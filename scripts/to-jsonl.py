#!/usr/bin/env python
"""
Convert main_assets (CSV or Parquet) into JSON Lines for the Azure AI Search
blob indexer.

CSV needs nothing beyond the standard library. Parquet lazily imports pyarrow,
so the common path has no install cost.

Why JSONL rather than CSV as the indexer input: userDescription is multi-line
markdown containing commas, quotes and newlines. One mis-escaped quote in a CSV
silently shifts every column on that row. JSONL has no delimiter ambiguity.

Field names are emitted to match the index schema exactly, so the indexer needs
no fieldMappings.

  python to-jsonl.py                          # ../main_assets.csv -> ../out/jsonl
  python to-jsonl.py --source assets.parquet
  python to-jsonl.py --max-mb 8
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

# CSV column -> index field. Anything not listed is dropped, with a warning.
FIELD_MAP = {
    "asset_id": "assetId",
    "name": "name",
    "asset_entity_type": "assetEntityType",
    "asset_type_friendly": "assetTypeFriendly",
    "PurviewURL": "purviewUrl",
    "displayText": "displayText",
    "qualifiedName": "qualifiedName",
    "collectionId": "collectionId",
    "collectionName": "collectionName",
    "owner": "owner",
    "expert": "expert",
    "userDescription": "userDescription",
}

# Blank rather than absent, so `owner eq ''` finds unassigned assets. A missing
# field would index as null and never match that filter.
STRING_FIELDS = list(FIELD_MAP.values())

INVALID_KEY_CHARS = re.compile(r"[^A-Za-z0-9_\-=]")

# Mirrors formatOf() in app/client/App.jsx. Kept in step with it: the client falls
# back to deriving this per row, so the two must agree or badges and facet values
# disagree for the same asset.
COSMOS_QN = re.compile(r"^https://[^/]+\.documents\.azure\.com/dbs/[^/]+/colls/[^/]+/?$", re.I)
ADX_QN = re.compile(r"^https://[^/]+\.kusto\.(windows\.net|azuresynapse\.net)/[^/]+/[^/]+/?$", re.I)
SQL_QN = re.compile(r"^mssql://", re.I)
DATABRICKS_QN = re.compile(r"^databricks://|@adb-[^@/]+\.azuredatabricks\.net$", re.I)
EXTENSION = re.compile(r"\.([a-z0-9]{1,8})(?:\?|$)", re.I)


def format_of(qualified_name: str) -> str:
    qn = qualified_name or ""
    if COSMOS_QN.search(qn):
        return "container"
    if ADX_QN.search(qn):
        return "kusto"
    if SQL_QN.search(qn):
        return "sql"
    if DATABRICKS_QN.search(qn):
        return "table"
    m = EXTENSION.search(qn)
    return m.group(1).lower() if m else "file"

# csv defaults to 128 KB per field; userDescription is larger than that.
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def sanitize_key(raw: str, seen: set[str]) -> str:
    """Mirrors Sanitize-Key in ingest.ps1 so keys match documents already indexed."""
    key = INVALID_KEY_CHARS.sub("_", raw) if raw else ""
    if not key:
        key = f"row_{len(seen) + 1}"
    base, n = key, 1
    while key in seen:
        n += 1
        key = f"{base}_{n}"
    seen.add(key)
    return key


def read_csv(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        unknown = [c for c in (reader.fieldnames or []) if c not in FIELD_MAP]
        if unknown:
            print(f"  ignoring unmapped columns: {', '.join(unknown)}")
        for row in reader:
            yield row


def read_parquet(path: Path):
    try:
        import pyarrow.parquet as pq
    except ImportError:
        sys.exit("Parquet input needs pyarrow.  pip install pyarrow")
    table = pq.read_table(path)
    unknown = [c for c in table.column_names if c not in FIELD_MAP]
    if unknown:
        print(f"  ignoring unmapped columns: {', '.join(unknown)}")
    for batch in table.to_batches():
        for row in batch.to_pylist():
            yield row


def build_doc(row: dict, seen: set[str], max_desc: int) -> dict:
    doc = {}
    for src, dest in FIELD_MAP.items():
        value = row.get(src)
        doc[dest] = "" if value is None else str(value).strip()

    doc["id"] = sanitize_key(doc.get("assetId", ""), seen)
    doc["format"] = format_of(doc.get("qualifiedName", ""))

    if max_desc and len(doc["userDescription"]) > max_desc:
        doc["userDescription"] = doc["userDescription"][:max_desc]

    # Same text ingest.ps1 embeds today, precomputed so the skillset's embedding
    # skill produces identical vectors and relevance does not shift.
    embed = f"{doc['name']} [{doc['assetEntityType']}]\n{doc['userDescription']}".strip()
    doc["embedText"] = embed or doc["name"]
    return doc


def main() -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default=str(here.parent / "main_assets.csv"))
    ap.add_argument("--out", default=str(here.parent / "out" / "jsonl"))
    # Basic tier caps a blob source file at 16 MB; 8 leaves headroom and parallelises.
    ap.add_argument("--max-mb", type=float, default=8.0)
    ap.add_argument("--max-desc", type=int, default=8000, help="truncate userDescription (0 disables)")
    args = ap.parse_args()

    source = Path(args.source)
    if not source.exists():
        sys.exit(f"Source not found: {source}")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("main_assets-*.jsonl"):
        stale.unlink()

    print(f"Reading {source}")
    rows = read_parquet(source) if source.suffix.lower() == ".parquet" else read_csv(source)

    max_bytes = int(args.max_mb * 1024 * 1024)
    seen: set[str] = set()
    part, written, part_bytes, truncated = 1, 0, 0, 0
    handle = None

    try:
        for row in rows:
            doc = build_doc(row, seen, args.max_desc)
            if args.max_desc and len(str(row.get("userDescription") or "")) > args.max_desc:
                truncated += 1

            line = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
            encoded = line.encode("utf-8")

            if handle is None or (part_bytes + len(encoded) > max_bytes):
                if handle:
                    handle.close()
                    print(f"  wrote part {part:03d}  {part_bytes / 1024 / 1024:.2f} MB")
                    part += 1
                # No BOM: the indexer expects plain UTF-8.
                handle = (out_dir / f"main_assets-{part:03d}.jsonl").open("w", encoding="utf-8", newline="\n")
                part_bytes = 0

            handle.write(line)
            part_bytes += len(encoded)
            written += 1
    finally:
        if handle:
            handle.close()
            print(f"  wrote part {part:03d}  {part_bytes / 1024 / 1024:.2f} MB")

    print(f"\n{written} documents across {part} file(s) in {out_dir}")
    if truncated:
        print(f"{truncated} description(s) truncated to {args.max_desc} chars")
    if written != len(seen):
        print("WARNING: duplicate asset_id values were de-duplicated into distinct keys")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
