// /api/adx-preview - <table> | take N against an Azure Data Explorer cluster.
import { Router } from 'express';

import { parseAdxAsset as parseAdxAssetPure } from '../../lib/qualified-names.js';
import { quoteKql, sqlCell } from '../../lib/sql.js';
import { getToken } from '../../azure.js';
import { ADX_ALLOWED_CLUSTERS, ADX_PREVIEW_ROWS } from '../../config.js';

const router = Router();

const parseAdxAsset = (qn) => parseAdxAssetPure(qn, { allowedClusters: ADX_ALLOWED_CLUSTERS });

router.get('/adx-preview', async (req, res) => {
  let target;
  try {
    target = parseAdxAsset((req.query.u ?? '').toString());
  } catch {
    return res.status(400).json({ error: 'A valid Azure Data Explorer table reference is required.' });
  }
  try {
    // Each cluster is its own token audience.
    const token = await getToken(`https://${target.host}/.default`);
    const r = await fetch(`https://${target.host}/v1/rest/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ db: target.database, csl: `${quoteKql(target.table)} | take ${ADX_PREVIEW_ROWS}` }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('adx-preview http', r.status, detail.slice(0, 500));
      if (r.status === 401 || r.status === 403) {
        return res.status(403).json({ error: 'The app\u2019s identity cannot read this table. It needs the Database Viewer role on this ADX database.' });
      }
      if (/EntityNotFound|Table not found|could not be resolved/i.test(detail)) {
        return res.status(404).json({ error: 'That table was not found in the database.' });
      }
      if (r.status === 404) return res.status(404).json({ error: 'That database was not found on this cluster.' });
      return res.status(502).json({ error: 'Unable to load this table preview.' });
    }
    const body = await r.json();
    const table = (body?.Tables || [])[0];
    const columns = (table?.Columns || []).map((c) => c.ColumnName);
    const rows = (table?.Rows || []).map((row) => row.map((v) => sqlCell(v)));
    res.json({ cluster: target.cluster, host: target.host, database: target.database, table: target.table, rowCap: ADX_PREVIEW_ROWS, columns, rows });
  } catch (err) {
    const msg = String(err?.message || err);
    console.error('adx-preview error:', msg);
    if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|ETIMEDOUT|ETIMEOUT|ESOCKET|fetch failed|network/i.test(msg)) {
      return res.status(502).json({ error: 'Could not reach the Data Explorer cluster. It may be stopped, or on a private network this app cannot access.' });
    }
    return res.status(502).json({ error: 'Unable to load this table preview.' });
  }
});

export default router;
