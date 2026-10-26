// Libra Asset Search - server bootstrap.
//
// This file wires the app together and nothing else. The work lives in:
//   config.js            every environment-derived setting
//   azure.js             the credential and its token cache
//   lib/                 pure, unit-tested helpers (parsers, quoting, filters, limiter)
//   routes/              one router per concern
//
// The design in one line: a web app that reads private data using its own managed
// identity. There are no keys or connection strings in this source - every downstream
// call authenticates with DefaultAzureCredential.
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRateLimiter, RATE_WINDOW_MS } from './lib/rate-limit.js';
import { PORT, REQUIRE_AUTH, RATE_MAX_SEARCH, RATE_MAX_DATA } from './config.js';
import searchRoutes from './routes/search.js';
import telemetryRoutes from './routes/telemetry.js';
import fileRoutes from './routes/file.js';
import previewRoutes from './routes/previews/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      workerSrc: ["'self'", 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '16kb' }));

// ---- Require an App Service Easy Auth principal (defence in depth) ----
// Easy Auth already blocks anonymous requests at the platform edge; this catches the
// case where it gets switched off while the app still holds data-plane access. Only
// meaningful with Easy Auth on, which strips client-supplied copies of these headers.
if (REQUIRE_AUTH) {
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    if (req.get('x-ms-client-principal-id') || req.get('x-ms-client-principal')) return next();
    res.status(401).json({ error: 'Sign-in required.' });
  });
}

// ---- Per-IP rate limiting ----
// Two budgets: cheap catalog queries, and the data endpoints that stream private
// content or hit an external system once per call. /api/health is never limited so
// the platform probe can't be throttled out by a flood.
const limiter = createRateLimiter({ windowMs: RATE_WINDOW_MS });
limiter.startSweeper();

app.use(['/api/search', '/api/browse', '/api/feedback', '/api/popular-searches'], limiter.limit(RATE_MAX_SEARCH));
app.use(
  ['/api/file', '/api/sql-preview', '/api/databricks-preview', '/api/cosmos-preview', '/api/adx-preview'],
  limiter.limit(RATE_MAX_DATA)
);

// ---- Routes ----
app.use('/api', searchRoutes);
app.use('/api', telemetryRoutes);
app.use('/api', fileRoutes);
app.use('/api', previewRoutes);

// ---- Static SPA + fallback ----
// Hashed assets cache for 1h; index.html must always revalidate so new deploys
// (with new asset hashes) are picked up on the next load instead of going stale.
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir, { index: false, maxAge: '1h' }));
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => console.log(`Libra Asset Search listening on port ${PORT}`));
