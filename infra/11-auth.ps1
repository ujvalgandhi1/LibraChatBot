#requires -Version 7.0
<#
  Put Microsoft Entra ID (App Service "Easy Auth") in front of the site.

  WHY
  ---
  The app reads private storage, Azure SQL, Cosmos and ADX with its own managed
  identity. While the site is anonymous, every visitor inherits that access - a
  classic confused-deputy exposure. Easy Auth closes it at the platform edge,
  before a single request reaches Express, with no application code change.

  WHAT IT DOES
  ------------
   1. Reuses (-ClientId) or creates an Entra app registration for the site.
   2. Adds the https://<host>/.auth/login/aad/callback redirect URI.
   3. Creates a client secret and stores it as an app setting. The secret is
      never written to the console, to disk, or to deployment.json.
   4. Turns on Easy Auth with "require authentication" + redirect-to-login.
   5. Leaves /api/health anonymous so the platform health probe keeps working.

  AFTER RUNNING
  -------------
  Anyone in the tenant can sign in. To narrow that to named people or groups,
  set "Assignment required" on the enterprise application and assign users:

    az ad sp update --id <clientId> --set appRoleAssignmentRequired=true

  USAGE
  -----
    ./11-auth.ps1                      # create a registration and enable auth
    ./11-auth.ps1 -ClientId <guid>     # reuse an existing registration
    ./11-auth.ps1 -Disable             # revert to an anonymous demo site
#>
[CmdletBinding()]
param(
  [string]$ClientId,
  [switch]$Disable
)

$ErrorActionPreference = 'Stop'
function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$state = Get-Content (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
$rg    = $state.resourceGroup
$app   = $state.appName
$host_ = $state.defaultHost

if ($Disable) {
  Write-Host "Disabling Easy Auth on $app (site becomes anonymous again)..." -ForegroundColor Yellow
  az webapp auth update -g $rg -n $app --enabled false -o none
  Assert-Ok 'auth disable'
  Write-Host "`nDone. https://$host_ is public with no authentication." -ForegroundColor Green
  Write-Host "The app identity's data access is once again reachable by anyone with the URL." -ForegroundColor Red
  return
}

$tenantId   = az account show --query tenantId -o tsv; Assert-Ok 'tenant lookup'
$redirect   = "https://$host_/.auth/login/aad/callback"
$secretName = 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'   # name Easy Auth expects

# 1) App registration -------------------------------------------------------
if (-not $ClientId) {
  $displayName = "$app-auth"
  $ClientId = az ad app list --display-name $displayName --query '[0].appId' -o tsv
  Assert-Ok 'app registration lookup'
  if ($ClientId) {
    Write-Host "Reusing existing app registration '$displayName' ($ClientId)" -ForegroundColor DarkGray
  } else {
    Write-Host "Creating app registration '$displayName'..." -ForegroundColor Cyan
    $ClientId = az ad app create --display-name $displayName `
      --sign-in-audience AzureADMyOrg --query appId -o tsv
    Assert-Ok 'app registration create'
  }
}

# 2) Redirect URI (additive - keep any that already exist) -------------------
$existing = @(az ad app show --id $ClientId --query 'web.redirectUris' -o tsv); Assert-Ok 'redirect uri read'
if ($existing -notcontains $redirect) {
  Write-Host "Adding redirect URI $redirect ..." -ForegroundColor Cyan
  az ad app update --id $ClientId --web-redirect-uris @($existing + $redirect) -o none
  Assert-Ok 'redirect uri update'
}

# Easy Auth needs a service principal for the registration in this tenant.
az ad sp show --id $ClientId -o none 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating service principal for $ClientId ..." -ForegroundColor Cyan
  az ad sp create --id $ClientId -o none
  Assert-Ok 'service principal create'
}

# 3) Client secret -> app setting -------------------------------------------
# Kept in a local variable only; cleared below. Never echoed.
Write-Host "Rotating client secret and storing it as an app setting..." -ForegroundColor Cyan
$secret = az ad app credential reset --id $ClientId --display-name 'easyauth' `
  --years 1 --query password -o tsv
Assert-Ok 'client secret create'
try {
  az webapp config appsettings set -g $rg -n $app --settings "$secretName=$secret" -o none
  Assert-Ok 'auth secret app setting'
} finally {
  $secret = $null
  [System.GC]::Collect()
}

# 4) Provider + enable ------------------------------------------------------
Write-Host "Configuring the Microsoft identity provider..." -ForegroundColor Cyan
az webapp auth microsoft update -g $rg -n $app `
  --client-id $ClientId `
  --client-secret-setting-name $secretName `
  --issuer "https://sts.windows.net/$tenantId/" `
  --yes -o none
Assert-Ok 'microsoft provider config'

# excluded-paths keeps the platform health probe anonymous; everything else
# redirects an unauthenticated browser to the Entra sign-in page.
Write-Host "Requiring authentication for every other route..." -ForegroundColor Cyan
az webapp auth update -g $rg -n $app `
  --enabled true `
  --action RedirectToLoginPage `
  --redirect-provider azureactivedirectory `
  --excluded-paths "/api/health" `
  --require-https true `
  --token-store true -o none
Assert-Ok 'auth enable'

Write-Host "`nEasy Auth is ON for https://$host_" -ForegroundColor Green
Write-Host "  client id : $ClientId"
Write-Host "  tenant    : $tenantId"
Write-Host "  anonymous : /api/health only"
Write-Host "`nOptional hardening - restrict to assigned users/groups:" -ForegroundColor Yellow
Write-Host "  az ad sp update --id $ClientId --set appRoleAssignmentRequired=true"
Write-Host "`nSet REQUIRE_AUTH=true so the server also rejects any request that" -ForegroundColor Yellow
Write-Host "arrives without an Easy Auth principal (defence in depth):" -ForegroundColor Yellow
Write-Host "  az webapp config appsettings set -g $rg -n $app --settings REQUIRE_AUTH=true"
