// One row in the result list.
import React from 'react';

import { FMT_COLOR, abbr, fmtOf, band, sanitize, cleanCaption, shortPath } from '../lib/display.js';

export default function ResultRow({ item, selected, picked, onOpen, onPick }) {
  const [cls, label] = band(item.score);
  const fmt = fmtOf(item);
  const multi = (item.locations?.length ?? 1) > 1;
  return (
    <div
      className={`row${selected ? ' sel' : ''}${picked ? ' checked' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen(); } }}
      role="button"
      tabIndex={0}
    >
      <input
        className="row-check"
        type="checkbox"
        checked={picked}
        onChange={onPick}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${item.name}`}
      />
      <span className="ftype" style={{ background: FMT_COLOR[fmt] || '#5b6472' }}>{abbr(fmt)}</span>
      <div className="row-main">
        <span className="row-name" title={item.name}>{item.name || '(unnamed asset)'}</span>
        {item.caption && (
          <p className="row-cap" dangerouslySetInnerHTML={{ __html: sanitize(cleanCaption(item.caption)) }} />
        )}
        <span className="row-meta">
          {item.collectionName && <span className="tag coll">{item.collectionName}</span>}
          {item.assetTypeFriendly && <span className="tag">{item.assetTypeFriendly}</span>}
          {multi && <span className="tag">{item.locations.length} copies</span>}
          {item.owner
            ? <span className="tag who">Owner: {item.owner}</span>
            : <span className="tag gap">No owner</span>}
          {item.expert
            ? <span className="tag who">Expert: {item.expert}</span>
            : <span className="tag gap">No expert</span>}
          {item.score != null && (
            <span className={`match ${cls}`} title={`Semantic relevance ${item.score.toFixed(2)} of 4.00`}>
              <span className="bars"><i /><i /><i /></span>{label}
            </span>
          )}
          <span className="path" title={item.qualifiedName}>{shortPath(item.qualifiedName)}</span>
        </span>
      </div>
    </div>
  );
}
