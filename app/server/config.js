// Every environment-derived setting in one place, so a deployment's shape can be read
// off a single file instead of grepped out of route handlers.
//
// Defaults match the reference deployment. A new customer overrides them via App
// Service app settings.

const num = (value, fallback, min, max) => {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const list = (value) =>
  (value || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const PORT = process.env.PORT || 8080;

// ---- Azure AI Search ----
export const SEARCH_ENDPOINT = process.env.SEARCH_ENDPOINT || 'https://libraaisearch.search.windows.net';
export const SEARCH_INDEX = process.env.SEARCH_INDEX || 'main-assets-index';
export const SEARCH_API = process.env.SEARCH_API_VERSION || '2024-07-01';
export const SEMANTIC_CONFIG = process.env.SEARCH_SEMANTIC_CONFIG || 'semcfg';
// Semantic reranker scores range 0–4; results below this are irrelevant backfill.
export const MIN_RERANKER_SCORE = Number(process.env.SEARCH_MIN_RERANKER_SCORE ?? 1.8);

// ---- Azure OpenAI ----
export const AOAI_ENDPOINT = process.env.AOAI_ENDPOINT || 'https://hokieopenai.openai.azure.com';
export const AOAI_EMBED = process.env.AOAI_EMBED_DEPLOYMENT || 'text-embedding-3-large';
export const AOAI_API = process.env.AOAI_API_VERSION || '2024-02-01';

// ---- Entra token audiences ----
export const SEARCH_SCOPE = 'https://search.azure.com/.default';
export const AOAI_SCOPE = 'https://cognitiveservices.azure.com/.default';
export const STORAGE_SCOPE = 'https://storage.azure.com/.default';
export const SQL_SCOPE = 'https://database.windows.net/.default';
export const DBX_SCOPE = '2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default'; // Azure Databricks resource id

// ---- Access control ----
// Set REQUIRE_AUTH=true once infra/11-auth.ps1 has put Easy Auth in front of the site.
export const REQUIRE_AUTH = String(process.env.REQUIRE_AUTH ?? 'false').toLowerCase() === 'true';
export const RATE_MAX_SEARCH = Math.max(parseInt(process.env.RATE_LIMIT_SEARCH, 10) || 60, 1);
export const RATE_MAX_DATA = Math.max(parseInt(process.env.RATE_LIMIT_DATA, 10) || 20, 1);

// ---- SSRF allowlists ----
// EMPTY MEANS "ANY HOST UNDER THE EXPECTED SUFFIX". Populate them with
// infra/12-allowlists.ps1, which derives the values from the catalog export.
export const VIEWER_ALLOWED_ACCOUNTS = list(process.env.VIEWER_ALLOWED_ACCOUNTS);
export const SQL_ALLOWED_SERVERS = list(process.env.SQL_ALLOWED_SERVERS);
export const COSMOS_ALLOWED_ACCOUNTS = list(process.env.COSMOS_ALLOWED_ACCOUNTS);
export const ADX_ALLOWED_CLUSTERS = list(process.env.ADX_ALLOWED_CLUSTERS);
export const DBX_ALLOWED_HOSTS = list(process.env.DATABRICKS_ALLOWED_HOSTS);

// ---- Storage viewer ----
export const STORAGE_API_VERSION = process.env.STORAGE_API_VERSION || '2023-11-03';

// ---- Preview row caps ----
export const SQL_PREVIEW_ROWS = num(process.env.SQL_PREVIEW_ROWS, 10, 1, 100);
export const DBX_PREVIEW_ROWS = num(process.env.DATABRICKS_PREVIEW_ROWS, 10, 1, 100);
export const COSMOS_PREVIEW_ROWS = num(process.env.COSMOS_PREVIEW_ROWS, 10, 1, 100);
export const ADX_PREVIEW_ROWS = num(process.env.ADX_PREVIEW_ROWS, 10, 1, 100);
export const COSMOS_TIMEOUT_MS = num(process.env.COSMOS_TIMEOUT_MS, 12000, 2000, 60000);

// ---- Databricks ----
export const DBX_WAREHOUSE_ID = (process.env.DATABRICKS_WAREHOUSE_ID || '').trim();
export const DBX_DEFAULT_HOST = (process.env.DATABRICKS_HOST || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/\/+$/, '');
export const DBX_TOKEN = (process.env.DATABRICKS_TOKEN || '').trim(); // optional PAT; else app identity

// ---- Feedback / query log (Azure SQL) ----
export const FEEDBACK_SQL_SERVER = (process.env.FEEDBACK_SQL_SERVER || 'hokiecopilotchatsqlserver.database.windows.net').trim().toLowerCase();
export const FEEDBACK_SQL_DATABASE = (process.env.FEEDBACK_SQL_DATABASE || 'hokiecopilotsqldb01').trim();
export const SEARCH_LOG_ENABLED = String(process.env.SEARCH_LOG_ENABLED ?? 'true').toLowerCase() !== 'false';
export const POPULAR_TOP = Math.min(Math.max(parseInt(process.env.POPULAR_TOP, 10) || 5, 1), 10);
// A query has to be asked by more than one person before it is shown back to everyone.
export const POPULAR_MIN_HITS = Math.max(parseInt(process.env.POPULAR_MIN_HITS, 10) || 3, 2);
export const POPULAR_WINDOW_DAYS = Math.max(parseInt(process.env.POPULAR_WINDOW_DAYS, 10) || 90, 1);
export const POPULAR_CACHE_MS = Math.max(parseInt(process.env.POPULAR_CACHE_SECONDS, 10) || 300, 0) * 1000;
