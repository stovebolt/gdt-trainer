// Number formatting for every value the viewer displays. Pure, no DOM, no Three.js.
//
// All lengths are shown with 4 decimals (0.0001 mm). Plain rounding could
// make the display contradict the verdict: r = 0.12503 is OUT but would
// round to "0.1250", which reads as "on the limit". So values compared
// against a limit use VERDICT-AWARE rounding:
//   - PASS: round to nearest, then cap at the limit, so the display is ≤ limit
//   - FAIL: round to nearest, but never below limit + 0.0001, so the display is > limit
//           (only values within 0.00005 of the limit are bumped; e.g. 0.12503 -> 0.1251)
// The IN/OUT decision itself is made only in tolerance.js (with its 1e-9 slack);
// this module never changes a verdict, it only displays it consistently.

export const DECIMALS = 4;
const SCALE = 10 ** DECIMALS;

const toUnits = (v) => Math.round(v * SCALE);
const unitsToString = (u) => (u / SCALE).toFixed(DECIMALS);

/** Unsigned value, 4 decimals: 0.125 -> "0.1250". */
export function fmt(v) {
  return Math.abs(v).toFixed(DECIMALS);
}

/** Signed value, 4 decimals, with a real minus sign: -0.13 -> "−0.1300", 0 -> "+0.0000". */
export function fmtSigned(v) {
  const s = Math.abs(v).toFixed(DECIMALS);
  const negative = v < 0 && Number(s) !== 0;
  return (negative ? '−' : '+') + s;
}

/**
 * Integer count of 0.0001 units to display for `value` checked against
 * `limit`, given the verdict `pass` (value within limit) from the math module.
 */
export function displayUnits(value, limit, pass) {
  const limitU = toUnits(limit);
  if (pass) return Math.min(toUnits(value), limitU);
  return Math.max(toUnits(value), limitU + 1);
}

/** Display string for a value checked against a limit (see header comment). */
export function fmtAgainst(value, limit, pass) {
  return unitsToString(displayUnits(value, limit, pass));
}

/** Margin (limit - value) computed from the DISPLAYED numbers, so it always adds up on screen. */
export function fmtMargin(value, limit, pass) {
  const u = toUnits(limit) - displayUnits(value, limit, pass);
  return (u < 0 ? '−' : '+') + unitsToString(Math.abs(u));
}
