#requires -Version 7.0
<#
  Provision the search-telemetry store for the Libra Asset Search app.

  Creates two tables in the existing Azure SQL database:
    dbo.search_feedback  1-5 usefulness ratings
    dbo.search_log       every query, used to rank "Most common searches"

  The app's managed identity is granted INSERT on both plus SELECT on the log only
  (deliberately NOT db_datawriter / db_datareader, which would cover every table in a
  shared database).

  Prerequisites:
   - 06-sql-access.ps1 has run (private endpoint + DNS + the MI database user).
   - You are the Entra (AAD) admin on the SQL server.
   - DNS resolves the server FQDN to its private endpoint, i.e. run this from the
     app's VNet or over the P2S VPN. If a stale hosts entry overrides the FQDN,
     fix that first -- connecting by raw IP fails because the Azure SQL gateway
     routes by server name.
#>
param(
  [string]$SqlServerName = 'hokiecopilotchatsqlserver',
  [string]$SqlDatabase   = 'hokiecopilotsqldb01',
  [switch]$SkipAppSettings
)
$ErrorActionPreference = 'Stop'

function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$state   = Get-Content (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
$miName  = $state.appName          # managed identity display name == app name
$sqlFqdn = "$SqlServerName.database.windows.net"

$tsql = @"
IF OBJECT_ID('dbo.search_feedback', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.search_feedback (
        feedback_id  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_search_feedback PRIMARY KEY,
        created_utc  DATETIME2(3)     NOT NULL CONSTRAINT DF_search_feedback_created DEFAULT SYSUTCDATETIME(),
        rating       TINYINT          NOT NULL CONSTRAINT CK_search_feedback_rating CHECK (rating BETWEEN 1 AND 5),
        query_text   NVARCHAR(1000)   NOT NULL,
        result_count INT              NULL,
        search_id    UNIQUEIDENTIFIER NULL
    );
    CREATE INDEX IX_search_feedback_created ON dbo.search_feedback (created_utc DESC);
END;

IF OBJECT_ID('dbo.search_log', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.search_log (
        log_id       BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_search_log PRIMARY KEY,
        created_utc  DATETIME2(3)     NOT NULL CONSTRAINT DF_search_log_created DEFAULT SYSUTCDATETIME(),
        search_id    UNIQUEIDENTIFIER NULL,
        query_text   NVARCHAR(1000)   NOT NULL,
        query_norm   NVARCHAR(200)    NOT NULL,
        result_count INT              NULL
    );
    -- Serves the GROUP BY query_norm ranking behind /api/popular-searches.
    CREATE INDEX IX_search_log_norm ON dbo.search_log (query_norm) INCLUDE (created_utc, result_count);
    CREATE INDEX IX_search_log_created ON dbo.search_log (created_utc DESC);
END;

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$miName')
    CREATE USER [$miName] FROM EXTERNAL PROVIDER;

GRANT INSERT ON dbo.search_feedback TO [$miName];
GRANT INSERT, SELECT ON dbo.search_log TO [$miName];
"@

Write-Host "Target: $sqlFqdn/$SqlDatabase" -ForegroundColor Cyan
Write-Host "Identity to grant: [$miName]" -ForegroundColor Cyan

if (Get-Command Invoke-Sqlcmd -ErrorAction SilentlyContinue) {
  $tok = az account get-access-token --resource https://database.windows.net --query accessToken -o tsv
  Assert-Ok 'get-access-token'
  Write-Host "Creating dbo.search_feedback + dbo.search_log and granting access ..." -ForegroundColor Cyan
  Invoke-Sqlcmd -ServerInstance $sqlFqdn -Database $SqlDatabase -AccessToken "$($tok.Trim())" `
    -Query $tsql -EncryptConnection -ErrorAction Stop
  Write-Host "Done." -ForegroundColor Green
} else {
  Write-Host "SqlServer module not found. Run this T-SQL on $sqlFqdn/$SqlDatabase as the AAD admin:" -ForegroundColor Yellow
  Write-Host $tsql -ForegroundColor Gray
}

if (-not $SkipAppSettings) {
  Write-Host "`nSetting feedback app settings ..." -ForegroundColor Cyan
  az webapp config appsettings set -g $state.resourceGroup -n $state.appName --settings `
    "FEEDBACK_SQL_SERVER=$sqlFqdn" "FEEDBACK_SQL_DATABASE=$SqlDatabase" -o none
  Assert-Ok 'set appsettings'
  Write-Host "  FEEDBACK_SQL_SERVER=$sqlFqdn" -ForegroundColor Green
  Write-Host "  FEEDBACK_SQL_DATABASE=$SqlDatabase" -ForegroundColor Green
}

Write-Host "`nSearch telemetry store ready." -ForegroundColor Green
Write-Host "  Ratings land in dbo.search_feedback (INSERT-only for the app identity)." -ForegroundColor Green
Write-Host "  Every query lands in dbo.search_log; the app reads it back for 'Most common searches'." -ForegroundColor Green
Write-Host "  Read them back with: SELECT TOP 50 * FROM dbo.search_feedback ORDER BY created_utc DESC;" -ForegroundColor Green
