// /api/databricks-preview
//
// Databricks tables can't be reached with the TDS/mssql driver, so previews run through
// the workspace's SQL Statement Execution API against a SQL warehouse. Auth is the app
// identity (AAD) by default, or a PAT if DATABRICKS_TOKEN is set.
import { Router } from 'express';

import { parseDatabricksAsset as parseDatabricksAssetPure, DBX_HOST_SUFFIX } from '../../lib/qualified-names.js';
import { quoteDbx } from '../../lib/sql.js';
import { getToken } from '../../azure.js';
import {
  DBX_SCOPE, DBX_WAREHOUSE_ID, DBX_DEFAULT_HOST, DBX_TOKEN,
  DBX_ALLOWED_HOSTS, DBX_PREVIEW_ROWS
} from '../../config.js';

const router = Router();

const parseDatabricksAsset = (qn) => parseDatabricksAssetPure(qn, { defaultHost: DBX_DEFAULT_HOST });

// Map a non-OK Databricks API HTTP status to a client status + message.
function dbxHttpError(status) {
  if (status === 401 || status === 403) return { code: 403, error: 'The app\u2019s identity is not permitted to query this Databricks workspace.' };
  if (status === 404) return { code: 404, error: 'The Databricks SQL warehouse was not found. Check DATABRICKS_WAREHOUSE_ID.' };
  return { code: 502, error: 'Unable to reach the Databricks SQL API.' };
}

router.get('/databricks-preview', async (req, res) => {
  let target;
  try {
    target = parseDatabricksAsset((req.query.u ?? '').toString());
  } catch (e) {
    if (/DATABRICKS_HOST/i.test(String(e?.message || e))) {
      return res.status(501).json({ error: 'Unity Catalog previews are not configured on the server.' });
    }
    return res.status(400).json({ error: 'A valid Databricks table reference is required.' });
  }
  if (!target.host.endsWith(DBX_HOST_SUFFIX) ||
      (DBX_ALLOWED_HOSTS.length && !DBX_ALLOWED_HOSTS.includes(target.host))) {
    return res.status(400).json({ error: 'This Databricks workspace is not allowed.' });
  }
  if (!DBX_WAREHOUSE_ID) {
    return res.status(501).json({ error: 'Databricks previews are not configured on the server (no SQL warehouse set).' });
  }
  try {
    const authHeader = `Bearer ${DBX_TOKEN || await getToken(DBX_SCOPE)}`;
    const statement = `SELECT * FROM ${quoteDbx(target.catalog)}.${quoteDbx(target.schema)}.${quoteDbx(target.table)} LIMIT ${DBX_PREVIEW_ROWS}`;
    const base = `https://${target.host}/api/2.0/sql/statements`;
    const startedAt = Date.now();
    const post = await fetch(base, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: DBX_WAREHOUSE_ID,
        statement,
        wait_timeout: '30s',
        on_wait_timeout: 'CONTINUE',
        format: 'JSON_ARRAY',
        disposition: 'INLINE',
      }),
    });
    if (!post.ok) { const m = dbxHttpError(post.status); return res.status(m.code).json({ error: m.error }); }
    let body = await post.json();
    // Keep polling while the statement runs (e.g. the warehouse is warming up).
    while (['PENDING', 'RUNNING'].includes(body?.status?.state) && Date.now() - startedAt < 45000) {
      await new Promise((r) => setTimeout(r, 2000));
      const g = await fetch(`${base}/${encodeURIComponent(body.statement_id)}`, { headers: { Authorization: authHeader } });
      if (!g.ok) { const m = dbxHttpError(g.status); return res.status(m.code).json({ error: m.error }); }
      body = await g.json();
    }
    const state = body?.status?.state;
    if (state !== 'SUCCEEDED') {
      const emsg = String(body?.status?.error?.message || '');
      if (state === 'PENDING' || state === 'RUNNING') {
        return res.status(503).json({ error: 'The SQL warehouse is starting up. Please try again in a moment.' });
      }
      if (/TABLE_OR_VIEW_NOT_FOUND|not found|does not exist|cannot be found/i.test(emsg)) {
        return res.status(404).json({ error: 'That table was not found in the workspace.' });
      }
      if (/PERMISSION|not authorized|access denied|forbidden/i.test(emsg)) {
        return res.status(403).json({ error: 'The app\u2019s identity cannot read this table. Grant it SELECT on the table and can-use on the SQL warehouse.' });
      }
      return res.status(502).json({ error: 'Unable to load this table preview.' });
    }
    const cols = (body?.manifest?.schema?.columns || []).slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const columns = cols.map((c) => c.name);
    const rows = (body?.result?.data_array || []).map((r) => columns.map((_c, i) => (r[i] ?? null)));
    res.json({ host: target.host, catalog: target.catalog, schema: target.schema, table: target.table, rowCap: DBX_PREVIEW_ROWS, columns, rows });
  } catch (err) {
    const msg = String(err?.message || err);
    console.error('databricks-preview error:', msg);
    if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|ETIMEDOUT|ETIMEOUT|ESOCKET|fetch failed|network/i.test(msg)) {
      return res.status(502).json({ error: 'Could not reach the Databricks workspace. It may be on a private network this app cannot access.' });
    }
    return res.status(502).json({ error: 'Unable to load this table preview.' });
  }
});

export default router;
