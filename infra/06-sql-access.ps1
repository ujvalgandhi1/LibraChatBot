#requires -Version 7.0
<#
  Give the web app's managed identity read-only access to the Purview-catalogued
  SQL assets so the "Preview table" (SELECT TOP N) feature works in production.

  Two SQL back-ends are wired up:

   1) Azure SQL (hokiecopilotchatsqlserver) has Public Network Access = Disabled,
      so it is only reachable over a private endpoint. This script creates a PE
      for the server in the app's VNet + a privatelink.database.windows.net DNS
      zone linked to that VNet, so the app resolves the server FQDN to the PE's
      10.0.3.x private IP (Azure DNS, WEBSITE_DNS_SERVER=168.63.129.16 from 04-vnet).

   2) Synapse dedicated pool (hokiesynapsews / hokiepool01) is Public Network
      Access = Enabled with an allow-Azure firewall rule, so the VNet-integrated
      app reaches it over its public endpoint. The pool must be resumed (running)
      for previews to work.

  It then grants the app's system-assigned managed identity (display name = the
  App Service name) db_datareader on each database via CREATE USER ... FROM
  EXTERNAL PROVIDER. The T-SQL runs through Invoke-Sqlcmd with an AAD access
  token when the SqlServer module is available; otherwise the exact statements
  are printed for a DBA to run. You must be the Entra (AAD) admin on each server.

  Idempotent: re-running skips resources that already exist.
#>
param(
  # --- Azure SQL (private-endpoint) ---
  [string]$SqlServerName        = 'hokiecopilotchatsqlserver',
  [string]$SqlServerRg          = 'hokiecopilotchat',
  [string]$SqlDatabase          = 'hokiecopilotsqldb01',

  # --- App VNet + private endpoint placement ---
  [string]$VnetResourceGroup    = 'hokiesynapse',
  [string]$VnetName             = 'hokiesynapsevirtualnetwork01',
  [string]$PeSubnetName         = 'sql-pe-subnet',
  [string]$PeName               = 'pe-hokiecopilotchatsql',

  # --- Synapse dedicated pool ---
  [string]$SynapseWorkspace     = 'hokiesynapsews',
  [string]$SynapseRg            = 'hokiesynapse',
  [string]$SynapsePool          = 'hokiepool01'
)

$ErrorActionPreference = 'Stop'
function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$state = Get-Content (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
$rg    = $state.resourceGroup   # app resource group (holds the PE + DNS zone)
$app   = $state.appName         # system-assigned MI display name == app name
$miName = $app

$sqlFqdn     = "$SqlServerName.database.windows.net"
$synapseFqdn = "$SynapseWorkspace.sql.azuresynapse.net"
$dnsZone     = 'privatelink.database.windows.net'

# ---------------------------------------------------------------------------
# 1) Private endpoint for the Azure SQL server in the app's VNet.
# ---------------------------------------------------------------------------
$peId = az network private-endpoint show -g $rg -n $PeName --query id -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($peId)) {
  $sqlServerId = az sql server show -g $SqlServerRg -n $SqlServerName --query id -o tsv
  Assert-Ok 'sql server show'
  Write-Host "Creating private endpoint $PeName -> $SqlServerName ..." -ForegroundColor Cyan
  az network private-endpoint create -g $rg -n $PeName `
    --vnet-name $VnetName --subnet $PeSubnetName `
    --private-connection-resource-id "$($sqlServerId.Trim())" `
    --group-id sqlServer --connection-name "$PeName-conn" -o none
  Assert-Ok 'private-endpoint create'
} else {
  Write-Host "Private endpoint $PeName already exists; reusing it." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 2) Private DNS zone + VNet link + PE zone-group (auto A record -> PE IP).
# ---------------------------------------------------------------------------
$zoneId = az network private-dns zone show -g $rg -n $dnsZone --query id -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($zoneId)) {
  Write-Host "Creating private DNS zone $dnsZone ..." -ForegroundColor Cyan
  $zoneId = az network private-dns zone create -g $rg -n $dnsZone --query id -o tsv
  Assert-Ok 'private-dns zone create'
} else {
  Write-Host "DNS zone $dnsZone already exists; reusing it." -ForegroundColor DarkGray
}
$zoneId = "$zoneId".Trim()

$linkName = 'link-hokiesynapsevnet'
$linkId = az network private-dns link vnet show -g $rg --zone-name $dnsZone -n $linkName --query id -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($linkId)) {
  $vnetId = az network vnet show -g $VnetResourceGroup -n $VnetName --query id -o tsv
  Assert-Ok 'vnet show'
  Write-Host "Linking $dnsZone to $VnetName ..." -ForegroundColor Cyan
  az network private-dns link vnet create -g $rg --zone-name $dnsZone -n $linkName `
    --virtual-network "$($vnetId.Trim())" --registration-enabled false -o none
  Assert-Ok 'private-dns link vnet create'
} else {
  Write-Host "DNS zone link $linkName already exists; reusing it." -ForegroundColor DarkGray
}

$zgExists = az network private-endpoint dns-zone-group show -g $rg --endpoint-name $PeName -n default --query id -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($zgExists)) {
  Write-Host "Wiring PE DNS zone-group (auto A record) ..." -ForegroundColor Cyan
  az network private-endpoint dns-zone-group create -g $rg --endpoint-name $PeName -n default `
    --private-dns-zone $zoneId --zone-name database -o none
  Assert-Ok 'dns-zone-group create'
} else {
  Write-Host "PE DNS zone-group already exists; reusing it." -ForegroundColor DarkGray
}

$peIp = az network private-endpoint show -g $rg -n $PeName `
  --query "customDnsConfigs[0].ipAddresses[0]" -o tsv 2>$null
Write-Host "Azure SQL private endpoint IP: $peIp" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3) Resume the Synapse dedicated pool (previews need it Online).
# ---------------------------------------------------------------------------
$poolStatus = az synapse sql pool show --name $SynapsePool --workspace-name $SynapseWorkspace `
  --resource-group $SynapseRg --query status -o tsv 2>$null
if ($poolStatus -ne 'Online') {
  Write-Host "Resuming Synapse pool $SynapsePool (status: $poolStatus) ..." -ForegroundColor Cyan
  az synapse sql pool resume --name $SynapsePool --workspace-name $SynapseWorkspace `
    --resource-group $SynapseRg -o none
  Assert-Ok 'synapse pool resume'
} else {
  Write-Host "Synapse pool $SynapsePool already Online." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 4) Grant the managed identity db_datareader on each database.
#    Run as the Entra (AAD) admin of each server. Requires DNS resolution to the
#    private endpoint for the Azure SQL step (run from the app's VNet / VPN).
# ---------------------------------------------------------------------------
$grantTsql = @"
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$miName')
    CREATE USER [$miName] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [$miName];
"@

function Grant-MiReader([string]$Server, [string]$Database) {
  if (Get-Command Invoke-Sqlcmd -ErrorAction SilentlyContinue) {
    $tok = az account get-access-token --resource https://database.windows.net --query accessToken -o tsv
    Assert-Ok 'get-access-token'
    Write-Host "Granting db_datareader to [$miName] on $Server/$Database ..." -ForegroundColor Cyan
    Invoke-Sqlcmd -ServerInstance $Server -Database $Database -AccessToken "$($tok.Trim())" `
      -Query $grantTsql -EncryptConnection -ErrorAction Stop
  } else {
    Write-Host "SqlServer module not found. Run this T-SQL on $Server/$Database as the AAD admin:" -ForegroundColor Yellow
    Write-Host $grantTsql -ForegroundColor Gray
  }
}

Grant-MiReader -Server $sqlFqdn     -Database $SqlDatabase
Grant-MiReader -Server $synapseFqdn -Database $SynapsePool

Write-Host "`nSQL access setup complete." -ForegroundColor Green
Write-Host "  Azure SQL : $sqlFqdn/$SqlDatabase (via PE $peIp)" -ForegroundColor Green
Write-Host "  Synapse   : $synapseFqdn/$SynapsePool (public + allow-Azure firewall)" -ForegroundColor Green
Write-Host "  Recommended app setting: SQL_ALLOWED_SERVERS=$SqlServerName,$SynapseWorkspace" -ForegroundColor Green
