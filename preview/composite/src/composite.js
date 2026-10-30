// Lesson 2: composite position of a 4-hole pattern (RFS). Pure math, no DOM, no Three.js.
// Port of Sally's spec.md §3.5 / check_examples.py (lesson-02-composite-position).
//   upper  ⌖ ⌀0.50 |A|B|C|  zones fixed at true position, ⟂ A, z = 0..10
//   lower  ⌖ ⌀0.10 |A|      4 zones, rigid basic 50 × 30 set, ⟂ A, free tx, ty, θz
// Pass: every axis endpoint inside its upper zone AND inside its lower zone for ONE
// shared rigid placement of the lower set. Boundary IN, EPS = 1e-9.
export const EPS = 1e-9;
export const L = 10; // plate thickness (z of the top endpoint)
export const PLATE = Object.freeze({ x: 100, y: 60, z: 10 });
export const BASIC = Object.freeze([[25, 15], [75, 15], [25, 45], [75, 45]]); // H1..H4
export const CEN = Object.freeze([50, 30]);
export const T_UP = 0.5, T_LO = 0.1;
export const R_UP = T_UP / 2, R_LO = T_LO / 2;
export const SIZE_LO = 10.0, SIZE_HI = 10.2;
export const THETA_MAX = 0.05; // rad, lower-tier search half-range
export const HOLE_NAMES = Object.freeze(['H1', 'H2', 'H3', 'H4']);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const circ2 = (a, b) => [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist(a, b) / 2];
function circ3(a, b, c) {
  const [ax, ay] = a, [bx, by] = b, [cx, cy] = c;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-30) { // collinear: widest pair
    return [circ2(a, b), circ2(a, c), circ2(b, c)].reduce((m, t) => (t[1] > m[1] ? t : m));
  }
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return [[ux, uy], dist([ux, uy], a)];
}

/** Exact minimum enclosing circle, deterministic brute force (n = 8). Returns [centre, radius]. */
export function mec(pts) {
  const n = pts.length;
  const covers = (c, r) => pts.every((p) => dist(c, p) <= r + 1e-12);
  let best = n === 1 ? [pts[0], 0] : null;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const [c, r] = circ2(pts[i], pts[j]);
    if ((best === null || r < best[1]) && covers(c, r)) best = [c, r];
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const [c, r] = circ3(pts[i], pts[j], pts[k]);
    if ((best === null || r < best[1]) && covers(c, r)) best = [c, r];
  }
  return best ?? [pts[0], 0];
}

/** devs: 4 × [dxb, dyb, dxt, dyt] -> 4 × [P_bot, P_top] (absolute XY). */
export const holesFromDev = (devs) => devs.map((d, i) => [[BASIC[i][0] + d[0], BASIC[i][1] + d[1]], [BASIC[i][0] + d[2], BASIC[i][1] + d[3]]]);

export const upperRadii = (holes) => holes.map(([pb, pt], i) => Math.max(dist(pb, BASIC[i]), dist(pt, BASIC[i])));

/** v = P − C − R(θ)(b − C) for all 8 endpoints; set translation t covers them iff |v − t| ≤ r. */
export function residualPts(holes, th, use = null) {
  const c = Math.cos(th), s = Math.sin(th), v = [];
  holes.forEach(([pb, pt], i) => {
    if (use && !use[i]) return;
    const qx = BASIC[i][0] - CEN[0], qy = BASIC[i][1] - CEN[1];
    const rx = c * qx - s * qy, ry = s * qx + c * qy;
    for (const p of [pb, pt]) v.push([p[0] - CEN[0] - rx, p[1] - CEN[1] - ry]);
  });
  return v;
}
export const fTheta = (holes, th, use = null) => mec(residualPts(holes, th, use))[1];

/** Spec §3.5: 401-point θ grid on ±0.05 rad, golden-section refine, always test θ = 0.
 *  Returns { r, tx, ty, theta } (theta in rad). */
export function lowerFit(holes, grid = 401, iters = 200, use = null) {
  const ths = Array.from({ length: grid }, (_, i) => -THETA_MAX + (2 * THETA_MAX * i) / (grid - 1));
  const vals = ths.map((t) => fTheta(holes, t, use));
  let k = 0;
  for (let i = 1; i < grid; i++) if (vals[i] < vals[k]) k = i;
  let a = ths[Math.max(k - 1, 0)], b = ths[Math.min(k + 1, grid - 1)];
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a), x2 = a + g * (b - a);
  let f1 = fTheta(holes, x1, use), f2 = fTheta(holes, x2, use);
  for (let i = 0; i < iters; i++) {
    if (b - a < 1e-15) break;
    if (f1 <= f2) { b = x2; x2 = x1; f2 = f1; x1 = b - g * (b - a); f1 = fTheta(holes, x1, use); }
    else { a = x1; x1 = x2; f1 = f2; x2 = a + g * (b - a); f2 = fTheta(holes, x2, use); }
  }
  const cands = [[vals[k], ths[k]], [f1, x1], [f2, x2], [fTheta(holes, 0, use), 0]];
  cands.sort((p, q) => p[0] - q[0] || p[1] - q[1]); // same order as Python's min over (r, θ) tuples
  const [r, theta] = cands[0];
  const [[tx, ty]] = mec(residualPts(holes, theta, use));
  return { r, tx, ty, theta };
}

/** Lower-zone centre of hole i for a placement: q_i = C + t + R(θ)(b_i − C). */
export function lowerCentres({ tx, ty, theta }) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return BASIC.map(([bx, by]) => {
    const qx = bx - CEN[0], qy = by - CEN[1];
    return [CEN[0] + tx + c * qx - s * qy, CEN[1] + ty + s * qx + c * qy];
  });
}

/**
 * Verdict per spec §3.6: INVALID_INPUT | UNSUPPORTED_V1 | REJECT_SIZE | PASS | FAIL_UPPER | FAIL_LOWER | FAIL_BOTH.
 * up: per-hole upper Ø (2r), upOk per hole; lo: lower Ø; loOk; fit {tx, ty, theta, deg}; per-hole lower
 * endpoint distances (loR) for the failing-hole readout.
 */
export function evaluate(devs, sizes = [10.1, 10.1, 10.1, 10.1], modifier = 'RFS') {
  if (modifier !== 'RFS') return { code: 'UNSUPPORTED_V1' };
  const flat = [...(devs ?? []).flat(), ...(sizes ?? [])];
  if (!devs || devs.length !== 4 || devs.some((d) => d.length !== 4) || !sizes || sizes.length !== 4 || !flat.every(Number.isFinite) || sizes.some((s) => s <= 0)) return { code: 'INVALID_INPUT' };
  const holes = holesFromDev(devs);
  const ru = upperRadii(holes);
  const f = lowerFit(holes);
  const upOk = ru.map((r) => r <= R_UP + EPS / 2);
  const loOk = f.r <= R_LO + EPS / 2;
  const sizeOk = sizes.map((s) => SIZE_LO - EPS <= s && s <= SIZE_HI + EPS);
  const allUp = upOk.every(Boolean);
  const code = !sizeOk.every(Boolean) ? 'REJECT_SIZE' : allUp && loOk ? 'PASS' : !allUp && !loOk ? 'FAIL_BOTH' : !allUp ? 'FAIL_UPPER' : 'FAIL_LOWER';
  const q = lowerCentres(f);
  const loR = holes.map(([pb, pt], i) => Math.max(dist(pb, q[i]), dist(pt, q[i])));
  const loHoleOk = loR.map((r) => r <= R_LO + EPS / 2 + 1e-9); // per-hole, at the shared best fit (display)
  return {
    code, holes, sizes, sizeOk,
    up: ru.map((r) => 2 * r), upR: ru, upOk, allUp,
    lo: 2 * f.r, loR: f.r, loOk, loHoleR: loR, loHoleOk,
    fit: { tx: f.tx, ty: f.ty, theta: f.theta, deg: (f.theta * 180) / Math.PI }, lowerCentres: q,
    failUpper: HOLE_NAMES.filter((_, i) => !upOk[i]),
    failLower: loOk ? [] : lowerCulprits(holes, f.r, loR),
  };
}

/**
 * Which hole(s) to name when the lower row fails (readout only; never changes the verdict).
 * At the minimax fit several holes touch the same radius, so "farthest" alone would name all
 * four for one bad hole. Named: a hole whose own lean already needs more than ⌀0.10, or a hole
 * without which the other three would fit. If neither picks anyone, the farthest holes.
 */
export function lowerCulprits(holes, r, loR) {
  const lim = R_LO + EPS / 2;
  const lean = holes.map(([pb, pt]) => dist(pb, pt) / 2 > lim);
  const named = holes.map((_, i) => lean[i] || lowerFit(holes, 401, 200, holes.map((__, j) => j !== i)).r <= lim);
  const out = HOLE_NAMES.filter((_, i) => named[i]);
  return out.length ? out : HOLE_NAMES.filter((_, i) => loR[i] >= r - 1e-9);
}

/** Rigid move of the whole pattern about CEN (deg CCW): 4 perpendicular devs. */
export function patternMove(tx, ty, deg) {
  const th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  return BASIC.map(([bx, by]) => {
    const qx = bx - CEN[0], qy = by - CEN[1];
    const nx = CEN[0] + c * qx - s * qy + tx, ny = CEN[1] + s * qx + c * qy + ty;
    return [nx - bx, ny - by, nx - bx, ny - by];
  });
}
export const perp = (d) => [d[0], d[1], d[0], d[1]];
export const ZERO = Object.freeze([0, 0, 0, 0]);
export const oneHole = (dev, k = 0) => BASIC.map((_, i) => (i === k ? [...dev] : [...ZERO]));

/** Spec display rule: 3 decimals, trailing zeros dropped; a failing value rounds AWAY from the limit. */
export function disp(x, limit = null) {
  let v = Math.round(x * 1000) / 1000;
  if (limit !== null && x > limit + EPS && v <= limit) {
    v = Math.ceil(x * 1000 - 1e-9) / 1000;
    if (v <= limit) v = limit + 0.001;
  }
  const s = Math.abs(v).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return (v < 0 && s !== '0' ? '−' : '') + s;
}

export const VERDICT_TEXT = Object.freeze({
  PASS: 'PASS', FAIL_UPPER: 'FAIL: upper row', FAIL_LOWER: 'FAIL: lower row', FAIL_BOTH: 'FAIL: both rows',
  REJECT_SIZE: 'REJECT: size', INVALID_INPUT: 'INVALID INPUT', UNSUPPORTED_V1: 'UNSUPPORTED (v1 is RFS only)',
});
