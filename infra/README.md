# Libra Asset Search — Azure hosting

Deploys the `app/` (Vite + React SPA + Express API) to Azure App Service with
**private networking** to the catalog's private-endpoint storage, while the
site itself is **public** (for demos).

> **There are two ways to provision this.** [bicep/](bicep/README.md) is a single
> declarative deployment covering scripts 01, 02, 04, 05 and 12 — prefer it for a new
> environment. The numbered scripts below remain the path for everything with no ARM
> representation (zip deploy, T-SQL grants, the AI Search indexer, Easy Auth), and are
> still the fastest way to turn one optional feature on.

New deployment? Read **[../PROVISIONING.md](../PROVISIONING.md)** first for the
resources, tiers and permissions you need in place before running these.

## Deploy order

| # | Script | What it does |
|---|--------|--------------|
| 1 | `01-provision.ps1` | RG, Linux App Service Plan (P0V3), web app (Node 22), system-assigned MI, base app settings, startup `npm start`, temp IP lock to the deploy machine. Writes `deployment.json`. |
| 2 | `02-rbac.ps1` | Grants the MI: `Search Index Data Reader` (libraaisearch), `Cognitive Services OpenAI User` (hokieopenai), and `Storage Blob Data Reader` **on each storage account the catalog references** (derived from `main_assets.csv`). `-StorageAccounts` overrides the list; `-SubscriptionScopeStorage` opts back into the old subscription-wide grant. |
| 3 | `03-deploy.ps1` | Zips the source and `az webapp deploy`; Oryx builds vite + starts the server. |
| 4 | `04-vnet.ps1` | Creates a delegated subnet in `hokiesynapsevirtualnetwork01`, adds regional VNet integration, sets `WEBSITE_VNET_ROUTE_ALL=1` + `WEBSITE_DNS_SERVER`. Lets the app resolve/reach private-endpoint storage. |
| 5 | `05-public.ps1` | Removes the deploy-IP lock (site goes public), forces HTTPS-only. |
| 6 | `06-sql-access.ps1` | (Only if using the **Preview table** feature) Creates a private endpoint + `privatelink.database.windows.net` DNS zone for the private-only Azure SQL server, resumes the Synapse pool, and grants the MI `db_datareader` on both databases. |
| 7 | `07-databricks-access.ps1` | (Only for **Databricks** previews) Sets the `DATABRICKS_*` app settings (SQL warehouse id, host, allowlist) for the `/api/databricks-preview` endpoint and prints the in-workspace grants to apply. |
| 8 | `08-cosmos-adx-access.ps1` | (Only for **Cosmos DB / ADX** previews) Grants the MI the Cosmos data-plane reader role (optionally with a private endpoint) and the ADX database `Viewer` role; can also start a stopped ADX cluster. |
| 9 | `09-feedback-store.ps1` | (Only for **search ratings** + **Most common searches**) Creates `dbo.search_feedback` and `dbo.search_log` in the existing Azure SQL database, grants the MI `INSERT` on both plus `SELECT` on the log, and sets the `FEEDBACK_SQL_*` app settings. Requires `06-sql-access.ps1` first. |
| 10 | `10-blob-indexer.ps1` | Builds the pull-model load path: data source, embedding skillset and indexer over `main-assets/jsonl/`. `-Prepare` grants the search identity Storage Blob Data Reader + Cognitive Services OpenAI User and creates/approves the `blob` and `dfs` shared private links. `-Run` indexes immediately; otherwise it runs on a 12-hour schedule. |
| 11 | `11-auth.ps1` | **Strongly recommended.** Puts Microsoft Entra ID (Easy Auth) in front of the site: app registration, redirect URI, client secret, require-authentication. Leaves `/api/health` anonymous for the platform probe. `-Disable` reverts to an anonymous demo site. |
| 12 | `12-allowlists.ps1` | **Strongly recommended.** Derives the five SSRF allowlists from `main_assets.csv` and applies them as app settings. Dry-run by default; `-Apply` writes them and restarts the app. Re-run after every catalog reload. |
| — | `_allowlists.ps1` | Shared helper (dot-sourced by `02` and `12`). Parses `qualifiedName` values into storage accounts / SQL servers / Cosmos accounts / ADX clusters / Databricks hosts. |

```powershell
./01-provision.ps1
./02-rbac.ps1
./03-deploy.ps1
./04-vnet.ps1
./05-public.ps1
./06-sql-access.ps1        # optional: enables SQL table previews
./07-databricks-access.ps1 # optional: enables Databricks table previews
./08-cosmos-adx-access.ps1 # optional: enables Cosmos DB + ADX previews
./09-feedback-store.ps1    # optional: enables ratings + popular searches
./10-blob-indexer.ps1 -Prepare
./10-blob-indexer.ps1 -Run
./11-auth.ps1              # recommended: require Entra sign-in
./12-allowlists.ps1 -Apply # recommended: narrow the SSRF allowlists
```

## Allowlists and blob scope

Each `u=` parameter on the viewer/preview endpoints is guarded by a host-suffix check plus an
**optional** allowlist. An unset allowlist means *any* host under that suffix. Paired with a
subscription-wide `Storage Blob Data Reader` grant, that made `/api/file` a read proxy for
every blob in the subscription — far beyond the catalogued assets.

Both halves are now closed by default:

- `02-rbac.ps1` grants blob-read **per storage account**, derived from the catalog export.
- `12-allowlists.ps1` derives and applies all five allowlists from the same export.

Because both read `main_assets.csv`, the grant and the allowlist can't drift apart. **Re-run
both after a catalog reload** — a new storage account will otherwise be blocked (allowlist)
and unreadable (RBAC).

## Authentication

`05-public.ps1` leaves the site anonymous so it can be demoed by URL. Because the app
reads private storage, SQL, Cosmos and ADX with its **own managed identity**, an anonymous
site hands that access to every visitor. `11-auth.ps1` closes that at the platform edge —
no application code changes, and unauthenticated browsers are redirected to Entra sign-in.

By default every user in the tenant can sign in. Narrow it to named users or groups with:

```powershell
az ad sp update --id <clientId> --set appRoleAssignmentRequired=true
```

As defence in depth, set `REQUIRE_AUTH=true` so the Express server also rejects any request
that arrives without an Easy Auth principal header — this catches the case where Easy Auth
is switched off while the app still holds data-plane access.

`deployment.json` carries state (subscription, RG, app name, MI principalId,
default host) between scripts.

## How private networking works here

- App and VNet are both in **eastus2**, so regional VNet integration reaches the
  private endpoints directly.
- The `privatelink.blob/dfs/...` zones are already linked to the VNet, so with
  `WEBSITE_VNET_ROUTE_ALL=1` the app resolves e.g.
  `hokiedemoadls2.blob.core.windows.net` to its private IP.
- AI Search + Azure OpenAI stay on their **public** endpoints (Public Network
  Access = Enabled) — no private endpoints needed for those.
- The **indexer** is a separate path. It runs inside the search service, not the
  app's VNet, so VNet integration doesn't help it. Reaching private-endpoint
  storage needs a **shared private link** (`blob` and `dfs` group IDs) plus
  `executionEnvironment: private` on the indexer. Same-region placement does not
  waive this once a private endpoint exists on the account.

## How SQL table previews work

The **Preview table** action runs `SELECT TOP 10 *` against catalog SQL assets
(`mssql://host/db/schema/table`) via the `/api/sql-preview` endpoint, using the
app's managed identity for AAD auth (no passwords).

- **Azure SQL** (`hokiecopilotchatsqlserver`) has Public Network Access =
  **Disabled**, so `06-sql-access.ps1` adds a **private endpoint** in the app's
  VNet plus a `privatelink.database.windows.net` zone linked to that VNet. The
  app resolves the server FQDN to the PE's private IP via Azure DNS.
- **Synapse** (`hokiesynapsews` / `hokiepool01`) is **public** with an
  allow-Azure firewall rule, so the VNet-integrated app reaches it directly —
  but the dedicated pool must be **resumed** (Online).
- The MI is granted `db_datareader` on each database (`CREATE USER ... FROM
  EXTERNAL PROVIDER`). Set `SQL_ALLOWED_SERVERS=hokiecopilotchatsqlserver,hokiesynapsews`
  to restrict which servers the endpoint may reach.

## How Databricks table previews work

Databricks tables can't use the TDS/`mssql` driver, so the **Preview table**
action for Databricks assets runs `SELECT * ... LIMIT 10` through the workspace's
**Databricks SQL Statement Execution API** against a SQL warehouse, via the
`/api/databricks-preview` endpoint.

- Two Purview qualifiedName shapes are supported: **Hive metastore**
  (`<schema>.<table>@adb-<workspaceId>.<n>.azuredatabricks.net` — host is in the
  name) and **Unity Catalog**
  (`databricks://<metastoreId>/catalogs/<catalog>/schemas/<schema>/tables/<table>`
  — needs `DATABRICKS_HOST` since the name carries only a metastore GUID).
- Auth uses the app's **managed identity** (AAD token for the Azure Databricks
  resource) by default, or a **PAT** if `DATABRICKS_TOKEN` is set. The identity
  needs `SELECT` on the tables and `Can use` on the warehouse (register the MI as
  a workspace service principal). `07-databricks-access.ps1` sets the app
  settings and prints the exact grants.
- The host is SSRF-guarded to `*.azuredatabricks.net`; set
  `DATABRICKS_ALLOWED_HOSTS` to restrict to specific workspaces.
- Networking: a **public** workspace is reachable over the app's VNet egress; a
  **private** workspace needs a private endpoint + `privatelink.azuredatabricks.net`
  zone linked to the app VNet (same pattern as the Azure SQL PE).

## How Cosmos DB and ADX previews work

- **Cosmos DB** assets (`https://<account>.documents.azure.com/dbs/<db>/colls/<container>`)
  are previewed by `/api/cosmos-preview`, which runs `SELECT TOP 10 * FROM c`
  with the `@azure/cosmos` SDK using the app's managed identity. Because Cosmos
  is schemaless, columns are the union of keys across the returned documents
  (`id` first; the `_rid`/`_self`/`_etag`/`_attachments` bookkeeping fields are
  hidden). Data-plane access is **not** an Azure RBAC role — the identity needs
  the account's built-in **Cosmos DB Built-in Data Reader** SQL role assignment.
- **Azure Data Explorer** assets (`https://<cluster>.<region>.kusto.windows.net/<db>/<table>`)
  are previewed by `/api/adx-preview`, which posts `<table> | take 10` to the
  cluster's `v1/rest/query` API with a token scoped to that cluster. The
  identity needs the **Viewer** role on the database, and the cluster must be
  **Running** (a stopped cluster returns a "may be stopped" error).
- Both endpoints are SSRF-guarded to their host suffixes; set
  `COSMOS_ALLOWED_ACCOUNTS` / `ADX_ALLOWED_CLUSTERS` to restrict further.
  Row caps are `COSMOS_PREVIEW_ROWS` / `ADX_PREVIEW_ROWS` (default 10).

## Search result ratings

After each search the UI shows a 1–5 usefulness scale. `POST /api/feedback`
inserts one row into **`dbo.search_feedback`** on the existing Azure SQL database
(`hokiecopilotchatsqlserver` / `hokiecopilotsqldb01`), reached over the same
private endpoint and managed identity as the **Preview table** feature — no
connection string, no secret.

| Column | Notes |
|---|---|
| `feedback_id` | identity PK |
| `created_utc` | `DATETIME2(3)`, defaults to `SYSUTCDATETIME()` |
| `rating` | `TINYINT`, `CHECK (rating BETWEEN 1 AND 5)` |
| `query_text` | `NVARCHAR(1000)` |
| `result_count` | how many matches were on screen |
| `search_id` | GUID stamped on the `/api/search` response, so a rating ties to that exact result set |

Run `09-feedback-store.ps1` to create the table and grant access. The identity gets
**`INSERT` on this table only** — not `db_datawriter`, which would allow writes to
every table in a shared database.

```powershell
./09-feedback-store.ps1

# Read the ratings back (as yourself, not the app identity):
# SELECT TOP 50 * FROM dbo.search_feedback ORDER BY created_utc DESC;
# SELECT rating, COUNT(*) FROM dbo.search_feedback GROUP BY rating ORDER BY rating;
```

Override the target with the `FEEDBACK_SQL_SERVER` / `FEEDBACK_SQL_DATABASE` app
settings if the table moves (e.g. to PostgreSQL later).

## Demo operations

```powershell
# Take the app offline between demos (recommended — it's public):
az webapp stop  -g rg-libra-assetsearch -n <appName>
az webapp start -g rg-libra-assetsearch -n <appName>

# Re-lock to just your IP instead of fully public:
az webapp config access-restriction add -g rg-libra-assetsearch -n <appName> `
  --rule-name lockdown --action Allow --ip-address <YOUR_IP>/32 --priority 100
```

## Security caveat

The site is public with **no auth**. Because the app reads files from private
storage using its managed identity, anyone with the URL can view those files.
The custom PDF viewer only **deters** download/print (no native toolbar, blocked
Ctrl/Cmd+P/S) — it is **not** DRM. Stop the app between demos, or re-lock to your
IP, to limit exposure.
