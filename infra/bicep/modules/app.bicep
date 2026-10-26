// Libra Asset Search - App Service plan, web app, identity and network integration.
//
// Regional VNet integration is expressed as virtualNetworkSubnetId + vnetRouteAllEnabled
// rather than the legacy WEBSITE_VNET_ROUTE_ALL app setting, so the wiring is a property
// of the site instead of a string a later deploy could clobber.

@description('Azure region for the plan and web app.')
param location string

@description('Name of the App Service plan.')
param planName string

@description('SKU for the App Service plan. P0V3 is the smallest tier supporting VNet integration.')
param planSku string = 'P0V3'

@description('Name of the web app. Must be globally unique.')
param appName string

@description('Node runtime for the Linux app.')
param linuxFxVersion string = 'NODE|22-lts'

@description('Application settings, as a flat object. Converted to the array shape App Service expects.')
param appSettings object = {}

@description('Resource id of the delegated subnet for regional VNet integration. Empty disables it.')
param subnetId string = ''

@description('Restrict the site to these CIDRs. Empty means public - see infra/11-auth.ps1 for the auth story.')
param allowedIpRanges array = []

var vnetIntegrated = !empty(subnetId)

// Built as variables because a for-expression can't sit inside a function call.
var allowRules = [for (cidr, i) in allowedIpRanges: {
  ipAddress: cidr
  action: 'Allow'
  priority: 100 + i
  name: 'allow-${i}'
}]
// An allow-list is only meaningful with a catch-all deny after it.
var denyAll = [
  {
    ipAddress: 'Any'
    action: 'Deny'
    priority: 2147483647
    name: 'deny-all'
  }
]
var ipRules = empty(allowedIpRanges) ? null : concat(allowRules, denyAll)

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: {
    name: planSku
  }
  // reserved:true is what makes the plan Linux. Omitting it silently creates Windows.
  properties: {
    reserved: true
  }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    virtualNetworkSubnetId: vnetIntegrated ? subnetId : null
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      // Oryx builds the client with vite during deploy, then this starts the server.
      appCommandLine: 'npm start'
      vnetRouteAllEnabled: vnetIntegrated
      appSettings: [for setting in items(appSettings): {
        name: setting.key
        value: setting.value
      }]
      ipSecurityRestrictions: ipRules
    }
  }
}

output principalId string = site.identity.principalId
output defaultHostName string = site.properties.defaultHostName
output siteName string = site.name
