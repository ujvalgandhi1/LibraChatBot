$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$key = az search admin-key show -g hokiepurview --service-name libraaisearch --query primaryKey -o tsv
$base = 'https://libraaisearch.search.windows.net'
$hdr = @{ 'api-key' = $key }

# Schema of assetsrag
$idx = Invoke-RestMethod -Uri "$base/indexes/assetsrag?api-version=2024-07-01" -Headers $hdr -Method Get
Write-Output "FIELDS:"
$idx.fields | ForEach-Object { Write-Output ("  - {0} ({1}) searchable={2} retrievable={3} dims={4}" -f $_.name, $_.type, $_.searchable, $_.retrievable, $_.dimensions) }
Write-Output ("SEMANTIC: " + (($idx.semantic.configurations.name) -join ', '))
Write-Output ("VECTOR_PROFILES: " + (($idx.vectorSearch.profiles.name) -join ', '))

# Doc count
$cnt = Invoke-RestMethod -Uri "$base/indexes/assetsrag/docs/`$count?api-version=2024-07-01" -Headers $hdr -Method Get
Write-Output ("DOC_COUNT: " + $cnt)

# One sample doc
$sample = Invoke-RestMethod -Uri "$base/indexes/assetsrag/docs?api-version=2024-07-01&search=*&`$top=1" -Headers $hdr -Method Get
Write-Output "SAMPLE_DOC_KEYS:"
if ($sample.value.Count -gt 0) { $sample.value[0].PSObject.Properties.Name | ForEach-Object { Write-Output ("  - " + $_) } }
