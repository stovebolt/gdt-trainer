// Display-only exaggeration ("magnification") of deviations. Pure, no Three.js.
//
// Real deviations (≤ a few tenths of a mm) are invisible next to a 100 mm
// plate, so the viewer draws every DEVIATION-RELATED length multiplied by M
// about the true-position axis:
//   - the actual axis endpoints:  visual = TP + M * (actual - TP)
//   - the hole's drawn location   (follows the visual axis)
//   - the zone radius:            visual R = M * (tolerance / 2)
// Because the same factor scales both the zone radius and the offsets, the
// inside/outside relationship seen on screen is exactly the computed one.
// Not scaled: plate size, hole diameter (⌀10.1), Z (thickness), basic dims.
// The IN/OUT math in tolerance.js always uses REAL (unscaled) values.

export function toVisualXY(truePosition, dx, dy, magnification) {
  return { x: truePosition.x + magnification * dx, y: truePosition.y + magnification * dy };
}

export function fromVisualDelta(vdx, vdy, magnification) {
  return { dx: vdx / magnification, dy: vdy / magnification };
}

export function visualZoneRadius(tolerance, magnification) {
  return (tolerance / 2) * magnification;
}
