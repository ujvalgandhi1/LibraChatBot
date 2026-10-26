// /api/sql-preview - SELECT TOP N from an Azure SQL or Synapse table.
import { Router } from 'express';

import { parseSqlAsset as parseSqlAssetPure } from '../../lib/qualified-names.js';
import { quoteIdent, sqlCell } from '../../lib/sql.js';
import { getToken } from '../../azure.js';
import { SQL_SCOPE, SQL_ALLOWED_SERVERS, SQL_PREVIEW_ROWS } from '../../config.js';

const router = Router();

const parseSqlAsset = (qn) => parseSqlAssetPure(qn, { allowedServers: SQL_ALLOWED_SERVERS });

router.get('/sql-preview', async (req, res) => {
  let target;
  try {
    target = parseSqlAsset((req.query.u ?? '').toString());
  } catch {
    return res.status(400).json({ error: 'A valid SQL table reference is required.' });
  }
  let pool;
  try {
    const token = await getToken(SQL_SCOPE);
    const sql = (await import('mssql')).default;
    pool = new sql.ConnectionPool({
      server: target.host,
      database: target.database,
      authentication: { type: 'azure-active-directory-access-token', options: { token } },
      options: { encrypt: true, trustServerCertificate: false },
      connectionTimeout: 15000,
      requestTimeout: 20000,
      pool: { max: 1, min: 0, idleTimeoutMillis: 5000 }
    });
    await pool.connect();
    const q = `SELECT TOP ${SQL_PREVIEW_ROWS} * FROM ${quoteIdent(target.schema)}.${quoteIdent(target.table)}`;
    const result = await pool.request().query(q);
    const rs = result.recordset || [];
    const columns = rs.columns
      ? Object.values(rs.columns).sort((a, b) => a.index - b.index).map((c) => c.name)
      : (rs.length ? Object.keys(rs[0]) : []);
    const rows = rs.map((row) => columns.map((c) => sqlCell(row[c])));
    res.json({ server: target.host, database: target.database, schema: target.schema, table: target.table, rowCap: SQL_PREVIEW_ROWS, columns, rows });
  } catch (err) {
    const msg = String(err?.message || err);
    console.error('sql-preview error:', msg);
    if (/Invalid object name|Cannot find the object/i.test(msg)) {
      return res.status(404).json({ error: 'That table was not found in the database.' });
    }
    if (/Login failed|permission|principal|Cannot open (server|database)|is expired|denied|not authorized/i.test(msg)) {
      return res.status(403).json({ error: 'The app\u2019s identity cannot read this table. It must be a database user with SELECT / db_datareader on this database.' });
    }
    if (/ETIMEOUT|ESOCKET|ECONNREFUSED|ENOTFOUND|getaddrinfo|Failed to connect|ETIMEDOUT/i.test(msg)) {
      return res.status(502).json({ error: 'Could not reach the SQL server. It may be on a private network this app cannot access, or blocked by the server firewall.' });
    }
    return res.status(502).json({ error: 'Unable to load this table preview.' });
  } finally {
    if (pool) { try { await pool.close(); } catch { /* ignore */ } }
  }
});

export default router;
