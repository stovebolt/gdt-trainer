import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockDrag, shrinkCausedOut, LOCK_EPS, evaluatePart, allowedTolerance } from '../src/tolerance.js';
import { SPEC } from '../src/config.js';
import { fmtAgainst, fmtLimit } from '../src/format.js';
import { SHRINK_NOTE } from '../src/ui.js';

const H = SPEC.hole;
const TP = { x: 35, y: 30 };
const r = (p) => Math.hypot(p.dx, p.dy);
const allowedAt = (size, modifier, stated = 0.25) => allowedTolerance({ stated, modifier, actualSize: size, mmc: H.mmc, lmc: H.lmc }).allowed;
const evalAx = (ax, size, modifier, stated = 0.25) => evaluatePart({
  truePosition: TP, bottom: { x: TP.x + ax.bottom.dx, y: TP.y + ax.bottom.dy }, top: { x: TP.x + ax.top.dx, y: TP.y + ax.top.dy },
  thickness: 10, stated, modifier, actualSize: size, mmc: H.mmc, lmc: H.lmc,
});
const O = { dx: 0, dy: 0 };

test('clamp at the boundary: r <= allowed/2 − eps, direction kept; inside moves untouched', () => {
  const c = lockDrag({ prev: O, next: { dx: 0.3, dy: 0.4 }, allowed: 0.25 });
  assert.ok(r(c) <= 0.125 - LOCK_EPS && r(c) > 0.123);
  assert.ok(Math.abs(c.dy / c.dx - 4 / 3) < 0.02, 'direction kept');
  assert.deepEqual(lockDrag({ prev: O, next: { dx: 0.1, dy: -0.05 }, allowed: 0.25 }), { dx: 0.1, dy: -0.05 });
  assert.deepEqual(lockDrag({ prev: O, next: { dx: 0.2, dy: 0 }, allowed: 0 }), { dx: 0, dy: 0 });
});

test('endpoints clamp separately: tilting right up to the edge works', () => {
  const top = lockDrag({ prev: O, next: { dx: 0.4, dy: 0 }, allowed: 0.25 });
  const bottom = lockDrag({ prev: O, next: { dx: -0.4, dy: 0 }, allowed: 0.25 });
  assert.deepEqual([top, bottom], [{ dx: 0.124, dy: 0 }, { dx: -0.124, dy: 0 }]);
  const v = evalAx({ top, bottom }, 10.1, 'RFS');
  assert.equal(v.verdict, 'IN');
  assert.ok(v.tilt > 1.4, 'full edge-to-edge tilt allowed');
});

test('locked drags + size OK -> verdict always IN (random drag sequences, all modes)', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.8 - 0.4;
  for (const m of ['RFS', 'MMC', 'LMC']) for (const s of [10, 10.05, 10.123, 10.2]) for (const st of m === 'RFS' ? [0.001, 0.25] : [0, 0.25]) {
    const allowed = allowedAt(s, m, st); let ax = { bottom: O, top: O };
    for (let i = 0; i < 60; i++) {
      const k = i % 2 ? 'top' : 'bottom';
      ax = { ...ax, [k]: lockDrag({ prev: ax[k], next: { dx: Math.round(rnd() * 1e3) / 1e3, dy: Math.round(rnd() * 1e3) / 1e3 }, allowed }) };
      const v = evalAx(ax, s, m, st);
      assert.equal(v.verdict, 'IN', `${m} ${s} ${st} step ${i}`);
      // display: the shown position never exceeds the shown limit
      assert.ok(Number(fmtAgainst(v.deviation, v.tolerance, true)) <= Number(fmtLimit(v.tolerance)));
    }
  }
});

test('locked + size rejected: position still clamped, verdict stays REJECT_SIZE', () => {
  const top = lockDrag({ prev: O, next: { dx: 0.4, dy: 0 }, allowed: allowedAt(10.22, 'MMC') });
  assert.ok(r(top) <= 0.125);
  assert.equal(evalAx({ top, bottom: O }, 10.22, 'MMC').verdict, 'REJECT_SIZE');
});

test('NO re-clamp on shrink: the axis stays put and reads OUT; the note explains it', () => {
  const top = lockDrag({ prev: O, next: { dx: 0.4, dy: 0 }, allowed: allowedAt(10.2, 'MMC') }); // r 0.224
  const ax = { top, bottom: O };
  assert.equal(evalAx(ax, 10.2, 'MMC').verdict, 'IN');
  const v = evalAx(ax, 10.0, 'MMC'); // zone ⌀0.45 -> ⌀0.25, axis untouched
  assert.deepEqual(top, { dx: 0.224, dy: 0 });
  assert.equal(v.verdict, 'OUT');
  assert.equal(shrinkCausedOut({ rBottom: v.bottom.r, rTop: v.top.r, allowedBefore: 0.45, allowedNow: 0.25 }), true);
  assert.equal(SHRINK_NOTE, 'zone shrank: less bonus at this size');
});

test('shrink note only when the shrink caused the OUT', () => {
  const f = (r, b, n) => shrinkCausedOut({ rBottom: 0, rTop: r, allowedBefore: b, allowedNow: n });
  assert.equal(f(0.2, 0.45, 0.25), true);
  assert.equal(f(0.1, 0.45, 0.25), false, 'still IN after shrink');
  assert.equal(f(0.3, 0.45, 0.25), false, 'was already OUT before');
  assert.equal(f(0.2, null, 0.25), false, 'no shrink recorded (lock off)');
  assert.equal(f(0.2, 0.25, 0.45), false, 'zone grew');
});

test('outside + locked: a drag may only reduce the radial offset; once inside, normal clamp', () => {
  const allowed = 0.25; const out = { dx: 0.2, dy: 0 }; // r 0.2 > 0.125 (zone shrank under it)
  assert.ok(r(lockDrag({ prev: out, next: { dx: 0.3, dy: 0 }, allowed })) <= 0.2 + 1e-12, 'outward refused');
  assert.ok(r(lockDrag({ prev: out, next: { dx: 0.2, dy: 0.1 }, allowed })) <= 0.2 + 1e-12, 'sideways cannot grow r');
  assert.deepEqual(lockDrag({ prev: out, next: { dx: 0.15, dy: 0 }, allowed }), { dx: 0.15, dy: 0 }, 'inward allowed');
  const inside = lockDrag({ prev: out, next: { dx: 0.05, dy: 0 }, allowed });
  assert.deepEqual(inside, { dx: 0.05, dy: 0 });
  assert.ok(r(lockDrag({ prev: inside, next: { dx: 0.3, dy: 0 }, allowed })) <= 0.125 - LOCK_EPS, 'normal clamp again');
});
