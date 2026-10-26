# Bicep deployment

Declarative replacement for the imperative provisioning scripts.

```powershell
cd .\infra\bicep
az deployment sub create --location eastus2 --template-file main.bicep --parameters main.bicepparam
```

Then deploy the code, which is not an ARM operation:

```powershell
cd ..
./03-deploy.ps1
```

## What this covers

| Script it replaces | Now expressed as |
|---|---|
| `01-provision.ps1` | Resource group, Linux P0V3 plan, web app, system-assigned identity, app settings, `npm start` startup command |
| `02-rbac.ps1` | `Search Index Data Reader`, `Cognitive Services OpenAI User`, and **per-account** `Storage Blob Data Reader` |
| `04-vnet.ps1` | Delegated subnet + `virtualNetworkSubnetId` + `vnetRouteAllEnabled` |
| `05-public.ps1` | `httpsOnly: true` and `ipSecurityRestrictions` |
| `12-allowlists.ps1` | The five allowlist app settings, as parameters |

### Improvements over the scripts

- **Role assignments are idempotent.** Names are `guid(scope, principalId, roleId)`, so a
  re-deploy updates in place instead of erroring on a duplicate.
- **VNet integration is a property of the site**, not the `WEBSITE_VNET_ROUTE_ALL` app
  setting a later `az webapp config appsettings set` could clobber.
- **The blob-read blast radius is reviewable.** `storageGrants` lists named accounts, so a
  reviewer can see exactly which storage the app can read. The original script granted the
  role at *subscription* scope.
- **An IP allowlist now gets a catch-all deny.** Allow rules without a trailing deny leave
  the site open, which is easy to miss when the rules are added one `az` call at a time.

## What deliberately stays a script, and why

None of these have an ARM representation. Bicep cannot express them, and pretending
otherwise would produce a template that silently does less than it appears to.

| Script | Why it can't be Bicep |
|---|---|
| `03-deploy.ps1` | Zip deploy is a Kudu data-plane call |
| `06-sql-access.ps1` | `CREATE USER ... FROM EXTERNAL PROVIDER` is T-SQL. *(The private endpoint half could move here later.)* |
| `07-databricks-access.ps1` | Grants live inside the Databricks workspace, not ARM |
| `09-feedback-store.ps1` | Creates tables and grants `INSERT` — T-SQL |
| `10-blob-indexer.ps1` | AI Search data sources, skillsets and indexers are a data-plane REST API |
| `11-auth.ps1` | Needs a Graph app registration and a client secret. `authsettingsV2` *is* ARM, but the registration it points at is not |

`08-cosmos-adx-access.ps1` is a partial case: the Cosmos SQL role assignment and the ADX
principal assignment **are** ARM types, so they could move here. They are left in the
script for now because both are optional features and neither is provisioned in the
reference deployment.

## Parameters

`main.bicepparam` carries the reference values. For a new tenant, the ones that must
change are `resourceGroupName`, `appName`, the `*ResourceGroupName` / `*Name` pairs for
AI Search and Azure OpenAI, `vnetName`, `subnetPrefix`, and `storageGrants`.

**Keep `storageGrants` and `VIEWER_ALLOWED_ACCOUNTS` in step.** They should name the same
accounts: one grants the identity permission to read, the other permits the endpoint to
ask. Derive both from the catalog with `../_allowlists.ps1`.

> The catalog also references `hokieadbadls02`, which no longer resolves in this
> subscription. It is in the allowlist app setting but omitted from `storageGrants`,
> because a role assignment against a missing account fails the whole deployment.

## Validating a change

```powershell
az bicep build --file main.bicep --stdout                 # compile
az bicep build-params --file main.bicepparam --stdout     # check parameter names and types

az deployment sub validate --location eastus2 `
  --template-file main.bicep --parameters main.bicepparam # Azure-side check, deploys nothing

az deployment sub what-if --location eastus2 `
  --template-file main.bicep --parameters main.bicepparam # exact diff before applying
```

Run **what-if** before any deployment against a live environment. The template creates the
resource group, so a mistyped `resourceGroupName` makes a second parallel environment
rather than updating the existing one.
