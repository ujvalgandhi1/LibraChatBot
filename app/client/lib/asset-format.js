// What kind of asset is this, and how should it be shown?
//
// `formatOf` is one half of a cross-language contract: it MUST agree with
// `format_of()` in Chatbot/scripts/to-jsonl.py, which computes the same value at
// index time. The badge on a result row is derived here; the facet the row falls
// under comes from the indexed field. If the two drift, a row can show "PDF" while
// being counted under a different format.
//
// Both sides are pinned by scripts/format_fixtures.json — see client/test/format.test.js
// and scripts/test_to_jsonl.py. Add a fixture whenever you touch these rules.

export function isSql(qualifiedName) {
  return /^mssql:\/\//i.test(qualifiedName || '');
}

// Databricks tables: Unity Catalog (databricks://.../tables/...) or Hive
// metastore (<schema>.<table>@adb-...azuredatabricks.net).
export function isDatabricks(qualifiedName) {
  const qn = qualifiedName || '';
  return /^databricks:\/\//i.test(qn) || /@adb-[^@/]+\.azuredatabricks\.net$/i.test(qn);
}

export function isCosmos(qualifiedName) {
  return /^https:\/\/[^/]+\.documents\.azure\.com\/dbs\/[^/]+\/colls\/[^/]+\/?$/i.test(qualifiedName || '');
}

export function isAdx(qualifiedName) {
  return /^https:\/\/[^/]+\.kusto\.(windows\.net|azuresynapse\.net)\/[^/]+\/[^/]+\/?$/i.test(qualifiedName || '');
}

export function isQueryable(qualifiedName) {
  return isSql(qualifiedName) || isDatabricks(qualifiedName) || isCosmos(qualifiedName) || isAdx(qualifiedName);
}

export function isPdf(qualifiedName) { return /\.pdf(\?|$)/i.test(qualifiedName || ''); }
export function isTabular(qualifiedName) { return /\.(csv|tsv|json|parquet)(\?|$)/i.test(qualifiedName || ''); }
// svg and tiff are deliberately excluded: svg can execute script, tiff won't render.
export function isImage(qualifiedName) { return /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(qualifiedName || ''); }
export function isStorage(qualifiedName) { return /\.(dfs|blob)\.core\.windows\.net/i.test(qualifiedName || ''); }
export function isViewable(qualifiedName) { return isQueryable(qualifiedName) || isStorage(qualifiedName); }

export function previewKind(qn) {
  if (isPdf(qn)) return 'pdf';
  if (isImage(qn)) return 'image';
  if (isQueryable(qn) || isTabular(qn)) return 'table';
  return 'none';
}

export function viewerHref(qualifiedName) {
  const enc = encodeURIComponent(qualifiedName);
  if (isPdf(qualifiedName)) return `/#/view?u=${enc}`;
  if (isImage(qualifiedName)) return `/#/image?u=${enc}`;
  if (isQueryable(qualifiedName) || isTabular(qualifiedName)) return `/#/table?u=${enc}`;
  return `/api/file?u=${enc}`;
}

// Short badge label for a result row, derived from the qualified name.
// Mirrors format_of() in scripts/to-jsonl.py — keep the two in step.
export function formatOf(qn) {
  const s = qn || '';
  if (isCosmos(s)) return 'container';
  if (isAdx(s)) return 'kusto';
  if (isSql(s)) return 'sql';
  if (isDatabricks(s)) return 'table';
  const m = /\.([a-z0-9]{1,8})(?:\?|$)/i.exec(s);
  return m ? m[1].toLowerCase() : 'file';
}
