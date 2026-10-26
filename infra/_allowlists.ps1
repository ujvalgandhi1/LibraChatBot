#requires -Version 7.0
<#
  Shared helper: derive the SSRF allowlists from the catalog export instead of
  hand-maintaining them.

  Dot-source it:
    . (Join-Path $PSScriptRoot '_allowlists.ps1')
    $lists = Get-LibraAllowlist

  The regexes below MUST mirror the parsers in app/server/index.js
  (parseSqlAsset / parseCosmosAsset / parseAdxAsset / parseDatabricksAsset /
  toBlobUrl). If a qualifiedName shape is added there, add it here too or the
  allowlist will silently exclude assets the app is expected to preview.
#>

function Get-LibraAllowlist {
  [CmdletBinding()]
  param(
    # Purview export that seeds the search index.
    [string]$CsvPath = (Join-Path $PSScriptRoot '..' 'main_assets.csv')
  )

  if (-not (Test-Path $CsvPath)) { throw "Catalog export not found: $CsvPath" }

  $storage = [System.Collections.Generic.HashSet[string]]::new()
  $sql     = [System.Collections.Generic.HashSet[string]]::new()
  $cosmos  = [System.Collections.Generic.HashSet[string]]::new()
  $adx     = [System.Collections.Generic.HashSet[string]]::new()
  $dbx     = [System.Collections.Generic.HashSet[string]]::new()

  foreach ($row in Import-Csv -Path $CsvPath) {
    $qn = $row.qualifiedName
    if (-not $qn) { continue }

    switch -Regex ($qn) {
      # mssql://<host>/<db>/<schema>/<table>  -> allowlist is the short server name
      '^mssql://([^/]+)/' { [void]$sql.Add(($Matches[1].Split('.')[0]).ToLower()); break }

      # https://<account>.documents.azure.com/dbs/<db>/colls/<container>
      '^https://([^./]+)\.documents\.azure\.com/' { [void]$cosmos.Add($Matches[1].ToLower()); break }

      # https://<cluster>.<region>.kusto.(windows.net|azuresynapse.net)/<db>/<table>
      '^https://([^./]+)\.[^/]*kusto\.(windows\.net|azuresynapse\.net)/' { [void]$adx.Add($Matches[1].ToLower()); break }

      # Hive metastore: <schema>.<table>@adb-<workspaceId>.<n>.azuredatabricks.net
      '@([^@/]+\.azuredatabricks\.net)$' { [void]$dbx.Add($Matches[1].ToLower()); break }

      # Unity Catalog names carry a metastore GUID, not a host - nothing to derive.
      '^databricks://' { break }

      # https://<account>.(dfs|blob).core.windows.net/<container>/<path>
      '^https://([^./]+)\.(dfs|blob)\.core\.windows\.net/' { [void]$storage.Add($Matches[1].ToLower()); break }
    }
  }

  [pscustomobject]@{
    StorageAccounts  = ($storage | Sort-Object)
    SqlServers       = ($sql     | Sort-Object)
    CosmosAccounts   = ($cosmos  | Sort-Object)
    AdxClusters      = ($adx     | Sort-Object)
    DatabricksHosts  = ($dbx     | Sort-Object)
  }
}
