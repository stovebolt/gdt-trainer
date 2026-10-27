// Auto-reframe: keep the hole (zone centre, axis endpoints) inside a free
// region of the 3D view after a large slide. Pure pixel math, no Three.js.

/**
 * @param {{x:number,y:number}[]} points key points in canvas px
 * @param {{l:number,t:number,r:number,b:number}} region where the points should sit
 * @param {{x:number,y:number}} center the camera target's screen position (dolly pivot)
 * @returns {null | {scale:number, dx:number, dy:number}} null if every point is already
 *   inside. Else: dolly out by `scale` (>= 1, about the target), THEN move the picture by
 *   (dx, dy) px (the minimal shift that brings the scaled box inside the region).
 */
export function reframePlan(points, region, center, { maxScale = 4, pad = 1.08, tol = 0.5 } = {}) {
  if (!points.length) return null;
  const box = (ps) => ({ l: Math.min(...ps.map((p) => p.x)), r: Math.max(...ps.map((p) => p.x)), t: Math.min(...ps.map((p) => p.y)), b: Math.max(...ps.map((p) => p.y)) });
  const bb = box(points);
  const rw = Math.max(1, region.r - region.l), rh = Math.max(1, region.b - region.t);
  if (bb.l >= region.l - tol && bb.r <= region.r + tol && bb.t >= region.t - tol && bb.b <= region.b + tol) return null;
  let scale = Math.max(1, (bb.r - bb.l) / rw, (bb.b - bb.t) / rh);
  if (scale > 1) scale = Math.min(maxScale, scale * pad);
  const sp = points.map((p) => ({ x: center.x + (p.x - center.x) / scale, y: center.y + (p.y - center.y) / scale }));
  const s = box(sp);
  const fit = (lo, hi, L, R) => (hi - lo > R - L ? (L + R) / 2 - (lo + hi) / 2 : lo < L ? L - lo : hi > R ? R - hi : 0);
  return { scale, dx: fit(s.l, s.r, region.l, region.r), dy: fit(s.t, s.b, region.t, region.b) };
}
