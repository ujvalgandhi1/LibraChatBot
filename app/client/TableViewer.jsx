import React, { useEffect, useMemo, useState } from 'react';

// Render tabular datasets (CSV / TSV / JSON) as an on-screen, view-only table so
// they open in the browser instead of downloading to disk. Reuses the PDF
// viewer's top-bar chrome (.pdfv-bar / .pdfv-name / .pdfv-badge / .pdfv-count).

const MAX_BYTES = 512 * 1024; // fetch at most ~512 KB for the preview
const MAX_ROWS = 10;          // show only the first N rows for a fast preview

function hashU() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  return new URLSearchParams(qi === -1 ? '' : hash.slice(qi + 1)).get('u');
}
function fileUrl(u) {
  return u ? `/api/file?u=${encodeURIComponent(u)}` : null;
}
function fileName(u) {
  const s = String(u || '');
  // Databricks Hive metastore: <schema>.<table>@adb-...azuredatabricks.net -> schema.table
  const at = s.indexOf('@');
  if (at > 0 && /@adb-[^@/]+\.azuredatabricks\.net/i.test(s)) return s.slice(0, at);
  // Cosmos containers and ADX tables: show <database>.<name> rather than the bare leaf.
  const cosmos = /\/dbs\/([^/]+)\/colls\/([^/?]+)/i.exec(s);
  if (cosmos) { try { return `${decodeURIComponent(cosmos[1])}.${decodeURIComponent(cosmos[2])}`; } catch { /* fall through */ } }
  const adx = /\.kusto\.(?:windows\.net|azuresynapse\.net)\/([^/]+)\/([^/?]+)/i.exec(s);
  if (adx) { try { return `${decodeURIComponent(adx[1])}.${decodeURIComponent(adx[2])}`; } catch { /* fall through */ } }
  try { return (decodeURIComponent(s.split('/').pop()) || 'Dataset').replace(/\?.*$/, ''); }
  catch { return 'Dataset'; }
}
function extOf(name) { return (name.split('.').pop() || '').toLowerCase(); }

function detectDelimiter(sample, ext) {
  if (ext === 'tsv') return '\t';
  const line = sample.split(/\r?\n/).find((l) => l.trim().length) || '';
  const counts = { ',': 0, '\t': 0, ';': 0, '|': 0 };
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
}

// RFC-4180-ish parser: handles quoted fields, escaped "" quotes, and newlines
// inside quotes. Returns an array of string[] rows.
function parseDsv(text, delim) {
  const rows = []; let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c === '\r') { if (text[i + 1] !== '\n') { row.push(field); field = ''; rows.push(row); row = []; } }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function fmt(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val));
  return String(v);
}

// Best-effort: array of objects -> columns from the union of keys; array of
// primitives -> a single column; anything else -> null (caller shows raw text).
function jsonToTable(text) {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : null);
  if (!arr || !arr.length) return null;
  if (arr.every((v) => v === null || typeof v !== 'object')) {
    return { headers: ['value'], rows: arr.map((v) => [fmt(v)]) };
  }
  const keys = []; const seen = new Set();
  for (const obj of arr.slice(0, 200)) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const k of Object.keys(obj)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  if (!keys.length) return null;
  const rows = arr.map((obj) => keys.map((k) => fmt(obj && typeof obj === 'object' ? obj[k] : undefined)));
  return { headers: keys, rows };
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/401|403|not authorized/i.test(m)) return 'You are not authorized to view this file, or it is on a private network this app cannot reach.';
  if (/404|not found/i.test(m)) return 'File not found.';
  return 'Unable to display this dataset.';
}

// Build a hyparquet AsyncBuffer backed by ranged GETs to /api/file. Parquet is
// read footer-first, so we probe the total size with a 1-byte range and then
// let hyparquet pull only the byte ranges it needs (cached to avoid re-fetches).
async function makeParquetBuffer(url, cachedAsyncBuffer) {
  const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  if (!probe.ok && probe.status !== 206) {
    throw new Error(probe.status === 403 ? 'not authorized' : `Request failed (${probe.status})`);
  }
  let byteLength = 0;
  const cr = probe.headers.get('content-range'); // e.g. "bytes 0-0/12345678"
  const mm = cr && /\/(\d+)\s*$/.exec(cr);
  if (mm) byteLength = Number(mm[1]);
  if (!byteLength) byteLength = Number(probe.headers.get('content-length')) || 0;
  try { await probe.arrayBuffer(); } catch { /* drain the 1-byte probe body */ }
  if (!byteLength) throw new Error('Could not determine file size.');
  const base = {
    byteLength,
    async slice(start, end) {
      const last = (end == null ? byteLength : end) - 1;
      if (last < start) return new ArrayBuffer(0);
      const r = await fetch(url, { headers: { Range: `bytes=${start}-${last}` } });
      if (!r.ok && r.status !== 206) {
        throw new Error(r.status === 403 ? 'not authorized' : `Request failed (${r.status})`);
      }
      return r.arrayBuffer();
    },
  };
  return cachedAsyncBuffer ? cachedAsyncBuffer(base) : base;
}

export default function TableViewer({ src, embedded = false }) {
  const rawU = src || hashU() || '';
  const name = fileName(rawU);
  const [status, setStatus] = useState('loading'); // loading | done | error | raw
  const [error, setError] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [rawText, setRawText] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState({ col: -1, dir: 0 }); // dir: 1 asc, -1 desc, 0 none

  useEffect(() => {
    if (embedded) return;
    document.title = `${name} — View only`;
  }, [name, embedded]);

  // Deterrents (mirrors the PDF viewer): mark view-only, block the context menu
  // and save/print shortcuts. Text selection stays on so tables are readable.
  useEffect(() => {
    if (!embedded) document.body.classList.add('viewer-mode');
    const blockCtx = (e) => e.preventDefault();
    const blockKeys = (e) => {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'p')) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('contextmenu', blockCtx);
    window.addEventListener('keydown', blockKeys, true);
    return () => {
      document.body.classList.remove('viewer-mode');
      document.removeEventListener('contextmenu', blockCtx);
      window.removeEventListener('keydown', blockKeys, true);
    };
  }, [embedded]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    setHeaders([]);
    setRows([]);
    setRawText('');
    setSort({ col: -1, dir: 0 });
    setFilter('');
    const isSql = /^mssql:\/\//i.test(rawU);
    const isDbx = /^databricks:\/\//i.test(rawU) || /@adb-[^@/]+\.azuredatabricks\.net$/i.test(rawU);
    const isCosmos = /^https:\/\/[^/]+\.documents\.azure\.com\/dbs\/[^/]+\/colls\/[^/]+\/?$/i.test(rawU);
    const isAdx = /^https:\/\/[^/]+\.kusto\.(windows\.net|azuresynapse\.net)\/[^/]+\/[^/]+\/?$/i.test(rawU);
    // Each of these is served by a dedicated endpoint returning {columns,rows,rowCap}.
    const endpoint = isSql ? 'sql-preview'
      : isDbx ? 'databricks-preview'
      : isCosmos ? 'cosmos-preview'
      : isAdx ? 'adx-preview'
      : null;
    const url = fileUrl(rawU);
    if (!endpoint && !url) { setError('No file specified.'); setStatus('error'); return; }
    const ext = extOf(name);
    (async () => {
      try {
        if (endpoint) {
          const resp = await fetch(`/api/${endpoint}?u=${encodeURIComponent(rawU)}`);
          const j = await resp.json().catch(() => ({}));
          if (cancelled) return;
          if (!resp.ok) { setError(j.error || 'Unable to load this table preview.'); setStatus('error'); return; }
          const cols = j.columns || [];
          if (!cols.length) { setError('This table has no columns to display.'); setStatus('error'); return; }
          setHeaders(cols);
          setRows((j.rows || []).map((r) => r.map(fmt)));
          setTruncated((j.rows || []).length >= (j.rowCap || MAX_ROWS));
          setStatus('done');
          return;
        }
        if (ext === 'parquet') {
          const [{ parquetMetadataAsync, parquetReadObjects, cachedAsyncBuffer }, { compressors }] =
            await Promise.all([import('hyparquet'), import('hyparquet-compressors')]);
          const file = await makeParquetBuffer(url, cachedAsyncBuffer);
          if (cancelled) return;
          const metadata = await parquetMetadataAsync(file);
          if (cancelled) return;
          const total = Number(metadata.num_rows ?? 0);
          const rowEnd = Math.min(total || MAX_ROWS, MAX_ROWS);
          const objs = await parquetReadObjects({ file, metadata, compressors, rowStart: 0, rowEnd });
          if (cancelled) return;
          const cols = objs.length ? Object.keys(objs[0]) : [];
          if (!cols.length) { setError('This dataset has no readable columns.'); setStatus('error'); return; }
          setHeaders(cols);
          setRows(objs.map((o) => cols.map((c) => fmt(o[c]))));
          setTruncated(total > rowEnd);
          setStatus('done');
          return;
        }

        const resp = await fetch(url, { headers: { Range: `bytes=0-${MAX_BYTES - 1}` } });
        if (!resp.ok && resp.status !== 206) {
          throw new Error(resp.status === 403 ? 'not authorized' : `Request failed (${resp.status})`);
        }
        let text = await resp.text();
        if (cancelled) return;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM

        let isTrunc = false;
        const cr = resp.headers.get('content-range'); // e.g. "bytes 0-4194303/12345678"
        const m = cr && /bytes \d+-(\d+)\/(\d+)/.exec(cr);
        if (m) isTrunc = Number(m[2]) > Number(m[1]) + 1;

        if (ext === 'json') {
          const table = jsonToTable(text);
          if (!table) { if (!cancelled) { setRawText(text); setStatus('raw'); } return; }
          if (!cancelled) {
            setHeaders(table.headers);
            setRows(table.rows.slice(0, MAX_ROWS));
            setTruncated(isTrunc || table.rows.length > MAX_ROWS);
            setStatus('done');
          }
          return;
        }

        const delim = detectDelimiter(text.slice(0, 4096), ext);
        const parsed = parseDsv(text, delim);
        if (isTrunc && parsed.length) parsed.pop(); // last row may be cut mid-line
        if (!parsed.length) { setError('This file appears to be empty.'); setStatus('error'); return; }
        const h = parsed[0].map((c, i) => (c === '' ? `Column ${i + 1}` : c));
        const r = parsed.slice(1);
        if (!cancelled) {
          setHeaders(h);
          setRows(r.slice(0, MAX_ROWS));
          setTruncated(isTrunc || r.length > MAX_ROWS);
          setStatus('done');
        }
      } catch (e) {
        if (!cancelled) { setError(friendly(e)); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [rawU, name]);

  // A column is numeric only if every sampled non-empty value parses as a number.
  const numericCols = useMemo(() => {
    const sample = rows.slice(0, 50);
    if (!sample.length) return headers.map(() => false);
    return headers.map((_, i) => sample.every((row) => {
      const v = row[i];
      return v === '' || v == null || Number.isFinite(Number(String(v).replace(/[,$%\s]/g, '')));
    }));
  }, [headers, rows]);

  const view = useMemo(() => {
    let out = rows;
    const f = filter.trim().toLowerCase();
    if (f) out = out.filter((row) => row.some((c) => String(c).toLowerCase().includes(f)));
    if (sort.col >= 0 && sort.dir) {
      const num = numericCols[sort.col];
      const toNum = (v) => Number(String(v ?? '').replace(/[,$%\s]/g, '')) || 0;
      out = [...out].sort((a, b) => {
        const cmp = num
          ? toNum(a[sort.col]) - toNum(b[sort.col])
          : String(a[sort.col] ?? '').localeCompare(String(b[sort.col] ?? ''), undefined, { numeric: true });
        return cmp * sort.dir;
      });
    }
    return out;
  }, [rows, filter, sort, numericCols]);

  const toggleSort = (i) => setSort((s) =>
    s.col !== i ? { col: i, dir: 1 } : { col: i, dir: s.dir === 1 ? -1 : s.dir === -1 ? 0 : 1 });

  return (
    <div className={embedded ? 'tblv is-embedded' : 'tblv'}>
      {!embedded && (
        <div className="pdfv-bar">
          <span className="pdfv-name" title={name}>{name}</span>
          <span className="pdfv-badge">View only</span>
          {status === 'done' && (
            <span className="pdfv-count">
              {view.length.toLocaleString()}{view.length !== rows.length ? ` / ${rows.length.toLocaleString()}` : ''} rows × {headers.length} cols{truncated ? ' · preview' : ''}
            </span>
          )}
        </div>
      )}

      {status === 'done' && (
        <div className="tblv-tools">
          <input
            className="tblv-filter"
            type="text"
            placeholder="Filter rows…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter rows"
          />
          {truncated && <span className="tblv-hint">Only {MAX_ROWS} rows displayed.</span>}
        </div>
      )}

      {status === 'loading' && <div className="pdfv-state"><div className="spinner" /> Loading dataset…</div>}
      {status === 'error' && <div className="pdfv-state error">⚠ {error}</div>}
      {status === 'raw' && <div className="tblv-scroll"><pre className="tblv-raw">{rawText}</pre></div>}

      {status === 'done' && (
        <div className="tblv-scroll">
          <table className="tblv-grid">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className={numericCols[i] ? 'num' : undefined} onClick={() => toggleSort(i)} title={h}>
                    {h}{sort.col === i && sort.dir ? <span className="tblv-arrow">{sort.dir === 1 ? '▲' : '▼'}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((row, ri) => (
                <tr key={ri}>
                  {headers.map((_, ci) => (
                    <td key={ci} className={numericCols[ci] ? 'num' : undefined} title={row[ci]}>{row[ci]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
