import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedTolerance, evaluatePart } from '../src/tolerance.js';
import { SPEC } from '../src/config.js';
import { fcfHTML } from '../src/fcf.js';
import { TEACH } from '../src/ui.js';

const H = SPEC.hole;
const tol = (actualSize, stated = 0.25) => allowedTolerance({ stated, modifier: 'LMC', actualSize, mmc: H.mmc, lmc: H.lmc });
const TP = { x: 35, y: 30 };
const part = (actualSize, dx, stated = 0.25) => evaluatePart({
  truePosition: TP, bottom: { x: TP.x + dx, y: TP.y }, top: { x: TP.x + dx, y: TP.y }, thickness: 10,
  stated, modifier: 'LMC', actualSize, mmc: H.mmc, lmc: H.lmc,
});

test('LMC edges: 10.20 -> bonus 0, allowed 0.25; 10.00 -> bonus 0.20, allowed 0.45', () => {
  assert.deepEqual([tol(10.2).bonus, tol(10.2).allowed], [0, 0.25]);
  assert.deepEqual([tol(10.0).bonus, tol(10.0).allowed], [0.2, 0.45]);
  assert.deepEqual([tol(10.05).bonus, tol(10.05).allowed], [0.15, 0.4]);
});

test('LMC bonus rounds down (never overstated)', () => {
  assert.equal(tol(10.12345).bonus, 0.0765); // 0.07655 -> floor
  assert.ok(tol(10.12345).bonus <= 10.2 - 10.12345);
});

test('LMC virtual condition = 10.20 + stated, independent of size', () => {
  assert.equal(tol(10.05).virtualCondition, 10.45);
  assert.equal(tol(10.19).virtualCondition, 10.45);
  assert.equal(tol(10.05, 0.1).virtualCondition, 10.3);
  assert.equal(tol(10.05, 0).virtualCondition, 10.2);
});

test('LMC: size rejects like MMC, bonus n/a', () => {
  for (const s of [9.95, 9.9999, 10.2001, 10.25]) {
    assert.equal(tol(s).bonus, null, String(s));
    assert.equal(part(s, 0).verdict, 'REJECT_SIZE');
  }
});

test('LMC: stated ⌀0 is valid (bonus supplies tolerance); at 10.20 nothing is allowed', () => {
  assert.equal(tol(10.1, 0).statedValid, true);
  assert.equal(tol(10.1, 0).allowed, 0.1);
  assert.equal(part(10.1, 0.05, 0).verdict, 'IN');
  assert.equal(part(10.1, 0.051, 0).verdict, 'OUT');
  assert.equal(part(10.2, 0, 0).verdict, 'IN');
  assert.equal(part(10.2, 0.001, 0).verdict, 'OUT');
});

test('LMC in/out boundary at 10.05 (allowed 0.40 -> r 0.20)', () => {
  assert.equal(part(10.05, 0.2).verdict, 'IN');
  assert.equal(part(10.05, 0.2001).verdict, 'OUT');
});

test('FCF shows circled L at LMC, M at MMC, nothing at RFS; teaching line text', () => {
  assert.match(fcfHTML({ stated: 0.25, modifier: 'LMC' }), /aria-label="LMC"[^]*>L<\/text>/);
  assert.match(fcfHTML({ stated: 0.25, modifier: 'MMC' }), />M<\/text>/);
  assert.doesNotMatch(fcfHTML({ stated: 0.25, modifier: 'RFS' }), /<svg class="mmcsym"/);
  assert.equal(TEACH, 'MMC protects assembly, LMC protects material.');
});

test("Sally's spot-check table: allowed for RFS / MMC / LMC", () => {
  const T = { 10.0: [0.25, 0.25, 0.45], 10.1: [0.25, 0.35, 0.35], 10.2: [0.25, 0.45, 0.25] };
  for (const [s, exp] of Object.entries(T)) {
    const got = ['RFS', 'MMC', 'LMC'].map((m) => allowedTolerance({ stated: 0.25, modifier: m, actualSize: Number(s), mmc: H.mmc, lmc: H.lmc }).allowed);
    assert.deepEqual(got, exp, `⌀${s}`);
  }
});

test('default VC labels: MMC ⌀9.75, LMC ⌀10.45, unchanged across sizes', () => {
  for (const s of [10.0, 10.05, 10.1, 10.15, 10.2]) {
    assert.equal(allowedTolerance({ stated: 0.25, modifier: 'MMC', actualSize: s, mmc: H.mmc, lmc: H.lmc }).virtualCondition, 9.75);
    assert.equal(tol(s).virtualCondition, 10.45);
  }
});
