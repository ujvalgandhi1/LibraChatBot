// The left-hand refine rail.
//
// Counts come from two different places depending on mode: in browse the server sends
// true index-wide counts with the page; in search they are tallied from the rows on
// screen, so what the rail says always matches what you can see.
import React, { useState } from 'react';

import { FACETS, EMPTY_VALUE, GAP_VALUES, facetLabel } from '../lib/facets.js';

export default function FacetRail({ results, selected, onToggle, onClearAll, serverFacets }) {
  const [closed, setClosed] = useState(() => new Set(FACETS.filter((f) => !f.open).map((f) => f.key)));
  const [more, setMore] = useState(() => new Set());
  const anySelected = Object.values(selected).some((s) => s.size > 0);

  const flip = (setter) => (k) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const toggleGroup = flip(setClosed);
  const toggleMore = flip(setMore);

  return (
    <aside className="rail">
      <div className="rail-top">
        <h2>Refine</h2>
        <span className="spacer" />
        <button className="linkbtn" type="button" onClick={onClearAll} disabled={!anySelected}>Clear all</button>
      </div>
      <div className="rail-scroll">
        {FACETS.map((f) => {
          let rows;
          if (serverFacets) {
            // Browse: counts describe the whole catalog, so they arrive with the page.
            const b = serverFacets[f.key];
            if (!b || !b.length) return null;
            rows = b.map((x) => [x.value === '' ? EMPTY_VALUE[f.key] ?? '(none)' : x.value, x.count]);
          } else {
            const counts = new Map();
            for (const a of results) for (const v of f.values(a)) counts.set(v, (counts.get(v) || 0) + 1);
            if (!counts.size) return null;
            rows = [...counts.entries()];
          }
          rows.sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])));
          const on = selected[f.key];
          const showAll = more.has(f.key);
          const shown = showAll ? rows : rows.slice(0, 6);
          return (
            <div className={`facet${closed.has(f.key) ? ' closed' : ''}`} key={f.key}>
              <button className="facet-head" type="button" onClick={() => toggleGroup(f.key)} aria-expanded={!closed.has(f.key)}>
                <h3>{f.title}</h3>
                <span className="prov" title={`Reads ${f.col} from main_assets.csv`}>{f.col}</span>
                {on.size > 0 && <span className="on-n">{on.size}</span>}
                <span className="caret">▼</span>
              </button>
              <div className="facet-list">
                {shown.map(([v, n]) => (
                  <button
                    key={String(v)}
                    type="button"
                    className={`facet-row${on.has(v) ? ' on' : ''}${GAP_VALUES.has(v) ? ' gap' : ''}`}
                    onClick={() => onToggle(f.key, v)}
                    aria-pressed={on.has(v)}
                  >
                    <span className="facet-box">{on.has(v) ? '✓' : ''}</span>
                    <span className="facet-label" title={facetLabel(f.key, v)}>{facetLabel(f.key, v)}</span>
                    <span className="facet-count">{n}</span>
                  </button>
                ))}
                {rows.length > 6 && (
                  <button className="facet-more" type="button" onClick={() => toggleMore(f.key)}>
                    {showAll ? 'Show less' : `Show ${rows.length - 6} more`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <p className="rail-note">
          {serverFacets
            ? 'Counts come from the whole index, not just the rows on this page.'
            : 'Counts come from the results on screen.'}
          {' '}Each grey badge names the <code>main_assets.csv</code> column that facet reads.
        </p>
      </div>
    </aside>
  );
}
