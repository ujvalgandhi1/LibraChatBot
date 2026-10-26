# Reads main_assets.csv, embeds userDescription via Azure OpenAI, pushes docs to main-assets-index.
# -MetadataOnly updates the scalar fields via a merge and skips embedding entirely.
param([switch]$MetadataOnly)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# --- Config ---
$csvPath      = Join-Path $PSScriptRoot '..\main_assets.csv'
$searchSvc    = 'libraaisearch'
$searchRg     = 'hokiepurview'
$indexName    = 'main-assets-index'
$searchApi    = '2024-07-01'
$searchBase   = "https://$searchSvc.search.windows.net"
$aoaiBase     = 'https://hokieopenai.openai.azure.com'
$embedDeploy  = 'text-embedding-3-large'
$aoaiApi      = '2024-02-01'
$maxChars     = 8000     # truncate very long descriptions (~2000 tokens)
$maxBatchTok  = 7000     # approx token budget per embeddings request
$maxBatchDocs = 16
$pushBatch    = 50

# --- Auth ---
$searchKey = az search admin-key show -g $searchRg --service-name $searchSvc --query primaryKey -o tsv
$searchHdr = @{ 'api-key' = $searchKey; 'Content-Type' = 'application/json' }

function Get-AoaiToken { az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv }
$script:aoaiTok = if ($MetadataOnly) { $null } else { Get-AoaiToken }

function Invoke-Embeddings([string[]]$inputs) {
    $body = @{ input = $inputs } | ConvertTo-Json -Depth 4 -Compress
    $uri  = "$aoaiBase/openai/deployments/$embedDeploy/embeddings?api-version=$aoaiApi"
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        try {
            $resp = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' `
                -Headers @{ Authorization = "Bearer $script:aoaiTok" } -Body $body
            # Build without pipeline flattening: each embedding must stay a discrete array.
            $sorted = @($resp.data | Sort-Object index)
            $out = New-Object System.Collections.ArrayList
            foreach ($d in $sorted) { [void]$out.Add([float[]]@($d.embedding)) }
            return , $out
        }
        catch {
            $code = $_.Exception.Response.StatusCode.value__
            if ($code -eq 401) { $script:aoaiTok = Get-AoaiToken; continue }
            if ($code -eq 429 -or $code -ge 500) { Start-Sleep -Seconds ([Math]::Pow(2, $attempt)); continue }
            throw
        }
    }
    throw "Embeddings failed after retries."
}

function Sanitize-Key([string]$raw, [hashtable]$seen) {
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = [guid]::NewGuid().ToString() }
    $k = ($raw -replace '[^A-Za-z0-9_\-=]', '_')
    $base = $k; $i = 1
    while ($seen.ContainsKey($k)) { $i++; $k = "$base`_$i" }
    $seen[$k] = $true
    return $k
}

function Push-Docs([array]$docs) {
    if ($docs.Count -eq 0) { return }
    $payload = @{ value = $docs } | ConvertTo-Json -Depth 6 -Compress
    $uri = "$searchBase/indexes/$indexName/docs/index?api-version=$searchApi"
    $r = Invoke-RestMethod -Uri $uri -Headers $searchHdr -Method Post -Body $payload
    $failed = @($r.value | Where-Object { -not $_.status })
    if ($failed.Count -gt 0) { Write-Warning "  $($failed.Count) docs failed: $($failed[0].errorMessage)" }
}

# --- Load CSV ---
Write-Output "Loading $csvPath ..."
$rows = Import-Csv $csvPath
Write-Output "Rows: $($rows.Count)"

$seen = @{}
$prepared = foreach ($row in $rows) {
    $desc = [string]$row.userDescription
    if ($desc.Length -gt $maxChars) { $desc = $desc.Substring(0, $maxChars) }
    $embedText = "$($row.name) [$($row.asset_entity_type)]`n$desc".Trim()
    if ([string]::IsNullOrWhiteSpace($embedText)) { $embedText = [string]$row.name }
    [pscustomobject]@{
        id                = Sanitize-Key $row.asset_id $seen
        assetId           = [string]$row.asset_id
        name              = [string]$row.name
        assetEntityType   = [string]$row.asset_entity_type
        purviewUrl        = [string]$row.PurviewURL
        displayText       = [string]$row.displayText
        qualifiedName     = [string]$row.qualifiedName
        collectionId      = [string]$row.collectionId
        collectionName    = [string]$row.collectionName
        assetTypeFriendly = [string]$row.asset_type_friendly
        owner             = [string]$row.owner
        expert            = [string]$row.expert
        userDescription   = $desc
        embedText         = $embedText
    }
}

# Update the scalar fields on documents that already exist, without paying for
# 900+ embedding calls. Fails loudly if a document is missing rather than
# creating a vectorless one.
if ($MetadataOnly) {
    $buf = New-Object System.Collections.ArrayList
    foreach ($p in $prepared) {
        [void]$buf.Add([ordered]@{
            '@search.action'  = 'merge'
            id                = $p.id
            collectionId      = $p.collectionId
            collectionName    = $p.collectionName
            assetTypeFriendly = $p.assetTypeFriendly
            owner             = $p.owner
            expert            = $p.expert
        })
        if ($buf.Count -ge $pushBatch) { Push-Docs ($buf.ToArray()); $buf.Clear() }
    }
    Push-Docs ($buf.ToArray())
    Write-Output "METADATA_MERGE_DONE: $($prepared.Count) docs updated, no embeddings."
    return
}

# --- Embed (token-aware batches) + push ---
$docBuffer = New-Object System.Collections.ArrayList
$batch = New-Object System.Collections.ArrayList
$batchTok = 0
$done = 0
$total = $prepared.Count

function Flush-EmbedBatch {
    if ($batch.Count -eq 0) { return }
    $vectors = Invoke-Embeddings ($batch | ForEach-Object { $_.embedText })
    for ($j = 0; $j -lt $batch.Count; $j++) {
        $item = $batch[$j]
        [void]$docBuffer.Add([ordered]@{
            '@search.action' = 'mergeOrUpload'
            id                = $item.id
            assetId           = $item.assetId
            name              = $item.name
            assetEntityType   = $item.assetEntityType
            purviewUrl        = $item.purviewUrl
            displayText       = $item.displayText
            qualifiedName     = $item.qualifiedName
            collectionId      = $item.collectionId
            collectionName    = $item.collectionName
            assetTypeFriendly = $item.assetTypeFriendly
            owner             = $item.owner
            expert            = $item.expert
            userDescription   = $item.userDescription
            descriptionVector = $vectors[$j]
        })
    }
    $script:done += $batch.Count
    Write-Output ("  embedded {0}/{1}" -f $script:done, $total)
    $batch.Clear(); $script:batchTok = 0
    if ($docBuffer.Count -ge $pushBatch) {
        Push-Docs ($docBuffer.ToArray())
        $docBuffer.Clear()
    }
}

foreach ($p in $prepared) {
    $estTok = [int]([Math]::Ceiling($p.embedText.Length / 4.0))
    if ($batch.Count -ge $maxBatchDocs -or ($batchTok + $estTok) -gt $maxBatchTok) { Flush-EmbedBatch }
    [void]$batch.Add($p)
    $batchTok += $estTok
}
Flush-EmbedBatch
Push-Docs ($docBuffer.ToArray())
$docBuffer.Clear()

Start-Sleep -Seconds 3
$cnt = Invoke-RestMethod -Uri "$searchBase/indexes/$indexName/docs/`$count?api-version=$searchApi" -Headers $searchHdr -Method Get
Write-Output "INGEST_DONE. Index doc count: $cnt"
