// One credential and one token cache for the whole process.
//
// There are no keys or connection strings anywhere in this app: every downstream call
// (AI Search, Azure OpenAI, Storage, SQL, Cosmos, ADX, Databricks) authenticates with a
// managed identity in Azure, or your `az login` locally.
import { DefaultAzureCredential } from '@azure/identity';

export const credential = new DefaultAzureCredential();

const tokenCache = new Map();

/** Bearer token for a scope, cached until a minute before it expires. */
export async function getToken(scope) {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresOnTimestamp - 60_000 > Date.now()) return cached.token;
  const t = await credential.getToken(scope);
  if (!t) throw new Error(`Failed to acquire token for ${scope}`);
  tokenCache.set(scope, t);
  return t.token;
}
