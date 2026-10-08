import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crossingsAtZ,
  deviationDiameter,
  tiltDegrees,
  evaluatePosition,
} from '../src/tolerance.js';
import { SPEC, PRESETS } from '../src/config.js';

const TP = { x: 35, y: 30 };
const T = 10;
const TOL = 0.25;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const ev = (bottom, top) => evaluatePosition({ truePosition: TP, bottom, top, tolerance: TOL, thickness: T });
const at = (dx, dy = 0) => ({ x: TP.x + dx, y: TP.y + dy });

test('spec constants match the expert spec', () => {
  assert.deepEqual({ ...SPEC.plate }, { x: 100, y: 60, z: 10 });
  assert.deepEqual({ ...SPEC.truePosition }, TP);
  assert.equal(SPEC.position.tolerance, 0.25);
  assert.deepEqual([...SPEC.position.datums], ['A', 'B', 'C']);
});

// ---- Required cases from the domain expert --------------------------------

test('REQUIRED: centered axis at (35,30) is IN', () => {
  const r = ev(at(0), at(0));
  assert.equal(r.inTolerance, true);
  assert.equal(r.deviation, 0);
});

test('REQUIRED: midpoint at (35,30), top +0.10 X, bottom -0.10 X is IN', () => {
  const r = ev(at(-0.1), at(0.1));
  close(r.mid.dx, 0);
  close(r.bottom.deviation, 0.2);
  close(r.top.deviation, 0.2);
  assert.equal(r.inTolerance, true);
});

test('REQUIRED: same with ±0.13 is OUT even though midpoint unchanged', () => {
  const r = ev(at(-0.13), at(0.13));
  close(r.mid.dx, 0);
  assert.equal(r.mid.deviation, 0); // a midpoint-only check would wrongly pass
  assert.equal(r.bottom.inside, false);
  assert.equal(r.top.inside, false);
  assert.equal(r.inTolerance, false);
  close(r.deviation, 0.26);
});

test('REQUIRED: exactly 0.125 radial is IN (boundary inclusive)', () => {
  for (const [dx, dy] of [[0.125, 0], [0, -0.125], [-0.125 * Math.SQRT1_2, 0.125 * Math.SQRT1_2]]) {
    const r = ev(at(dx, dy), at(dx, dy));
    close(r.deviation, 0.25);
    assert.equal(r.inTolerance, true, `dx=${dx} dy=${dy}`);
  }
});

test('REQUIRED: 0.126 radial is OUT', () => {
  const r = ev(at(0.126), at(0.126));
  close(r.deviation, 0.252);
  assert.equal(r.inTolerance, false);
  assert.ok(r.margin < 0);
});

// ---- Additional coverage ---------------------------------------------------

test('deviation is 2*sqrt(dx^2+dy^2) (3-4-5)', () => {
  close(deviationDiameter(at(0.03, 0.04), TP), 0.1);
  close(deviationDiameter(at(-0.06, 0.08), TP), 0.2);
});

test('X and Y each under 0.125 but combined radial over it is OUT', () => {
  const r = ev(at(0.1, 0.1), at(0.1, 0.1)); // radial 0.1414 -> ⌀0.283
  assert.equal(r.inTolerance, false);
});

test('tilted axis with only ONE end outside is OUT', () => {
  const r = ev(at(0.05), at(0.15)); // bottom in, top out
  assert.equal(r.bottom.inside, true);
  assert.equal(r.top.inside, false);
  assert.equal(r.inTolerance, false);
  close(r.deviation, 0.3); // worst end governs
});

test('crossingsAtZ finds where a general 3D line meets z=0 and z=10', () => {
  // line through (35,30,5) leaning +0.02 mm X per mm Z
  const c = crossingsAtZ({ x: 35, y: 30, z: 5 }, { x: 35.02, y: 30, z: 6 }, 0, T);
  close(c.bottom.x, 34.9);
  close(c.top.x, 35.1);
  close(c.bottom.y, 30);
  assert.equal(c.bottom.z, 0);
  assert.equal(c.top.z, T);
  assert.throws(() => crossingsAtZ({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, 0, T), RangeError);
});

test('tilt angle reported from endpoints', () => {
  close(tiltDegrees(at(0), at(0), T), 0);
  close(tiltDegrees(at(-0.1), at(0.1), T), (Math.atan(0.2 / 10) * 180) / Math.PI);
});

test('UI presets produce the expected IN/OUT results', () => {
  const expected = { centered: true, 'tilt-in': true, 'tilt-out': false, 'edge-in': true, 'edge-out': false, 'diag-out': false };
  for (const p of PRESETS) {
    const r = ev(at(p.bottom.dx, p.bottom.dy), at(p.top.dx, p.top.dy));
    assert.equal(r.inTolerance, expected[p.id], p.id);
  }
});

test('rejects invalid input', () => {
  assert.throws(() => ev(at(NaN), at(0)), TypeError);
  assert.throws(() => evaluatePosition({ truePosition: TP, bottom: TP, top: TP, tolerance: -1 }), RangeError);
});

test('REQUIRED: reported position value = 2 × max endpoint radial offset (a diameter, not a radius)', () => {
  const cases = [
    [at(-0.1), at(0.1)],
    [at(0.05, -0.02), at(0.11, 0.09)],
    [at(0.126), at(0)],
    [at(0, 0.03), at(0, -0.2)],
  ];
  for (const [b, t] of cases) {
    const r = ev(b, t);
    const rb = Math.hypot(b.x - TP.x, b.y - TP.y);
    const rt = Math.hypot(t.x - TP.x, t.y - TP.y);
    close(r.deviation, 2 * Math.max(rb, rt));
    close(r.bottom.r, rb);
    close(r.top.r, rt);
    close(r.bottom.deviation, 2 * rb);
    close(r.top.deviation, 2 * rt);
    assert.equal(r.inTolerance, Math.max(rb, rt) <= 0.125 + 1e-9);
  }
});
