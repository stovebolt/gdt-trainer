// Lesson 2 (composite position): port of Sally's check_examples.py (164 checks) to node.
// Reference numbers from the Python script (and its scipy cross-check) live in
// composite/tests/fixture.json (regenerate: python3 composite/tests/gen_fixture.py <spec dir>).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mec, evaluate, dispUp, lowerFit, holesFromDev, patternMove, perp, oneHole, ZERO, disp,
  BASIC, CEN, R_UP, R_LO, T_LO, PLATE, SIZE_HI,
} from '../composite/src/composite.js';
import { PRESETS, EXTRA_PRESETS } from '../composite/src/config.js';
import { devsFromState } from '../composite/src/state.js';

const FX = JSON.parse(readFileSync(new URL('../composite/tests/fixture.json', import.meta.url)));
let checks = 0;
const check = (cond, label) => { assert.ok(cond, label); checks++; };
const close = (a, b, tol = 5e-7) => Math.abs(a - b) <= tol;
const max = (a) => Math.max(...a);
const RC = Math.hypot(25, 15);
const rad = (d) => (d * Math.PI) / 180;

test('display rule', () => {
  check(disp(0.25) === '0.25' && disp(0.2) === '0.2' && disp(0.10180) === '0.102', 'display basics');
  check(disp(0.5000004, 0.5) === '0.501', 'failing value rounds away from limit');
  check(disp(0.1000004, 0.1) === '0.101', 'failing lower value rounds away');
});

test('locked geometry', () => {
  check(JSON.stringify(BASIC) === '[[25,15],[75,15],[25,45],[75,45]]', 'basic positions');
  check(close(BASIC[1][0] - BASIC[0][0], 50) && close(BASIC[2][1] - BASIC[0][1], 30), '50x30 spacing');
  check(CEN[0] === 50 && CEN[1] === 30, 'pattern centre = plate centre');
  check(close(RC, 29.154759), 'corner radius');
  for (const [bx, by] of BASIC) check(bx - SIZE_HI / 2 - R_UP > 0 && bx + SIZE_HI / 2 + R_UP < PLATE.x && by - SIZE_HI / 2 - R_UP > 0 && by + SIZE_HI / 2 + R_UP < PLATE.y, 'hole inside plate');
  const r0 = evaluate([ZERO, ZERO, ZERO, ZERO]);
  check(r0.code === 'PASS' && r0.lo === 0 && max(r0.up) === 0, 'nominal part');
});

test('MEC unit tests', () => {
  check(close(mec([[0, 0], [2, 0]])[1], 1), 'mec 2 pts');
  check(close(mec([[0, 0], [1, 0], [0, 1], [1, 1]])[1], Math.SQRT2 / 2), 'mec square');
  check(close(mec([[0, 0], [4, 0], [2, 0.1]])[1], 2), 'mec obtuse -> diameter');
  check(close(mec([[0, 0], [0, 0]])[1], 0), 'mec coincident');
});

const results = {};
test('edge cases vs spec, Python and scipy (1e-5)', () => {
  for (const [k, c] of Object.entries(FX.cases)) {
    const r = evaluate(c.devs);
    results[k] = r;
    check(close(max(r.up), c.exp_up, 1e-6), `${k} upper ${max(r.up)} vs ${c.exp_up}`);
    if (c.exp_lo !== null) check(close(r.lo, c.exp_lo, 1e-6), `${k} lower ${r.lo} vs ${c.exp_lo}`);
    if (c.exp_code !== null) check(r.code === c.exp_code, `${k} code ${r.code} vs ${c.exp_code}`);
    // independent optimiser (scipy, from the fixture)
    check(c.scipy_lo >= r.lo - 2e-6, `${k} scipy not better (${c.scipy_lo} vs ${r.lo})`);
    check(Math.abs(c.scipy_lo - r.lo) <= 2e-5, `${k} scipy agrees (${c.scipy_lo} vs ${r.lo})`);
    // extra (not in the 164): JS port = Python reference to 1e-5
    assert.ok(Math.abs(r.lo - c.py_lo) <= 1e-5, `${k} JS lo ${r.lo} vs Python ${c.py_lo}`);
    assert.ok(r.up.every((u, i) => Math.abs(u - c.py_up[i]) <= 1e-9), `${k} JS up = Python`);
    assert.equal(r.code, c.py_code, `${k} JS code = Python`);
    // the drawn placement achieves the reported lower Ø (the optimal placement need not be unique, e.g. EC16)
    assert.ok(Math.abs(2 * Math.max(...r.loHoleR) - r.lo) <= 1e-9, `${k} placement achieves lo`);
    if (c.py_lo < 1e-6) for (let i = 0; i < 3; i++) assert.ok(Math.abs([r.fit.tx, r.fit.ty, r.fit.deg][i] - c.py_fit[i]) <= 1e-5, `${k} fit[${i}] JS vs Python`);
  }
  const SPEC_LO = { 'EC9 H1 +0.06 X': 0.06, 'EC10 H1 +0.10 X': 0.10, 'EC11 H1 +0.20 X': 0.20, 'EC12 H1 (0.15,0.20) =0.25': 0.25 };
  for (const [n, v] of Object.entries(SPEC_LO)) {
    check(close(results[n].lo, v, 1e-6), `${n} lower Ø`);
    check(close(Math.hypot(results[n].fit.tx, results[n].fit.ty), v / 2, 1e-6), `${n} set shifts d/2`);
  }
  check(results['EC10 H1 +0.10 X'].code === 'PASS', 'EC10 boundary PASS');
  check(2 * 0.06 > T_LO, 'EC9 fixed-zone misconception would fail');
  const rb2 = evaluate(oneHole(perp([0.10 + 1e-4, 0])));
  check(rb2.code === 'FAIL_LOWER' && disp(rb2.lo, 0.10) === '0.101', 'EC19 displays 0.101');
  check(evaluate(oneHole(perp([0.10 + 2.5e-10, 0]))).code === 'PASS', 'EC20 lower within EPS');
  const mv = 2 * RC * Math.sin(rad(0.1));
  check(close(mv, 0.101769), '0.2 deg corner move');
  check(close(results['EC7 rotate 0.2 deg'].lo, 0, 1e-6), 'rotation lower zero error');
  const TH_UP = (2 * Math.asin(R_UP / (2 * RC)) * 180) / Math.PI;
  check(close(TH_UP, 0.491309, 1e-5), 'rotation upper limit deg');
  check(close(2 * RC * Math.sin(rad(0.25)), 0.254422), '0.5deg move');
  check(evaluate(patternMove(0, 0, TH_UP)).code === 'PASS', 'EC21 rotation at limit');
  check(evaluate(patternMove(0, 0, TH_UP + 1e-4)).code === 'FAIL_UPPER', 'EC22 rotation past limit');
  assert.equal(disp(max(evaluate(patternMove(0, 0, TH_UP + 1e-4)).up), 0.5), '0.501');
  const cm = evaluate(patternMove(0.10, 0.05, 0.2));
  check(cm.code === 'PASS' && close(cm.lo, 0, 1e-6), 'EC23 translate+rotate PASS');
  check(close(max(cm.up), 0.410045, 1e-5), 'EC23 upper');
  check(close(cm.fit.deg, 0.2, 1e-5), 'fit recovers θ');
  check(evaluate(patternMove(0.25 + 2.5e-10, 0, 0)).code === 'PASS', 'EPS inside');
  check(evaluate(patternMove(0.25 + 1e-6, 0, 0)).code === 'FAIL_UPPER', 'just outside');
  const Z4 = [ZERO, ZERO, ZERO, ZERO];
  check(evaluate(Z4, [10.1, 10.1, 10.25, 10.1]).code === 'REJECT_SIZE', 'size reject');
  check(evaluate(Z4, [10.0, 10.2, 10.0, 10.2]).code === 'PASS', 'size limits ok');
  check(evaluate(Z4, undefined, 'MMC').code === 'UNSUPPORTED_V1', 'MMC unsupported');
  check(evaluate([[NaN, 0, 0, 0], ZERO, ZERO, ZERO]).code === 'INVALID_INPUT', 'NaN');
  const f2 = results['EC2 translate (0.12,0.16)'].fit;
  check(close(Math.hypot(f2.tx, f2.ty), 0.2, 1e-6), 'EC2 small zones shifted 0.20');
  const f6 = results['EC4 translate 0.30 diag'].fit;
  check(Math.hypot(f6.tx, f6.ty) + R_LO > R_UP, 'EC4 small zones poke outside big ones');
});

test('random patterns vs Python and scipy', () => {
  for (const [i, c] of FX.random.entries()) {
    const r = lowerFit(holesFromDev(c.devs)).r;
    check(c.scipy_r >= r - 1e-6 && Math.abs(c.scipy_r - r) <= 1e-5, `random ${i}: ${r} vs scipy ${c.scipy_r}`);
    assert.ok(Math.abs(r - c.py_r) <= 1e-5, `random ${i}: JS ${r} vs Python ${c.py_r}`);
  }
});

const EXP = { 'P0-NOMINAL': 'PASS', 'P1-AHA-SHIFT': 'PASS', 'P2-AHA-ROTATE': 'PASS', 'P3-PATTERN-OUT': 'FAIL_UPPER', 'P4-ONE-HOLE-OUT': 'FAIL_LOWER', 'P5-TILT-LEAN': 'FAIL_LOWER' };
test('presets (exact endpoints, spec §6)', () => {
  for (const p of PRESETS) check(evaluate(devsFromState(p)).code === EXP[p.id], `preset ${p.id}`);
  const p2 = holesFromDev(devsFromState(PRESETS.find((p) => p.id === 'P2-AHA-ROTATE')));
  const E = [[25.052512, 14.912825], [75.052207, 15.087358], [24.947793, 44.912642], [74.947488, 45.087175]];
  p2.forEach(([pb, pt], i) => check(close(pb[0], E[i][0], 1e-6) && close(pb[1], E[i][1], 1e-6) && pb[0] === pt[0] && pb[1] === pt[1], 'P2 endpoints'));
  // the §6 table endpoints, P1 / P3 / P4 / P5
  const H = (id) => holesFromDev(devsFromState(PRESETS.find((p) => p.id === id)));
  assert.ok(close(H('P1-AHA-SHIFT')[3][0][0], 75.12, 1e-12) && close(H('P1-AHA-SHIFT')[3][0][1], 45.16, 1e-12));
  assert.ok(close(H('P3-PATTERN-OUT')[0][1][0], 25.18, 1e-12) && close(H('P3-PATTERN-OUT')[0][1][1], 15.24, 1e-12));
  assert.deepEqual(H('P4-ONE-HOLE-OUT')[0], [[25.2, 15], [25.2, 15]]);
  assert.deepEqual(H('P5-TILT-LEAN')[0], [[25, 15], [25.12, 15]]);
  const diag = evaluate(devsFromState(EXTRA_PRESETS[0]));
  assert.equal(diag.code, 'FAIL_UPPER'); assert.equal(disp(max(diag.up), 0.5), '0.566');
});

test('readout: every hole tied at the max is named; the outlier is separate', () => {
  const p4 = evaluate(oneHole(perp([0.2, 0])));
  assert.deepEqual(p4.failLower, ['H1', 'H2', 'H3', 'H4']); assert.equal(p4.outlier, 'H1');
  const h3 = evaluate(oneHole(perp([0.2, 0]), 2));
  assert.deepEqual(h3.failLower, ['H1', 'H2', 'H3', 'H4']); assert.equal(h3.outlier, 'H3');
  assert.equal(evaluate(oneHole([0, 0, 0.12, 0])).outlier, 'H1');
  const lean = evaluate([[0, 0, 0.12, 0], [0, 0, 0.12, 0], [0, 0, 0.12, 0], [0, 0, 0.12, 0]]);
  assert.deepEqual(lean.failLower, ['H1', 'H2', 'H3', 'H4']); assert.equal(lean.outlier, null);
  const both = evaluate(oneHole(perp([0.3, 0])));
  assert.equal(both.code, 'FAIL_BOTH'); assert.deepEqual(both.failUpper, ['H1']); assert.equal(both.outlier, 'H1');
  const p3 = evaluate(patternMove(0.18, 0.24, 0));
  assert.deepEqual(p3.failUpper, ['H1', 'H2', 'H3', 'H4']); assert.deepEqual(p3.failLower, []); assert.equal(p3.outlier, null);
});

test('display: Lesson 1 round-up rule with the 1e-9 guard', () => {
  assert.equal(disp(0.410045, 0.5), '0.411'); // EC23 upper: measured rounds UP (spec table said 0.41)
  assert.equal(dispUp(0.410045), '0.411');
  assert.equal(disp(0.2035385, 0.5), '0.204'); // P2 / EC7
  assert.equal(disp(0.5000000005, 0.5), '0.5'); // within slack: PASS, shows the limit, never above it
  assert.equal(disp(0.25 * 2 + 2.5e-10 * 2, 0.5), '0.5');
  assert.equal(disp(0.5 + 2e-6, 0.5), '0.501'); // just outside: FAIL, strictly above
  assert.equal(disp(0.4999, 0.5), '0.5'); // pass rounding up to the limit is fine
  assert.equal(disp(0.1 + 1e-4, 0.1), '0.101');
  assert.equal(disp(0.13000000000000034), '0.13'); assert.equal(dispUp(0.13000000000000034), '0.13'); // float noise
  assert.equal(disp(-0.12), '−0.12'); assert.equal(disp(0), '0');
  // every edge case: a PASS never displays above its limit; a FAIL never displays at or below it
  for (const [k, c] of Object.entries(FX.cases)) {
    const r = evaluate(c.devs), u = Math.max(...r.up);
    const su = Number(disp(u, 0.5, r.allUp)), sl = Number(disp(r.lo, 0.1, r.loOk));
    assert.ok(r.allUp ? su <= 0.5 : su > 0.5, `${k} upper display ${su}`);
    assert.ok(r.loOk ? sl <= 0.1 : sl > 0.1, `${k} lower display ${sl}`);
  }
  const eps = evaluate(patternMove(0.25 + 2.5e-10, 0, 0));
  assert.equal(eps.code, 'PASS'); assert.equal(disp(Math.max(...eps.up), 0.5, eps.allUp), '0.5');
});

test('explainer citations: only the four topic names', async () => {
  const { EXPLAIN, TOPICS } = await import('../composite/src/copy.js');
  const allowed = new Set(Object.values(TOPICS));
  for (const l of EXPLAIN) {
    for (const c of l.citations) assert.ok(allowed.has(c), c);
    assert.equal(l.citations.length > 0, l.type === 'rule', l.text);
  }
  for (const t of allowed) assert.ok(EXPLAIN.some((l) => l.citations.includes(t)), `topic used: ${t}`);
});

test('all 164 Python checks ported', () => {
  assert.equal(FX.checks_py, 164);
  assert.equal(checks, 164, `ported ${checks} checks`);
});
