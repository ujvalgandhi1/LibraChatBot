import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';

import { isTabular, isImage, isPdf, isQueryable, isViewable } from './lib/asset-format.js';
import { FACETS, emptyFacets, keyOf, wireFacets } from './lib/facets.js';
import RatingBar from './components/RatingBar.jsx';
import FacetRail from './components/FacetRail.jsx';
import ResultRow from './components/ResultRow.jsx';
import PreviewPane from './components/PreviewPane.jsx';
import ExportDialog from './components/ExportDialog.jsx';

// Shown until the query log has enough traffic to rank real searches.
const FALLBACK_EXAMPLES = [
  'tables that track equipment inventory for staff',
  'customer financial transactions and accounts',
  'sales order data in the data lake',
  'employee or HR related datasets'
];

const TOP = 50;
const PAGE = 50;

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [error, setError] = useState('');
  const [searched, setSearched] = useState('');
  const [searchId, setSearchId] = useState(0);
  const [serverSearchId, setServerSearchId] = useState(null);
  const [popular, setPopular] = useState([]);
  const [selected, setSelected] = useState(emptyFacets);
  const [openKey, setOpenKey] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [sort, setSort] = useState('rel');
  const [exportOpen, setExportOpen] = useState(false);
  const [mode, setMode] = useState('browse'); // browse | search
  const [serverFacets, setServerFacets] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/popular-searches')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (!cancelled) setPopular(Array.isArray(d.items) ? d.items : []); })
      .catch(() => { /* curated examples stay in place */ });
    return () => { cancelled = true; };
  }, []);

  const runBrowse = useCallback(async (sel, srt = 'name', pg = 0) => {
    const use = sel ?? emptyFacets();
    setStatus('loading');
    setError('');
    setMode('browse');
    setSearched('');
    setServerSearchId(null);
    setSort(srt);
    setPage(pg);
    setOpenKey(null);
    window.history.replaceState(null, '', '#browse');
    try {
      const res = await fetch('/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facets: wireFacets(use), sort: srt, top: PAGE, skip: pg * PAGE })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setResults(data.results || []);
      setServerFacets(data.facets || null);
      setTotal(data.total || 0);
      setStatus('done');
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      setStatus('error');
    }
  }, []);

  const runSearch = useCallback(async (q) => {
    const term = (q ?? query).trim();
    if (!term) return runBrowse(emptyFacets());
    setStatus('loading');
    setError('');
    setMode('search');
    setSearched(term);
    setSearchId((n) => n + 1);
    setSelected(emptyFacets());
    setServerFacets(null);
    setSort('rel');
    setPicked(new Set());
    setOpenKey(null);
    window.history.replaceState(null, '', `#q=${encodeURIComponent(term)}`);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: term, top: TOP })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setResults(data.results || []);
      setServerSearchId(data.searchId || null);
      setStatus('done');
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      setStatus('error');
    }
  }, [query, runBrowse]);

  // Restore a shared search from the URL on first load; otherwise open on the catalog.
  useEffect(() => {
    const m = /q=([^&]*)/.exec(window.location.hash || '');
    const q = m ? decodeURIComponent(m[1]) : '';
    if (!q) { runBrowse(emptyFacets()); return; }
    setQuery(q);
    runSearch(q);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFacet = useCallback((key, value) => {
    const next = { ...selected, [key]: new Set(selected[key]) };
    if (next[key].has(value)) next[key].delete(value); else next[key].add(value);
    setSelected(next);
    if (mode === 'browse') runBrowse(next, sort, 0);
  }, [selected, mode, sort, runBrowse]);

  const clearFacets = useCallback(() => {
    const e = emptyFacets();
    setSelected(e);
    if (mode === 'browse') runBrowse(e, sort, 0);
  }, [mode, sort, runBrowse]);

  const changeSort = useCallback((v) => {
    setSort(v);
    if (mode === 'browse') runBrowse(selected, v, 0);
  }, [mode, selected, runBrowse]);

  const filtered = useMemo(() => {
    if (mode === 'browse') return results; // the server already filtered and sorted this page
    const out = results.filter((a) => FACETS.every((f) => {
      const on = selected[f.key];
      return !on.size || f.values(a).some((v) => on.has(v));
    }));
    const gov = (a) => (a.owner ? 1 : 0) + (a.expert ? 1 : 0);
    if (sort === 'name') out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sort === 'platform') out.sort((a, b) => (a.assetTypeFriendly || '').localeCompare(b.assetTypeFriendly || '') || (b.score ?? 0) - (a.score ?? 0));
    else if (sort === 'collection') out.sort((a, b) => (a.collectionName || '').localeCompare(b.collectionName || '') || (b.score ?? 0) - (a.score ?? 0));
    else if (sort === 'gov') out.sort((a, b) => gov(a) - gov(b) || (b.score ?? 0) - (a.score ?? 0));
    else out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return out;
  }, [results, selected, sort, mode]);

  const openItem = useMemo(() => filtered.find((a) => keyOf(a) === openKey) || null, [filtered, openKey]);
  const pickedItems = useMemo(() => results.filter((a) => picked.has(keyOf(a))), [results, picked]);

  // Arrow keys move the selection; Escape closes the pane; Ctrl+K focuses search.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); inputRef.current?.select(); return; }
      if (e.key === 'Escape') { setOpenKey(null); setExportOpen(false); return; }
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (!filtered.length) return;
      e.preventDefault();
      const i = filtered.findIndex((a) => keyOf(a) === openKey);
      const next = e.key === 'ArrowDown' ? Math.min(i + 1, filtered.length - 1) : Math.max(i - 1, 0);
      setOpenKey(keyOf(filtered[i === -1 ? 0 : next]));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, openKey]);

  useEffect(() => {
    document.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
  }, [openKey]);

  const onSubmit = (e) => { e.preventDefault(); runSearch(); };
  const chips = popular.length ? popular : FALLBACK_EXAMPLES.map((text) => ({ text, count: null }));
  const allChecked = filtered.length > 0 && filtered.every((a) => picked.has(keyOf(a)));
  const anyFilter = Object.values(selected).some((s) => s.size > 0);
  const pages = Math.ceil(total / PAGE);

  const fetchAllBrowse = useCallback(async () => {
    const out = [];
    for (let skip = 0; skip < 5000; skip += 1000) {
      const res = await fetch('/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facets: wireFacets(selected), sort, top: 1000, skip })
      });
      if (!res.ok) throw new Error('Could not load the full result set.');
      const d = await res.json();
      out.push(...(d.results || []));
      if (out.length >= (d.total || 0)) break;
    }
    return out;
  }, [selected, sort]);

  const toggleAll = () => setPicked((prev) => {
    const next = new Set(prev);
    for (const a of filtered) { if (allChecked) next.delete(keyOf(a)); else next.add(keyOf(a)); }
    return next;
  });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/logo.png" alt="Libra Asset Search" />
        </div>

        <form className="topsearch" onSubmit={onSubmit} role="search">
          <span className="mag" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="7" cy="7" r="4.6" /><path d="M10.4 10.4 14 14" strokeLinecap="round" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe what you're looking for, e.g. “equipment inventory by department”"
            aria-label="Search assets"
            autoFocus
          />
          <button type="submit" disabled={status === 'loading'}>
            {status === 'loading' ? 'Working…' : query.trim() ? 'Search' : 'Browse all'}
          </button>
        </form>

        <div className="topactions">
          <button
            className="icon-btn"
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={status !== 'done' || !results.length}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M8 1.8v8.4M5 7.4 8 10.4l3-3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2.4 11.4v1.4a1.4 1.4 0 0 0 1.4 1.4h8.4a1.4 1.4 0 0 0 1.4-1.4v-1.4" strokeLinecap="round" />
            </svg>
            Export
          </button>
        </div>
      </header>

      <div className="panes">
        {status === 'done' && (results.length > 0 || serverFacets) ? (
          <FacetRail
            results={results}
            selected={selected}
            onToggle={toggleFacet}
            onClearAll={clearFacets}
            serverFacets={mode === 'browse' ? serverFacets : null}
          />
        ) : (
          <aside className="rail">
            <div className="rail-top"><h2>Refine</h2></div>
            <div className="rail-scroll"><p className="rail-note">Run a search to see facets.</p></div>
          </aside>
        )}

        <section className="list">
          <div className="chips">
            <span className="chips-label">{popular.length ? 'Most common searches:' : 'Try:'}</span>
            {chips.map((c) => (
              <button
                key={c.text}
                type="button"
                className="chip"
                title={c.count ? `Searched ${c.count} times` : undefined}
                onClick={() => { setQuery(c.text); runSearch(c.text); }}
              >
                {c.text}{c.count ? <span className="n">{c.count}</span> : null}
              </button>
            ))}
          </div>

          {status === 'done' && results.length > 0 && (
            <div className="list-head">
              <label className="selall">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                <span>{allChecked ? `All ${filtered.length} selected` : `Select all ${filtered.length}`}</span>
              </label>
              <span>
                {mode === 'browse' ? (
                  <>
                    <strong>{total.toLocaleString()}</strong>
                    {' '}asset{total === 1 ? '' : 's'}{anyFilter ? ' matching your filters' : ' in the catalog'}
                    {total > PAGE ? ` · showing ${(page * PAGE + 1).toLocaleString()}–${Math.min((page + 1) * PAGE, total).toLocaleString()}` : ''}
                  </>
                ) : (
                  <>
                    <strong>{filtered.length}</strong>
                    {filtered.length !== results.length ? ` of ${results.length}` : ''}
                    {' '}match{filtered.length === 1 ? '' : 'es'} for “{searched}”
                  </>
                )}
              </span>
              <span className="spacer" />
              <label htmlFor="sortsel">Sort</label>
              <select id="sortsel" className="sortsel" value={sort} onChange={(e) => changeSort(e.target.value)}>
                {mode === 'search' && <option value="rel">Relevance</option>}
                <option value="name">Name (A–Z)</option>
                <option value="platform">Platform</option>
                <option value="collection">Collection</option>
                <option value="gov">Least governed first</option>
              </select>
            </div>
          )}

          <div className="rows">
            {status === 'idle' && (
              <div className="state hint">
                Search 900+ catalog assets by meaning — not just keywords. Results link straight to Microsoft Purview.
              </div>
            )}
            {status === 'loading' && <div className="state"><div className="spinner" /> {mode === 'browse' ? 'Loading the catalog…' : 'Searching the catalog…'}</div>}
            {status === 'error' && <div className="state error">⚠ {error}</div>}

            {status === 'done' && results.length === 0 && (mode === 'browse' ? (
              <div className="state hint">
                <p>No assets match the current filters.</p>
                <p><button className="btn" type="button" onClick={clearFacets}>Clear all filters</button></p>
              </div>
            ) : (
              <div className="state hint">
                <p>No matches found for “{searched}”. Results below the relevance threshold are discarded, so a very narrow query can come back empty.</p>
                <p>Try one of the searches above, rephrase in plainer language, or{' '}
                  <button className="linkbtn" type="button" onClick={() => { setQuery(''); runBrowse(emptyFacets()); }}>browse the whole catalog</button>.
                </p>
              </div>
            ))}
            {mode === 'search' && status === 'done' && results.length > 0 && filtered.length === 0 && (
              <div className="state hint">
                <p>Your filters hid everything. {results.length} result{results.length === 1 ? '' : 's'} matched the query but none survive the current facet selection.</p>
                <p><button className="btn" type="button" onClick={clearFacets}>Clear all filters</button></p>
              </div>
            )}

            {status === 'done' && filtered.map((item) => (
              <ResultRow
                key={keyOf(item)}
                item={item}
                selected={openKey === keyOf(item)}
                picked={picked.has(keyOf(item))}
                onOpen={() => setOpenKey(keyOf(item))}
                onPick={() => setPicked((prev) => {
                  const next = new Set(prev);
                  if (next.has(keyOf(item))) next.delete(keyOf(item)); else next.add(keyOf(item));
                  return next;
                })}
              />
            ))}
          </div>

          {mode === 'browse' && status === 'done' && pages > 1 && (
            <div className="pager">
              <button className="btn" type="button" disabled={page === 0} onClick={() => runBrowse(selected, sort, page - 1)}>Previous</button>
              <span className="muted">Page {page + 1} of {pages.toLocaleString()}</span>
              <button className="btn" type="button" disabled={page + 1 >= pages} onClick={() => runBrowse(selected, sort, page + 1)}>Next</button>
            </div>
          )}

          {picked.size > 0 && (            <div className="selbar">
              <b>{picked.size}</b> asset{picked.size === 1 ? '' : 's'} selected
              <span className="spacer" />
              <button type="button" className="ghost" onClick={() => setPicked(new Set())}>Clear selection</button>
              <button type="button" onClick={() => setExportOpen(true)}>Export CSV</button>
            </div>
          )}

          {mode === 'search' && status === 'done' && results.length > 0 && (
            <RatingBar key={searchId} query={searched} resultCount={results.length} searchId={serverSearchId} />
          )}
        </section>

        <PreviewPane item={openItem} onClose={() => setOpenKey(null)} />
      </div>

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        picked={pickedItems}
        filtered={filtered}
        all={results}
        query={searched}
        browse={mode === 'browse'}
        total={total}
        fetchAll={fetchAllBrowse}
      />

      <footer className="footer">
        <span>Powered by Azure AI Search + Microsoft Foundry · Private to your network</span>
      </footer>
    </div>
  );
}

