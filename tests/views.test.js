import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewPose, dragPlane, dragDelta, effectiveDistance, VIEW_DIRS } from '../src/views.js';
import { translateAxis, evaluatePosition, LOCK_EPS } from '../src/tolerance.js';
import { PRESETS, SPEC } from '../src/config.js';
import { fmtUp, fmtLimit } from '../src/format.js';

const T = [35, 30, 5];
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const r = (p) => Math.hypot(p.dx, p.dy);

test('view poses: top looks down Z, front along +Y, side along −X, at the given distance', () => {
  const top = viewPose('top', T, 100), front = viewPose('front', T, 100), side = viewPose('side', T, 100);
  assert.ok(top.position[2] - 5 > 99.99 && near(top.position[0], 35));
  assert.deepEqual(front.position, [35, -70, 5]);
  assert.deepEqual(side.position, [135, 30, 5]);
  assert.throws(() => viewPose('iso', T, 1));
});

test('drag plane: horizontal when looking down (top / 3D orbit), vertical facing the camera in front/side', () => {
  assert.equal(dragPlane([0, 0, -1]).kind, 'horizontal');
  assert.equal(dragPlane([0.57, 0.7, -0.45]).kind, 'horizontal'); // default 3D orbit
  assert.deepEqual(dragPlane([0, 1, 0]), { kind: 'vertical', normal: [0, 1, 0] });
  assert.deepEqual(dragPlane([-1, 0, 0]), { kind: 'vertical', normal: [-1, 0, 0] });
});

test('drag mapping: top view -> X/Y; front view -> X only; side view -> Y only (magnification removed)', () => {
  const eq = (a, b) => assert.ok(near(a.dx, b.dx, 1e-12) && near(a.dy, b.dy, 1e-12), JSON.stringify([a, b]));
  eq(dragDelta(dragPlane([0, 0, -1]), [2.4, -4.8], 24), { dx: 0.1, dy: -0.2 });
  const f = dragDelta(dragPlane([0, 1, 0]), [2.4, 1e-14], 24);
  eq(f, { dx: 0.1, dy: 0 }); assert.equal(f.dy, 0);
  const sd = dragDelta(dragPlane([-1, 0, 0]), [3e-13, -2.4], 24);
  eq(sd, { dx: 0, dy: -0.1 }); assert.equal(sd.dx, 0);
});

test('label layout distance: ortho uses visible half-height, persp the camera distance', () => {
  assert.equal(effectiveDistance({ ortho: false, distance: 88 }), 88);
  assert.ok(near(effectiveDistance({ ortho: true, halfHeight: 20, zoom: 2, fovDeg: 90 }), 10));
  assert.ok(VIEW_DIRS.top[2] === 1);
});

test('Lock tilt: both ends move by the same delta; the tilt (top − bottom) is constant', () => {
  let ax = { bottom: { dx: -0.1, dy: 0.02 }, top: { dx: 0.1, dy: -0.03 } };
  const diff = (a) => [Math.round((a.top.dx - a.bottom.dx) * 1e6), Math.round((a.top.dy - a.bottom.dy) * 1e6)];
  const d0 = diff(ax);
  for (const d of [{ dx: 0.05, dy: 0 }, { dx: -0.013, dy: 0.2 }, { dx: 0.4, dy: -0.4 }, { dx: -0.333, dy: 0.001 }]) {
    ax = translateAxis({ ...ax, delta: d, maxDev: 0.4 });
    assert.deepEqual(diff(ax), d0, JSON.stringify(d));
    for (const p of [ax.bottom, ax.top]) assert.ok(Math.abs(p.dx) <= 0.4 && Math.abs(p.dy) <= 0.4);
  }
});

test('turning Lock tilt on never moves the axis (a zero delta is a no-op, tilted or not)', () => {
  for (const ax of [{ bottom: { dx: -0.13, dy: 0 }, top: { dx: 0.13, dy: 0 } }, { bottom: { dx: 0.1, dy: 0.1 }, top: { dx: 0.1, dy: 0.1 } }]) {
    const t = translateAxis({ ...ax, delta: { dx: 0, dy: 0 } });
    assert.deepEqual([t.bottom, t.top], [ax.bottom, ax.top]);
    const tl = translateAxis({ ...ax, delta: { dx: 0, dy: 0 }, allowed: 0.25 }); // also with the tolerance lock on, even if OUT
    assert.deepEqual([tl.bottom, tl.top], [ax.bottom, ax.top]);
  }
});

test('both locks: whichever end would leave first limits the move; both move by the clamped delta', () => {
  const ax = { bottom: { dx: -0.1, dy: 0 }, top: { dx: 0.1, dy: 0 } }; // tilted, inside ⌀0.25
  const t = translateAxis({ ...ax, delta: { dx: 0.2, dy: 0 }, allowed: 0.25 });
  assert.deepEqual(t.delta, { dx: 0.024, dy: 0 }); // TOP reaches the edge first (0.124 ≤ 0.125 − eps)
  assert.deepEqual([t.bottom, t.top], [{ dx: -0.076, dy: 0 }, { dx: 0.124, dy: 0 }]);
  assert.ok(r(t.top) <= 0.125 - LOCK_EPS && r(t.bottom) <= 0.125);
  // sideways slides along the boundary instead of sticking
  const s = translateAxis({ ...t, delta: { dx: 0.05, dy: 0.06 }, allowed: 0.25 });
  assert.ok(s.top.dy > 0.03, 'slides in Y');
  assert.ok(r(s.top) <= 0.125 - LOCK_EPS && r(s.bottom) <= 0.125 - LOCK_EPS);
  assert.equal(Math.round((s.top.dx - s.bottom.dx) * 1e6), 200000);
});

test('both locks: random drags stay IN and keep the tilt; display never above the limit', () => {
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.6 - 0.3;
  for (const allowed of [0.25, 0.4, 0.45, 0.1]) {
    let ax = { bottom: { dx: -0.02, dy: 0.01 }, top: { dx: 0.03, dy: -0.01 } };
    for (let i = 0; i < 80; i++) {
      ax = translateAxis({ ...ax, delta: { dx: Math.round(rnd() * 1e3) / 1e3, dy: Math.round(rnd() * 1e3) / 1e3 }, allowed, maxDev: 0.4 });
      assert.equal(Math.round((ax.top.dx - ax.bottom.dx) * 1e6), 50000);
      const v = evaluatePosition({ truePosition: { x: 0, y: 0 }, bottom: { x: ax.bottom.dx, y: ax.bottom.dy }, top: { x: ax.top.dx, y: ax.top.dy }, tolerance: allowed, thickness: 10 });
      assert.ok(v.inTolerance, `${allowed} step ${i}`);
      assert.ok(Math.min(Number(fmtUp(v.deviation)), Number(fmtLimit(allowed))) <= Number(fmtLimit(allowed)));
    }
  }
});

test('both locks, an end already outside: the move can only bring it inward (projected, never stuck)', () => {
  const ax = { bottom: { dx: 0.2, dy: 0 }, top: { dx: 0.22, dy: 0 } }; // zone shrank: both outside ⌀0.25
  const out = translateAxis({ ...ax, delta: { dx: 0.05, dy: 0 }, allowed: 0.25 });
  assert.ok(r(out.top) <= 0.22 + 1e-12 && r(out.bottom) <= 0.2 + 1e-12, 'no outward move');
  const back = translateAxis({ ...ax, delta: { dx: -0.2, dy: 0.01 }, allowed: 0.25 });
  assert.deepEqual(back.delta, { dx: -0.2, dy: 0.01 });
  assert.ok(r(back.top) < 0.125 && r(back.bottom) < 0.125);
});

test('Diagonal (2D trap) preset: 0.10 X + 0.10 Y, no tilt -> r 0.1414, ⌀0.283 > ⌀0.25 OUT at RFS', () => {
  const p = PRESETS.find((x) => x.id === 'diag-out');
  assert.equal(p.label, 'Diagonal (2D trap)');
  assert.equal(p.note, 'Inside the band in front and side views, but outside the round zone.');
  assert.deepEqual([p.bottom, p.top], [{ dx: 0.1, dy: 0.1 }, { dx: 0.1, dy: 0.1 }]);
  const v = evaluatePosition({ truePosition: SPEC.truePosition, bottom: { x: 35.1, y: 30.1 }, top: { x: 35.1, y: 30.1 }, tolerance: 0.25, thickness: 10 });
  assert.ok(near(v.top.r, 0.14142, 1e-5));
  assert.equal(fmtUp(v.deviation), '0.283');
  assert.equal(v.inTolerance, false);
  // the trap: each single-axis offset (what front / side views show) is inside the band ±0.125
  assert.ok(0.1 <= 0.125);
});
