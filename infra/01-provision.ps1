#requires -Version 7.0
<#
  Provision App Service (Linux, Node 22) for the Libra Asset Search app.
  Public access is left ON but locked to the deploy machine's IP so we can
  deploy + verify. Later steps:
    02-rbac.ps1   grants the MI data-plane access (Search, OpenAI, Storage)
    03-deploy.ps1 zip-deploys the app (Oryx builds vite + starts npm)
    04-vnet.ps1   integrates the app into the hokiesynapse VNet so it can
                  reach the private-endpoint storage accounts over private DNS
    05-public.ps1 removes the deploy-IP lock (opens the site for demos) and
                  forces HTTPS-only
#>
param(
  [string]$Location      = 'eastus2',
  [string]$ResourceGroup = 'rg-libra-assetsearch',
  [string]$PlanName      = 'asp-libra-assetsearch',
  [string]$PlanSku       = 'P0V3',
  [string]$AppName,
  [string]$DeployIp      = '108.45.77.147'
)

$ErrorActionPreference = 'Stop'
function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$stateFile = Join-Path $PSScriptRoot 'deployment.json'

if (-not $AppName) {
  $suffix  = ([guid]::NewGuid().ToString('N')).Substring(0, 6)
  $AppName = "libra-assetsearch-$suffix"
}
Write-Host "App name: $AppName" -ForegroundColor Cyan

# 1) Resource group
az group create -n $ResourceGroup -l $Location -o none
Assert-Ok 'group create'

# 2) App Service plan (Linux)
az appservice plan create -g $ResourceGroup -n $PlanName --is-linux --sku $PlanSku -l $Location -o none
Assert-Ok 'plan create'

# 3) Web app (Node 22 LTS)
az webapp create -g $ResourceGroup -p $PlanName -n $AppName --runtime 'NODE:22-lts' -o none
Assert-Ok 'webapp create'

# 4) System-assigned managed identity
$principalId = az webapp identity assign -g $ResourceGroup -n $AppName --query principalId -o tsv
Assert-Ok 'identity assign'
$principalId = "$principalId".Trim()
Write-Host "MI principalId: $principalId" -ForegroundColor Cyan

# 5) App settings (defaults are also baked into the server; set for clarity/override)
az webapp config appsettings set -g $ResourceGroup -n $AppName -o none --settings `
  SCM_DO_BUILD_DURING_DEPLOYMENT=true `
  WEBSITES_CONTAINER_START_TIME_LIMIT=600 `
  SEARCH_ENDPOINT=https://libraaisearch.search.windows.net `
  SEARCH_INDEX=main-assets-index `
  SEARCH_API_VERSION=2024-07-01 `
  SEARCH_SEMANTIC_CONFIG=semcfg `
  AOAI_ENDPOINT=https://hokieopenai.openai.azure.com `
  AOAI_EMBED_DEPLOYMENT=text-embedding-3-large `
  AOAI_API_VERSION=2024-02-01
Assert-Ok 'appsettings set'

# 6) Startup command + hardening
az webapp config set -g $ResourceGroup -n $AppName -o none `
  --startup-file 'npm start' --http20-enabled true --min-tls-version 1.2 --ftps-state Disabled
Assert-Ok 'config set'

# 7) Temporary public lockdown to the deploy machine IP (main + scm)
az webapp config access-restriction add -g $ResourceGroup -n $AppName `
  --rule-name deploy-machine --action Allow --ip-address "$DeployIp/32" --priority 100 --scm-site false -o none
Assert-Ok 'access-restriction main'
az webapp config access-restriction add -g $ResourceGroup -n $AppName `
  --rule-name deploy-machine-scm --action Allow --ip-address "$DeployIp/32" --priority 100 --scm-site true -o none
Assert-Ok 'access-restriction scm'

$defaultHost = az webapp show -g $ResourceGroup -n $AppName --query defaultHostName -o tsv
Assert-Ok 'webapp show'
$defaultHost = "$defaultHost".Trim()

$state = [ordered]@{
  subscriptionId = 'a5ec88f0-4e3a-4db3-a689-68ef11f0eae0'
  location       = $Location
  resourceGroup  = $ResourceGroup
  planName       = $PlanName
  planSku        = $PlanSku
  appName        = $AppName
  principalId    = $principalId
  defaultHost    = $defaultHost
}
$state | ConvertTo-Json | Set-Content $stateFile -Encoding utf8
Write-Host "`nProvisioned. State written to $stateFile" -ForegroundColor Green
$state | ConvertTo-Json
