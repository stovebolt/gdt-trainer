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

/** Lengths are quantised to 0.0001 mm (the display resolution). */
const UNITS = 1e4;
/** Round DOWN to 0.0001 (tiny float noise forgiven), so a bonus is never overstated. */
const floorUnits = (v) => Math.floor(v * UNITS + 1e-6) / UNITS;
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
 * Bonus is floored to 0.0001 mm (conservative: never overstated).
 *
 * @param {object} p
 * @param {number} p.stated     stated position tolerance, diameter (mm), >= 0
 * @param {'RFS'|'MMC'} p.modifier
 * @param {number} p.actualSize actual hole diameter (mm)
 * @param {number} p.mmc        maximum material size of the hole = its smallest size (mm)
 * @param {number} p.lmc        least material size = its largest size (mm)
 */
export function allowedTolerance({ stated, modifier, actualSize, mmc, lmc }) {
  assertFinite({ stated, actualSize, mmc, lmc });
  if (stated < 0) throw new RangeError('stated tolerance must be >= 0');
  if (lmc < mmc) throw new RangeError('lmc must be >= mmc for a hole');
  if (modifier !== 'RFS' && modifier !== 'MMC') throw new RangeError(`modifier must be 'RFS' or 'MMC' (got ${modifier})`);
  const sizeOk = actualSize >= mmc - EPS && actualSize <= lmc + EPS;
  const statedValid = modifier === 'MMC' || stated > EPS;
  const bonus = modifier === 'MMC' ? floorUnits(Math.min(Math.max(actualSize - mmc, 0), lmc - mmc)) : 0;
  const allowed = floorUnits(stated + bonus);
  return {
    modifier,
    stated,
    actualSize,
    sizeOk,
    statedValid,
    bonus,
    allowed,
    virtualCondition: modifier === 'MMC' ? roundUnits(mmc - stated) : null,
  };
}

/**
 * Full verdict: size first, then position against the allowed tolerance.
 * verdict: 'INVALID_TOL' (⌀0 at RFS) | 'REJECT_SIZE' | 'IN' | 'OUT'.
 * The position check is evaluatePosition() with tolerance = allowed, i.e. the
 * reported position 2·max(r) compared with allowed (both endpoints r <= allowed/2).
 */
export function evaluatePart({ truePosition, bottom, top, thickness, stated, modifier, actualSize, mmc, lmc }) {
  const tol = allowedTolerance({ stated, modifier, actualSize, mmc, lmc });
  const pos = evaluatePosition({ truePosition, bottom, top, tolerance: tol.allowed, thickness });
  const verdict = !tol.statedValid ? 'INVALID_TOL' : !tol.sizeOk ? 'REJECT_SIZE' : pos.inTolerance ? 'IN' : 'OUT';
  return { ...pos, size: tol, verdict, accept: verdict === 'IN' };
}
