import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedTolerance, evaluatePart } from '../src/tolerance.js';
import { SPEC } from '../src/config.js';

const H = SPEC.hole;
const tol = (actualSize, modifier = 'MMC', stated = 0.25) => allowedTolerance({ stated, modifier, actualSize, mmc: H.mmc, lmc: H.lmc });
const TP = { x: 35, y: 30 };
const part = (actualSize, modifier, dx, stated = 0.25) => evaluatePart({
  truePosition: TP, bottom: { x: TP.x + dx, y: TP.y }, top: { x: TP.x + dx, y: TP.y }, thickness: 10,
  stated, modifier, actualSize, mmc: H.mmc, lmc: H.lmc,
});

test('size limits and slider range match the spec', () => {
  assert.equal(H.mmc, 10.0);
  assert.equal(H.lmc, 10.2);
  assert.deepEqual([H.sizeSlider.min, H.sizeSlider.max], [9.95, 10.25]);
});

test('MMC edges: 10.00 -> bonus 0, allowed 0.25; 10.20 -> bonus 0.20, allowed 0.45', () => {
  assert.deepEqual([tol(10.0).bonus, tol(10.0).allowed, tol(10.0).sizeOk], [0, 0.25, true]);
  assert.deepEqual([tol(10.2).bonus, tol(10.2).allowed, tol(10.2).sizeOk], [0.2, 0.45, true]);
  assert.deepEqual([tol(10.15).bonus, tol(10.15).allowed], [0.15, 0.4]); // no float noise (10.15 - 10 = 0.15000000000000036)
  assert.deepEqual([tol(10.1).bonus, tol(10.1).allowed], [0.1, 0.35]);
});

test('slider ends 9.95 and 10.25 are REJECT: size, whatever the axis', () => {
  for (const s of [9.95, 10.25]) for (const m of ['RFS', 'MMC']) {
    assert.equal(tol(s, m).sizeOk, false, `${s} ${m}`);
    assert.equal(part(s, m, 0).verdict, 'REJECT_SIZE', `${s} ${m} centered`);
    assert.equal(part(s, m, 0.3).verdict, 'REJECT_SIZE', `${s} ${m} far out`);
    assert.equal(part(s, m, 0).accept, false);
  }
  // bonus is capped at lmc - mmc even for an oversize hole (zone never grows past 0.45)
  assert.equal(tol(10.25).allowed, 0.45);
  assert.equal(tol(9.95).bonus, 0);
});

test('reject boundaries: 10.00 and 10.20 accepted (inclusive), 9.9999 / 10.2001 rejected, 1e-9 slack', () => {
  for (const s of [10.0, 10.2, 10.0 - 5e-10, 10.2 + 5e-10]) assert.equal(tol(s).sizeOk, true, String(s));
  for (const s of [9.9999, 10.2001, 9.99, 10.21]) {
    assert.equal(tol(s).sizeOk, false, String(s));
    assert.equal(part(s, 'MMC', 0).verdict, 'REJECT_SIZE');
  }
});

test('RFS: allowed stays the stated 0.25 at every size, no bonus', () => {
  for (const s of [10.0, 10.1, 10.15, 10.2]) {
    const t = tol(s, 'RFS');
    assert.deepEqual([t.bonus, t.allowed, t.virtualCondition], [0, 0.25, null]);
  }
  assert.equal(part(10.15, 'RFS', 0.13).verdict, 'OUT'); // 2r = 0.26 > 0.25
  assert.equal(part(10.15, 'MMC', 0.13).verdict, 'IN'); //  2r = 0.26 <= 0.40
});

test('position (2r) is compared with allowed, boundary inclusive', () => {
  assert.equal(part(10.2, 'MMC', 0.225).verdict, 'IN'); //  2r = 0.45 = allowed
  assert.equal(part(10.2, 'MMC', 0.2251).verdict, 'OUT');
  assert.equal(part(10.0, 'MMC', 0.125).verdict, 'IN'); //  no bonus at MMC size
  assert.equal(part(10.0, 'MMC', 0.1251).verdict, 'OUT');
  const r = part(10.15, 'MMC', 0.2);
  assert.equal(r.tolerance, 0.4);
  assert.equal(r.radius, 0.2); // zone radius = allowed / 2
});

test('virtual condition = 10.00 - stated: 9.75 at default, follows stated, never the size', () => {
  for (const s of [9.95, 10.0, 10.1, 10.2, 10.25]) assert.equal(tol(s).virtualCondition, 9.75);
  assert.equal(tol(10.1, 'MMC', 0.3).virtualCondition, 9.7);
  assert.equal(tol(10.1, 'MMC', 0).virtualCondition, 10.0);
  assert.equal(tol(10.1, 'MMC', 0.1234).virtualCondition, 9.8766);
});

test('stated ⌀0: valid at MMC (all from bonus), invalid at RFS', () => {
  const m = tol(10.12, 'MMC', 0);
  assert.deepEqual([m.statedValid, m.bonus, m.allowed], [true, 0.12, 0.12]);
  assert.equal(part(10.12, 'MMC', 0.06, 0).verdict, 'IN');
  assert.equal(part(10.12, 'MMC', 0.0601, 0).verdict, 'OUT');
  assert.equal(part(10.0, 'MMC', 0, 0).verdict, 'IN'); // perfect axis at MMC size with ⌀0 stated
  assert.equal(tol(10.1, 'RFS', 0).statedValid, false);
  assert.equal(part(10.1, 'RFS', 0, 0).verdict, 'INVALID_TOL');
  assert.equal(part(10.1, 'RFS', 0, 0).accept, false);
});

test('conservative rounding: bonus floored to 0.0001, never overstated', () => {
  assert.equal(tol(10.12345).bonus, 0.1234);
  assert.equal(tol(10.12349).allowed, 0.3734);
  assert.ok(tol(10.1).bonus <= 10.1 - 10.0 + 1e-12);
});

test('bad inputs throw', () => {
  assert.throws(() => tol(10.1, 'LMC'));
  assert.throws(() => tol(10.1, 'MMC', -0.01));
  assert.throws(() => tol(NaN));
});
