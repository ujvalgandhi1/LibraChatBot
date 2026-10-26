using './main.bicep'

// Values match the reference deployment described in ../deployment.json and ../README.md.
// Derive the storage account list with ../_allowlists.ps1 and keep it in step with the
// VIEWER_ALLOWED_ACCOUNTS app setting - the RBAC grant and the SSRF allowlist should
// always name the same accounts.

param location = 'eastus2'
param resourceGroupName = 'rg-libra-assetsearch'
param appName = 'libra-assetsearch-25f9f8'
param planName = 'asp-libra-assetsearch'
param planSku = 'P0V3'

// Empty = public site. Run ../11-auth.ps1 to require Entra sign-in, which is the
// supported way to protect it - an IP allowlist only limits where it can be reached from.
param allowedIpRanges = []

param enableVnetIntegration = true
param vnetResourceGroupName = 'hokiesynapse'
param vnetName = 'hokiesynapsevirtualnetwork01'
param subnetName = 'snet-libra-appservice'
param subnetPrefix = '10.0.9.0/27'

param searchResourceGroupName = 'hokiepurview'
param searchServiceName = 'libraaisearch'
param openAiResourceGroupName = 'hokieopenai'
param openAiAccountName = 'hokieopenai'

// Only the accounts the catalog actually references, grouped by resource group.
// NOTE: the catalog also references 'hokieadbadls02', which no longer resolves in this
// subscription. It is omitted rather than left to fail the deployment.
param storageGrants = [
  {
    resourceGroup: 'hokiesynapse'
    accounts: [
      'hokiedemoadls2'
      'hokiesynapseadls02'
      'hokiesynapseadls03'
    ]
  }
  {
    resourceGroup: 'hokiepurview'
    accounts: [
      'hokiepurviewadls01'
    ]
  }
]

param appSettings = {
  // Build the client server-side with Oryx so dist/ never has to be committed.
  SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
  WEBSITE_NODE_DEFAULT_VERSION: '~22'

  SEARCH_ENDPOINT: 'https://libraaisearch.search.windows.net'
  SEARCH_INDEX: 'main-assets-index'
  SEARCH_SEMANTIC_CONFIG: 'semcfg'
  SEARCH_MIN_RERANKER_SCORE: '1.8'

  AOAI_ENDPOINT: 'https://hokieopenai.openai.azure.com'
  AOAI_EMBED_DEPLOYMENT: 'text-embedding-3-large'

  FEEDBACK_SQL_SERVER: 'hokiecopilotchatsqlserver.database.windows.net'
  FEEDBACK_SQL_DATABASE: 'hokiecopilotsqldb01'

  // SSRF allowlists. Empty would mean "any host under the expected suffix", so these
  // are set explicitly. Regenerate with ../12-allowlists.ps1 after a catalog reload.
  VIEWER_ALLOWED_ACCOUNTS: 'hokieadbadls02,hokiedemoadls2,hokiepurviewadls01,hokiesynapseadls02,hokiesynapseadls03'
  SQL_ALLOWED_SERVERS: 'hokiecopilotchatsqlserver,hokiesynapsemgvnet,hokiesynapsews'
  COSMOS_ALLOWED_ACCOUNTS: 'hokiesimplechatcosmosdb'
  ADX_ALLOWED_CLUSTERS: 'hokieadxpurview01'
  DATABRICKS_ALLOWED_HOSTS: 'adb-2778872873979183.3.azuredatabricks.net'

  // Set to 'true' once ../11-auth.ps1 has enabled Easy Auth.
  REQUIRE_AUTH: 'false'
}
