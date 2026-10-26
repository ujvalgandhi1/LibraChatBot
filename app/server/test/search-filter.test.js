// buildFilter turns browser-supplied facet selections into an OData $filter, so it is
// the injection boundary for the search index. normalizeQuery is what stops anonymous
// text from reaching other visitors as markup.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFilter, odataStr, normalizeQuery } from '../lib/search-filter.js';

test('odataStr wraps in quotes and doubles embedded quotes', () => {
  assert.equal(odataStr('plain'), "'plain'");
  assert.equal(odataStr("O'Brien"), "'O''Brien'");
  assert.equal(odataStr("' or 1 eq 1 or '"), "''' or 1 eq 1 or '''");
});

test('buildFilter emits an OR group per field and ANDs the groups', () => {
  assert.equal(buildFilter({ owner: ['ann'] }), "(owner eq 'ann')");
  assert.equal(buildFilter({ owner: ['ann', 'bob'] }), "(owner eq 'ann' or owner eq 'bob')");
  assert.equal(
    buildFilter({ owner: ['ann'], format: ['pdf'] }),
    "(owner eq 'ann') and (format eq 'pdf')"
  );
});

test('buildFilter drops fields that are not facetable', () => {
  // An attacker-supplied field name must never reach the query.
  assert.equal(buildFilter({ userDescription: ['x'] }), '');
  assert.equal(buildFilter({ 'owner eq 1 or 1': ['x'] }), '');
  assert.equal(buildFilter({ __proto__: ['x'] }), '');
  assert.equal(buildFilter({ owner: ['ann'], notAField: ['x'] }), "(owner eq 'ann')");
});

test('buildFilter escapes values rather than interpolating them', () => {
  assert.equal(
    buildFilter({ owner: ["' or collectionName ne '"] }),
    "(owner eq ''' or collectionName ne ''')"
  );
});

test('buildFilter ignores malformed, oversized and empty selections', () => {
  assert.equal(buildFilter(null), '');
  assert.equal(buildFilter('nope'), '');
  assert.equal(buildFilter(['nope']), '');
  assert.equal(buildFilter({ owner: [] }), '');
  assert.equal(buildFilter({ owner: 'ann' }), '');           // not an array
  assert.equal(buildFilter({ owner: [1, null, {}] }), '');   // non-string values
  assert.equal(buildFilter({ owner: Array(51).fill('x') }), ''); // over the 50 cap
  assert.equal(buildFilter({ owner: ['a'.repeat(201)] }), ''); // over the 200 cap
});

test('buildFilter maps stewardship values to their canned clauses', () => {
  assert.equal(buildFilter({ stewardship: ['no-owner'] }), "(owner eq '')");
  assert.equal(
    buildFilter({ stewardship: ['no-owner', 'no-expert'] }),
    "(owner eq '' or expert eq '')"
  );
  assert.equal(buildFilter({ stewardship: ['made-up'] }), '');
});

test('buildFilter honours the exclude argument used by browse drill-down', () => {
  const facets = { owner: ['ann'], format: ['pdf'] };
  assert.equal(buildFilter(facets, 'owner'), "(format eq 'pdf')");
  assert.equal(buildFilter(facets, 'format'), "(owner eq 'ann')");
});

test('normalizeQuery collapses casing, punctuation and spacing to one key', () => {
  const expected = 'sales order data';
  assert.equal(normalizeQuery('Sales Order Data!!'), expected);
  assert.equal(normalizeQuery('sales order data'), expected);
  assert.equal(normalizeQuery('  SALES   ORDER   DATA '), expected);
});

test('normalizeQuery strips anything that could render as markup', () => {
  assert.equal(normalizeQuery('<script>alert(1)</script>'), 'script alert 1 script');
  assert.equal(normalizeQuery('[link](javascript:alert(1))'), 'link javascript alert 1');
  assert.equal(normalizeQuery('a<b>c'), 'a b c');
  for (const ch of ['<', '>', '&', '"', '`', '/', '\\', '(', ')']) {
    assert.ok(!normalizeQuery(`x${ch}y`).includes(ch), `kept ${ch}`);
  }
});

test('normalizeQuery keeps apostrophes and hyphens, folding smart quotes', () => {
  assert.equal(normalizeQuery('O\u2019Brien year-end'), "o'brien year-end");
  assert.equal(normalizeQuery("O'Brien year-end"), "o'brien year-end");
});

test('normalizeQuery caps length at 200 characters', () => {
  assert.equal(normalizeQuery('a'.repeat(500)).length, 200);
});

test('normalizeQuery handles non-string input without throwing', () => {
  assert.equal(normalizeQuery(null), 'null');
  assert.equal(normalizeQuery(42), '42');
});
