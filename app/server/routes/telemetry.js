// /api/feedback, /api/popular-searches
//
// Ratings and the query log are written with the app identity - the same keyless path
// as /api/sql-preview. The identity is granted rights on dbo.search_feedback and
// dbo.search_log only, not db_datawriter, so it can't write anywhere else in a shared
// database.
import { Router } from 'express';

import { normalizeQuery } from '../lib/search-filter.js';
import { getToken } from '../azure.js';
import {
  SQL_SCOPE, FEEDBACK_SQL_SERVER, FEEDBACK_SQL_DATABASE, SEARCH_LOG_ENABLED,
  POPULAR_TOP, POPULAR_MIN_HITS, POPULAR_WINDOW_DAYS, POPULAR_CACHE_MS
} from '../config.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function withFeedbackDb(fn) {
  const token = await getToken(SQL_SCOPE);
  const sql = (await import('mssql')).default;
  const pool = new sql.ConnectionPool({
    server: FEEDBACK_SQL_SERVER,
    database: FEEDBACK_SQL_DATABASE,
    authentication: { type: 'azure-active-directory-access-token', options: { token } },
    options: { encrypt: true, trustServerCertificate: false },
    connectionTimeout: 15000,
    requestTimeout: 20000,
    pool: { max: 1, min: 0, idleTimeoutMillis: 5000 }
  });
  try {
    await pool.connect();
    return await fn(pool, sql);
  } finally {
    try { await pool.close(); } catch { /* ignore */ }
  }
}

async function recordFeedback({ rating, queryText, resultCount, searchId }) {
  await withFeedbackDb((pool, sql) => pool.request()
    .input('rating', sql.TinyInt, rating)
    .input('query_text', sql.NVarChar(1000), queryText)
    .input('result_count', sql.Int, resultCount)
    .input('search_id', sql.UniqueIdentifier, searchId)
    .query('INSERT INTO dbo.search_feedback (rating, query_text, result_count, search_id)'
      + ' VALUES (@rating, @query_text, @result_count, @search_id)'));
}

let searchLogDisabled = !SEARCH_LOG_ENABLED;

/** Called fire-and-forget from /api/search - must never throw into the request path. */
export async function logSearch({ searchId, queryText, resultCount }) {
  if (searchLogDisabled) return;
  const queryNorm = normalizeQuery(queryText);
  if (!queryNorm) return;
  try {
    await withFeedbackDb((pool, sql) => pool.request()
      .input('search_id', sql.UniqueIdentifier, searchId)
      .input('query_text', sql.NVarChar(1000), queryText)
      .input('query_norm', sql.NVarChar(200), queryNorm)
      .input('result_count', sql.Int, resultCount)
      .query('INSERT INTO dbo.search_log (search_id, query_text, query_norm, result_count)'
        + ' VALUES (@search_id, @query_text, @query_norm, @result_count)'));
  } catch (err) {
    const msg = String(err?.message || err);
    // A missing table or a missing grant won't resolve itself -- stop paying for a
    // doomed SQL connection on every subsequent search.
    if (/Invalid object name|permission|denied|principal|Login failed|Cannot open/i.test(msg)) {
      searchLogDisabled = true;
      console.warn('search logging disabled:', msg);
    } else {
      console.error('search log write error:', msg);
    }
  }
}

let popularCache = { at: 0, items: [] };

async function popularSearches() {
  if (POPULAR_CACHE_MS && popularCache.at && Date.now() - popularCache.at < POPULAR_CACHE_MS) {
    return popularCache.items;
  }
  const result = await withFeedbackDb((pool, sql) => pool.request()
    .input('top', sql.Int, POPULAR_TOP)
    .input('days', sql.Int, POPULAR_WINDOW_DAYS)
    .input('min_hits', sql.Int, POPULAR_MIN_HITS)
    .query(`SELECT TOP (@top) query_norm AS text, COUNT(*) AS hits
              FROM dbo.search_log
             WHERE created_utc >= DATEADD(day, -@days, SYSUTCDATETIME())
               AND result_count > 0
               AND LEN(query_norm) BETWEEN 8 AND 80
             GROUP BY query_norm
            HAVING COUNT(*) >= @min_hits
             ORDER BY COUNT(*) DESC, MAX(created_utc) DESC`));
  const items = (result.recordset || []).map((r) => ({ text: r.text, count: r.hits }));
  popularCache = { at: Date.now(), items };
  return items;
}

// The client falls back to its curated examples on an empty list, so this never 500s --
// an unprovisioned or unreachable log must not break the landing page.
router.get('/popular-searches', async (_req, res) => {
  try {
    res.json({ items: await popularSearches() });
  } catch (err) {
    console.error('popular searches error:', String(err?.message || err));
    res.json({ items: [] });
  }
});

router.post('/feedback', async (req, res) => {
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5.' });
  }
  const queryText = (req.body?.query ?? '').toString().trim().slice(0, 1000);
  if (!queryText) return res.status(400).json({ error: 'The rated query is required.' });
  const rawCount = Number(req.body?.resultCount);
  const resultCount = Number.isFinite(rawCount) ? Math.min(Math.max(Math.trunc(rawCount), 0), 1000) : null;
  const rawId = (req.body?.searchId ?? '').toString();
  const searchId = UUID_RE.test(rawId) ? rawId : null;

  try {
    await recordFeedback({ rating, queryText, resultCount, searchId });
    res.status(204).end();
  } catch (err) {
    const msg = String(err?.message || err);
    console.error('feedback write error:', msg);
    if (/Login failed|permission|principal|Cannot open (server|database)|denied|not authorized/i.test(msg)) {
      return res.status(403).json({ error: 'The app\u2019s identity cannot write feedback. It needs INSERT on dbo.search_feedback.' });
    }
    if (/ETIMEOUT|ESOCKET|ECONNREFUSED|ENOTFOUND|getaddrinfo|Failed to connect|ETIMEDOUT/i.test(msg)) {
      return res.status(502).json({ error: 'Could not reach the feedback database.' });
    }
    res.status(500).json({ error: 'Could not record your rating.' });
  }
});

export default router;
