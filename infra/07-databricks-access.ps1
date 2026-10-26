#requires -Version 7.0
<#
  Enable the "Preview table" feature for Purview-catalogued Databricks assets.

  Databricks tables cannot be reached with the TDS/mssql driver, so previews run
  through the workspace's Databricks SQL Statement Execution API against a SQL
  warehouse (server endpoint /api/databricks-preview). This script:

   1) Sets the app settings the endpoint reads:
        DATABRICKS_WAREHOUSE_ID   (required to turn previews on)
        DATABRICKS_HOST           (only needed for Unity Catalog assets, whose
                                   qualifiedName carries a metastore GUID, not a
                                   host; Hive metastore assets embed the host)
        DATABRICKS_ALLOWED_HOSTS  (SSRF allowlist; defaults to the workspace host)
        DATABRICKS_PREVIEW_ROWS   (row cap, default 10)
        DATABRICKS_TOKEN          (optional PAT; if omitted the app uses its
                                   system-assigned managed identity for AAD auth)

   2) Best-effort discovers the workspace host from the Azure Databricks
      workspace resource (needs the 'databricks' az extension; skipped if absent).

   3) Prints the Databricks-side grants that must be applied inside the
      workspace (register the MI as a service principal, GRANT SELECT on the
      tables, and give it "Can use" on the SQL warehouse). Those live in the
      Databricks control plane and can't be done with az, exactly like the
      T-SQL that 06-sql-access.ps1 prints when it can't run it.

  Idempotent: app settings are upserted; re-running is safe.

  Networking: a PUBLIC workspace is reachable over the app's existing VNet
  egress. A PRIVATE workspace needs a private endpoint + a
  privatelink.azuredatabricks.net DNS zone linked to the app VNet (same pattern
  as the Azure SQL PE in 06-sql-access.ps1) — not created here.
#>
param(
  # SQL warehouse that runs the preview query. Find it in Databricks:
  #   SQL > SQL Warehouses > (your warehouse) > Connection details >
  #   HTTP path = /sql/1.0/warehouses/<ID>  (the <ID> is this value).
  [string]$WarehouseId = '',

  # Workspace host, e.g. adb-2778872873979183.3.azuredatabricks.net.
  # If empty and -WorkspaceName/-WorkspaceRg are given, it is auto-discovered.
  [string]$WorkspaceHost = '',
  [string]$WorkspaceName = '',
  [string]$WorkspaceRg   = '',

  # Extra hosts to allow in addition to the workspace host (comma-separated set).
  [string[]]$AllowedHosts = @(),

  [int]$PreviewRows = 10,

  # Optional Databricks PAT. Leave empty to use the app's managed identity.
  [string]$AccessToken = ''
)

$ErrorActionPreference = 'Stop'
function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$state       = Get-Content (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
$rg          = $state.resourceGroup   # app resource group
$app         = $state.appName         # system-assigned MI display name == app name
$principalId = $state.principalId

# ---------------------------------------------------------------------------
# 1) Resolve the workspace host (best effort) for DATABRICKS_HOST / allowlist.
# ---------------------------------------------------------------------------
$dbxHost = $WorkspaceHost.Trim().ToLower() -replace '^https?://','' -replace '/+$',''
if (-not $dbxHost -and $WorkspaceName -and $WorkspaceRg) {
  $hasExt = az extension show -n databricks --query name -o tsv 2>$null
  if ($hasExt) {
    Write-Host "Discovering workspace host for $WorkspaceName ..." -ForegroundColor Cyan
    $dbxHost = (az databricks workspace show -g $WorkspaceRg -n $WorkspaceName --query workspaceUrl -o tsv 2>$null).Trim().ToLower()
  } else {
    Write-Host "az 'databricks' extension not installed; skipping host discovery. Pass -WorkspaceHost to set DATABRICKS_HOST." -ForegroundColor Yellow
  }
}
if ($dbxHost) { Write-Host "Workspace host: $dbxHost" -ForegroundColor Green }

# ---------------------------------------------------------------------------
# 2) Managed identity application (client) id — how Databricks identifies the SP.
# ---------------------------------------------------------------------------
$miAppId = az ad sp show --id $principalId --query appId -o tsv 2>$null
$sp = if ([string]::IsNullOrWhiteSpace($miAppId)) { "<application-id of $app>" } else { $miAppId.Trim() }

# ---------------------------------------------------------------------------
# 3) Upsert app settings the /api/databricks-preview endpoint reads.
# ---------------------------------------------------------------------------
$allow = @()
if ($dbxHost)      { $allow += $dbxHost }
if ($AllowedHosts) { $allow += ($AllowedHosts | ForEach-Object { $_.Trim().ToLower() }) }
$allow = $allow | Where-Object { $_ } | Select-Object -Unique

$settings = @("DATABRICKS_PREVIEW_ROWS=$PreviewRows")
if ($WarehouseId)   { $settings += "DATABRICKS_WAREHOUSE_ID=$($WarehouseId.Trim())" }
if ($dbxHost)       { $settings += "DATABRICKS_HOST=$dbxHost" }
if ($allow.Count)   { $settings += "DATABRICKS_ALLOWED_HOSTS=$($allow -join ',')" }
if ($AccessToken)   { $settings += "DATABRICKS_TOKEN=$($AccessToken.Trim())" }

Write-Host "Applying app settings to $app ..." -ForegroundColor Cyan
az webapp config appsettings set -g $rg -n $app -o none --settings $settings
Assert-Ok 'appsettings set (databricks)'

# Echo back what was applied (mask the PAT).
az webapp config appsettings list -g $rg -n $app -o json |
  ConvertFrom-Json |
  Where-Object { $_.name -like 'DATABRICKS*' } |
  ForEach-Object { if ($_.name -eq 'DATABRICKS_TOKEN') { $_.value = '***(set)' }; $_ } |
  Select-Object name, value | Format-Table -AutoSize

if (-not $WarehouseId) {
  Write-Host "`nNo -WarehouseId provided: previews stay OFF until DATABRICKS_WAREHOUSE_ID is set." -ForegroundColor Yellow
  Write-Host "Find it in Databricks SQL > Warehouses > (warehouse) > Connection details: HTTP path = /sql/1.0/warehouses/<ID>." -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
# 4) Databricks-side grants (control plane — apply inside the workspace).
# ---------------------------------------------------------------------------
$grantHelp = @'

Databricks-side grants (run as a workspace admin in a Databricks SQL editor).
Register the app's managed identity as a workspace service principal first:
  Account console > User management > Service principals > Add
  Application ID: __SP__

  -- Unity Catalog assets (databricks://.../catalogs/<catalog>/schemas/<schema>/tables/<table>)
  GRANT USE CATALOG ON CATALOG <catalog> TO `__SP__`;
  GRANT USE SCHEMA  ON SCHEMA  <catalog>.<schema> TO `__SP__`;
  GRANT SELECT      ON TABLE   <catalog>.<schema>.<table> TO `__SP__`;

  -- Hive metastore assets (<schema>.<table>@adb-...azuredatabricks.net)
  GRANT USAGE  ON SCHEMA hive_metastore.<schema> TO `__SP__`;
  GRANT SELECT ON TABLE  hive_metastore.<schema>.<table> TO `__SP__`;

Let it use the warehouse:
  Databricks SQL > Warehouses > (your warehouse) > Permissions > add __SP__ as "Can use".

If registering the managed identity as a service principal is blocked, instead
pass a Databricks PAT to this script:  -AccessToken <dapi...>  (stored as the
DATABRICKS_TOKEN app setting; the endpoint uses it in place of the MI).
'@
Write-Host $grantHelp.Replace('__SP__', $sp) -ForegroundColor Gray

Write-Host "`nDatabricks preview setup complete." -ForegroundColor Green
if ($dbxHost)     { Write-Host "  Host      : $dbxHost" -ForegroundColor Green }
if ($WarehouseId) { Write-Host "  Warehouse : $WarehouseId" -ForegroundColor Green }
Write-Host "  Auth      : $([string]::IsNullOrWhiteSpace($AccessToken) ? "managed identity ($sp)" : 'PAT (DATABRICKS_TOKEN)')" -ForegroundColor Green
Write-Host "  Endpoint  : https://$($state.defaultHost)/api/databricks-preview" -ForegroundColor Green
