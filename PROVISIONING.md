# Provisioning guide

This guide describes the Azure resources you need before you deploy Libra Asset Search, and
the decisions that are difficult to change later.

Read this first. Two choices — the search service tier and the staging store — are expensive
to reverse once the index is built.

---

## What the solution does

Libra Asset Search makes your Microsoft Purview catalog searchable by meaning. Users describe
what they need in plain language, and the app returns matching assets with links back to
Purview, an inline preview of the data, and facets to narrow the results.

Users can also browse the whole catalog without typing anything, and filter it by collection,
platform, or stewardship gaps such as "no owner assigned". This makes the app useful as a
governance worklist, not only as a search box.

The app doesn't query Purview at run time. A pipeline exports catalog metadata, an Azure AI
Search indexer loads it, and the web app queries the index.

---

## Required resources

Provision these five before you begin. All must be in the **same region**.

| Resource | Purpose | Minimum |
|---|---|---|
| **Microsoft Purview** | Source of catalog metadata | Any tier with a completed scan |
| **Azure AI Search** | Serves every query | **Standard (S1)** — see [Choose a search tier](#choose-a-search-tier) |
| **Azure OpenAI** | Generates embeddings | An account with a `text-embedding-3-large` deployment |
| **Azure Storage (ADLS Gen2)** | Staging for the exported catalog | StorageV2 with hierarchical namespace enabled |
| **Azure App Service** | Hosts the web app | Linux, Node 22, P0V3 or higher |

The app and the search service must be in the same region as your storage account. Cross-region
indexing works but adds latency and egress cost.

### Optional resources

Add these only if you want the matching feature.

| Resource | Enables |
|---|---|
| **Azure SQL Database** | Search ratings, the query log, and the *Most common searches* chips |
| **Azure Databricks** | Table previews for Databricks assets |
| **Azure Cosmos DB** | Container previews |
| **Azure Data Explorer** | Table previews for Kusto assets |

---

## Choose a search tier

The tier determines what the indexer can do when your storage account is private. Choose
before you build the index — changing tiers later is disruptive.

| Your situation | Tier |
|---|---|
| Storage allows public network access | **Basic** is sufficient |
| Storage is private, and you use only an embedding skill | **Basic**, if the service was created after 3 April 2024 in a high-capacity region |
| Storage is private, and you need chunking, PII detection or a custom skill | **Standard (S1)** |
| You need a service-level agreement | Any billable tier with **two or more replicas** |

**We recommend Standard (S1) with two replicas** for a customer deployment. Basic works for a
demo, but it excludes non-embedding skills over a private link and can't meet an SLA at one
replica.

Two limits worth knowing:

- Basic caps a blob source file at **16 MB**. Standard raises this to 128 MB. The conversion
  script splits output at 8 MB, so this rarely blocks you.
- The semantic ranker allows **2 concurrent requests per search unit** on Basic and 3 on
  Standard. Every search in this app uses the semantic ranker, so concurrency matters more
  than storage.

---

## Choose a staging store

The pipeline writes catalog metadata to a staging store, and the indexer reads from it. Azure
AI Search supports a fixed set of sources, so this choice constrains everything downstream.

**Use Azure Storage.** Every customer already has it, no platform standard forbids it, and the
blob indexer reads JSON Lines natively.

Two constraints to be aware of:

- Azure AI Search has **no indexer for Azure Database for PostgreSQL**. MySQL support is in
  preview. If your organization mandates PostgreSQL, you must push documents to the index with
  your own code rather than using an indexer.
- The blob indexer **can't read Parquet**. Keep Parquet in your pipeline if you prefer it, but
  convert to JSON Lines for the indexer. The included script does this.

---

## Network configuration

The app is deliberately public so you can demo it by URL. It reads private data using its own
managed identity.

| Connection | Requirement |
|---|---|
| App Service → private storage, SQL | Regional VNet integration, with `WEBSITE_VNET_ROUTE_ALL=1` |
| App Service → AI Search, Azure OpenAI | Public endpoints. No configuration needed. |
| **AI Search indexer → private storage** | **Shared private link**, approved on the storage account |

If your storage account has public network access disabled, the indexer can't reach it over
the internet. You need a shared private link with the `blob` and `dfs` group IDs, and the
indexer must run with `executionEnvironment` set to `private`. The `-Prepare` switch on
`infra/10-blob-indexer.ps1` creates and approves both.

Same-region placement does **not** remove this requirement. If a private endpoint exists on the
storage account, the connection is refused without a shared private link.

---

## Permissions

### Your account

To run the provisioning scripts, you need:

- **Contributor** on the resource group
- **User Access Administrator** or **Owner**, to assign roles to managed identities
- **Purview Data Reader** on the collections you want to export

### App Service managed identity

Assigned by `infra/02-rbac.ps1`.

| Role | Scope |
|---|---|
| Search Index Data Reader | Azure AI Search |
| Cognitive Services OpenAI User | Azure OpenAI |
| Storage Blob Data Reader | Storage accounts holding previewable files |
| `INSERT` on two tables | Azure SQL, if you enable ratings |

The SQL grant is deliberately narrow. Don't use `db_datawriter` — it would allow writes to
every table in a shared database.

### Search service managed identity

Assigned by `infra/10-blob-indexer.ps1 -Prepare`.

| Role | Scope |
|---|---|
| Storage Blob Data Reader | The staging storage account |
| Cognitive Services OpenAI User | Azure OpenAI |

Enable the system-assigned managed identity on the search service before you run this. The
data source and skillset use it instead of keys.

---

## Sizing and cost

The main cost drivers, in order:

1. **App Service Plan.** P0V3 runs continuously. Stop the app between demos to reduce spend.
2. **Azure AI Search.** Billed per search unit (replicas × partitions). Standard with two
   replicas is two search units.
3. **Azure OpenAI embeddings.** Charged per token at index time only, not per query. A 1,000-asset
   catalog costs a few cents to embed. Reruns only process changed documents.
4. **Storage.** Negligible. A 1,000-asset export is roughly 5 MB.
5. **Private Link.** Shared private links are billed by usage.

For capacity: 1,000 assets uses about 17 MB of vector index and 60 MB of storage. Even 20,000
assets stays within 10% of the Standard quota. Capacity is rarely the constraint — concurrency is.

---

## Before you deploy

Confirm each item:

- [ ] Purview scan has completed, and assets have descriptions
- [ ] Azure OpenAI has a `text-embedding-3-large` deployment
- [ ] Search service tier chosen, with a system-assigned managed identity enabled
- [ ] Semantic ranker enabled on the search service
- [ ] Storage account created with hierarchical namespace enabled
- [ ] All resources in the same region
- [ ] You have Contributor and User Access Administrator on the resource group
- [ ] If storage is private: you can approve private endpoint connections on it

---

## Next steps

1. Export your catalog to `main_assets.csv` at the repository root. See the notebooks in
   [Project Libra's Reporting directory](https://github.com/ujvalgandhi1/ProjectLibra/tree/main/Reporting).
   Catalog exports are local data and are not committed to this repository.
2. Follow the deployment order in [infra/README.md](infra/README.md).
3. Load the index. See [Loading the index](README.md#loading-the-index).

---

## Common issues

**The indexer processes 0 documents.** Check the execution history rather than the current
status. A run that processes 0 documents immediately after a successful run means change
detection is working, not that indexing failed.

**The indexer can't reach storage.** Confirm the shared private link shows **Approved** on both
the search service and the storage account, and that the indexer's `executionEnvironment` is
set to `private`.

**Facets are empty.** Facetable fields must be marked `facetable` in the index schema. Adding
that attribute to an existing field requires rebuilding the index, so add a new field instead.
Browsing depends on this: without facetable fields, the app can't count the catalog.

**"No owner" filters return nothing.** Export empty strings rather than omitting the field. A
missing field indexes as null and never matches `owner eq ''`.

**A `*` in the search box returns nothing.** That's expected. The semantic ranker can't rank a
wildcard, so every row falls below the relevance cut-off. Clear the box and select **Browse
all** instead.
