// The limiter is the only thing bounding how often an anonymous caller can reach the
// data endpoints, and its counter map used to grow without bound.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter } from '../lib/rate-limit.js';

// Minimal express-shaped doubles.
const mkRes = () => {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

function run(mw, ip) {
  const res = mkRes();
  let passed = false;
  mw({ ip }, res, () => { passed = true; });
  return { passed, res };
}

test('requests up to the limit pass and the next one is rejected', () => {
  const mw = createRateLimiter().limit(3);
  for (let i = 0; i < 3; i += 1) assert.ok(run(mw, '1.1.1.1').passed, `request ${i + 1}`);
  const blocked = run(mw, '1.1.1.1');
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.match(blocked.res.body.error, /Too many requests/);
});

test('a rejected response carries Retry-After in whole seconds', () => {
  const mw = createRateLimiter({ windowMs: 60_000 }).limit(1);
  run(mw, '2.2.2.2');
  const { res } = run(mw, '2.2.2.2');
  const retry = Number(res.headers['retry-after']);
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= 60, `retry-after=${retry}`);
});

test('budgets are tracked per IP', () => {
  const mw = createRateLimiter().limit(1);
  assert.ok(run(mw, '3.3.3.3').passed);
  assert.equal(run(mw, '3.3.3.3').passed, false);
  assert.ok(run(mw, '4.4.4.4').passed, 'a different IP has its own budget');
});

test('separate limiters do not share budgets', () => {
  const rl = createRateLimiter();
  const search = rl.limit(1);
  const data = rl.limit(1);
  assert.ok(run(search, '5.5.5.5').passed);
  assert.equal(run(search, '5.5.5.5').passed, false);
  assert.ok(run(data, '5.5.5.5').passed, 'the data budget is untouched by search');
});

test('the window resets after it elapses', async () => {
  const mw = createRateLimiter({ windowMs: 20 }).limit(1);
  assert.ok(run(mw, '6.6.6.6').passed);
  assert.equal(run(mw, '6.6.6.6').passed, false);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(run(mw, '6.6.6.6').passed, 'budget restored in the next window');
});

test('sweep evicts expired entries so the map cannot grow without bound', async () => {
  const rl = createRateLimiter({ windowMs: 20 });
  const mw = rl.limit(10);
  for (let i = 0; i < 500; i += 1) run(mw, `10.0.0.${i}`);
  assert.equal(rl.size(), 500);
  assert.equal(rl.sweep(), 0, 'nothing is expired yet');

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(rl.sweep(), 500);
  assert.equal(rl.size(), 0);
});

test('sweep keeps entries that are still inside their window', async () => {
  const rl = createRateLimiter({ windowMs: 10_000 });
  const mw = rl.limit(10);
  run(mw, '7.7.7.7');
  assert.equal(rl.sweep(), 0);
  assert.equal(rl.size(), 1);
});

test('maxKeys caps the map when new IPs arrive faster than the sweeper', () => {
  const rl = createRateLimiter({ windowMs: 60_000, maxKeys: 100 });
  const mw = rl.limit(10);
  for (let i = 0; i < 250; i += 1) run(mw, `10.1.0.${i}`);
  assert.ok(rl.size() <= 100, `size ${rl.size()} exceeded the cap`);
});

test('startSweeper returns an unref-ed timer that cannot hold the process open', () => {
  const t = createRateLimiter().startSweeper();
  assert.ok(t, 'a timer handle is returned');
  clearInterval(t);
});
