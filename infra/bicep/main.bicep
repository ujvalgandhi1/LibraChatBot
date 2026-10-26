// Libra Asset Search - infrastructure entry point.
//
// Replaces the imperative 01/02/04/05 scripts with a single declarative deployment:
// resource group, App Service plan, web app, managed identity, regional VNet
// integration, HTTPS-only, and the least-privilege role assignments.
//
// What is deliberately NOT here, and why, is documented in bicep/README.md - chiefly
// the zip deploy, the SQL contained-user grants and the AI Search indexer, which are
// data-plane operations with no ARM representation.

targetScope = 'subscription'

@description('Region for every resource in this deployment.')
param location string = 'eastus2'

@description('Resource group to create or update.')
param resourceGroupName string

@description('Globally unique web app name.')
param appName string

@description('App Service plan name.')
param planName string

@description('P0V3 is the smallest SKU supporting regional VNet integration.')
param planSku string = 'P0V3'

@description('Application settings for the web app.')
param appSettings object = {}

@description('Leave empty for a public site. See infra/11-auth.ps1 for Entra sign-in.')
param allowedIpRanges array = []

// ---- Regional VNet integration (optional) ----
@description('Set false to skip VNet integration entirely.')
param enableVnetIntegration bool = true
param vnetResourceGroupName string = ''
param vnetName string = ''
param subnetName string = 'snet-libra-appservice'
param subnetPrefix string = ''

// ---- Least-privilege data-plane access ----
param searchResourceGroupName string
param searchServiceName string
param openAiResourceGroupName string
param openAiAccountName string

@description('Storage accounts to grant blob read on, grouped by resource group: [{ resourceGroup: string, accounts: [string] }]. Derive with infra/_allowlists.ps1.')
param storageGrants array = []

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
}

module subnet 'modules/subnet.bicep' = if (enableVnetIntegration) {
  name: 'libra-subnet'
  scope: resourceGroup(vnetResourceGroupName)
  params: {
    vnetName: vnetName
    subnetName: subnetName
    subnetPrefix: subnetPrefix
  }
}

module app 'modules/app.bicep' = {
  name: 'libra-app'
  scope: rg
  params: {
    location: location
    planName: planName
    planSku: planSku
    appName: appName
    appSettings: appSettings
    allowedIpRanges: allowedIpRanges
    subnetId: enableVnetIntegration ? subnet!.outputs.subnetId : ''
  }
}

module rbacSearch 'modules/rbac-search.bicep' = {
  name: 'libra-rbac-search'
  scope: resourceGroup(searchResourceGroupName)
  params: {
    principalId: app.outputs.principalId
    searchServiceName: searchServiceName
  }
}

module rbacOpenAi 'modules/rbac-openai.bicep' = {
  name: 'libra-rbac-openai'
  scope: resourceGroup(openAiResourceGroupName)
  params: {
    principalId: app.outputs.principalId
    openAiAccountName: openAiAccountName
  }
}

module rbacStorage 'modules/rbac-storage.bicep' = [for (grant, i) in storageGrants: {
  name: 'libra-rbac-storage-${i}'
  scope: resourceGroup(grant.resourceGroup)
  params: {
    principalId: app.outputs.principalId
    storageAccountNames: grant.accounts
  }
}]

output appName string = app.outputs.siteName
output defaultHost string = app.outputs.defaultHostName
output principalId string = app.outputs.principalId
output resourceGroup string = rg.name
