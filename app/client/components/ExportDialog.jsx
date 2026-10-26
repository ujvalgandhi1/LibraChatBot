// Bulk CSV export dialog.
//
// Browsing holds only one page in memory, so "everything matching the filters" has to be
// re-fetched from the index rather than read off the screen - hence fetchAll.
import React, { useState, useEffect } from 'react';

import { EXPORT_COLS, DEFAULT_COLS, explode, downloadCsv } from '../lib/export.js';

export default function ExportDialog({ open, onClose, picked, filtered, all, query, browse, total, fetchAll }) {
  const [scope, setScope] = useState('filtered');
  const [cols, setCols] = useState(() => new Set(DEFAULT_COLS));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const slug = (query || 'all-assets').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    setName(`libra-${slug}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`);
    setScope((s) => (s === 'selected' && !picked.length ? 'filtered' : s));
  }, [open, query, picked.length]);

  if (!open) return null;

  const sets = { selected: picked, filtered, all };
  // Browsing holds one page in memory, so the filtered count comes from the index.
  const counts = {
    selected: explode(picked).length,
    filtered: browse ? total : explode(filtered).length,
    all: explode(all).length
  };
  const rows = counts[scope] ?? 0;
  const scopes = browse
    ? [
      ['selected', 'Selected rows only', counts.selected, !picked.length],
      ['filtered', 'Every asset matching the current filters', counts.filtered, false]
    ]
    : [
      ['selected', 'Selected rows only', counts.selected, !picked.length],
      ['filtered', 'Everything matching the current filters', counts.filtered, false],
      ['all', 'All results for this search, ignoring facets', counts.all, false]
    ];

  const onDownload = async () => {
    if (browse && scope === 'filtered') {
      setBusy(true);
      try {
        downloadCsv(await fetchAll(), cols, name);
      } finally {
        setBusy(false);
      }
    } else {
      downloadCsv(sets[scope], cols, name);
    }
    onClose();
  };

  const toggleCol = (k) => setCols((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <div className="modal open" role="dialog" aria-modal="true" aria-labelledby="exportTitle">
        <div className="modal-head">
          <button className="x" type="button" onClick={onClose} aria-label="Close">×</button>
          <h2 id="exportTitle">Bulk export</h2>
          <p>{browse ? 'Narrow the catalog with facets, then take the result set away as CSV.' : 'Search, narrow with facets, then take the result set away as CSV.'}</p>
        </div>
        <div className="modal-body">
          <section>
            <h4>What to export</h4>
            <div className="scopes">
              {scopes.map(([k, label, n, dis]) => (
                <label className={`scope${scope === k ? ' on' : ''}${dis ? ' dis' : ''}`} key={k}>
                  <input type="radio" name="scope" value={k} checked={scope === k} disabled={dis} onChange={() => setScope(k)} />
                  <span>{label}</span>
                  <span className="n">{n}</span>
                </label>
              ))}
            </div>
          </section>
          <section>
            <h4>
              Columns
              <span className="norm">
                {' — '}
                <button className="linkbtn" type="button" onClick={() => setCols(new Set(EXPORT_COLS.map((c) => c.k)))}>all</button>
                {' · '}
                <button className="linkbtn" type="button" onClick={() => setCols(new Set())}>none</button>
                {' · '}
                <button className="linkbtn" type="button" onClick={() => setCols(new Set(DEFAULT_COLS))}>reset</button>
              </span>
            </h4>
            <div className="colgrid">
              {EXPORT_COLS.filter((c) => !(browse && c.k === 'relevance_score')).map((c) => (
                <label className="col" key={c.k}>
                  <input type="checkbox" checked={cols.has(c.k)} onChange={() => toggleCol(c.k)} />
                  <span className="k" title={c.k}>{c.k}</span>
                </label>
              ))}
            </div>
          </section>
          <section>
            <h4>File name</h4>
            <input className="filenm" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </section>
        </div>
        <div className="modal-foot">
          <span className="summary">
            <b>{rows.toLocaleString()}</b> rows × <b>{cols.size}</b> columns
            <span className="muted"> · one row per catalogued location</span>
          </span>
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            type="button"
            disabled={!rows || !cols.size || busy}
            onClick={onDownload}
          >
            {busy ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      </div>
    </>
  );
}
