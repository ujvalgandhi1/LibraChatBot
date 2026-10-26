#requires -Version 7.0
<#
  Zip-deploy the app source (no node_modules / dist) and let Oryx build it
  server-side: npm install -> npm run build (vite) -> npm start.
#>
$ErrorActionPreference = 'Stop'
function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$state = Get-Content (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
$appRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'app'
$zipPath = Join-Path $PSScriptRoot 'app.zip'

$include = @('package.json','package-lock.json','vite.config.js','index.html','client','server','public')
$paths = $include | ForEach-Object { Join-Path $appRoot $_ } | Where-Object { Test-Path $_ }

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Write-Host "Zipping: $($include -join ', ')" -ForegroundColor Cyan
Compress-Archive -Path $paths -DestinationPath $zipPath -Force
$sizeKB = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host "Created $zipPath ($sizeKB KB)" -ForegroundColor Cyan

Write-Host "Deploying to $($state.appName)..." -ForegroundColor Cyan
az webapp deploy -g $state.resourceGroup -n $state.appName --src-path $zipPath --type zip -o table
Assert-Ok 'webapp deploy'

Write-Host "`nDeployment submitted. Default host: https://$($state.defaultHost)" -ForegroundColor Green
