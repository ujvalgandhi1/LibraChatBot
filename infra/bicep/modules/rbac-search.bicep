// Search Index Data Reader on the AI Search service.
// Deployed into the search service's resource group.

param principalId string
param searchServiceName string

// Search Index Data Reader - query the index, read nothing else.
var roleId = '1407120a-92aa-4202-b7e9-c0e197c71c8f'

resource search 'Microsoft.Search/searchServices@2024-06-01-preview' existing = {
  name: searchServiceName
}

resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: search
  // Deterministic name so a re-deploy updates rather than duplicating.
  name: guid(search.id, principalId, roleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
