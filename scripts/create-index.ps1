# Creates/updates the 'main-assets-index' in libraaisearch with hybrid (keyword+vector) + semantic search.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$service = 'libraaisearch'
$rg = 'hokiepurview'
$indexName = 'main-assets-index'
$apiVersion = '2024-07-01'
$base = "https://$service.search.windows.net"

$key = az search admin-key show -g $rg --service-name $service --query primaryKey -o tsv
$hdr = @{ 'api-key' = $key; 'Content-Type' = 'application/json' }

$index = [ordered]@{
    name   = $indexName
    fields = @(
        [ordered]@{ name = 'id'; type = 'Edm.String'; key = $true; filterable = $true; searchable = $false; sortable = $false; facetable = $false; retrievable = $true }
        [ordered]@{ name = 'assetId'; type = 'Edm.String'; searchable = $false; filterable = $true; retrievable = $true }
        [ordered]@{ name = 'name'; type = 'Edm.String'; searchable = $true; filterable = $true; sortable = $true; retrievable = $true; analyzer = 'standard.lucene' }
        [ordered]@{ name = 'assetEntityType'; type = 'Edm.String'; searchable = $true; filterable = $true; facetable = $true; retrievable = $true }
        [ordered]@{ name = 'purviewUrl'; type = 'Edm.String'; searchable = $false; filterable = $false; retrievable = $true }
        [ordered]@{ name = 'displayText'; type = 'Edm.String'; searchable = $true; retrievable = $true }
        [ordered]@{ name = 'qualifiedName'; type = 'Edm.String'; searchable = $true; filterable = $true; retrievable = $true }
        [ordered]@{ name = 'collectionId'; type = 'Edm.String'; searchable = $false; filterable = $true; retrievable = $true }
        [ordered]@{ name = 'collectionName'; type = 'Edm.String'; searchable = $true; filterable = $true; facetable = $true; retrievable = $true }
        [ordered]@{ name = 'assetTypeFriendly'; type = 'Edm.String'; searchable = $true; filterable = $true; facetable = $true; retrievable = $true }
        # Empty string rather than null, so `owner eq ''` finds unassigned assets.
        [ordered]@{ name = 'owner'; type = 'Edm.String'; searchable = $true; filterable = $true; facetable = $true; retrievable = $true }
        [ordered]@{ name = 'expert'; type = 'Edm.String'; searchable = $true; filterable = $true; facetable = $true; retrievable = $true }
        # Derived from qualifiedName by to-jsonl.py; stored so the index can facet on it.
        [ordered]@{ name = 'format'; type = 'Edm.String'; searchable = $false; filterable = $true; facetable = $true; retrievable = $true }
        [ordered]@{ name = 'userDescription'; type = 'Edm.String'; searchable = $true; retrievable = $true; analyzer = 'standard.lucene' }
        [ordered]@{ name = 'descriptionVector'; type = 'Collection(Edm.Single)'; searchable = $true; retrievable = $false; dimensions = 3072; vectorSearchProfile = 'vprofile' }
    )
    vectorSearch = [ordered]@{
        algorithms = @(
            [ordered]@{ name = 'hnsw1'; kind = 'hnsw'; hnswParameters = [ordered]@{ metric = 'cosine'; m = 4; efConstruction = 400; efSearch = 500 } }
        )
        profiles   = @(
            [ordered]@{ name = 'vprofile'; algorithm = 'hnsw1' }
        )
    }
    semantic = [ordered]@{
        configurations = @(
            [ordered]@{
                name = 'semcfg'
                prioritizedFields = [ordered]@{
                    titleField = [ordered]@{ fieldName = 'name' }
                    prioritizedContentFields = @( [ordered]@{ fieldName = 'userDescription' } )
                    prioritizedKeywordsFields = @(
                        [ordered]@{ fieldName = 'assetEntityType' }
                        [ordered]@{ fieldName = 'collectionName' }
                    )
                }
            }
        )
    }
}

$bodyJson = $index | ConvertTo-Json -Depth 12
Invoke-RestMethod -Uri "$base/indexes/$indexName`?api-version=$apiVersion" -Headers $hdr -Method Put -Body $bodyJson | Out-Null
Write-Output "INDEX_READY: $indexName"
