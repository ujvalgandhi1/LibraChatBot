// Facet definitions.
//
// In search mode these are computed from the returned result set, so counts on screen
// always match the rows on screen. In browse mode the server supplies true index-wide
// counts instead - see /api/browse.

import { fmtOf, typeLabel } from './display.js';

const STEW_LABELS = {
  'has-owner': 'Has an owner',
  'has-expert': 'Has an expert',
  'no-owner': '⚠ No owner assigned',
  'no-expert': '⚠ No expert assigned',
  'no-contact': '⚠ No owner or expert'
};

export const GAP_VALUES = new Set(['no-owner', 'no-expert', 'no-contact', '__none__']);

// Azure AI Search returns an empty-string bucket; the UI shows it under these labels.
export const EMPTY_VALUE = { owner: '__none__', expert: '__none__' };
export const SENTINELS = new Set(['__none__', '(none)']);

export function stewardship(a) {
  const v = [a.owner ? 'has-owner' : 'no-owner', a.expert ? 'has-expert' : 'no-expert'];
  if (!a.owner && !a.expert) v.push('no-contact');
  return v;
}

export const FACETS = [
  { key: 'collectionName', title: 'Collection', col: 'collectionName', open: true, values: (a) => [a.collectionName || '(none)'] },
  { key: 'assetTypeFriendly', title: 'Platform', col: 'asset_type_friendly', open: true, values: (a) => [a.assetTypeFriendly || '(none)'] },
  { key: 'stewardship', title: 'Stewardship', col: 'owner / expert', open: true, values: stewardship },
  { key: 'owner', title: 'Owner', col: 'owner', open: false, values: (a) => [a.owner || '__none__'] },
  { key: 'expert', title: 'Expert', col: 'expert', open: false, values: (a) => [a.expert || '__none__'] },
  { key: 'assetEntityType', title: 'Entity type', col: 'asset_entity_type', open: false, values: (a) => [a.assetEntityType] },
  { key: 'format', title: 'Format', col: 'format', open: false, values: (a) => [fmtOf(a)] }
];

export function facetLabel(key, v) {
  if (v === '__none__') return key === 'owner' ? '⚠ No owner' : '⚠ No expert';
  if (key === 'stewardship') return STEW_LABELS[v] || v;
  if (key === 'assetEntityType') return typeLabel(v);
  if (key === 'format') return String(v).toUpperCase();
  return v;
}

export const emptyFacets = () => Object.fromEntries(FACETS.map((f) => [f.key, new Set()]));

export const keyOf = (a) => a.qualifiedName || a.name;

// The rail uses sentinels for "not set"; the index stores an empty string.
export const wireFacets = (sel) => Object.fromEntries(
  Object.entries(sel).map(([k, s]) => [k, [...s].map((v) => (SENTINELS.has(v) ? '' : v))])
);
