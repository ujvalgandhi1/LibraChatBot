// The right-hand preview pane.
//
// The file, table or document renders beside the results instead of taking over a new
// tab, so the query is never lost. previewKind() decides which viewer to mount.
import React, { useState, useEffect } from 'react';

import PdfViewer from '../PdfViewer.jsx';
import TableViewer from '../TableViewer.jsx';
import ImageViewer from '../ImageViewer.jsx';
import { previewKind, viewerHref, formatOf, isViewable, isStorage } from '../lib/asset-format.js';
import {
  FMT_COLOR, abbr, typeLabel, shortPath, initials, renderDescription
} from '../lib/display.js';

export default function PreviewPane({ item, onClose }) {
  const [tab, setTab] = useState('preview');
  const [locIndex, setLocIndex] = useState(0);
  const key = item ? (item.qualifiedName || item.name) : null;

  useEffect(() => { setTab('preview'); setLocIndex(0); }, [key]);

  if (!item) {
    return (
      <section className="pane">
        <div className="pane-empty">
          <div>
            <p className="pane-empty-title">Select a result to preview it here</p>
            <p>The file, table or document renders beside your results — you never lose the query.</p>
          </div>
        </div>
      </section>
    );
  }

  const locations = item.locations?.length
    ? item.locations
    : [{ qualifiedName: item.qualifiedName, purviewUrl: item.purviewUrl, path: shortPath(item.qualifiedName) }];
  const active = locations[Math.min(locIndex, locations.length - 1)];
  const qn = active.qualifiedName;
  const kind = previewKind(qn);
  const fmt = formatOf(qn);
  const govN = (item.owner ? 1 : 0) + (item.expert ? 1 : 0);

  const tabs = [
    ['preview', kind === 'pdf' ? 'Document' : kind === 'image' ? 'Image' : kind === 'table' ? 'Data' : 'Preview', ''],
    ['desc', 'Description', ''],
    ['gov', 'Stewardship', String(govN)],
    ['locs', 'Locations', String(locations.length)]
  ];

  return (
    <section className="pane is-open" aria-live="polite">
      <div className="pane-head">
        <div className="pane-title">
          <span className="ftype" style={{ background: FMT_COLOR[fmt] || '#5b6472' }}>{abbr(fmt)}</span>
          <div className="pane-title-text">
            <h2>{item.name || '(unnamed asset)'}</h2>
            <p className="pane-sub">
              {[item.collectionName, item.assetTypeFriendly, typeLabel(item.assetEntityType)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button className="pane-close" type="button" onClick={onClose} aria-label="Close preview">×</button>
        </div>
        <div className="pane-acts">
          {active.purviewUrl
            ? <a className="btn primary" href={active.purviewUrl} target="_blank" rel="noopener noreferrer">Open in Purview ↗</a>
            : <span className="purview-missing">No Purview link</span>}
          {isViewable(qn) && (
            <a className="btn" href={viewerHref(qn)} target="_blank" rel="noopener noreferrer">Full screen ↗</a>
          )}
          <button className="btn" type="button" onClick={() => navigator.clipboard?.writeText(qn)}>Copy path</button>
        </div>
        <div className="tabs">
          {tabs.map(([k, l, n]) => (
            <button key={k} type="button" className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
              {l}{n ? <span className="n"> {n}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="pane-body">
        {tab === 'preview' && (
          <>
            {locations.length > 1 && (
              <div className="loc-switch">
                <span>Copy {locIndex + 1} of {locations.length}</span>
                <select value={locIndex} onChange={(e) => setLocIndex(Number(e.target.value))} aria-label="Choose location">
                  {locations.map((l, i) => (
                    <option key={i} value={i}>{l.path || shortPath(l.qualifiedName)}</option>
                  ))}
                </select>
              </div>
            )}
            {kind === 'table' && <TableViewer key={qn} src={qn} embedded />}
            {kind === 'pdf' && <PdfViewer key={qn} src={qn} embedded />}
            {kind === 'image' && <ImageViewer key={qn} src={qn} embedded />}
            {kind === 'none' && (
              <div className="pane-note">
                <h3>No in-browser preview</h3>
                <p>
                  {isStorage(qn)
                    ? 'This file type has no in-page renderer. Opening it streams the file through the authenticated viewer.'
                    : 'This asset type cannot be previewed. Open it in Purview for the full catalog entry.'}
                </p>
                {isStorage(qn) && (
                  <p><a className="btn primary" href={viewerHref(qn)} target="_blank" rel="noopener noreferrer">Open file ↗</a></p>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'desc' && (
          item.userDescription
            ? (
              <>
                <div className="doc" dangerouslySetInnerHTML={{ __html: renderDescription(item.userDescription) }} />
                <p className="pane-foot">
                  Written by the Project Libra enrichment pipeline and stored on the Purview asset as <code>userDescription</code>.
                  This is the text the search index embeds.
                </p>
              </>
            )
            : <div className="pane-note"><p>No description was catalogued for this asset.</p></div>
        )}

        {tab === 'gov' && (
          <div className="gov">
            {(!item.owner || !item.expert) && (
              <div className="gapnote">
                <span aria-hidden="true">⚠</span>
                <span>
                  This asset has {[!item.owner && 'no owner', !item.expert && 'no expert'].filter(Boolean).join(' and ')}.
                  Use the Stewardship facets to build a remediation worklist, then export it.
                </span>
              </div>
            )}
            <section>
              <h3>Contacts</h3>
              {item.owner
                ? <div className="person"><span className="av">{initials(item.owner)}</span><span className="who">{item.owner}</span><span className="role">Owner</span></div>
                : <p className="muted">No owner assigned.</p>}
              {item.expert
                ? <div className="person"><span className="av expert">{initials(item.expert)}</span><span className="who">{item.expert}</span><span className="role">Expert</span></div>
                : <p className="muted">No expert assigned.</p>}
            </section>
            <section>
              <h3>Catalog</h3>
              <dl className="kv">
                <dt>Collection</dt>
                <dd>{item.collectionName || '(none)'} <span className="muted">({item.collectionId || '—'})</span></dd>
                <dt>Platform</dt><dd>{item.assetTypeFriendly || '—'}</dd>
                <dt>Entity type</dt>
                <dd>{typeLabel(item.assetEntityType)} <span className="muted">({item.assetEntityType})</span></dd>
              </dl>
            </section>
          </div>
        )}

        {tab === 'locs' && (
          <>
            {locations.map((l, i) => (
              <div className={`loc${i === locIndex ? ' on' : ''}`} key={i}>
                <button className="loc-pick" type="button" onClick={() => { setLocIndex(i); setTab('preview'); }}>Preview</button>
                <span className="loc-path" title={l.qualifiedName}>{l.path || shortPath(l.qualifiedName)}</span>
                {l.purviewUrl
                  ? <a className="purview-link" href={l.purviewUrl} target="_blank" rel="noopener noreferrer">Purview ↗</a>
                  : <span className="purview-missing">No link</span>}
              </div>
            ))}
            <p className="pane-foot">
              {locations.length > 1
                ? `The same asset is catalogued in ${locations.length} places. The search API collapses these into one result; this tab shows what was merged.`
                : 'Catalogued once.'}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
