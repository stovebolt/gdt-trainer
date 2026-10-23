// Pure tolerance math for a cylindrical position tolerance zone on a hole
// (RFS, no material condition modifier). NO Three.js dependency, so it can be
// unit-tested with `node --test`.
//
// Units: millimetres. Frame: datum reference frame with origin at the
// intersection of datums A, B, C; +Z normal to datum A (up), X from datum B,
// Y from datum C. See ZONE.md for the full derivation and assumptions.

/** Floating-point slack (mm). The zone boundary itself counts as IN. */
export const EPS = 1e-9;

/**
 * Where a straight 3D line (through points p and q) crosses the planes
 * z = zLow and z = zHigh. Used to get the actual axis endpoints at the
 * bottom and top of the tolerance zone.
 * @returns {{bottom:{x,y,z}, top:{x,y,z}}}
 */
export function crossingsAtZ(p, q, zLow, zHigh) {
  assertFinite({ px: p.x, py: p.y, pz: p.z, qx: q.x, qy: q.y, qz: q.z, zLow, zHigh });
  const dz = q.z - p.z;
  if (Math.abs(dz) < EPS) throw new RangeError('axis is parallel to datum A; it never crosses the zone ends');
  const at = (z) => {
    const s = (z - p.z) / dz;
    return { x: p.x + s * (q.x - p.x), y: p.y + s * (q.y - p.y), z };
  };
  return { bottom: at(zLow), top: at(zHigh) };
}

/** Radial distance (mm) of point (x, y) from the true-position axis. */
export function radialDistance(point, truePosition) {
  return Math.hypot(point.x - truePosition.x, point.y - truePosition.y);
}

/**
 * Positional deviation of a single point, expressed as a DIAMETER (the way the
 * position tolerance is stated): 2 * sqrt(dx^2 + dy^2).
 */
export function deviationDiameter(point, truePosition) {
  return 2 * radialDistance(point, truePosition);
}

/** Tilt of the axis from the datum-A normal, in degrees. */
export function tiltDegrees(bottom, top, thickness) {
  return (Math.atan2(Math.hypot(top.x - bottom.x, top.y - bottom.y), thickness) * 180) / Math.PI;
}

/**
 * Evaluate a hole axis against a cylindrical position zone.
 *
 * The zone is a right circular cylinder of diameter `tolerance`, coaxial with
 * true position, perpendicular to datum A, spanning the feature length
 * (z = 0 .. thickness). A cylinder is convex, so a straight axis segment is
 * entirely inside it iff BOTH of its endpoints (its crossings of z = 0 and
 * z = thickness) are inside it. The whole-axis deviation is therefore the
 * larger of the two endpoint deviations.
 *
 * @param {object} p
 * @param {{x:number,y:number}} p.truePosition  basic location (mm)
 * @param {{x:number,y:number}} p.bottom  actual axis at z = 0 (mm)
 * @param {{x:number,y:number}} p.top     actual axis at z = thickness (mm)
 * @param {number} p.tolerance  position tolerance, diameter (mm)
 * @param {number} [p.thickness] zone length (mm), only used to report tilt
 */
export function evaluatePosition({ truePosition, bottom, top, tolerance, thickness }) {
  assertFinite({
    tpx: truePosition.x, tpy: truePosition.y,
    bx: bottom.x, by: bottom.y, tx: top.x, ty: top.y, tolerance,
  });
  if (tolerance < 0) throw new RangeError('tolerance must be >= 0');

  const radius = tolerance / 2;
  const rBottom = radialDistance(bottom, truePosition);
  const rTop = radialDistance(top, truePosition);
  const bottomIn = rBottom <= radius + EPS;
  const topIn = rTop <= radius + EPS;
  const deviation = 2 * Math.max(rBottom, rTop);
  const mid = { x: (bottom.x + top.x) / 2, y: (bottom.y + top.y) / 2 };

  return {
    bottom: { dx: bottom.x - truePosition.x, dy: bottom.y - truePosition.y, r: rBottom, deviation: 2 * rBottom, inside: bottomIn },
    top: { dx: top.x - truePosition.x, dy: top.y - truePosition.y, r: rTop, deviation: 2 * rTop, inside: topIn },
    mid: { dx: mid.x - truePosition.x, dy: mid.y - truePosition.y, deviation: deviationDiameter(mid, truePosition) },
    tilt: thickness > 0 ? tiltDegrees(bottom, top, thickness) : null,
    tolerance,
    radius,
    deviation, // whole-axis positional deviation, diameter (mm)
    margin: tolerance - deviation, // > 0 inside, < 0 outside (diameter, mm)
    inTolerance: bottomIn && topIn,
  };
}

function assertFinite(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`${k} must be a finite number (got ${v})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Hole size, RFS / MMC and bonus tolerance (Sally's rules, see ZONE.md §7)
// ---------------------------------------------------------------------------

/** Internal math resolution 0.0001 mm (finer than the 0.001 mm metric display). */
const UNITS = 1e4;
/** Round DOWN to 0.0001 (tiny float noise forgiven), so a bonus is never overstated. */
const floorUnits = (v) => Math.floor(v * UNITS + 1e-6) / UNITS;
/** Round UP to 0.0001 (minimum boundaries are never understated). */
const ceilUnits = (v) => Math.ceil(v * UNITS - 1e-6) / UNITS;
const roundUnits = (v) => Math.round(v * UNITS) / UNITS;

/**
 * Size check and allowed position tolerance for an internal feature (hole).
 *
 * - Size: the hole is acceptable only if mmc <= actualSize <= lmc (inclusive,
 *   EPS slack). Otherwise the part is rejected for size, whatever the axis.
 * - RFS: allowed = stated. A stated ⌀0 is invalid at RFS.
 * - MMC: bonus = actualSize − mmc (never negative, never more than lmc − mmc),
 *   allowed = stated + bonus. A stated ⌀0 is valid at MMC (all tolerance
 *   comes from bonus).
 * - Virtual condition (hole, MMC) = mmc − stated. It depends only on the
 *   stated tolerance, never on the actual size.
 * - LMC: bonus = lmc − actualSize (same clamps), allowed = stated + bonus.
 *   ⌀0 valid as at MMC. LMC virtual condition (hole) = lmc + stated.
 *   LMC resultant condition = mmc − (stated + (lmc − mmc)), rounded up; it
 *   depends only on the stated tolerance.
 * Bonus is floored to 0.0001 mm (conservative: never overstated).
 * On a size reject the bonus is not applicable: bonus = null and
 * allowed = stated (shown for information only; the verdict is REJECT: size).
 *
 * @param {object} p
 * @param {number} p.stated     stated position tolerance, diameter (mm), >= 0
 * @param {'RFS'|'MMC'|'LMC'} p.modifier
 * @param {number} p.actualSize actual hole diameter (mm)
 * @param {number} p.mmc        maximum material size of the hole = its smallest size (mm)
 * @param {number} p.lmc        least material size = its largest size (mm)
 */
export function allowedTolerance({ stated, modifier, actualSize, mmc, lmc }) {
  assertFinite({ stated, actualSize, mmc, lmc });
  if (stated < 0) throw new RangeError('stated tolerance must be >= 0');
  if (lmc < mmc) throw new RangeError('lmc must be >= mmc for a hole');
  if (!['RFS', 'MMC', 'LMC'].includes(modifier)) throw new RangeError(`modifier must be 'RFS', 'MMC' or 'LMC' (got ${modifier})`);
  const sizeOk = actualSize >= mmc - EPS && actualSize <= lmc + EPS;
  const statedValid = modifier !== 'RFS' || stated > EPS;
  const raw = modifier === 'MMC' ? actualSize - mmc : lmc - actualSize;
  const bonus = modifier === 'RFS' ? 0 : sizeOk ? floorUnits(Math.min(Math.max(raw, 0), lmc - mmc)) : null;
  const allowed = floorUnits(stated + (bonus ?? 0));
  return {
    modifier,
    stated,
    actualSize,
    sizeOk,
    statedValid,
    bonus,
    allowed,
    // LMC resultant condition (hole) = MMC size − allowed at MMC size = mmc − (stated + (lmc − mmc)); a minimum boundary, rounded up.
    resultantCondition: modifier === 'LMC' ? ceilUnits(mmc - (stated + (lmc - mmc))) : null,
    virtualCondition: modifier === 'MMC' ? roundUnits(mmc - stated) : modifier === 'LMC' ? roundUnits(lmc + stated) : null,
  };
}

/**
 * Full verdict: size first, then position against the allowed tolerance.
 * verdict: 'INVALID_TOL' (⌀0 at RFS) | 'REJECT_SIZE' | 'NO_DATUMS' | 'IN' | 'OUT'.
 * The position check is evaluatePosition() with tolerance = allowed, i.e. the
 * reported position 2·max(r) compared with allowed (both endpoints r <= allowed/2).
 */
export function evaluatePart({ truePosition, bottom, top, thickness, stated, modifier, actualSize, mmc, lmc, datums }) {
  const tol = allowedTolerance({ stated, modifier, actualSize, mmc, lmc });
  const pos = evaluatePositionDatums({ truePosition, bottom, top, tolerance: tol.allowed, thickness, datums });
  // NO_DATUMS: A, B and C all dropped, so the zone floats free and the control means nothing (accepts any axis).
  const verdict = !tol.statedValid ? 'INVALID_TOL' : !tol.sizeOk ? 'REJECT_SIZE' : pos.freedom.floats ? 'NO_DATUMS' : pos.inTolerance ? 'IN' : 'OUT';
  return { ...pos, size: tol, verdict, accept: verdict === 'IN' || verdict === 'NO_DATUMS' };
}

/** Verdicts where the position is not judged against the zone (drawn neutral gray). */
export const notJudged = (verdict) => verdict === 'REJECT_SIZE' || verdict === 'NO_DATUMS';

// ---------------------------------------------------------------------------
// "Lock in tolerance" (Will; spec revised by Sally and Gleeb)
// ---------------------------------------------------------------------------

/** Tiny margin kept inside the zone boundary (mm). */
export const LOCK_EPS = 1e-6;

const truncGrid = (v, grid) => { const g = 1 / grid; return (Math.trunc(v * g + Math.sign(v) * 1e-9) / g) || 0; };
/** Scale p radially to radius rMax (direction kept), then truncate toward zero onto the grid (r can only shrink). */
const toRadius = (p, rMax, grid) => {
  const r = Math.hypot(p.dx, p.dy);
  if (r <= rMax) return { dx: p.dx, dy: p.dy };
  const k = r > 0 ? rMax / r : 0;
  return { dx: truncGrid(p.dx * k, grid), dy: truncGrid(p.dy * k, grid) };
};

/**
 * One endpoint, one user drag/tilt step, with the lock on. Pure.
 * - prev inside (r <= allowed/2 − eps): next is clamped radially to allowed/2 − eps.
 * - prev outside (the zone shrank under it, or a preset put it there): the drag
 *   may only REDUCE its radial offset. A larger next is pulled back to r(prev)
 *   (direction of next kept), so it can slide around or come inward, never out.
 *   Once inside, the normal clamp applies on the next step.
 * Each endpoint is handled separately, so tilting right up to the edge works.
 * The zone is convex, so two endpoints inside keep the whole axis inside.
 */
export function lockDrag({ prev, next, allowed, eps = LOCK_EPS, grid = 1e-3 }) {
  assertFinite({ allowed, pdx: prev.dx, pdy: prev.dy, ndx: next.dx, ndy: next.dy });
  if (allowed < 0) throw new RangeError('allowed must be >= 0');
  const rMax = Math.max(0, allowed / 2 - eps);
  const rPrev = Math.hypot(prev.dx, prev.dy);
  return toRadius(next, rPrev <= rMax ? rMax : Math.max(rMax, rPrev), grid);
}

/**
 * Should the "zone shrank: less bonus at this size" note show? Pure.
 * True only when the axis would be IN at the allowed value from before the
 * shrink (taken while the lock was on) and is OUT at the current allowed value,
 * i.e. the shrink, not the axis, caused the OUT.
 */
export function shrinkCausedOut({ rBottom, rTop, allowedBefore, allowedNow }) {
  if (allowedBefore == null || !(allowedNow < allowedBefore)) return false;
  const r = Math.max(rBottom, rTop);
  return r <= allowedBefore / 2 + EPS && r > allowedNow / 2 + EPS;
}

// ---------------------------------------------------------------------------
// "Lock tilt" (Sally): both endpoints move together by the same delta, so the
// tilt (top − bottom) stays exactly what it was when the lock was turned on.
// Turning it on never moves the axis.
// ---------------------------------------------------------------------------

/**
 * Translate both endpoints by `delta` (mm). Pure.
 * - Box: each endpoint offset stays within ±maxDev per axis.
 * - allowed == null (tolerance lock off): only the box applies.
 * - allowed given (tolerance lock on): each endpoint must satisfy r <= R_i,
 *   with R_i = allowed/2 − eps if it starts inside, or its current r if it
 *   starts outside (it may only come inward). The translation is the point of
 *   that feasible set closest to `delta` (a projection), so whichever end would
 *   leave first limits the move, both ends move by the same clamped delta, and
 *   sideways drags slide along the boundary instead of sticking.
 * - Results are on the `grid` (0.001 mm); the tilt is preserved exactly on it.
 */
export function translateAxis({ bottom, top, delta, allowed = null, eps = LOCK_EPS, grid = 1e-3, maxDev = Infinity }) {
  assertFinite({ bdx: bottom.dx, bdy: bottom.dy, tdx: top.dx, tdy: top.dy, ddx: delta.dx, ddy: delta.dy });
  const g = 1 / grid;
  const q = (v) => Math.round(v * g) / g;
  const pts = [bottom, top];
  const rMax = allowed == null ? Infinity : Math.max(0, allowed / 2 - eps);
  const R = pts.map((p) => { const r = Math.hypot(p.dx, p.dy); return r <= rMax ? rMax : r; });
  const ok = (t) => pts.every((p, i) => {
    const x = p.dx + t[0], y = p.dy + t[1];
    return Math.abs(x) <= maxDev + 1e-12 && Math.abs(y) <= maxDev + 1e-12 && (R[i] === Infinity || Math.hypot(x, y) <= R[i] + 1e-12);
  });
  const D = [delta.dx, delta.dy];
  let T = [0, 0];
  if (ok(D)) T = D;
  else {
    const cands = [];
    const boxed = (t) => [0, 1].map((k) => Math.max(...pts.map((p) => -maxDev - (k ? p.dy : p.dx)), Math.min(...pts.map((p) => maxDev - (k ? p.dy : p.dx)), t[k])));
    cands.push(boxed(D));
    pts.forEach((p, i) => {
      if (R[i] === Infinity) return;
      const c = [-p.dx, -p.dy], v = [D[0] - c[0], D[1] - c[1]], l = Math.hypot(...v);
      const k = l > R[i] ? R[i] / l : 1;
      cands.push([c[0] + v[0] * k, c[1] + v[1] * k]);
    });
    if (R[0] !== Infinity && R[1] !== Infinity) { // the two boundary circles' intersections
      const [c0, c1] = pts.map((p) => [-p.dx, -p.dy]);
      const dx = c1[0] - c0[0], dy = c1[1] - c0[1], d = Math.hypot(dx, dy);
      if (d > 1e-12 && d <= R[0] + R[1] && d >= Math.abs(R[0] - R[1])) {
        const a = (R[0] ** 2 - R[1] ** 2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, R[0] ** 2 - a * a));
        const mx = c0[0] + (a * dx) / d, my = c0[1] + (a * dy) / d;
        cands.push([mx + (h * dy) / d, my - (h * dx) / d], [mx - (h * dy) / d, my + (h * dx) / d]);
      }
    }
    let lo = 0, hi = 1; // fallback: largest t with t·D feasible
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ok([D[0] * m, D[1] * m])) lo = m; else hi = m; }
    cands.push([D[0] * lo, D[1] * lo]);
    let best = Infinity;
    for (const c of cands) { const dd = Math.hypot(c[0] - D[0], c[1] - D[1]); if (ok(c) && dd < best) { best = dd; T = c; } }
  }
  // onto the grid, staying feasible: nearest feasible of the 4 floor/ceil combos (else no move)
  if (!(Number.isInteger(Math.round(T[0] * g * 1e6) / 1e6) && Number.isInteger(Math.round(T[1] * g * 1e6) / 1e6) && ok([q(T[0]), q(T[1])]))) {
    let best = Infinity, pick = [0, 0];
    for (const fx of [Math.floor, Math.ceil]) for (const fy of [Math.floor, Math.ceil]) {
      const c = [fx(T[0] * g + 1e-9) / g, fy(T[1] * g + 1e-9) / g];
      const dd = Math.hypot(c[0] - T[0], c[1] - T[1]);
      if (ok(c) && dd < best) { best = dd; pick = c; }
    }
    T = pick;
  } else T = [q(T[0]), q(T[1])];
  const mv = (p) => ({ dx: q(p.dx + T[0]) || 0, dy: q(p.dy + T[1]) || 0 });
  return { bottom: mv(bottom), top: mv(top), delta: { dx: T[0] || 0, dy: T[1] || 0 } };
}

// ---------------------------------------------------------------------------
// Datum reference suppression (Sally's rules, ZONE.md §12)
// ---------------------------------------------------------------------------

/**
 * Which degrees of freedom the zone gets when datum references are dropped.
 * - B dropped: the zone slides in X.   C dropped: the zone slides in Y.
 * - B and C dropped, A kept: slides in X and Y, stays perpendicular to A
 *   (acts like a perpendicularity control).
 * - A, B and C all dropped: the zone floats free; for a single hole the control means nothing.
 * - A dropped alone changes nothing visible (aDropped is only a flag for the on-screen note).
 * @param {{A?:boolean,B?:boolean,C?:boolean}} [d] references kept (default all true)
 */
export function datumFreedom(d = {}) {
  const A = d.A !== false, B = d.B !== false, C = d.C !== false;
  const floats = !A && !B && !C;
  const freeX = !floats && !B;
  const freeY = !floats && !C;
  return {
    A, B, C, floats, freeX, freeY,
    slides: freeX || freeY,
    perpOnly: A && !B && !C,
    aDropped: !A && !floats,
    kept: ['A', 'B', 'C'].filter((k) => ({ A, B, C })[k]),
  };
}

// min over c of max((a1−c)² + h1², (a2−c)² + h2²): the tightest centre along one free axis.
function fit1(a1, h1, a2, h2) {
  if ((a2 - a1) ** 2 + h2 * h2 <= h1 * h1) return a1;
  if ((a1 - a2) ** 2 + h1 * h1 <= h2 * h2) return a2;
  return (a2 * a2 + h2 * h2 - a1 * a1 - h1 * h1) / (2 * (a2 - a1));
}

/**
 * Tightest zone centre for an axis (endpoint offsets from true position, mm)
 * when the zone may slide along the free axes. The centre minimises the larger
 * endpoint distance, so position = 2·r is the smallest ⌀ that still contains the
 * axis. Nothing free: the centre stays at true position. Both free: the centre is
 * the endpoint midpoint and r is half the lateral spread. Pure, unique.
 * @returns {{cx:number, cy:number, rBottom:number, rTop:number, r:number}}
 */
export function fitZone({ bottom, top, freeX = false, freeY = false }) {
  let cx = 0, cy = 0;
  if (freeX && freeY) { cx = (bottom.dx + top.dx) / 2; cy = (bottom.dy + top.dy) / 2; }
  else if (freeX) cx = fit1(bottom.dx, bottom.dy, top.dx, top.dy);
  else if (freeY) cy = fit1(bottom.dy, bottom.dx, top.dy, top.dx);
  const rBottom = Math.hypot(bottom.dx - cx, bottom.dy - cy);
  const rTop = Math.hypot(top.dx - cx, top.dy - cy);
  return { cx, cy, rBottom, rTop, r: Math.max(rBottom, rTop) };
}

/**
 * evaluatePosition() with datum references: the zone slides along the freed
 * axes to its tightest fit (see fitZone), so r is measured from the slid zone
 * centre. With all references kept this is exactly evaluatePosition().
 * Adds: zone {dx, dy} (centre offset from true position), freedom (datumFreedom),
 * and per endpoint rx/ry (offsets from the zone centre). All three dropped:
 * r = 0 and everything is inside (nothing constrains the axis).
 */
export function evaluatePositionDatums({ datums, ...p }) {
  const base = evaluatePosition(p);
  const f = datumFreedom(datums);
  const ends = (cx, cy, rB, rT) => ({
    bottom: { ...base.bottom, rx: base.bottom.dx - cx, ry: base.bottom.dy - cy, r: rB },
    top: { ...base.top, rx: base.top.dx - cx, ry: base.top.dy - cy, r: rT },
  });
  if (!f.slides && !f.floats) {
    const e = ends(0, 0, base.bottom.r, base.top.r);
    return { ...base, ...e, zone: { dx: 0, dy: 0 }, freedom: f };
  }
  const radius = base.radius;
  let z;
  if (f.floats) z = { cx: base.mid.dx, cy: base.mid.dy, rBottom: 0, rTop: 0, r: 0 };
  else z = fitZone({ bottom: base.bottom, top: base.top, freeX: f.freeX, freeY: f.freeY });
  const bIn = z.rBottom <= radius + EPS, tIn = z.rTop <= radius + EPS;
  const deviation = 2 * z.r;
  const e = ends(z.cx, z.cy, z.rBottom, z.rTop);
  return {
    ...base,
    bottom: { ...e.bottom, deviation: 2 * z.rBottom, inside: bIn },
    top: { ...e.top, deviation: 2 * z.rTop, inside: tIn },
    zone: { dx: z.cx, dy: z.cy },
    deviation,
    margin: base.tolerance - deviation,
    inTolerance: bIn && tIn,
    freedom: f,
  };
}

const gridFloor = (v, g) => Math.floor(v * g + 1e-9) / g;
const gridCeil = (v, g) => Math.ceil(v * g - 1e-9) / g;

/**
 * lockDrag() with freed datum axes: ONE endpoint, one user drag step, the other
 * endpoint (`other`) as it is now. The feasible endpoint set is the zone's
 * sweep: every point within L of a centre that also holds `other` within L, i.e.
 * K ⊕ disc(L), with K = the centres still holding `other`:
 *   nothing free: a point; X free: a horizontal segment; Y free: a vertical
 *   segment; both free: disc(other, L), so |p − other| ≤ 2L.
 * L = allowed/2 − eps, or the fit radius it has now if it is already outside
 * (an outside endpoint may only come inward). The result is the closest feasible
 * point to `next` (a projection, so sideways drags slide and never stick), then
 * moved onto the 0.001 mm grid keeping it feasible.
 * @returns {{dx:number, dy:number}}
 */
export function lockDragFree({ prev, next, other, allowed, free = {}, eps = LOCK_EPS, grid = 1e-3 }) {
  assertFinite({ allowed, pdx: prev.dx, pdy: prev.dy, ndx: next.dx, ndy: next.dy, odx: other.dx, ody: other.dy });
  if (allowed < 0) throw new RangeError('allowed must be >= 0');
  const fx = !!free.x, fy = !!free.y;
  const rho = (p) => fitZone({ bottom: p, top: other, freeX: fx, freeY: fy }).r;
  const L = Math.max(Math.max(0, allowed / 2 - eps), rho(prev));
  const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const w = (h) => Math.sqrt(Math.max(0, L * L - h * h));
  if (rho(next) <= L) return { dx: next.dx, dy: next.dy };
  let c;
  if (fx && fy) {
    const d = [next.dx - other.dx, next.dy - other.dy], l = Math.hypot(...d);
    c = l <= L ? [next.dx, next.dy] : [other.dx + (d[0] * L) / l, other.dy + (d[1] * L) / l];
  } else if (fx) c = [clampTo(next.dx, other.dx - w(other.dy), other.dx + w(other.dy)), 0];
  else if (fy) c = [0, clampTo(next.dy, other.dy - w(other.dx), other.dy + w(other.dx))];
  else c = [0, 0];
  const v = [next.dx - c[0], next.dy - c[1]], lv = Math.hypot(...v);
  const k = lv > L ? L / lv : 1;
  const p = { dx: c[0] + v[0] * k, dy: c[1] + v[1] * k };
  const g = 1 / grid;
  let best = null, bd = Infinity;
  for (const fxn of [gridFloor, gridCeil]) for (const fyn of [gridFloor, gridCeil]) {
    const q = { dx: fxn(p.dx, g) || 0, dy: fyn(p.dy, g) || 0 };
    const dd = Math.hypot(q.dx - p.dx, q.dy - p.dy);
    if (rho(q) <= L + 1e-12 && dd < bd) { bd = dd; best = q; }
  }
  return best ?? { dx: prev.dx, dy: prev.dy };
}

/**
 * translateAxis() (Lock tilt) with freed datum axes. Translating both ends by
 * the same delta along a FREE axis never changes the fit, so that axis is
 * limited only by the ±maxDev box; the other axis is limited to the interval of
 * translations that keep the fit radius ≤ L (L = allowed/2 − eps, or the fit it
 * has now if already outside). Nothing free: translateAxis(). Pure.
 */
export function translateAxisFree({ bottom, top, delta, allowed = null, free = {}, eps = LOCK_EPS, grid = 1e-3, maxDev = Infinity }) {
  const fx = !!free.x, fy = !!free.y;
  if ((!fx && !fy) || allowed == null) return translateAxis({ bottom, top, delta, allowed, eps, grid, maxDev });
  assertFinite({ bdx: bottom.dx, bdy: bottom.dy, tdx: top.dx, tdy: top.dy, ddx: delta.dx, ddy: delta.dy });
  const g = 1 / grid, q = (v) => Math.round(v * g) / g;
  const rho = (tx, ty) => fitZone({ bottom: { dx: bottom.dx + tx, dy: bottom.dy + ty }, top: { dx: top.dx + tx, dy: top.dy + ty }, freeX: fx, freeY: fy }).r;
  const L = Math.max(Math.max(0, allowed / 2 - eps), rho(0, 0));
  const box = (a, b) => [Math.min(0, Math.max(-maxDev - a, -maxDev - b)), Math.max(0, Math.min(maxDev - a, maxDev - b))];
  const [bx0, bx1] = box(bottom.dx, top.dx), [by0, by1] = box(bottom.dy, top.dy);
  // interval of translations along one axis (ok(t) is convex-feasible and contains 0)
  const span = (ok, lo, hi) => {
    const edge = (end) => {
      if (end === 0 || ok(end)) return end;
      let a = 0, b = end;
      for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (ok(m)) a = m; else b = m; }
      return a;
    };
    return [edge(Math.max(lo, -2)), edge(Math.min(hi, 2))];
  };
  let [tx0, tx1] = [bx0, bx1], [ty0, ty1] = [by0, by1];
  if (fx && !fy) [ty0, ty1] = span((t) => rho(0, t) <= L, by0, by1);
  if (fy && !fx) [tx0, tx1] = span((t) => rho(t, 0) <= L, bx0, bx1);
  const lim = (v, lo, hi) => Math.max(gridCeil(lo, g), Math.min(gridFloor(hi, g), q(v)));
  const T = { dx: lim(delta.dx, tx0, tx1) || 0, dy: lim(delta.dy, ty0, ty1) || 0 };
  const mv = (p) => ({ dx: q(p.dx + T.dx) || 0, dy: q(p.dy + T.dy) || 0 });
  return { bottom: mv(bottom), top: mv(top), delta: T };
}
