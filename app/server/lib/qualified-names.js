// Parsers that turn a Purview `qualifiedName` into a concrete target, and the SSRF
// guards that go with them.
//
// Every function here is pure: allowlists arrive as arguments rather than being read
// from process.env, so they can be exercised directly by the tests in server/test/.
// An EMPTY allowlist means "any host under the expected suffix" - the suffix check
// always applies, the allowlist only narrows it further.

export const VIEWER_HOST_SUFFIXES = ['.dfs.core.windows.net', '.blob.core.windows.net'];
export const SQL_HOST_SUFFIXES = ['.database.windows.net', '.sql.azuresynapse.net'];
export const ADX_HOST_SUFFIXES = ['.kusto.windows.net', '.kusto.azuresynapse.net'];
export const COSMOS_HOST_SUFFIX = '.documents.azure.com';
export const DBX_HOST_SUFFIX = '.azuredatabricks.net';

// Turn an asset's qualifiedName into a short, human-readable location label,
// e.g. https://acct.dfs.core.windows.net/bronze/file.pdf -> acct/bronze
export function locationLabel(qualifiedName) {
  if (!qualifiedName) return '';
  try {
    const u = new URL(qualifiedName);
    const account = u.hostname.split('.')[0];
    const dir = decodeURIComponent(u.pathname).replace(/\/[^/]*$/, '');
    return `${account}${dir}`;
  } catch {
    return qualifiedName;
  }
}

// Validate the requested URL points at Azure Storage (blocks SSRF / open-proxy abuse)
// and return the Blob-endpoint URL to read from.
export function toBlobUrl(qualifiedName, { allowedAccounts = [] } = {}) {
  const u = new URL(qualifiedName);
  const host = u.hostname.toLowerCase();
  if (!VIEWER_HOST_SUFFIXES.some((sfx) => host.endsWith(sfx))) throw new Error('Unsupported host');
  const account = host.split('.')[0];
  if (allowedAccounts.length && !allowedAccounts.includes(account)) {
    throw new Error('Account not allowed');
  }
  u.hostname = `${account}.blob.core.windows.net`;
  u.search = '';
  return u;
}

// mssql://<host>/<database>/<schema>/<table>
export function parseSqlAsset(qualifiedName, { allowedServers = [] } = {}) {
  if (!/^mssql:\/\//i.test(qualifiedName)) throw new Error('Not a SQL asset');
  const parts = qualifiedName.slice(qualifiedName.indexOf('://') + 3).split('/');
  if (parts.length !== 4 || parts.some((p) => !p)) throw new Error('Malformed SQL qualified name');
  const [host, database, schema, table] = parts;
  const h = host.toLowerCase();
  if (!SQL_HOST_SUFFIXES.some((sfx) => h.endsWith(sfx))) throw new Error('Unsupported SQL host');
  if (allowedServers.length && !allowedServers.includes(h.split('.')[0])) throw new Error('Server not allowed');
  return {
    host: h,
    database: decodeURIComponent(database),
    schema: decodeURIComponent(schema),
    table: decodeURIComponent(table)
  };
}

// Hive metastore: <schema>.<table>@adb-<workspaceId>.<n>.azuredatabricks.net
// Unity Catalog:  databricks://<metastoreId>/catalogs/<catalog>/schemas/<schema>/tables/<table>
export function parseDatabricksAsset(qualifiedName, { defaultHost = '' } = {}) {
  const qn = (qualifiedName || '').trim();
  const uc = /^databricks:\/\/[^/]+\/catalogs\/([^/]+)\/schemas\/([^/]+)\/tables\/([^/]+)\/?$/i.exec(qn);
  if (uc) {
    // The Unity Catalog qualifiedName carries a metastore GUID, not a host, so the
    // target workspace must be supplied via DATABRICKS_HOST.
    if (!defaultHost) throw new Error('Unity Catalog previews require DATABRICKS_HOST');
    return {
      host: defaultHost,
      catalog: decodeURIComponent(uc[1]),
      schema: decodeURIComponent(uc[2]),
      table: decodeURIComponent(uc[3])
    };
  }
  const at = qn.lastIndexOf('@');
  if (at > 0) {
    const host = qn.slice(at + 1).toLowerCase();
    const left = qn.slice(0, at);
    const dot = left.indexOf('.');
    if (host.endsWith(DBX_HOST_SUFFIX) && dot > 0 && dot < left.length - 1) {
      const schema = left.slice(0, dot);
      const table = left.slice(dot + 1);
      if (!schema.includes('.') && !table.includes('.')) {
        return { host, catalog: 'hive_metastore', schema, table };
      }
    }
  }
  throw new Error('Not a Databricks asset');
}

// https://<account>.documents.azure.com/dbs/<database>/colls/<container>
export function parseCosmosAsset(qualifiedName, { allowedAccounts = [] } = {}) {
  let u;
  try { u = new URL(qualifiedName); } catch { throw new Error('Not a Cosmos asset'); }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !h.endsWith(COSMOS_HOST_SUFFIX)) throw new Error('Not a Cosmos asset');
  const account = h.slice(0, -COSMOS_HOST_SUFFIX.length);
  if (allowedAccounts.length && !allowedAccounts.includes(account)) throw new Error('Account not allowed');
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 4 || parts[0] !== 'dbs' || parts[2] !== 'colls') throw new Error('Malformed Cosmos qualified name');
  return { endpoint: `https://${h}`, account, database: parts[1], container: parts[3] };
}

// https://<cluster>.<region>.kusto.windows.net/<database>/<table>
export function parseAdxAsset(qualifiedName, { allowedClusters = [] } = {}) {
  let u;
  try { u = new URL(qualifiedName); } catch { throw new Error('Not an ADX asset'); }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !ADX_HOST_SUFFIXES.some((sfx) => h.endsWith(sfx))) throw new Error('Not an ADX asset');
  if (allowedClusters.length && !allowedClusters.includes(h.split('.')[0])) throw new Error('Cluster not allowed');
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 2) throw new Error('Malformed ADX qualified name');
  return { host: h, cluster: h.split('.')[0], database: parts[0], table: parts[1] };
}
