import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  datumFreedom, fitZone, evaluatePart, evaluatePositionDatums, evaluatePosition, lockDragFree, lockDrag,
  translateAxisFree, translateAxis, notJudged, allowedTolerance, LOCK_EPS,
} from '../src/tolerance.js';
import { SPEC } from '../src/config.js';
import { fmtUp, fmtLimit } from '../src/format.js';

const H = SPEC.hole;
const TP = { x: 35, y: 30 };
const P = (bottom, top, datums, extra = {}) => evaluatePart({
  truePosition: TP,
  bottom: { x: TP.x + bottom[0], y: TP.y + bottom[1] },
  top: { x: TP.x + top[0], y: TP.y + top[1] },
  thickness: 10, stated: 0.25, modifier: 'RFS', actualSize: 10.1, mmc: H.mmc, lmc: H.lmc, datums, ...extra,
});
const D = (s) => ({ A: s.includes('A'), B: s.includes('B'), C: s.includes('C') });
const pt = (a) => ({ dx: a[0], dy: a[1] });
// seeded rng
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const rr = (a) => (rnd() * 2 - 1) * a;

test('freedom table: Sally\'s rules for all 8 combinations', () => {
  const f = (s) => { const x = datumFreedom(D(s)); return [x.freeX, x.freeY, x.floats, x.perpOnly, x.aDropped].map(Number).join(''); };
  assert.equal(f('ABC'), '00000');
  assert.equal(f('AB'), '01000'); // C dropped: slides in Y
  assert.equal(f('AC'), '10000'); // B dropped: slides in X
  assert.equal(f('A'), '11010');  // B+C dropped: X and Y, perpendicular to A
  assert.equal(f('BC'), '00001'); // A alone dropped: no new freedom, note only
  assert.equal(f('B'), '01001');
  assert.equal(f('C'), '10001');
  assert.equal(f(''), '00100');   // all dropped: floats
  assert.deepEqual(datumFreedom().kept, ['A', 'B', 'C']);
  assert.deepEqual(datumFreedom(D('AC')).kept, ['A', 'C']);
});

test('all references kept (or only A dropped) is exactly the old evaluatePosition', () => {
  for (let i = 0; i < 200; i++) {
    const b = [rr(0.3), rr(0.3)], t = [rr(0.3), rr(0.3)];
    const base = evaluatePosition({ truePosition: TP, bottom: { x: TP.x + b[0], y: TP.y + b[1] }, top: { x: TP.x + t[0], y: TP.y + t[1] }, tolerance: 0.25, thickness: 10 });
    for (const d of [undefined, D('ABC'), D('BC')]) {
      const r = P(b, t, d);
      assert.equal(r.deviation, base.deviation);
      assert.equal(r.inTolerance, base.inTolerance);
      assert.equal(r.bottom.r, base.bottom.r);
      assert.deepEqual(r.zone, { dx: 0, dy: 0 });
    }
  }
});

test('fitZone is the exact min-max centre (matches brute force on each free set)', () => {
  const brute = (b, t, fx, fy) => {
    let best = Infinity;
    const R = 0.6, n = 300;
    for (let i = 0; i <= (fx ? n : 0); i++) for (let j = 0; j <= (fy ? n : 0); j++) {
      const cx = fx ? -R + (2 * R * i) / n : 0, cy = fy ? -R + (2 * R * j) / n : 0;
      best = Math.min(best, Math.max(Math.hypot(b[0] - cx, b[1] - cy), Math.hypot(t[0] - cx, t[1] - cy)));
    }
    return best;
  };
  for (let i = 0; i < 60; i++) {
    const b = [rr(0.4), rr(0.4)], t = [rr(0.4), rr(0.4)];
    for (const [fx, fy] of [[1, 0], [0, 1], [1, 1], [0, 0]]) {
      const z = fitZone({ bottom: pt(b), top: pt(t), freeX: !!fx, freeY: !!fy });
      const bf = brute(b, t, fx, fy);
      assert.ok(z.r <= bf + 1e-12, `closed form not worse than brute (${z.r} vs ${bf})`);
      assert.ok(z.r >= bf - 5e-3, 'and not suspiciously better');
      assert.ok(Math.abs(z.r - Math.max(z.rBottom, z.rTop)) < 1e-15);
    }
  }
});

test('C dropped: zone slides in Y; only the X spread (and the Y difference) matter', () => {
  // both ends 0.2 above true position: with C it is 0.4 ⌀ out; with C dropped it slides and is perfect
  const a = P([0, 0.2], [0, 0.2], D('ABC')), c = P([0, 0.2], [0, 0.2], D('AB'));
  assert.equal(a.verdict, 'OUT'); assert.ok(a.deviation > 0.39);
  assert.equal(c.verdict, 'IN'); assert.equal(c.deviation, 0);
  assert.ok(Math.abs(c.zone.dy - 0.2) < 1e-12 && c.zone.dx === 0);
  // X offset is NOT freed: still out
  assert.equal(P([0.2, 0], [0.2, 0], D('AB')).verdict, 'OUT');
  // opposite Y offsets at the ends: zone centres between, ⌀ = |Δy| ... (here 0.2 → r 0.1)
  const t = P([0, -0.1], [0, 0.1], D('AB'));
  assert.ok(Math.abs(t.deviation - 0.2) < 1e-12 && t.verdict === 'IN');
});

test('B dropped: zone slides in X only', () => {
  assert.equal(P([0.3, 0], [0.3, 0], D('AC')).verdict, 'IN');
  assert.equal(P([0, 0.3], [0, 0.3], D('AC')).verdict, 'OUT');
  const r = P([0.3, 0.05], [0.3, 0.05], D('AC'));
  assert.ok(Math.abs(r.zone.dx - 0.3) < 1e-12);
  // the unfree axis still counts: r includes the Y offset from the centre
  assert.ok(Math.abs(r.top.r - 0.05) < 1e-12);
});

test('B and C dropped (A only): slides in X and Y and acts like a perpendicularity control', () => {
  // translated 1 mm in any direction: perfect (perpendicular to A)
  assert.equal(P([0.9, -0.7], [0.9, -0.7], D('A')).verdict, 'IN');
  // tilted: ⌀ position = lateral spread of the endpoints, same as perpendicularity of the axis to A
  const tilt = P([-0.1, 0], [0.1, 0], D('A'));
  assert.ok(Math.abs(tilt.deviation - 0.2) < 1e-12 && tilt.verdict === 'IN');
  assert.equal(P([-0.13, 0], [0.13, 0], D('A')).verdict, 'OUT');
  const diag = P([-0.09, -0.09], [0.09, 0.09], D('A')); // spread 0.2546 > 0.25
  assert.equal(diag.verdict, 'OUT');
  for (let i = 0; i < 200; i++) {
    const b = [rr(1), rr(1)], t = [rr(1), rr(1)];
    const r = P(b, t, D('A'));
    assert.ok(Math.abs(r.deviation - Math.hypot(t[0] - b[0], t[1] - b[1])) < 1e-12, 'deviation = spread');
  }
});

test('A, B and C all dropped: floats free: NO_DATUMS, accepts anything, never IN/OUT', () => {
  const r = P([5, -4], [-6, 3], D(''));
  assert.equal(r.verdict, 'NO_DATUMS'); assert.ok(notJudged(r.verdict));
  assert.equal(r.deviation, 0); assert.equal(r.bottom.inside, true);
  assert.equal(r.freedom.floats, true);
  assert.equal(P([0, 0], [0, 0], D('')).verdict, 'NO_DATUMS');
  // size reject and invalid tolerance still win
  assert.equal(P([0, 0], [0, 0], D(''), { actualSize: 9.0 }).verdict, 'REJECT_SIZE');
  assert.equal(P([0, 0], [0, 0], D(''), { stated: 0 }).verdict, 'INVALID_TOL');
});

test('dropping references never makes a good part worse (monotone), except that nothing changes for A alone', () => {
  for (let i = 0; i < 400; i++) {
    const b = [rr(0.5), rr(0.5)], t = [rr(0.5), rr(0.5)];
    const all = P(b, t, D('ABC')).deviation;
    for (const s of ['AB', 'AC', 'A', 'BC', 'B', 'C']) {
      const d = P(b, t, D(s)).deviation;
      assert.ok(d <= all + 1e-12, s);
    }
    assert.ok(P(b, t, D('A')).deviation <= P(b, t, D('AB')).deviation + 1e-12);
    assert.ok(P(b, t, D('A')).deviation <= P(b, t, D('AC')).deviation + 1e-12);
  }
});

test('MMC / LMC bonus applies to the slid zone and rounding stays conservative', () => {
  // MMC: hole at ⌀10.2 → bonus 0.2: allowed 0.45
  const m = P([0, 0.2], [0, 0.2], D('AB'), { modifier: 'MMC', actualSize: 10.2 });
  assert.equal(m.verdict, 'IN'); assert.ok(Math.abs(m.tolerance - 0.45) < 1e-12);
  const m2 = P([0.226, 0], [-0.226, 0], D('AB'), { modifier: 'MMC', actualSize: 10.2 }); // spread 0.452 > 0.45, X not freed
  assert.equal(m2.verdict, 'OUT');
  const l = P([0, 0], [0.4, 0], D('A'), { modifier: 'LMC', actualSize: 10.1 });
  assert.equal(l.verdict, 'OUT'); // LMC bonus 0.1 → allowed 0.35 < spread 0.4
  assert.equal(P([0, 0], [0.3, 0], D('A'), { modifier: 'LMC', actualSize: 10.1 }).verdict, 'IN');
  // A failing value never displays ≤ its limit (measured rounds up, allowed rounds down)
  for (let i = 0; i < 500; i++) {
    const b = [rr(0.25), rr(0.25)], t = [rr(0.25), rr(0.25)];
    for (const s of ['AB', 'AC', 'A']) {
      const r = P(b, t, D(s));
      if (r.verdict === 'OUT') assert.ok(Number(fmtUp(r.deviation)) > Number(fmtLimit(r.tolerance)) || r.deviation > r.tolerance, 'OUT is visibly over');
      if (r.verdict === 'OUT') assert.ok(Number(fmtUp(r.deviation)) >= Number(fmtLimit(r.tolerance)));
    }
  }
  const exact = P([0, 0.125 + 1e-4], [0, 0.125 + 1e-4], D('ABC'));
  assert.equal(exact.verdict, 'OUT');
});

// ---------------------------------------------------------------------------
// Lock in tolerance with freed axes
// ---------------------------------------------------------------------------
const FREE = { AB: { x: false, y: true }, AC: { x: true, y: false }, A: { x: true, y: true }, ABC: {} };
const fit = (b, t, f) => fitZone({ bottom: b, top: t, freeX: !!f.x, freeY: !!f.y }).r;

test('lockDragFree with nothing free agrees with lockDrag (same disc, to the grid; the app uses lockDrag itself)', () => {
  for (let i = 0; i < 200; i++) {
    const prev = { dx: rr(0.08), dy: rr(0.08) }, next = { dx: rr(0.5), dy: rr(0.5) };
    const a = lockDragFree({ prev, next, other: pt([0, 0]), allowed: 0.25, free: {} }), b = lockDrag({ prev, next, allowed: 0.25 });
    assert.ok(Math.hypot(a.dx, a.dy) <= 0.125 - LOCK_EPS + 1e-12 && Math.hypot(a.dx - b.dx, a.dy - b.dy) < 2.2e-3);
  }
});

test('lockDragFree keeps every drag IN (fuzz, all freedoms), moves freely along the free axis, never sticks', () => {
  for (const [name, free] of Object.entries(FREE)) for (const allowed of [0.25, 0.45, 0.07, 0]) {
    let b = pt([0, 0]), t = pt([0, 0]);
    for (let i = 0; i < 400; i++) {
      const next = { dx: rr(2), dy: rr(2) };
      if (rnd() < 0.5) b = lockDragFree({ prev: b, next, other: t, allowed, free });
      else t = lockDragFree({ prev: t, next, other: b, allowed, free });
      assert.ok(fit(b, t, free) <= allowed / 2 - LOCK_EPS + 1e-9 || allowed === 0 && fit(b, t, free) < 1e-9, `${name} ${allowed} fit ${fit(b, t, free)}`);
      const v = evaluatePositionDatums({ truePosition: TP, bottom: { x: TP.x + b.dx, y: TP.y + b.dy }, top: { x: TP.x + t.dx, y: TP.y + t.dy }, tolerance: allowed, thickness: 10, datums: D(name) });
      if (allowed > 0) assert.ok(v.inTolerance, `${name} ${allowed} stays in`);
    }
  }
});

test('lockDragFree: the freed axis has no wall (zone slides), the held axis does', () => {
  // C dropped (Y free): bottom can go 1 mm in Y if top follows... drag bottom alone: Y wall is allowed (spread), X wall is the zone
  let b = pt([0, 0]), t = pt([0, 0]);
  for (let i = 1; i <= 40; i++) {
    b = lockDragFree({ prev: b, next: { dx: 0, dy: 0.05 * i }, other: t, allowed: 0.25, free: FREE.AB });
    t = lockDragFree({ prev: t, next: { dx: 0, dy: 0.05 * i }, other: b, allowed: 0.25, free: FREE.AB });
  }
  assert.ok(b.dy > 1.9 && t.dy > 1.9, 'both ends followed the slide to 2 mm in Y');
  const x = lockDragFree({ prev: b, next: { dx: 0.5, dy: b.dy }, other: t, allowed: 0.25, free: FREE.AB });
  assert.ok(Math.abs(x.dx) <= 0.125, 'X is still walled');
  // A only: a lone endpoint may go 2L = 0.25 from the other (perpendicularity wall)
  const e = lockDragFree({ prev: pt([0, 0]), next: pt([1, 0]), other: pt([0, 0]), allowed: 0.25, free: FREE.A });
  assert.ok(Math.abs(e.dx - (0.25 - 2 * LOCK_EPS)) < 2e-3 && e.dy === 0);
});

test('lockDragFree: an outside endpoint may only come inward (never worse)', () => {
  for (const free of Object.values(FREE)) for (let i = 0; i < 100; i++) {
    const prev = { dx: rr(1), dy: rr(1) }, other = { dx: rr(0.05), dy: rr(0.05) }, next = { dx: rr(1), dy: rr(1) };
    const out = lockDragFree({ prev, next, other, allowed: 0.1, free });
    assert.ok(fit(out, other, free) <= Math.max(fit(prev, other, free), 0.05 - LOCK_EPS) + 1e-9);
  }
});

test('translateAxisFree: free axis has only the box; the held axis is limited; tilt is preserved', () => {
  const bottom = pt([-0.05, 0]), top = pt([0.05, 0]);
  const y = translateAxisFree({ bottom, top, delta: pt([0, 1.5]), allowed: 0.25, free: FREE.AB, maxDev: 2 });
  assert.equal(y.delta.dy, 1.5, 'Y free: moves all the way');
  assert.ok(Math.abs(translateAxisFree({ bottom, top, delta: pt([1.5, 0]), allowed: 0.25, free: FREE.AB, maxDev: 2 }).delta.dx) <= 0.125 - 0.05 + 1e-9);
  const xy = translateAxisFree({ bottom, top, delta: pt([1.9, -1.9]), allowed: 0.25, free: FREE.A, maxDev: 2 });
  assert.ok(xy.delta.dx > 1.8 && xy.delta.dy < -1.8, 'both free: box only');
  assert.ok(Math.abs((xy.top.dx - xy.bottom.dx) - 0.1) < 1e-9, 'tilt preserved');
  // none free = translateAxis
  assert.deepEqual(translateAxisFree({ bottom, top, delta: pt([0.3, 0.1]), allowed: 0.25, free: {}, maxDev: 2 }), translateAxis({ bottom, top, delta: pt([0.3, 0.1]), allowed: 0.25, maxDev: 2 }));
  // box respected
  const box = translateAxisFree({ bottom: pt([1.9, 0]), top: pt([1.9, 0]), delta: pt([1, 0]), allowed: 0.25, free: FREE.AC, maxDev: 2 });
  assert.ok(box.bottom.dx <= 2 + 1e-12);
});

test('translateAxisFree fuzz: stays IN for every freedom', () => {
  for (const [name, free] of Object.entries(FREE)) for (let i = 0; i < 150; i++) {
    const g3 = (p) => ({ dx: Math.round(p.dx * 1e3) / 1e3, dy: Math.round(p.dy * 1e3) / 1e3 }); // app positions sit on the 0.001 grid
    const a = lockDragFree({ prev: pt([0, 0]), next: g3(pt([rr(0.1), rr(0.1)])), other: pt([0, 0]), allowed: 0.25, free });
    const b = lockDragFree({ prev: pt([0, 0]), next: g3(pt([rr(0.1), rr(0.1)])), other: a, allowed: 0.25, free });
    const r = translateAxisFree({ bottom: a, top: b, delta: pt([rr(2), rr(2)]), allowed: 0.25, free, maxDev: 2 });
    assert.ok(fit(r.bottom, r.top, free) <= 0.125 - LOCK_EPS + 1e-9, name);
  }
});

// ---------------------------------------------------------------------------
// Display strings
// ---------------------------------------------------------------------------
import { fcfHTML, datumSummary, DATUM_NOTES } from '../src/fcf.js';
import { STATUS, DATUM_SHRINK_NOTE } from '../src/ui.js';

test('FCF drops the cells of dropped references', () => {
  const cells = (d) => [...fcfHTML({ stated: 0.25, modifier: 'RFS', datums: d }).matchAll(/<td>([ABC])<\/td>/g)].map((m) => m[1]).join('');
  assert.equal(cells(undefined), 'ABC');
  assert.equal(cells(D('ABC')), 'ABC');
  assert.equal(cells(D('AB')), 'AB');
  assert.equal(cells(D('AC')), 'AC');
  assert.equal(cells(D('A')), 'A');
  assert.equal(cells(D('BC')), 'BC');
  assert.equal(cells(D('')), '');
  assert.match(fcfHTML({ stated: 0.25, modifier: 'MMC', datums: D('AB') }), /⌀0\.25<svg class="mmcsym"/); // modifier still shown
});

test('datumSummary: wording for every case (Sally\'s rules)', () => {
  assert.equal(datumSummary(D('ABC')).badge, '');
  assert.equal(datumSummary(D('ABC')).slide, '');
  assert.equal(datumSummary(D('AB'), { dx: 0, dy: 0.2 }).badge, 'C dropped: zone slides in Y');
  assert.equal(datumSummary(D('AB'), { dx: 0, dy: 0.2 }).slide, 'zone slides in Y · centre dy +0.2');
  assert.equal(datumSummary(D('AC')).badge, 'B dropped: zone slides in X');
  assert.equal(datumSummary(D('A')).badge, 'B, C dropped: zone slides in X and Y');
  assert.equal(datumSummary(D('A')).note, DATUM_NOTES.perp);
  assert.match(DATUM_NOTES.perp, /perpendicularity/);
  assert.equal(datumSummary(D('BC')).note, 'Dropping A alone changes nothing visible here.');
  assert.equal(datumSummary(D('BC')).slide, '');
  assert.equal(datumSummary(D('')).note, DATUM_NOTES.floats);
  assert.match(DATUM_NOTES.floats, /means nothing/);
  assert.equal(STATUS.NO_DATUMS, 'NO DATUMS');
  assert.match(DATUM_SHRINK_NOTE, /datum restored/);
});
