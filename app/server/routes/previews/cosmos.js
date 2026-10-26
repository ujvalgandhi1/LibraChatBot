// /api/cosmos-preview - SELECT TOP N documents from a Cosmos container.
//
// Data-plane access is NOT an Azure RBAC role: the identity needs the account's
// built-in "Cosmos DB Built-in Data Reader" SQL role assignment.
import { Router } from 'express';

import { parseCosmosAsset as parseCosmosAssetPure } from '../../lib/qualified-names.js';
import { sqlCell } from '../../lib/sql.js';
import { credential } from '../../azure.js';
import { COSMOS_ALLOWED_ACCOUNTS, COSMOS_PREVIEW_ROWS, COSMOS_TIMEOUT_MS } from '../../config.js';

const router = Router();

// Cosmos bookkeeping fields; hidden so the preview shows the actual document shape.
const COSMOS_SYSTEM_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments']);

const parseCosmosAsset = (qn) => parseCosmosAssetPure(qn, { allowedAccounts: COSMOS_ALLOWED_ACCOUNTS });

router.get('/cosmos-preview', async (req, res) => {
  let target;
  try {
    target = parseCosmosAsset((req.query.u ?? '').toString());
  } catch {
    return res.status(400).json({ error: 'A valid Cosmos DB container reference is required.' });
  }
  try {
    const { CosmosClient } = await import('@azure/cosmos');
    const client = new CosmosClient({
      endpoint: target.endpoint,
      aadCredentials: credential,
      connectionPolicy: {
        requestTimeout: 8000,
        retryOptions: { maxRetryAttemptCount: 2, fixedRetryIntervalInMilliseconds: 500, maxWaitTimeInSeconds: 10 },
      },
    });
    const query = client
      .database(target.database)
      .container(target.container)
      .items.query(
        { query: `SELECT TOP ${COSMOS_PREVIEW_ROWS} * FROM c` },
        { maxItemCount: COSMOS_PREVIEW_ROWS }
      )
      .fetchNext();
    query.catch(() => { /* settled by the race below; avoid an unhandled rejection */ });
    // The SDK keeps retrying endpoint discovery for an unreachable account well
    // past its own timeouts, so bound the whole call here.
    let timer;
    const { resources } = await Promise.race([
      query,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('ETIMEDOUT: cosmos preview timed out')), COSMOS_TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
    const docs = resources || [];
    // Cosmos is schemaless: derive columns from the union of keys, 'id' first.
    const columns = [];
    const seen = new Set();
    for (const d of docs) {
      for (const k of Object.keys(d || {})) {
        if (!seen.has(k) && !COSMOS_SYSTEM_FIELDS.has(k)) { seen.add(k); columns.push(k); }
      }
    }
    columns.sort((a, b) => (a === 'id' ? -1 : b === 'id' ? 1 : 0));
    const rows = docs.map((d) => columns.map((c) => sqlCell(d?.[c])));
    res.json({ account: target.account, database: target.database, container: target.container, rowCap: COSMOS_PREVIEW_ROWS, columns, rows });
  } catch (err) {
    const msg = String(err?.message || err);
    const code = Number(err?.code ?? err?.statusCode ?? 0);
    console.error('cosmos-preview error:', msg);
    if (code === 404 || /NotFound|does not exist/i.test(msg)) {
      return res.status(404).json({ error: 'That database or container was not found.' });
    }
    if (code === 401 || code === 403 || /Forbidden|Unauthorized|not authorized|PrincipalId/i.test(msg)) {
      return res.status(403).json({ error: 'The app\u2019s identity cannot read this container. It needs the Cosmos DB Built-in Data Reader role on the account.' });
    }
    if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|ETIMEDOUT|ETIMEOUT|ESOCKET|fetch failed|network|abort|timeout|timed out/i.test(msg)) {
      return res.status(502).json({ error: 'Could not reach the Cosmos DB account. It may have been deleted, or is on a private network this app cannot access.' });
    }
    return res.status(502).json({ error: 'Unable to load this container preview.' });
  }
});

export default router;
