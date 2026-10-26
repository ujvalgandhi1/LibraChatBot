// Cognitive Services OpenAI User on the Azure OpenAI account.
// Deployed into the OpenAI account's resource group.

param principalId string
param openAiAccountName string

// Cognitive Services OpenAI User - call the embedding deployment, nothing else.
var roleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: openAiAccountName
}

resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, principalId, roleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
