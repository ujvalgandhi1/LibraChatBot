#requires -Version 7.0
<#
  Derive the SSRF allowlists from the catalog export and apply them as app
  settings.

  WHY
  ---
  Every `u=` parameter on the preview/viewer endpoints is guarded by a host
  suffix check plus an OPTIONAL allowlist. An unset allowlist means "any host
  under that suffix" - so /api/file will stream any blob the managed identity
  can read, not just catalogued assets. Setting these narrows the endpoints to
  the accounts the catalog actually references.

  Values are derived from main_assets.csv (the same export that seeds the search
  index) so they stay accurate as the catalog grows - re-run after each reload.

  Settings written:
    VIEWER_ALLOWED_ACCOUNTS    /api/file
    SQL_ALLOWED_SERVERS        /api/sql-preview
    COSMOS_ALLOWED_ACCOUNTS    /api/cosmos-preview
    ADX_ALLOWED_CLUSTERS       /api/adx-preview
    DATABRICKS_ALLOWED_HOSTS   /api/databricks-preview

  USAGE
  -----
    ./12-allowlists.ps1            # dry run - show what would be set
    ./12-allowlists.ps1 -Apply     # write the app settings
#>
[CmdletBinding()]
param(
  [string]$CsvPath,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

. (Join-Path $PSScriptRoot '_allowlists.ps1')

$state = Get-Content (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
$rg    = $state.resourceGroup
$app   = $state.appName

$lists = if ($CsvPath) { Get-LibraAllowlist -CsvPath $CsvPath } else { Get-LibraAllowlist }

$map = [ordered]@{
  VIEWER_ALLOWED_ACCOUNTS  = $lists.StorageAccounts
  SQL_ALLOWED_SERVERS      = $lists.SqlServers
  COSMOS_ALLOWED_ACCOUNTS  = $lists.CosmosAccounts
  ADX_ALLOWED_CLUSTERS     = $lists.AdxClusters
  DATABRICKS_ALLOWED_HOSTS = $lists.DatabricksHosts
}

Write-Host "Allowlists derived from the catalog export:`n" -ForegroundColor Cyan
$settings = @()
foreach ($k in $map.Keys) {
  $values = @($map[$k])
  if (-not $values.Count) {
    Write-Host ("  {0,-24} (none found - leaving unset)" -f $k) -ForegroundColor DarkYellow
    continue
  }
  Write-Host ("  {0,-24} {1}" -f $k, ($values -join ',')) -ForegroundColor Green
  $settings += "$k=$($values -join ',')"
}

if (-not $Apply) {
  Write-Host "`nDry run. Re-run with -Apply to write these app settings." -ForegroundColor Yellow
  return
}

Write-Host "`nApplying $($settings.Count) app settings to $app..." -ForegroundColor Cyan
az webapp config appsettings set -g $rg -n $app --settings $settings -o none
Assert-Ok 'allowlist app settings'

Write-Host "Done. Restarting the app so the new settings take effect..." -ForegroundColor Cyan
az webapp restart -g $rg -n $app -o none
Assert-Ok 'app restart'

Write-Host "`nAllowlists applied." -ForegroundColor Green
Write-Host "Re-run this after every catalog reload so new accounts are not blocked." -ForegroundColor Yellow
