// Identifier quoting for the three query dialects the preview endpoints speak, plus
// value coercion for JSON responses.
//
// These are the last line of defence against injection: table and schema names come
// from a Purview qualifiedName, which is data, not code. Parameter binding cannot be
// used for identifiers, so each dialect's escape rule is applied explicitly.

// T-SQL: [name], closing bracket doubled.
export function quoteIdent(name) {
  if (typeof name !== 'string' || !name.length || name.length > 128 || /[\u0000-\u001f]/.test(name)) {
    throw new Error('Invalid identifier');
  }
  return `[${name.replace(/]/g, ']]')}]`;
}

// Databricks / Spark SQL: `name`, backticks doubled.
export function quoteDbx(name) {
  if (typeof name !== 'string' || !name.length || name.length > 255 || /[\u0000-\u001f]/.test(name)) {
    throw new Error('Invalid identifier');
  }
  return `\`${name.replace(/`/g, '``')}\``;
}

// KQL: ['name'], backslashes and single quotes escaped.
export function quoteKql(name) {
  if (typeof name !== 'string' || !name.length || name.length > 1024 || /[\u0000-\u001f]/.test(name)) {
    throw new Error('Invalid identifier');
  }
  return `['${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
}

// Convert a SQL cell to a JSON-friendly value (dates -> ISO, binary -> short hex).
export function sqlCell(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return `0x${v.toString('hex').slice(0, 64)}${v.length > 32 ? '\u2026' : ''}`;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
