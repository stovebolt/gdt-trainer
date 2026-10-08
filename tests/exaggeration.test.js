import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toVisualXY, fromVisualDelta, visualZoneRadius } from '../src/exaggeration.js';

const TP = { x: 35, y: 30 };

test('exaggeration scales offsets and zone radius by the same factor', () => {
  const M = 24;
  const v = toVisualXY(TP, 0.125, 0, M);
  // a point on the real boundary is drawn exactly on the drawn zone boundary
  assert.equal(v.x - TP.x, visualZoneRadius(0.25, M));
  assert.deepEqual(fromVisualDelta(3, -1.5, M), { dx: 0.125, dy: -0.0625 });
  assert.deepEqual(toVisualXY(TP, 0.1, -0.1, 1), { x: 35.1, y: 29.9 });
});
