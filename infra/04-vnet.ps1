#requires -Version 7.0
<#
  Integrate the web app into the existing hokiesynapse VNet so it can reach the
  private-endpoint storage accounts (e.g. hokiedemoadls2) over private DNS.

  Why this works with no extra DNS wiring:
   - The app and the VNet are both in eastus2, so regional VNet integration
     routes app -> subnet -> private endpoints directly.
   - The privatelink.blob/dfs/file/... zones are already linked to
     hokiesynapsevirtualnetwork01, so once outbound traffic is routed through
     the VNet (WEBSITE_VNET_ROUTE_ALL=1) the app resolves
     <account>.blob.core.windows.net to its 10.0.0.x private endpoint.

  The AI Search + Azure OpenAI backends stay on their public endpoints
  (Public Network Access = Enabled), so no private endpoints are needed there.
#>
param(
  [string]$VnetResourceGroup = 'hokiesynapse',
  [string]$VnetName          = 'hokiesynapsevirtualnetwork01',
  [string]$SubnetName        = 'snet-appservice',
  [string]$SubnetPrefix      = '10.0.6.0/27'
)

$ErrorActionPreference = 'Stop'
function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$state = Get-Content (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
$rg    = $state.resourceGroup
$app   = $state.appName

# 1) Dedicated, delegated subnet for the App Service regional integration.
#    App Service requires the subnet be delegated to Microsoft.Web/serverFarms.
$exists = az network vnet subnet show -g $VnetResourceGroup --vnet-name $VnetName -n $SubnetName --query id -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($exists)) {
  Write-Host "Creating delegated subnet $SubnetName ($SubnetPrefix)..." -ForegroundColor Cyan
  az network vnet subnet create -g $VnetResourceGroup --vnet-name $VnetName -n $SubnetName `
    --address-prefixes $SubnetPrefix --delegations Microsoft.Web/serverFarms -o none
  Assert-Ok 'subnet create'
} else {
  Write-Host "Subnet $SubnetName already exists; reusing it." -ForegroundColor DarkGray
}

$vnetId = az network vnet show -g $VnetResourceGroup -n $VnetName --query id -o tsv
Assert-Ok 'vnet show'
$vnetId = "$vnetId".Trim()

# 2) Attach the app to the subnet (regional VNet integration).
Write-Host "Adding VNet integration on $app..." -ForegroundColor Cyan
az webapp vnet-integration add -g $rg -n $app --vnet $vnetId --subnet $SubnetName -o none
Assert-Ok 'vnet-integration add'

# 3) Route ALL outbound through the VNet and use Azure DNS so private-endpoint
#    A records (privatelink zones) resolve to private IPs.
Write-Host "Setting WEBSITE_VNET_ROUTE_ALL + WEBSITE_DNS_SERVER..." -ForegroundColor Cyan
az webapp config appsettings set -g $rg -n $app -o none --settings `
  WEBSITE_VNET_ROUTE_ALL=1 `
  WEBSITE_DNS_SERVER=168.63.129.16
Assert-Ok 'appsettings set (vnet)'

Write-Host "`nVNet integration complete for $app -> $VnetName/$SubnetName" -ForegroundColor Green
az webapp show -g $rg -n $app --query "{app:name, subnet:virtualNetworkSubnetId}" -o table
