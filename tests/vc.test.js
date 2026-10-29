import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vcSize, vcLockRadius, vcState, vcMagnification, vcWallRadius, VC_RFS_NOTE } from '../src/vc.js';
import { evaluatePart, lockDrag, allowedTolerance } from '../src/tolerance.js';

const TP = { x: 35, y: 30 }, H = 10, mmc = 10, lmc = 10.2;
const part = (o) => evaluatePart({ truePosition: TP, thickness: H, mmc, lmc, datums: { A: true, B: true, C: true }, ...o });

test('VC size follows stated tolerance + modifier, never the hole size', () => {
  assert.deepEqual(vcSize({ stated: 0.25, modifier: 'MMC', mmc, lmc }), { kind: 'pin', vc: 9.75, resultant: null });
  assert.deepEqual(vcSize({ stated: 0.25, modifier: 'LMC', mmc, lmc }), { kind: 'boundary', vc: 10.45, resultant: 9.55 });
  assert.equal(vcSize({ stated: 0.4, modifier: 'MMC', mmc, lmc }).vc, 9.6);
  for (const size of [10, 10.1, 10.2]) assert.equal(vcState({ stated: 0.25, modifier: 'MMC', size, mmc, lmc, rBottom: 0, rTop: 0 }).vc, 9.75);
});

test('RFS: no virtual condition, view disabled with the note', () => {
  assert.equal(vcSize({ stated: 0.25, modifier: 'RFS', mmc, lmc }), null);
  const s = vcState({ stated: 0.25, modifier: 'RFS', size: 10.1, mmc, lmc, rBottom: 0, rTop: 0 });
  assert.equal(s.applies, false);
  assert.equal(s.note, 'Virtual condition applies at MMC or LMC.');
  assert.equal(VC_RFS_NOTE, s.note);
});

test('lock radius = (d − 9.75)/2 at MMC, (10.45 − d)/2 at LMC, = allowed/2 inside the size limits', () => {
  for (const size of [10, 10.05, 10.1, 10.15, 10.2]) {
    const m = vcLockRadius({ stated: 0.25, modifier: 'MMC', size, mmc, lmc });
    const l = vcLockRadius({ stated: 0.25, modifier: 'LMC', size, mmc, lmc });
    assert.ok(Math.abs(m - (size - 9.75) / 2) < 1e-12 && Math.abs(l - (10.45 - size) / 2) < 1e-12);
    for (const [mod, r] of [['MMC', m], ['LMC', l]]) {
      const allowed = allowedTolerance({ stated: 0.25, modifier: mod, actualSize: size, mmc, lmc }).allowed;
      assert.ok(Math.abs(2 * r - allowed) < 1e-9, `${mod} ${size}: ${2 * r} vs ${allowed}`);
    }
  }
});

test('VC view and bonus-zone view never disagree on IN / OUT (grid of sizes, stated, offsets, tilts; boundary is IN)', () => {
  let n = 0;
  for (const modifier of ['MMC', 'LMC']) for (const stated of [0, 0.1, 0.25, 0.5]) for (let size = 10; size <= 10.2001; size += 0.01) {
    const d = Math.round(size * 1000) / 1000;
    const R = vcLockRadius({ stated, modifier, size: d, mmc, lmc });
    const rs = [0, R * 0.5, R - 1e-4, R, R + 1e-4, R + 0.01, 0.3].filter((r) => r >= 0);
    for (const rb of rs) for (const rt of rs) for (const ang of [0, 0.7, 2.1]) {
      const bottom = { x: TP.x + rb * Math.cos(ang), y: TP.y + rb * Math.sin(ang) };
      const top = { x: TP.x - rt * Math.sin(ang), y: TP.y + rt * Math.cos(ang) };
      const res = part({ bottom, top, stated, modifier, actualSize: d });
      if (res.verdict === 'INVALID_TOL') continue;
      const v = vcState({ stated, modifier, size: d, mmc, lmc, rBottom: res.bottom.r, rTop: res.top.r });
      assert.equal(v.inside, res.verdict === 'IN', `${modifier} ⌀${stated} d=${d} rb=${rb} rt=${rt}: vc ${v.inside} zone ${res.verdict}`);
      n++;
    }
  }
  assert.ok(n > 5000, `cases ${n}`);
});

test('exact contact counts as IN in both views; clearance = leftover tolerance', () => {
  const R = 0.175; // ⌀10.1 at MMC: (10.1 − 9.75)/2
  const res = part({ bottom: { x: TP.x + R, y: TP.y }, top: { x: TP.x + R, y: TP.y }, stated: 0.25, modifier: 'MMC', actualSize: 10.1 });
  const v = vcState({ stated: 0.25, modifier: 'MMC', size: 10.1, mmc, lmc, rBottom: res.bottom.r, rTop: res.top.r });
  assert.equal(res.verdict, 'IN'); assert.equal(v.inside, true); assert.equal(v.clearanceShown, 0);
  const v2 = vcState({ stated: 0.25, modifier: 'MMC', size: 10.1, mmc, lmc, rBottom: 0.1, rTop: 0.05 });
  assert.equal(v2.clearanceShown, 0.075); assert.equal(v2.leftoverDiameterShown, 0.15); // allowed 0.35 − position 0.2
});

test('lock (impermeable VC): a drag stops at contact, the wall never crosses the VC', () => {
  for (const [modifier, size] of [['MMC', 10.1], ['MMC', 10], ['LMC', 10.05], ['LMC', 10.2]]) {
    const R = vcLockRadius({ stated: 0.25, modifier, size, mmc, lmc });
    let p = { dx: 0, dy: 0 };
    for (let i = 1; i <= 60; i++) p = lockDrag({ prev: p, next: { dx: p.dx + 0.01, dy: p.dy + 0.004 }, allowed: Math.max(0, 2 * R) });
    const r = Math.hypot(p.dx, p.dy);
    const v = vcState({ stated: 0.25, modifier, size, mmc, lmc, rBottom: r, rTop: r });
    assert.ok(v.inside, `${modifier} ${size}: crossed (r ${r} > ${R})`);
    assert.ok(R - r < 0.002, `${modifier} ${size}: stopped short of contact (gap ${R - r})`);
  }
});

test('VC drawing: wall and VC touch exactly when the math says contact (same ×m for gap and offsets)', () => {
  for (const modifier of ['MMC', 'LMC']) {
    const s = vcSize({ stated: 0.25, modifier, mmc, lmc });
    const m = vcMagnification({ magnification: 24, stated: 0.25, modifier, mmc, lmc, sizeMin: 9.95, sizeMax: 10.25 });
    assert.ok(m >= 1 && m <= 24);
    for (const size of [9.95, 10, 10.1, 10.25]) {
      const R = vcLockRadius({ stated: 0.25, modifier, size, mmc, lmc });
      const wall = vcWallRadius({ vc: s.vc, kind: s.kind, lockRadius: R, m });
      assert.ok(wall >= 1.5 - 1e-9 && wall <= 22 + 1e-9, `${modifier} ${size} wall ${wall}`);
      const gapDrawn = s.kind === 'pin' ? wall - R * m - s.vc / 2 : s.vc / 2 - (R * m + wall);
      assert.ok(Math.abs(gapDrawn) < 1e-9); // axis drawn at R·m: wall just touches the VC
    }
  }
  assert.equal(vcMagnification({ magnification: 24, stated: 0.25, modifier: 'RFS', mmc, lmc, sizeMin: 9.95, sizeMax: 10.25 }), 24);
});
