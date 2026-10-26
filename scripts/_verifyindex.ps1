$ErrorActionPreference = 'Continue'
$key = az search admin-key show -g hokiepurview --service-name libraaisearch --query primaryKey -o tsv
$h = @{ 'api-key' = $key; 'Content-Type' = 'application/json' }
$b = 'https://libraaisearch.search.windows.net'

"--- doc count + facets ---"
$body = '{"search":"*","top":0,"count":true,"facets":["collectionName","assetTypeFriendly"]}'
$r = Invoke-RestMethod "$b/indexes/main-assets-index/docs/search?api-version=2024-07-01" -Headers $h -Method Post -Body $body
"docs: $($r.'@odata.count')"
$r.'@search.facets'.collectionName | ForEach-Object { "  {0,5}  {1}" -f $_.count, $_.value }

""
"--- service stats (vectorIndexSize proves descriptionVector is populated) ---"
$stats = Invoke-RestMethod "$b/servicestats?api-version=2024-07-01" -Headers $h
"vectorIndexSize: {0} MB" -f [math]::Round($stats.counters.vectorIndexSize.usage / 1MB, 2)
"storageSize    : {0} MB" -f [math]::Round($stats.counters.storageSize.usage / 1MB, 2)

""
"--- semantic query ---"
$qbody = '{"search":"equipment inventory for staff","queryType":"semantic","semanticConfiguration":"semcfg","top":3,"select":"name,collectionName,assetTypeFriendly,owner"}'
$q = Invoke-RestMethod "$b/indexes/main-assets-index/docs/search?api-version=2024-07-01" -Headers $h -Method Post -Body $qbody
$q.value | ForEach-Object {
    "  {0,-34} coll={1,-20} plat={2,-14} rerank={3}" -f $_.name, $_.collectionName, $_.assetTypeFriendly, [math]::Round($_.'@search.rerankerScore', 2)
}

""
"--- service state ---"
az search service show -g hokiepurview -n libraaisearch --query "{sku:sku.name,replicas:replicaCount,partitions:partitionCount,prov:provisioningState,status:status}" -o json
