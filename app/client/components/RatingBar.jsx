// 1-5 usefulness scale under a result set.
//
// Rendered fresh for every search (keyed on searchId), so a rating is captured per query.
import React, { useState } from 'react';

const RATING_VALUES = [1, 2, 3, 4, 5];
const RATING_LABELS = ['Not useful', 'Slightly useful', 'Somewhat useful', 'Useful', 'Very useful'];

export default function RatingBar({ query, resultCount, searchId }) {
  const [picked, setPicked] = useState(null);
  const [state, setState] = useState('idle'); // idle | saving | saved | error

  const rate = async (value) => {
    if (state === 'saving' || state === 'saved') return;
    setPicked(value);
    setState('saving');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, rating: value, resultCount, searchId })
      });
      if (!res.ok) throw new Error('save failed');
      setState('saved');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="rating">
      <span className="rating-prompt">How useful were these results?</span>
      <div className="rating-scale" role="group" aria-label="Rate these results from 1 (lowest) to 5 (highest)">
        <span className="rating-end">1 · lowest</span>
        {RATING_VALUES.map((v) => (
          <button
            key={v}
            type="button"
            className={`rating-dot${picked === v ? ' is-picked' : ''}`}
            onClick={() => rate(v)}
            disabled={state === 'saving' || state === 'saved'}
            aria-pressed={picked === v}
            aria-label={`${v} — ${RATING_LABELS[v - 1]}`}
            title={RATING_LABELS[v - 1]}
          >
            {v}
          </button>
        ))}
        <span className="rating-end">5 · highest</span>
      </div>
      <span className="rating-note" role="status">
        {state === 'saved' && 'Thanks — your rating was recorded.'}
        {state === 'error' && 'Could not save that rating. Please try again.'}
      </span>
    </div>
  );
}
