#requires -Version 7.0
<#
  Open the site for demos: remove the deploy-machine IP lock on the MAIN site
  (leaving it publicly reachable, no auth) and force HTTPS-only.

  SECURITY NOTE
  -------------
  This makes the app reachable by anyone who has the URL. Because the app reads
  files from private storage with its managed identity, a fully public site
  exposes those files to any visitor. The custom PDF viewer only *deters*
  download/print (no toolbar, blocked shortcuts) - it is NOT DRM.

  Recommended between demos:
    az webapp stop  -g <rg> -n <app>          # take it offline
    az webapp start -g <rg> -n <app>          # bring it back for the next demo

  To re-lock to just your IP instead of fully public:
    az webapp config access-restriction add -g <rg> -n <app> `
      --rule-name lockdown --action Allow --ip-address <YOUR_IP>/32 --priority 100

  The SCM/Kudu site stays locked to the deploy IP (see 01-provision.ps1).
#>
$ErrorActionPreference = 'Stop'
function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$state = Get-Content (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
$rg    = $state.resourceGroup
$app   = $state.appName

# 1) Remove the temporary deploy-machine allow rule on the MAIN site -> public.
#    (Ignore the error if it was already removed.)
Write-Host "Opening MAIN site to public (removing deploy-machine rule)..." -ForegroundColor Cyan
az webapp config access-restriction remove -g $rg -n $app --rule-name deploy-machine --scm-site false -o none 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "  (rule already absent - continuing)" -ForegroundColor DarkGray }

# 2) Force HTTPS-only.
Write-Host "Forcing HTTPS-only..." -ForegroundColor Cyan
az webapp update -g $rg -n $app --https-only true -o none
Assert-Ok 'https-only'

Write-Host "`nApp is public at: https://$($state.defaultHost)" -ForegroundColor Green
Write-Host "Stop between demos with: az webapp stop -g $rg -n $app" -ForegroundColor Yellow
