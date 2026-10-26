#requires -Version 7.0
<#
  Give the web app's managed identity read-only data-plane access to Cosmos DB
  containers and Azure Data Explorer (Kusto) tables, so the "Preview" action
  works for those catalog assets (/api/cosmos-preview, /api/adx-preview).

  Cosmos DB:
    Data-plane access is NOT an Azure RBAC role — it is a separate SQL role
    assignment on the account. This grants the built-in "Cosmos DB Built-in Data
    Reader" role (id ...0001) at account scope. Note the demo accounts have
    Public Network Access = Disabled, so a private endpoint in the app's VNet is
    also required; pass -CreateCosmosPrivateEndpoint to create one.

  Azure Data Explorer:
    Grants the identity the "Viewer" role on a database via a principal
    assignment. Uses `az rest` against the ARM API so the `kusto` az extension
    is not needed (that extension prompts to install and can hang). Optionally
    starts the cluster, which must be Running to serve queries.

  Both sections are skipped unless you pass the matching parameters, so this is
  safe to run when only one of the two is in play.

  Idempotent: existing role assignments / endpoints are detected and reused.
#>
param(
  # --- Cosmos DB ---
  [string]$CosmosAccount = '',
  [string]$CosmosRg      = '',
  [switch]$CreateCosmosPrivateEndpoint,

  # --- Azure Data Explorer ---
  [string]$AdxCluster  = '',
  [string]$AdxRg       = '',
  [string]$AdxDatabase = '',
  [switch]$StartAdxCluster,

  # --- App VNet (for the Cosmos private endpoint) ---
  [string]$VnetResourceGroup = 'hokiesynapse',
  [string]$VnetName          = 'hokiesynapsevirtualnetwork01',
  [string]$PeSubnetName      = 'sql-pe-subnet'
)

$ErrorActionPreference = 'Stop'
function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$state       = Get-Content (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
$rg          = $state.resourceGroup
$app         = $state.appName
$principalId = $state.principalId
$subId       = $state.subscriptionId
$tenantId    = az account show --query tenantId -o tsv
Assert-Ok 'account show'
$tenantId = "$tenantId".Trim()

Write-Host "App: $app  (MI principalId $principalId)" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Cosmos DB — data-plane reader role + optional private endpoint.
# ---------------------------------------------------------------------------
if ($CosmosAccount -and $CosmosRg) {
  $readerRoleId = "/subscriptions/$subId/resourceGroups/$CosmosRg/providers/Microsoft.DocumentDB/databaseAccounts/$CosmosAccount/sqlRoleDefinitions/00000000-0000-0000-0000-000000000001"

  $existing = az cosmosdb sql role assignment list --account-name $CosmosAccount -g $CosmosRg `
    --query "[?principalId=='$principalId'].id" -o tsv 2>$null
  if ([string]::IsNullOrWhiteSpace($existing)) {
    Write-Host "Granting Cosmos DB Built-in Data Reader on $CosmosAccount ..." -ForegroundColor Cyan
    az cosmosdb sql role assignment create --account-name $CosmosAccount -g $CosmosRg `
      --scope "/" --principal-id $principalId --role-definition-id $readerRoleId -o none
    Assert-Ok 'cosmosdb sql role assignment create'
  } else {
    Write-Host "Cosmos data-plane role already assigned; reusing it." -ForegroundColor DarkGray
  }

  if ($CreateCosmosPrivateEndpoint) {
    $peName = "pe-$CosmosAccount-sql"
    $dnsZone = 'privatelink.documents.azure.com'
    $peId = az network private-endpoint show -g $rg -n $peName --query id -o tsv 2>$null
    if ([string]::IsNullOrWhiteSpace($peId)) {
      $acctId = az cosmosdb show -g $CosmosRg -n $CosmosAccount --query id -o tsv
      Assert-Ok 'cosmosdb show'
      Write-Host "Creating private endpoint $peName ..." -ForegroundColor Cyan
      az network private-endpoint create -g $rg -n $peName `
        --vnet-name $VnetName --subnet $PeSubnetName `
        --private-connection-resource-id "$($acctId.Trim())" `
        --group-id Sql --connection-name "$peName-conn" -o none
      Assert-Ok 'private-endpoint create'
    } else {
      Write-Host "Private endpoint $peName already exists; reusing it." -ForegroundColor DarkGray
    }

    $zoneId = az network private-dns zone show -g $rg -n $dnsZone --query id -o tsv 2>$null
    if ([string]::IsNullOrWhiteSpace($zoneId)) {
      Write-Host "Creating private DNS zone $dnsZone ..." -ForegroundColor Cyan
      $zoneId = az network private-dns zone create -g $rg -n $dnsZone --query id -o tsv
      Assert-Ok 'private-dns zone create'
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
    }

    $zg = az network private-endpoint dns-zone-group show -g $rg --endpoint-name $peName -n default --query id -o tsv 2>$null
    if ([string]::IsNullOrWhiteSpace($zg)) {
      Write-Host "Wiring PE DNS zone-group ..." -ForegroundColor Cyan
      az network private-endpoint dns-zone-group create -g $rg --endpoint-name $peName -n default `
        --private-dns-zone $zoneId --zone-name documents -o none
      Assert-Ok 'dns-zone-group create'
    }
  }

  Write-Host "  Recommended app setting: COSMOS_ALLOWED_ACCOUNTS=$CosmosAccount" -ForegroundColor Green
} else {
  Write-Host "Skipping Cosmos (pass -CosmosAccount and -CosmosRg to configure)." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Azure Data Explorer — optional cluster start + database Viewer assignment.
# `az rest` is used so the `kusto` extension is never required.
# ---------------------------------------------------------------------------
if ($AdxCluster -and $AdxRg) {
  $api = '2023-08-15'
  $clusterUri = "https://management.azure.com/subscriptions/$subId/resourceGroups/$AdxRg/providers/Microsoft.Kusto/clusters/$AdxCluster"

  $adxState = az resource show --resource-type Microsoft.Kusto/clusters -g $AdxRg -n $AdxCluster --query properties.state -o tsv 2>$null
  Write-Host "ADX cluster $AdxCluster state: $adxState" -ForegroundColor Cyan
  if ($StartAdxCluster -and $adxState -ne 'Running') {
    Write-Host "Starting cluster (this takes several minutes and resumes billing) ..." -ForegroundColor Yellow
    az rest --method post --url "$clusterUri/start?api-version=$api" -o none
    Assert-Ok 'kusto cluster start'
    Write-Host "Start requested. Poll with: az resource show --resource-type Microsoft.Kusto/clusters -g $AdxRg -n $AdxCluster --query properties.state -o tsv" -ForegroundColor Gray
  }

  if ($AdxDatabase) {
    $paName = "libra-viewer"
    $paUri = "$clusterUri/databases/$AdxDatabase/principalAssignments/$paName" + "?api-version=$api"
    $existing = az rest --method get --url $paUri --query properties.principalId -o tsv 2>$null
    if ([string]::IsNullOrWhiteSpace($existing)) {
      Write-Host "Granting ADX Viewer on $AdxDatabase to the app identity ..." -ForegroundColor Cyan
      # Pass the body via a file: inline JSON gets mangled by shell quoting on Windows.
      $bodyFile = Join-Path ([IO.Path]::GetTempPath()) "adx-principal-assignment.json"
      @{ properties = @{ principalId = $principalId; principalType = 'App'; role = 'Viewer'; tenantId = $tenantId } } |
        ConvertTo-Json -Depth 5 | Set-Content $bodyFile -Encoding utf8
      az rest --method put --url $paUri --headers 'Content-Type=application/json' --body "@$bodyFile" -o none
      $rc = $LASTEXITCODE
      Remove-Item $bodyFile -ErrorAction SilentlyContinue
      if ($rc -ne 0) { throw "kusto principal assignment create failed (exit $rc). The cluster must be Running." }
    } else {
      Write-Host "ADX principal assignment already exists; reusing it." -ForegroundColor DarkGray
    }
  } else {
    Write-Host "No -AdxDatabase given; skipped the Viewer grant." -ForegroundColor DarkGray
  }

  Write-Host "  Recommended app setting: ADX_ALLOWED_CLUSTERS=$AdxCluster" -ForegroundColor Green
} else {
  Write-Host "Skipping ADX (pass -AdxCluster and -AdxRg to configure)." -ForegroundColor DarkGray
}

Write-Host "`nCosmos / ADX access setup complete." -ForegroundColor Green
Write-Host "Apply the allowlists with:" -ForegroundColor Gray
Write-Host "  az webapp config appsettings set -g $rg -n $app --settings COSMOS_ALLOWED_ACCOUNTS=<accts> ADX_ALLOWED_CLUSTERS=<clusters>" -ForegroundColor Gray
