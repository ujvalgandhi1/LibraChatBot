// Presentation helpers: labels, colours, and the tiny markdown renderer.

import { formatOf } from './asset-format.js';

const TYPE_LABELS = {
  azure_datalake_gen2_path: 'Data Lake file',
  databricks_table: 'Databricks table',
  databricks_catalog: 'Databricks catalog',
  databricks_schema: 'Databricks schema',
  hive_table: 'Hive table',
  hive_view: 'Hive view',
  azure_sql_table: 'Azure SQL table',
  azure_sql_db: 'Azure SQL database',
  azure_synapse_dedicated_sql_table: 'Synapse SQL table',
  azure_cosmosdb_sqlapi_collection: 'Cosmos DB container',
  azure_data_explorer_table: 'Data Explorer table',
  adf_copy_activity: 'Data Factory copy activity'
};
export const typeLabel = (t) => TYPE_LABELS[t] || t || 'unknown';

export const FMT_COLOR = {
  csv: '#1f7a4d', tsv: '#1f7a4d', json: '#a2681b', parquet: '#5b3fbf', pdf: '#b3352b',
  docx: '#1f5fa8', doc: '#1f5fa8', xlsx: '#1f7a4d', png: '#0b7285', jpg: '#0b7285',
  jpeg: '#0b7285', gif: '#0b7285', webp: '#0b7285', bmp: '#0b7285',
  table: '#c9432c', sql: '#1f5fa8', container: '#2b7a4b', kusto: '#8a5a00', file: '#5b6472'
};
const FMT_ABBR = { table: 'TBL', container: 'DOC', kusto: 'KQL', file: 'FILE', jpeg: 'JPG' };

export const abbr = (f) => FMT_ABBR[f] || f.slice(0, 4).toUpperCase();
// Indexed since the format field was added; derived for documents predating it.
export const fmtOf = (a) => a.format || formatOf(a.qualifiedName);

// Minimal client-side sanitization for caption highlights (server returns <em> only).
export function sanitize(html) {
  return String(html)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;em&gt;/g, '<em>')
    .replace(/&lt;\/em&gt;/g, '</em>');
}

// Captions are extracted from markdown descriptions, so they arrive carrying
// ###, ** and backticks. Strip the syntax but keep the <em> highlights.
export function cleanCaption(s) {
  return String(s || '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shortPath(qn) {
  try {
    const u = new URL(qn);
    return u.hostname.split('.')[0] + decodeURIComponent(u.pathname);
  } catch { return qn || ''; }
}

export function band(score) {
  if (score == null) return ['good', 'Match'];
  if (score >= 3.0) return ['strong', 'Strong match'];
  if (score >= 2.3) return ['good', 'Good match'];
  return ['fair', 'Fair match'];
}

export const initials = (n) => String(n).split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/* The AI description is markdown-ish: ### headings, - bullets, `code`, **bold**.
   Rendered here rather than pulling in a parser for four constructs. */
export function renderDescription(text) {
  const inline = (s) => sanitize(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let list = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) { (list ||= []).push(inline(li[1])); continue; }
    if (list) { out.push(`<ul>${list.map((x) => `<li>${x}</li>`).join('')}</ul>`); list = null; }
    if (h) { out.push(`<h4>${inline(h[2])}</h4>`); continue; }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.map((x) => `<li>${x}</li>`).join('')}</ul>`);
  return out.join('');
}
