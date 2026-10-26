#requires -Version 7.0
<#
  Grant the web app's managed identity least-privilege data-plane access:
   - Search Index Data Reader       on libraaisearch (query the index)
   - Cognitive Services OpenAI User on hokieopenai   (embed the query)
   - Storage Blob Data Reader       on each storage account the catalog
     actually references, derived from main_assets.csv via _allowlists.ps1.

  The storage grant used to be made at SUBSCRIPTION scope. Combined with an
  unset VIEWER_ALLOWED_ACCOUNTS that turned /api/file into a read proxy for
  every blob in the subscription, so per-account is now the default.

  USAGE
  -----
    ./02-rbac.ps1                                   # accounts from the catalog
    ./02-rbac.ps1 -StorageAccounts acct1,acct2      # explicit list
    ./02-rbac.ps1 -SubscriptionScopeStorage         # old broad grant (opt-in)
#>
[CmdletBinding()]
param(
  [string[]]$StorageAccounts,
  [switch]$SubscriptionScopeStorage
)

$ErrorActionPreference = 'Stop'
function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$state = Get-Content (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
$sub   = $state.subscriptionId
$oid   = $state.principalId

$searchScope = "/subscriptions/$sub/resourceGroups/hokiepurview/providers/Microsoft.Search/searchServices/libraaisearch"
$openaiScope = "/subscriptions/$sub/resourceGroups/hokieopenai/providers/Microsoft.CognitiveServices/accounts/hokieopenai"

Write-Host "Assigning 'Search Index Data Reader' on libraaisearch..." -ForegroundColor Cyan
az role assignment create --assignee-object-id $oid --assignee-principal-type ServicePrincipal `
  --role 'Search Index Data Reader' --scope $searchScope -o none
Assert-Ok 'search role assignment'

Write-Host "Assigning 'Cognitive Services OpenAI User' on hokieopenai..." -ForegroundColor Cyan
az role assignment create --assignee-object-id $oid --assignee-principal-type ServicePrincipal `
  --role 'Cognitive Services OpenAI User' --scope $openaiScope -o none
Assert-Ok 'openai role assignment'

if ($SubscriptionScopeStorage) {
  Write-Host "`nAssigning 'Storage Blob Data Reader' on the WHOLE SUBSCRIPTION..." -ForegroundColor Yellow
  Write-Host "  This lets /api/file read every blob in the subscription. Prefer per-account." -ForegroundColor Red
  az role assignment create --assignee-object-id $oid --assignee-principal-type ServicePrincipal `
    --role 'Storage Blob Data Reader' --scope "/subscriptions/$sub" -o none
  Assert-Ok 'storage role assignment'
} else {
  if (-not $StorageAccounts) {
    . (Join-Path $PSScriptRoot '_allowlists.ps1')
    $StorageAccounts = @((Get-LibraAllowlist).StorageAccounts)
    Write-Host "`nStorage accounts derived from the catalog export:" -ForegroundColor Cyan
  } else {
    Write-Host "`nStorage accounts supplied on the command line:" -ForegroundColor Cyan
  }
  if (-not $StorageAccounts.Count) {
    throw 'No storage accounts to grant. Pass -StorageAccounts, or -SubscriptionScopeStorage to opt into the broad grant.'
  }
  $StorageAccounts | ForEach-Object { Write-Host "  $_" }

  foreach ($acct in $StorageAccounts) {
    $id = az storage account show --name $acct --query id -o tsv 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $id) {
      Write-Host "  ! $acct not found in this subscription - skipping" -ForegroundColor Yellow
      continue
    }
    Write-Host "Assigning 'Storage Blob Data Reader' on $acct..." -ForegroundColor Cyan
    az role assignment create --assignee-object-id $oid --assignee-principal-type ServicePrincipal `
      --role 'Storage Blob Data Reader' --scope $id -o none
    Assert-Ok "storage role assignment ($acct)"
  }

  Write-Host "`nIf a subscription-wide grant exists from an earlier run, remove it:" -ForegroundColor Yellow
  Write-Host "  az role assignment delete --assignee $oid --role 'Storage Blob Data Reader' --scope /subscriptions/$sub"
}

Write-Host "`nRole assignments complete for principal $oid" -ForegroundColor Green
az role assignment list --assignee $oid --all `
  --query "[].{role:roleDefinitionName, scope:scope}" -o table

Write-Host "`nNext: ./12-allowlists.ps1 -Apply  (sets the matching SSRF allowlists)" -ForegroundColor Cyan

