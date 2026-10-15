// Number formatting for every value the viewer displays. Pure, no DOM, no Three.js.
//
// Metric (mm) convention, per Will (supersedes the earlier 4-decimal rule):
// at most 3 decimals, trailing zeros dropped, leading zero kept
// (0.25, 0.4, 10.15, 0.247, 10).
//
// Conservative rounding, so the display can never contradict the verdict:
//   - measured values (r, reported position 2r) round UP;
//   - limits (allowed tolerance, r limit) and bonus round DOWN;
//   - a PASSING value is capped at the displayed limit (shows ≤ limit);
//   - a FAILING value always shows strictly above the displayed limit
//     (rounding up already guarantees this; it is also enforced explicitly).
// The IN/OUT decision itself is made only in tolerance.js (with its 1e-9 slack).

export const DECIMALS = 3;
const SCALE = 10 ** DECIMALS;
const GUARD = 1e-6; // in display units (= 1e-9 mm): ignores float noise such as 0.13000000000000034

const unitsNearest = (v) => Math.round(v * SCALE);
const unitsUp = (v) => Math.ceil(v * SCALE - GUARD);
const unitsDown = (v) => Math.floor(v * SCALE + GUARD);

/** Integer display units -> metric string (no sign): 250 -> "0.25", 10150 -> "10.15", 0 -> "0". */
function unitsToString(u) {
  const s = (Math.abs(u) / SCALE).toFixed(DECIMALS);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Neutral value (sizes, stated tolerance, VC, offsets): nearest, trimmed, unsigned. */
export function fmt(v) {
  return unitsToString(unitsNearest(Math.abs(v)));
}

/** A limit / allowed tolerance / bonus: rounded DOWN (never overstated). */
export function fmtLimit(v) {
  return unitsToString(unitsDown(v));
}

/** A measured value shown on its own: rounded UP (never understated). */
export function fmtUp(v) {
  return unitsToString(unitsUp(v));
}

/** Signed value with a real minus sign: -0.13 -> "−0.13", 0 -> "+0", 0.1 -> "+0.1". */
export function fmtSigned(v) {
  const u = unitsNearest(v);
  return (u < 0 ? '−' : '+') + unitsToString(u);
}

/**
 * Integer display units for `value` checked against `limit`, given the verdict
 * `pass` from the math module. Limit is shown rounded down.
 */
export function displayUnits(value, limit, pass) {
  const limitU = unitsDown(limit);
  const u = unitsUp(value);
  if (pass) return Math.min(u, limitU);
  return Math.max(u, limitU + 1);
}

/** Display string for a measured value checked against a limit (see header comment). */
export function fmtAgainst(value, limit, pass) {
  return unitsToString(displayUnits(value, limit, pass));
}

/** Margin (limit - value) from the DISPLAYED numbers, so it always adds up on screen. */
export function fmtMargin(value, limit, pass) {
  const u = unitsDown(limit) - displayUnits(value, limit, pass);
  return (u < 0 ? '−' : '+') + unitsToString(u);
}
