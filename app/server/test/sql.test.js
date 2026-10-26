// Identifier quoting is what stops a Purview table name from becoming SQL/KQL code.
import test from 'node:test';
import assert from 'node:assert/strict';

import { quoteIdent, quoteDbx, quoteKql, sqlCell } from '../lib/sql.js';

test('quoteIdent brackets and doubles closing brackets', () => {
  assert.equal(quoteIdent('Customers'), '[Customers]');
  assert.equal(quoteIdent('my table'), '[my table]');
  assert.equal(quoteIdent('we]rd'), '[we]]rd]');
});

test('quoteIdent neutralises T-SQL injection attempts', () => {
  // The classic break-out: close the bracket, add a statement. Doubling the ] keeps
  // the whole payload inside the identifier.
  assert.equal(quoteIdent('t]; DROP TABLE users--'), '[t]]; DROP TABLE users--]');
  assert.equal(quoteIdent("t'; DROP TABLE users--"), "[t'; DROP TABLE users--]");
});

test('quoteIdent rejects empty, oversized and control-character names', () => {
  assert.throws(() => quoteIdent(''), /Invalid identifier/);
  assert.throws(() => quoteIdent('a'.repeat(129)), /Invalid identifier/);
  assert.throws(() => quoteIdent('a\u0000b'), /Invalid identifier/);
  assert.throws(() => quoteIdent('a\nb'), /Invalid identifier/);
  assert.throws(() => quoteIdent(null), /Invalid identifier/);
  assert.throws(() => quoteIdent(123), /Invalid identifier/);
});

test('quoteDbx backticks and doubles backticks', () => {
  assert.equal(quoteDbx('orders'), '`orders`');
  assert.equal(quoteDbx('we`rd'), '`we``rd`');
  assert.equal(quoteDbx('t`; DROP TABLE users--'), '`t``; DROP TABLE users--`');
});

test('quoteDbx enforces its own length and control-character limits', () => {
  assert.equal(quoteDbx('a'.repeat(255)), `\`${'a'.repeat(255)}\``);
  assert.throws(() => quoteDbx('a'.repeat(256)), /Invalid identifier/);
  assert.throws(() => quoteDbx('a\u001fb'), /Invalid identifier/);
});

test('quoteKql escapes backslashes before quotes', () => {
  assert.equal(quoteKql('Events'), "['Events']");
  assert.equal(quoteKql("we'rd"), "['we\\'rd']");
  // Order matters: escaping quotes first would leave the added backslash unescaped.
  assert.equal(quoteKql('back\\slash'), "['back\\\\slash']");
  assert.equal(quoteKql("a\\'b"), "['a\\\\\\'b']");
});

test('quoteKql rejects control characters and oversized names', () => {
  assert.throws(() => quoteKql(''), /Invalid identifier/);
  assert.throws(() => quoteKql('a'.repeat(1025)), /Invalid identifier/);
  assert.throws(() => quoteKql('a\tb'), /Invalid identifier/);
});

test('sqlCell coerces driver types to JSON-friendly values', () => {
  assert.equal(sqlCell(null), null);
  assert.equal(sqlCell(undefined), null);
  assert.equal(sqlCell('text'), 'text');
  assert.equal(sqlCell(42), 42);
  assert.equal(sqlCell(true), true);
  assert.equal(sqlCell(10n), '10');
  assert.equal(sqlCell(new Date('2026-01-02T03:04:05.000Z')), '2026-01-02T03:04:05.000Z');
  assert.equal(sqlCell({ a: 1 }), '{"a":1}');
});

test('sqlCell truncates binary to short hex', () => {
  assert.equal(sqlCell(Buffer.from([0xde, 0xad, 0xbe, 0xef])), '0xdeadbeef');
  const long = sqlCell(Buffer.alloc(64, 0xab));
  assert.equal(long.length, 2 + 64 + 1);          // '0x' + 64 hex chars + ellipsis
  assert.ok(long.endsWith('\u2026'));
});
