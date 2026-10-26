$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# 1. AI Search reachability (admin key)
try {
    $key = az search admin-key show -g hokiepurview --service-name libraaisearch --query primaryKey -o tsv
    $url = 'https://libraaisearch.search.windows.net/indexes?api-version=2024-07-01&$select=name'
    $r = Invoke-RestMethod -Uri $url -Headers @{ 'api-key' = $key } -Method Get
    Write-Output ("SEARCH_OK indexes: [" + (($r.value.name) -join ', ') + "]")
}
catch { Write-Output ("SEARCH_FAIL: " + $_.Exception.Message) }

# 2. OpenAI embeddings reachability (AAD)
try {
    $tok = az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv
    $body = @{ input = 'connectivity test' } | ConvertTo-Json
    $uri = 'https://hokieopenai.openai.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2024-02-01'
    $er = Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $tok" } -Method Post -ContentType 'application/json' -Body $body
    Write-Output ("OPENAI_OK embedding_dims: " + $er.data[0].embedding.Count)
}
catch { Write-Output ("OPENAI_FAIL: " + $_.Exception.Message) }

# 3. Storage container listing over private endpoint (AAD)
try {
    $existing = az storage container list --account-name hokiesynapseadls03 --auth-mode login --query "[].name" -o tsv 2>$null
    Write-Output ("STORAGE_OK containers: [" + (($existing) -join ', ') + "]")
}
catch { Write-Output ("STORAGE_FAIL: " + $_.Exception.Message) }
