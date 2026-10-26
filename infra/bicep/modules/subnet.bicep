// Delegated subnet for regional VNet integration, added to an existing VNet.
//
// Deployed into the VNet's own resource group. The delegation to
// Microsoft.Web/serverFarms is what lets App Service claim the subnet; without it the
// integration call fails with a misleading "subnet not found".

@description('Name of the existing virtual network.')
param vnetName string

@description('Name of the subnet to create.')
param subnetName string

@description('Address prefix for the subnet, e.g. 10.0.9.0/27. Must not overlap an existing subnet.')
param subnetPrefix string

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: vnetName
}

resource subnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {
  parent: vnet
  name: subnetName
  properties: {
    addressPrefixes: [subnetPrefix]
    delegations: [
      {
        name: 'appservice'
        properties: {
          serviceName: 'Microsoft.Web/serverFarms'
        }
      }
    ]
    privateEndpointNetworkPolicies: 'Enabled'
  }
}

output subnetId string = subnet.id
