// /api/search, /api/browse, /api/health
//
// Search and browse are genuinely different queries, not one query with a flag:
// search is semantic + vector with a relevance cut-off; browse is a filtered,
// sorted, paged slice of the index with true index-wide facet counts.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';

import { locationLabel } from '../lib/qualified-names.js';
import { buildFilter } from '../lib/search-filter.js';
import { getToken } from '../azure.js';
import { logSearch } from './telemetry.js';
import {
  SEARCH_ENDPOINT, SEARCH_INDEX, SEARCH_API, SEMANTIC_CONFIG, MIN_RERANKER_SCORE,
  AOAI_ENDPOINT, AOAI_EMBED, AOAI_API, SEARCH_SCOPE, AOAI_SCOPE
} from '../config.js';

const router = Router();

const SELECT_FIELDS = 'name,assetEntityType,purviewUrl,qualifiedName,displayText,collectionId,collectionName,assetTypeFriendly,owner,expert,format,userDescription';

async function embedQuery(text) {
  const token = await getToken(AOAI_SCOPE);
  const url = `${AOAI_ENDPOINT}/openai/deployments/${AOAI_EMBED}/embeddings?api-version=${AOAI_API}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text })
  });
  if (!r.ok) throw new Error(`Embedding request failed: ${r.status}`);
  const j = await r.json();
  return j.data[0].embedding;
}

function mapDoc(d) {
  return {
    name: d.name,
    assetEntityType: d.assetEntityType,
    assetTypeFriendly: d.assetTypeFriendly || '',
    collectionId: d.collectionId || '',
    collectionName: d.collectionName || '',
    owner: d.owner || '',
    expert: d.expert || '',
    format: d.format || '',
    purviewUrl: d.purviewUrl,
    qualifiedName: d.qualifiedName,
    userDescription: d.userDescription || '',
    score: d['@search.rerankerScore'] ?? d['@search.score'] ?? null,
    caption: d['@search.captions']?.[0]?.highlights || d['@search.captions']?.[0]?.text || ''
  };
}

async function searchAssets(q, top, filter) {
  const vector = await embedQuery(q);
  const token = await getToken(SEARCH_SCOPE);
  const url = `${SEARCH_ENDPOINT}/indexes/${SEARCH_INDEX}/docs/search?api-version=${SEARCH_API}`;
  const body = {
    search: q,
    queryType: 'semantic',
    semanticConfiguration: SEMANTIC_CONFIG,
    captions: 'extractive',
    vectorQueries: [{ kind: 'vector', vector, fields: 'descriptionVector', k: 50 }],
    select: SELECT_FIELDS,
    top
  };
  if (filter) body.filter = filter;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Search request failed: ${r.status}`);
  const j = await r.json();
  const mapped = (j.value || []).map(mapDoc);

  // Vector/semantic search always returns `top` neighbours ranked by similarity, so
  // low-relevance docs backfill the list. Drop anything below the reranker threshold.
  const relevant = mapped.filter((d) => d.score == null || d.score >= MIN_RERANKER_SCORE);

  // The same document is often catalogued in several storage locations. Collapse those
  // into one result (highest-scoring instance) that carries every location + Purview link.
  const groups = new Map();
  for (const d of relevant) {
    const key = d.name || d.qualifiedName;
    const loc = { path: locationLabel(d.qualifiedName), qualifiedName: d.qualifiedName, purviewUrl: d.purviewUrl };
    const g = groups.get(key);
    if (g) {
      if (loc.qualifiedName && !g.locations.some((l) => l.qualifiedName === loc.qualifiedName)) {
        g.locations.push(loc);
      }
    } else {
      groups.set(key, {
        name: d.name,
        assetEntityType: d.assetEntityType,
        assetTypeFriendly: d.assetTypeFriendly,
        collectionId: d.collectionId,
        collectionName: d.collectionName,
        owner: d.owner,
        expert: d.expert,
        format: d.format,
        purviewUrl: d.purviewUrl,
        qualifiedName: d.qualifiedName,
        userDescription: d.userDescription,
        caption: d.caption,
        score: d.score,
        locations: [loc]
      });
    }
  }
  return [...groups.values()];
}

router.post('/search', async (req, res) => {
  try {
    const q = (req.body?.q ?? '').toString().trim();
    if (!q) return res.status(400).json({ error: 'A search query is required.' });
    if (q.length > 1000) return res.status(400).json({ error: 'Search query is too long.' });
    const top = Math.min(Math.max(parseInt(req.body?.top, 10) || 15, 1), 50);
    const filter = buildFilter(req.body?.facets);
    const results = await searchAssets(q, top, filter);
    const searchId = randomUUID();
    // Echoed back with any rating so feedback ties to this exact result set.
    res.json({ searchId, query: q, count: results.length, results });
    // Fire-and-forget: telemetry must never delay or fail a search.
    void logSearch({ searchId, queryText: q, resultCount: results.length });
  } catch (err) {
    console.error('search error:', err.message);
    res.status(502).json({ error: 'Search is temporarily unavailable. Please try again.' });
  }
});

// Browse is a different query shape from search: no vector, no semantic ranker and no
// relevance threshold — just a filtered slice of the catalog with true facet counts.
const BROWSE_SORTS = {
  name: 'name asc',
  collection: 'collectionName asc,name asc',
  platform: 'assetTypeFriendly asc,name asc',
  gov: 'owner asc,expert asc,name asc'
};
const BROWSE_FACETS = ['collectionName', 'assetTypeFriendly', 'assetEntityType', 'owner', 'expert', 'format'];

async function browseAssets({ top, skip, facets, sort }) {
  const token = await getToken(SEARCH_SCOPE);
  const url = `${SEARCH_ENDPOINT}/indexes/${SEARCH_INDEX}/docs/search?api-version=${SEARCH_API}`;
  const post = (body) => fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (r) => {
    if (!r.ok) throw new Error(`Browse request failed: ${r.status}`);
    return r.json();
  });

  const base = { search: '*', queryType: 'simple', select: SELECT_FIELDS, count: true };
  const withFilter = (body, f) => (f ? { ...body, filter: f } : body);
  const filter = buildFilter(facets);
  const page = withFilter({
    ...base,
    top,
    skip,
    orderby: BROWSE_SORTS[sort] || BROWSE_SORTS.name,
    facets: BROWSE_FACETS.map((f) => `${f},count:60`)
  }, filter);

  // A group's own selection must not constrain its own counts, or choosing one value
  // hides every sibling value and you can't switch without clearing first.
  const chosen = Object.entries(facets || {})
    .filter(([k, v]) => Array.isArray(v) && v.length && (BROWSE_FACETS.includes(k) || k === 'stewardship'))
    .map(([k]) => k);
  const stewFilter = chosen.includes('stewardship') ? buildFilter(facets, 'stewardship') : filter;

  // owner and expert give "no owner" and "no expert" separately but never their
  // intersection, so "no contact at all" needs a count of its own.
  const gap = "owner eq '' and expert eq ''";
  const jobs = [
    post(page),
    post({ ...base, top: 0, filter: stewFilter ? `(${stewFilter}) and ${gap}` : gap }),
    ...(chosen.includes('stewardship')
      ? [post(withFilter({ ...base, top: 0, facets: ['owner,count:60', 'expert,count:60'] }, stewFilter))]
      : []),
    ...chosen.filter((k) => k !== 'stewardship').map((k) =>
      post(withFilter({ ...base, top: 0, facets: [`${k},count:60`] }, buildFilter(facets, k)))
        .then((r) => [k, r['@search.facets'] || {}]))
  ];

  const [p, n, ...rest] = await Promise.all(jobs);
  const total = p['@odata.count'] ?? 0;
  const pageFacets = p['@search.facets'] || {};
  // Drill-down responses override the page's own counts for the groups they cover.
  const stewSource = chosen.includes('stewardship') ? (rest.shift()['@search.facets'] || {}) : pageFacets;
  const drilled = Object.fromEntries(rest);

  const bucket = (name) => ((drilled[name]?.[name] ?? pageFacets[name]) || [])
    .map((x) => ({ value: x.value ?? '', count: x.count }));
  const stewTotal = chosen.includes('stewardship')
    ? (stewSource.owner || []).reduce((a, x) => a + x.count, 0)
    : total;
  const emptyCount = (name) => (stewSource[name] || []).find((x) => !x.value)?.count ?? 0;
  const noOwner = emptyCount('owner');
  const noExpert = emptyCount('expert');

  return {
    total,
    // Every wildcard hit scores 1.0, which is not relevance — drop it so the UI shows no band.
    results: (p.value || []).map((d) => ({ ...mapDoc(d), score: null })),
    facets: {
      ...Object.fromEntries(BROWSE_FACETS.map((k) => [k, bucket(k)])),
      stewardship: [
        { value: 'has-owner', count: stewTotal - noOwner },
        { value: 'no-owner', count: noOwner },
        { value: 'has-expert', count: stewTotal - noExpert },
        { value: 'no-expert', count: noExpert },
        { value: 'no-contact', count: n['@odata.count'] ?? 0 }
      ].filter((x) => x.count > 0)
    }
  };
}

// Deliberately not logged to dbo.search_log — browsing is not a query, and counting it
// would pollute "Most common searches".
router.post('/browse', async (req, res) => {
  try {
    const top = Math.min(Math.max(parseInt(req.body?.top, 10) || 50, 1), 1000);
    const skip = Math.min(Math.max(parseInt(req.body?.skip, 10) || 0, 0), 100000);
    const sort = (req.body?.sort ?? 'name').toString();
    res.json(await browseAssets({ top, skip, facets: req.body?.facets, sort }));
  } catch (err) {
    console.error('browse error:', err.message);
    res.status(502).json({ error: 'Browse is temporarily unavailable. Please try again.' });
  }
});

router.get('/health', (_req, res) => res.json({ status: 'ok' }));

export default router;
