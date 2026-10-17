import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, fmtLimit, fmtUp, fmtSigned, fmtAgainst, fmtMargin } from '../src/format.js';
import { evaluatePosition, evaluatePart, EPS } from '../src/tolerance.js';

const TP = { x: 35, y: 30 };
const ev = (dx, tolerance = 0.25) => evaluatePosition({ truePosition: TP, bottom: { x: TP.x + dx, y: TP.y }, top: { x: TP.x + dx, y: TP.y }, tolerance, thickness: 10 });

test('metric display: max 3 decimals, trailing zeros dropped, leading zero kept (Will)', () => {
  assert.equal(fmt(0.25), '0.25');
  assert.equal(fmt(0.4), '0.4');
  assert.equal(fmt(10.15), '10.15');
  assert.equal(fmt(0.247), '0.247');
  assert.equal(fmt(10), '10');
  assert.equal(fmt(9.75), '9.75');
  assert.equal(fmt(0.125), '0.125');
  assert.equal(fmt(0), '0');
  assert.equal(fmtSigned(-0.13), '−0.13');
  assert.equal(fmtSigned(0.1), '+0.1');
  assert.equal(fmtSigned(0), '+0');
  assert.equal(fmtSigned(-0.0001), '+0'); // no "−0"
});

test('conservative directions: measured rounds up, limits/bonus round down, float noise ignored', () => {
  assert.equal(fmtUp(0.2461), '0.247');
  assert.equal(fmtUp(0.13000000000000034), '0.13'); // float noise is not "above"
  assert.equal(fmtUp(Math.hypot(0.1, 0.1)), '0.142'); // 0.14142...
  assert.equal(fmtLimit(0.4499), '0.449');
  assert.equal(fmtLimit(0.15000000000000036), '0.15');
  assert.equal(fmtLimit(0.39999999999999997), '0.4'); // float noise is not "below"
  assert.equal(fmtLimit(0.1255), '0.125');
});

test('a failing value never displays equal to or under the limit', () => {
  for (const r of [0.1251, 0.12501, 0.125001, 0.1250001, 0.125 + 2e-9, 0.12503]) {
    const res = ev(r);
    assert.equal(res.inTolerance, false, `r=${r}`);
    const shownR = Number(fmtAgainst(res.top.r, res.radius, false));
    const shownD = Number(fmtAgainst(res.deviation, res.tolerance, false));
    assert.ok(shownR > Number(fmtLimit(res.radius)), `r=${r} shown ${shownR}`);
    assert.ok(shownD > Number(fmtLimit(res.tolerance)), `2r for r=${r} shown ${shownD}`);
    assert.ok(fmtMargin(res.deviation, 0.25, false).startsWith('−'));
  }
  assert.equal(fmtAgainst(0.2502, 0.25, false), '0.251'); // rounds up: 3 decimals stay > limit
  assert.equal(fmtAgainst(0.12501, 0.125, false), '0.126');
  assert.equal(fmtAgainst(0.136015, 0.125, false), '0.137');
});

test('limit that is not a 3-decimal number: fail still shows above the displayed limit, pass never above it', () => {
  // allowed 0.2505 displays as 0.25 (rounded down)
  assert.equal(fmtLimit(0.2505), '0.25');
  assert.equal(fmtAgainst(0.2503, 0.2505, true), '0.25'); // IN: capped at the shown limit
  assert.equal(fmtAgainst(0.2506, 0.2505, false), '0.251'); // OUT: strictly above
  assert.equal(fmtMargin(0.2503, 0.2505, true), '+0');
});

test('values on or within the limit never display above it', () => {
  for (const r of [0.125, 0.125 + EPS / 2, 0.12499999, 0.12496, 0.1]) {
    const res = ev(r);
    assert.equal(res.inTolerance, true, `r=${r}`);
    assert.ok(Number(fmtAgainst(res.top.r, 0.125, true)) <= 0.125);
    assert.ok(Number(fmtAgainst(res.deviation, 0.25, true)) <= 0.25);
  }
  assert.equal(fmtAgainst(0.125, 0.125, true), '0.125');
  assert.equal(fmtAgainst(0.2461, 0.25, true), '0.247'); // reported position rounds up
  assert.equal(fmtMargin(0.25, 0.25, true), '+0');
});

test('sweep across the boundary: displayed comparison always agrees with the verdict', () => {
  for (const tol of [0.25, 0.4, 0.45, 0.12, 0.2505]) {
    for (let i = -3000; i <= 3000; i++) {
      const r = tol / 2 + i * 1.3e-8;
      const res = ev(r, tol);
      const shownR = Number(fmtAgainst(res.top.r, res.radius, res.top.inside));
      const shownD = Number(fmtAgainst(res.deviation, res.tolerance, res.inTolerance));
      const limR = Number(fmtLimit(res.radius));
      const limD = Number(fmtLimit(res.tolerance));
      assert.equal(shownR <= limR, res.top.inside, `tol ${tol} r=${r}`);
      assert.equal(shownD <= limD, res.inTolerance, `tol ${tol} 2r for r=${r}`);
      assert.ok(String(shownD).split('.')[1]?.length ?? 0 <= 3);
    }
  }
});

test('MMC readout values: bonus and allowed shown rounded down, 3 decimals', () => {
  const p = (size, stated = 0.25) => evaluatePart({ truePosition: TP, bottom: TP, top: TP, thickness: 10, stated, modifier: 'MMC', actualSize: size, mmc: 10, lmc: 10.2 });
  assert.deepEqual([fmtLimit(p(10.15).size.bonus), fmtLimit(p(10.15).size.allowed)], ['0.15', '0.4']);
  assert.deepEqual([fmtLimit(p(10.2).size.bonus), fmtLimit(p(10.2).size.allowed)], ['0.2', '0.45']);
  assert.deepEqual([fmtLimit(p(10.1234).size.bonus), fmtLimit(p(10.1234).size.allowed)], ['0.123', '0.373']);
  assert.equal(fmt(p(10.15).size.virtualCondition), '9.75');
  assert.equal(fmt(p(10.15, 0.3).size.virtualCondition), '9.7');
});
