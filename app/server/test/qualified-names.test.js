// Guards on every user-supplied `u=` parameter. These are the functions standing
// between an anonymous request and the app identity's data-plane access, so the
// negative cases matter more than the happy paths.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  locationLabel,
  toBlobUrl,
  parseSqlAsset,
  parseDatabricksAsset,
  parseCosmosAsset,
  parseAdxAsset
} from '../lib/qualified-names.js';

test('toBlobUrl accepts dfs and blob endpoints and normalises to blob', () => {
  assert.equal(
    toBlobUrl('https://acct.dfs.core.windows.net/bronze/report.pdf').toString(),
    'https://acct.blob.core.windows.net/bronze/report.pdf'
  );
  assert.equal(
    toBlobUrl('https://acct.blob.core.windows.net/bronze/report.pdf').toString(),
    'https://acct.blob.core.windows.net/bronze/report.pdf'
  );
});

test('toBlobUrl strips the query string so a caller cannot smuggle a SAS token', () => {
  const u = toBlobUrl('https://acct.blob.core.windows.net/c/f.pdf?sig=abc&se=2030-01-01');
  assert.equal(u.search, '');
  assert.equal(u.toString(), 'https://acct.blob.core.windows.net/c/f.pdf');
});

test('toBlobUrl rejects hosts outside Azure Storage (SSRF)', () => {
  for (const bad of [
    'https://evil.com/secret',
    'http://169.254.169.254/metadata/instance',            // IMDS
    'https://acct.blob.core.windows.net.evil.com/c/f',     // suffix-lookalike
    'https://localhost/c/f',
    'file:///etc/passwd'
  ]) {
    assert.throws(() => toBlobUrl(bad), /Unsupported host|Invalid URL/, bad);
  }
});

test('toBlobUrl enforces the account allowlist when one is set', () => {
  const opts = { allowedAccounts: ['good'] };
  assert.ok(toBlobUrl('https://good.blob.core.windows.net/c/f', opts));
  assert.throws(
    () => toBlobUrl('https://other.blob.core.windows.net/c/f', opts),
    /Account not allowed/
  );
});

test('toBlobUrl allows any storage account when the allowlist is empty (fail-open)', () => {
  // Documents the current contract: an unset allowlist narrows nothing. This is why
  // infra/12-allowlists.ps1 exists.
  assert.ok(toBlobUrl('https://anything.blob.core.windows.net/c/f'));
});

test('parseSqlAsset splits a well-formed mssql qualifiedName', () => {
  assert.deepEqual(parseSqlAsset('mssql://srv.database.windows.net/db/dbo/Customers'), {
    host: 'srv.database.windows.net',
    database: 'db',
    schema: 'dbo',
    table: 'Customers'
  });
});

test('parseSqlAsset decodes percent-encoded name parts', () => {
  const t = parseSqlAsset('mssql://srv.database.windows.net/my%20db/dbo/Order%20Items');
  assert.equal(t.database, 'my db');
  assert.equal(t.table, 'Order Items');
});

test('parseSqlAsset rejects wrong scheme, wrong host and wrong arity', () => {
  const bad = [
    'https://srv.database.windows.net/db/dbo/t',       // not mssql://
    'mssql://srv.evil.com/db/dbo/t',                   // host not Azure SQL
    'mssql://srv.database.windows.net/db/dbo',         // too few segments
    'mssql://srv.database.windows.net/db/dbo/t/extra', // too many segments
    'mssql://srv.database.windows.net//dbo/t'          // empty segment
  ];
  for (const qn of bad) assert.throws(() => parseSqlAsset(qn), Error, qn);
});

test('parseSqlAsset enforces the server allowlist on the short name', () => {
  const opts = { allowedServers: ['srv'] };
  assert.ok(parseSqlAsset('mssql://srv.database.windows.net/db/dbo/t', opts));
  assert.throws(
    () => parseSqlAsset('mssql://other.database.windows.net/db/dbo/t', opts),
    /Server not allowed/
  );
});

test('parseDatabricksAsset handles the hive metastore shape', () => {
  assert.deepEqual(
    parseDatabricksAsset('sales.orders@adb-123.4.azuredatabricks.net'),
    { host: 'adb-123.4.azuredatabricks.net', catalog: 'hive_metastore', schema: 'sales', table: 'orders' }
  );
});

test('parseDatabricksAsset handles Unity Catalog and needs a default host', () => {
  const qn = 'databricks://meta-guid/catalogs/main/schemas/sales/tables/orders';
  assert.throws(() => parseDatabricksAsset(qn), /DATABRICKS_HOST/);
  assert.deepEqual(parseDatabricksAsset(qn, { defaultHost: 'adb-9.1.azuredatabricks.net' }), {
    host: 'adb-9.1.azuredatabricks.net',
    catalog: 'main',
    schema: 'sales',
    table: 'orders'
  });
});

test('parseDatabricksAsset rejects foreign hosts and ambiguous names', () => {
  for (const qn of [
    'sales.orders@evil.com',
    'sales.orders@adb-123.4.azuredatabricks.net.evil.com',
    'orders@adb-123.4.azuredatabricks.net',        // no schema separator
    'a.b.c@adb-123.4.azuredatabricks.net',         // ambiguous extra dot
    ''
  ]) {
    assert.throws(() => parseDatabricksAsset(qn), /Not a Databricks asset/, qn);
  }
});

test('parseCosmosAsset splits dbs/colls and rejects malformed paths', () => {
  assert.deepEqual(parseCosmosAsset('https://acct.documents.azure.com/dbs/d1/colls/c1'), {
    endpoint: 'https://acct.documents.azure.com',
    account: 'acct',
    database: 'd1',
    container: 'c1'
  });
  for (const qn of [
    'http://acct.documents.azure.com/dbs/d1/colls/c1',   // plaintext
    'https://acct.documents.azure.com/dbs/d1',           // truncated
    'https://acct.documents.azure.com/foo/d1/colls/c1',  // wrong literal
    'https://acct.evil.com/dbs/d1/colls/c1',
    'not a url'
  ]) {
    assert.throws(() => parseCosmosAsset(qn), Error, qn);
  }
});

test('parseCosmosAsset enforces the account allowlist', () => {
  const opts = { allowedAccounts: ['acct'] };
  assert.ok(parseCosmosAsset('https://acct.documents.azure.com/dbs/d/colls/c', opts));
  assert.throws(
    () => parseCosmosAsset('https://other.documents.azure.com/dbs/d/colls/c', opts),
    /Account not allowed/
  );
});

test('parseAdxAsset splits cluster/database/table', () => {
  assert.deepEqual(parseAdxAsset('https://clu.eastus2.kusto.windows.net/mydb/Events'), {
    host: 'clu.eastus2.kusto.windows.net',
    cluster: 'clu',
    database: 'mydb',
    table: 'Events'
  });
});

test('parseAdxAsset rejects wrong host, wrong scheme and wrong arity', () => {
  for (const qn of [
    'https://clu.eastus2.kusto.evil.com/db/t',
    'http://clu.eastus2.kusto.windows.net/db/t',
    'https://clu.eastus2.kusto.windows.net/db',
    'https://clu.eastus2.kusto.windows.net/db/t/extra'
  ]) {
    assert.throws(() => parseAdxAsset(qn), Error, qn);
  }
});

test('parseAdxAsset enforces the cluster allowlist', () => {
  const opts = { allowedClusters: ['clu'] };
  assert.ok(parseAdxAsset('https://clu.eastus2.kusto.windows.net/db/t', opts));
  assert.throws(
    () => parseAdxAsset('https://other.eastus2.kusto.windows.net/db/t', opts),
    /Cluster not allowed/
  );
});

test('locationLabel shortens a storage path and passes non-URLs through', () => {
  assert.equal(locationLabel('https://acct.dfs.core.windows.net/bronze/sub/file.pdf'), 'acct/bronze/sub');
  assert.equal(locationLabel('mssql://srv/db/dbo/t'), 'srv/db/dbo');
  assert.equal(locationLabel('not a url'), 'not a url');
  assert.equal(locationLabel(''), '');
  assert.equal(locationLabel(null), '');
});
