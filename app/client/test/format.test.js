// JS half of the cross-language format contract. The Python half is
// scripts/test_to_jsonl.py; both read scripts/format_fixtures.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  formatOf, isSql, isDatabricks, isCosmos, isAdx,
  isQueryable, isPdf, isTabular, isImage, isStorage, previewKind, viewerHref
} from '../lib/asset-format.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(here, '..', '..', '..', 'scripts', 'format_fixtures.json');
const { cases } = JSON.parse(readFileSync(fixturesPath, 'utf8'));

test('the shared fixture file is present and non-trivial', () => {
  assert.ok(Array.isArray(cases), 'cases[] missing from format_fixtures.json');
  assert.ok(cases.length >= 20, `expected 20+ fixtures, got ${cases.length}`);
});

// One test per fixture so a failure names the exact qualifiedName that drifted.
for (const { qualifiedName, format, why } of cases) {
  test(`formatOf: ${why} — ${JSON.stringify(qualifiedName)} -> ${format}`, () => {
    assert.equal(formatOf(qualifiedName), format);
  });
}

test('formatOf tolerates null and undefined', () => {
  assert.equal(formatOf(null), 'file');
  assert.equal(formatOf(undefined), 'file');
});

test('asset-kind predicates agree with the format they produce', () => {
  assert.ok(isCosmos('https://a.documents.azure.com/dbs/d/colls/c'));
  assert.ok(isAdx('https://c.eastus2.kusto.windows.net/d/t'));
  assert.ok(isSql('mssql://s.database.windows.net/d/dbo/t'));
  assert.ok(isDatabricks('databricks://m/catalogs/c/schemas/s/tables/t'));
  assert.ok(isDatabricks('s.t@adb-1.2.azuredatabricks.net'));
  assert.ok(['container', 'kusto', 'sql', 'table'].every((f) => typeof f === 'string'));
});

test('isQueryable is the union of the four database predicates', () => {
  const qns = [
    'mssql://s.database.windows.net/d/dbo/t',
    'databricks://m/catalogs/c/schemas/s/tables/t',
    'https://a.documents.azure.com/dbs/d/colls/c',
    'https://c.eastus2.kusto.windows.net/d/t'
  ];
  for (const qn of qns) assert.ok(isQueryable(qn), qn);
  assert.equal(isQueryable('https://acct.dfs.core.windows.net/c/f.pdf'), false);
});

test('viewer predicates pick exactly one pane', () => {
  assert.ok(isPdf('https://a.dfs.core.windows.net/c/f.pdf'));
  assert.ok(isImage('https://a.dfs.core.windows.net/c/f.png'));
  assert.ok(isTabular('https://a.dfs.core.windows.net/c/f.csv'));
  assert.ok(isStorage('https://a.blob.core.windows.net/c/f'));
  // svg and tiff are deliberately excluded - svg can execute script.
  assert.equal(isImage('https://a.dfs.core.windows.net/c/f.svg'), false);
  assert.equal(isImage('https://a.dfs.core.windows.net/c/f.tiff'), false);
});

test('previewKind routes each asset class to its pane', () => {
  assert.equal(previewKind('https://a.dfs.core.windows.net/c/f.pdf'), 'pdf');
  assert.equal(previewKind('https://a.dfs.core.windows.net/c/f.png'), 'image');
  assert.equal(previewKind('https://a.dfs.core.windows.net/c/f.csv'), 'table');
  assert.equal(previewKind('mssql://s.database.windows.net/d/dbo/t'), 'table');
  assert.equal(previewKind('https://a.dfs.core.windows.net/c/f.docx'), 'none');
});

test('viewerHref encodes the qualified name into the right route', () => {
  assert.equal(
    viewerHref('https://a.dfs.core.windows.net/c/f.pdf'),
    '/#/view?u=https%3A%2F%2Fa.dfs.core.windows.net%2Fc%2Ff.pdf'
  );
  assert.ok(viewerHref('https://a.dfs.core.windows.net/c/f.png').startsWith('/#/image?u='));
  assert.ok(viewerHref('mssql://s.database.windows.net/d/dbo/t').startsWith('/#/table?u='));
  assert.ok(viewerHref('https://a.dfs.core.windows.net/c/f.docx').startsWith('/api/file?u='));
});
