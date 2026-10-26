# Quick end-to-end search test: embed a natural-language query, run hybrid + semantic search.
param([string]$Query = 'equipment assigned to staff members by department')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$searchBase = 'https://libraaisearch.search.windows.net'
$indexName  = 'main-assets-index'
$searchApi  = '2024-07-01'
$aoaiBase   = 'https://hokieopenai.openai.azure.com'
$embedDeploy = 'text-embedding-3-large'

$searchKey = az search admin-key show -g hokiepurview --service-name libraaisearch --query primaryKey -o tsv
$tok = az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv

# 1. Embed query
$eBody = @{ input = @($Query) } | ConvertTo-Json
$emb = Invoke-RestMethod -Uri "$aoaiBase/openai/deployments/$embedDeploy/embeddings?api-version=2024-02-01" `
    -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $tok" } -Body $eBody
$vec = [float[]]@($emb.data[0].embedding)

# 2. Hybrid + semantic search
$sBody = [ordered]@{
    search = $Query
    queryType = 'semantic'
    semanticConfiguration = 'semcfg'
    vectorQueries = @( [ordered]@{ kind = 'vector'; vector = $vec; fields = 'descriptionVector'; k = 20 } )
    select = 'name,assetEntityType,purviewUrl,qualifiedName'
    top = 5
} | ConvertTo-Json -Depth 6 -Compress
$res = Invoke-RestMethod -Uri "$searchBase/indexes/$indexName/docs/search?api-version=$searchApi" `
    -Method Post -ContentType 'application/json' -Headers @{ 'api-key' = $searchKey } -Body $sBody

Write-Output "QUERY: $Query`n"
$i = 0
foreach ($d in $res.value) {
    $i++
    Write-Output ("{0}. {1}  [{2}]" -f $i, $d.name, $d.assetEntityType)
    Write-Output ("   reranker={0:N3}  search={1:N3}" -f $d.'@search.rerankerScore', $d.'@search.score')
    Write-Output ("   purview={0}" -f ($d.purviewUrl.Substring(0, [Math]::Min(90, $d.purviewUrl.Length))))
}
