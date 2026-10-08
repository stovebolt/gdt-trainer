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
