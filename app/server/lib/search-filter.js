// OData $filter construction for Azure AI Search.
//
// Facet values come straight from the browser, so field names are checked against an
// allowlist and values are escaped rather than interpolated. A facet selection can
// therefore never inject OData.

// Only these fields can be filtered.
export const FACET_FIELDS = new Set([
  'collectionName', 'assetTypeFriendly', 'assetEntityType', 'owner', 'expert', 'format'
]);

export const STEWARDSHIP = {
  'has-owner': "owner ne ''",
  'no-owner': "owner eq ''",
  'has-expert': "expert ne ''",
  'no-expert': "expert eq ''",
  'no-contact': "(owner eq '' and expert eq '')"
};

export const odataStr = (v) => `'${String(v).replace(/'/g, "''")}'`;

export function buildFilter(facets, exclude) {
  if (!facets || typeof facets !== 'object' || Array.isArray(facets)) return '';
  const groups = [];
  for (const [field, values] of Object.entries(facets)) {
    if (field === exclude) continue;
    if (!Array.isArray(values) || !values.length || values.length > 50) continue;
    if (field === 'stewardship') {
      const parts = values.map((v) => STEWARDSHIP[v]).filter(Boolean);
      if (parts.length) groups.push(`(${parts.join(' or ')})`);
      continue;
    }
    if (!FACET_FIELDS.has(field)) continue;
    const parts = values
      .filter((v) => typeof v === 'string' && v.length <= 200)
      .map((v) => `${field} eq ${odataStr(v)}`);
    if (parts.length) groups.push(`(${parts.join(' or ')})`);
  }
  return groups.join(' and ');
}

// Collapses casing, punctuation and spacing so one popular question doesn't split into
// several rows. Stripping everything but letters, digits, spaces, apostrophes and hyphens
// also means no markup can survive into the list rendered back to other visitors.
export function normalizeQuery(text) {
  return String(text)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
