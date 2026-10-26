// CSV export of the current result set.

export const EXPORT_COLS = [
  { k: 'name', get: (a) => a.name },
  { k: 'asset_entity_type', get: (a) => a.assetEntityType },
  { k: 'asset_type_friendly', get: (a) => a.assetTypeFriendly },
  { k: 'collectionId', get: (a) => a.collectionId },
  { k: 'collectionName', get: (a) => a.collectionName },
  { k: 'qualifiedName', get: (a) => a.qualifiedName },
  { k: 'PurviewURL', get: (a) => a.purviewUrl },
  { k: 'owner', get: (a) => a.owner },
  { k: 'expert', get: (a) => a.expert },
  { k: 'location_count', get: (a) => (a.locations?.length ?? 1) },
  { k: 'relevance_score', get: (a) => (a.score == null ? '' : a.score.toFixed(2)) },
  { k: 'userDescription', get: (a) => String(a.userDescription || '').replace(/\s+/g, ' ').trim() }
];

export const DEFAULT_COLS = ['name', 'asset_type_friendly', 'collectionName', 'qualifiedName', 'PurviewURL', 'owner', 'expert'];

export function csvCell(v) {
  const s = String(v == null ? '' : v);
  // Guard against formula injection when the CSV is opened in Excel.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// One row per catalogued location, not per grouped card, so the export keeps
// the same grain as main_assets.csv.
export function explode(items) {
  const out = [];
  for (const a of items) {
    const locs = a.locations?.length ? a.locations : [{ qualifiedName: a.qualifiedName, purviewUrl: a.purviewUrl }];
    for (const l of locs) out.push({ ...a, qualifiedName: l.qualifiedName, purviewUrl: l.purviewUrl || a.purviewUrl });
  }
  return out;
}

export function downloadCsv(items, cols, filename) {
  const chosen = EXPORT_COLS.filter((c) => cols.has(c.k));
  const rows = explode(items);
  const lines = [chosen.map((c) => csvCell(c.k)).join(',')];
  for (const a of rows) lines.push(chosen.map((c) => csvCell(c.get(a))).join(','));
  // BOM so Excel reads UTF-8 correctly.
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[^\w.\-]+/g, '-') || 'libra-export.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
