import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, fmtSigned, fmtAgainst, fmtMargin } from '../src/format.js';
import { evaluatePosition, EPS } from '../src/tolerance.js';

const TP = { x: 35, y: 30 };
const ev = (dx) => evaluatePosition({ truePosition: TP, bottom: { x: TP.x + dx, y: TP.y }, top: { x: TP.x + dx, y: TP.y }, tolerance: 0.25, thickness: 10 });

test('4-decimal basic formatting', () => {
  assert.equal(fmt(0.125), '0.1250');
  assert.equal(fmt(0.25), '0.2500');
  assert.equal(fmtSigned(-0.13), '−0.1300');
  assert.equal(fmtSigned(0.1), '+0.1000');
  assert.equal(fmtSigned(0), '+0.0000');
  assert.equal(fmtSigned(-0.00001), '+0.0000'); // no "−0.0000"
});

test('a value just over the limit never displays as the limit', () => {
  // r just over 0.125, each of these is OUT in the math
  for (const r of [0.1251, 0.12501, 0.125001, 0.1250001, 0.125 + 2e-9]) {
    const res = ev(r);
    assert.equal(res.inTolerance, false, `r=${r}`);
    const shownR = fmtAgainst(res.top.r, res.radius, res.top.inside);
    const shownD = fmtAgainst(res.deviation, res.tolerance, res.inTolerance);
    assert.ok(Number(shownR) > 0.125, `r=${r} shown as ${shownR}`);
    assert.ok(Number(shownD) > 0.25, `2r for r=${r} shown as ${shownD}`);
    assert.ok(fmtMargin(res.deviation, 0.25, false).startsWith('−'));
  }
  assert.equal(fmtAgainst(0.1251, 0.125, false), '0.1251'); // exact value is not bumped to 0.1252
  assert.equal(fmtAgainst(0.2502, 0.25, false), '0.2502');
  assert.equal(fmtAgainst(0.12501, 0.125, false), '0.1251');
  assert.equal(fmtAgainst(0.136015, 0.125, false), '0.1360'); // far from the limit: plain rounding
});

test('values on or within the limit never display above it', () => {
  for (const r of [0.125, 0.125 + EPS / 2, 0.12499999, 0.12496, 0.1]) {
    const res = ev(r);
    assert.equal(res.inTolerance, true, `r=${r}`);
    assert.ok(Number(fmtAgainst(res.top.r, 0.125, true)) <= 0.125);
    assert.ok(Number(fmtAgainst(res.deviation, 0.25, true)) <= 0.25);
  }
  assert.equal(fmtAgainst(0.125, 0.125, true), '0.1250');
  assert.equal(fmtMargin(0.25, 0.25, true), '+0.0000');
});

test('sweep across the boundary: displayed comparison always agrees with the verdict', () => {
  for (let i = -2000; i <= 2000; i++) {
    const r = 0.125 + i * 1.3e-8; // fine steps straddling the limit and the 1e-9 slack
    const res = ev(r);
    const shownR = Number(fmtAgainst(res.top.r, 0.125, res.top.inside));
    const shownD = Number(fmtAgainst(res.deviation, 0.25, res.inTolerance));
    assert.equal(shownR <= 0.125, res.inTolerance, `r=${r}`);
    assert.equal(shownD <= 0.25, res.inTolerance, `r=${r}`);
  }
});
