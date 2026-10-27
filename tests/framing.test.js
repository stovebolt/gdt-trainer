import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reframePlan } from '../src/framing.js';
import { maxMagnificationFor, clampMagnification, PHONE_MAX_MAGNIFICATION } from '../src/exaggeration.js';

const region = { l: 100, t: 120, r: 240, b: 260 };
const c = { x: 195, y: 190 };

test('inside the region: nothing to do', () => {
  assert.equal(reframePlan([{ x: 150, y: 150 }, { x: 180, y: 220 }], region, c), null);
  assert.equal(reframePlan([], region, c), null);
});

test('outside: minimal pan, no zoom when the box fits', () => {
  const p = reframePlan([{ x: 300, y: 150 }, { x: 330, y: 200 }], region, c);
  assert.equal(p.scale, 1); assert.equal(p.dx, 240 - 330); assert.equal(p.dy, 0);
  const q = reframePlan([{ x: 150, y: 20 }, { x: 160, y: 60 }], region, c);
  assert.equal(q.scale, 1); assert.equal(q.dx, 0); assert.equal(q.dy, 120 - 20);
});

test('box larger than the region: dolly out about the target, then the picture ends inside', () => {
  const pts = [{ x: 20, y: 100 }, { x: 420, y: 300 }];
  const p = reframePlan(pts, region, c);
  assert.ok(p.scale > 2.8 && p.scale <= 4);
  for (const pt of pts) {
    const x = c.x + (pt.x - c.x) / p.scale + p.dx, y = c.y + (pt.y - c.y) / p.scale + p.dy;
    assert.ok(x >= region.l - 1 && x <= region.r + 1 && y >= region.t - 1 && y <= region.b + 1, `${x},${y}`);
  }
});

test('result is idempotent: applying the plan leaves nothing more to do', () => {
  for (const pts of [[{ x: 500, y: 400 }, { x: 520, y: 430 }], [{ x: -80, y: 60 }, { x: 40, y: 90 }]]) {
    const p = reframePlan(pts, region, c);
    const moved = pts.map((pt) => ({ x: c.x + (pt.x - c.x) / p.scale + p.dx, y: c.y + (pt.y - c.y) / p.scale + p.dy }));
    assert.equal(reframePlan(moved, region, c), null);
  }
});

test('phones cap the exaggeration at ×40, other screens keep ×80', () => {
  assert.equal(PHONE_MAX_MAGNIFICATION, 40);
  assert.equal(maxMagnificationFor(true), 40); assert.equal(maxMagnificationFor(false), 80);
  assert.equal(clampMagnification(80, true), 40); assert.equal(clampMagnification(80, false), 80);
  assert.equal(clampMagnification(24, true), 24); assert.equal(clampMagnification(0, true), 1);
});
