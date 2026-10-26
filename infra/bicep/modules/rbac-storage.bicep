// Storage Blob Data Reader, granted PER STORAGE ACCOUNT.
//
// This is the Bicep expression of the P2 finding: the original 02-rbac.ps1 granted this
// role at SUBSCRIPTION scope, which - combined with an unset VIEWER_ALLOWED_ACCOUNTS -
// turned /api/file into a read proxy for every blob in the subscription. Listing the
// accounts explicitly makes the blast radius reviewable in the template.

param principalId string

@description('Names of storage accounts in THIS resource group that the catalog references.')
param storageAccountNames array

// Storage Blob Data Reader.
var roleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'

resource accounts 'Microsoft.Storage/storageAccounts@2023-05-01' existing = [for name in storageAccountNames: {
  name: name
}]

resource assignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (name, i) in storageAccountNames: {
  scope: accounts[i]
  name: guid(accounts[i].id, principalId, roleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}]
