// Pure view math (no Three.js): standard orthographic views and how a screen
// drag maps onto the hole axis in each. Frame: +X from datum B, +Y from datum C,
// +Z up out of datum A (Z-up).

/** Unit vectors from the target TOWARD the camera, per named view. */
export const VIEW_DIRS = Object.freeze({
  top: Object.freeze([0, -1e-4, 1]), //   Top (Z): looking down −Z; screen up = +Y (tiny −Y tilt keeps orbit math non-degenerate)
  front: Object.freeze([0, -1, 0]), //    Front (Y): looking along +Y; screen right = +X, up = +Z
  side: Object.freeze([1, 0, 0]), //      Side (X): looking along −X; screen right = +Y, up = +Z
});
export const VIEW_NAMES = Object.freeze(['top', 'front', 'side', '3d']);
export const VIEW_LABELS = Object.freeze({ top: 'Top (Z)', front: 'Front (Y)', side: 'Side (X)', '3d': '3D' });

const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };

/** Camera pose for a named ortho view around `target` at `distance`. */
export function viewPose(name, target, distance) {
  const d = VIEW_DIRS[name];
  if (!d) throw new RangeError(`unknown view ${name}`);
  const n = norm(d);
  return { position: target.map((t, i) => t + n[i] * distance), target: [...target] };
}

/**
 * Which plane a handle drag happens in, from the camera's viewing direction
 * (any vector along the line of sight). Looking mostly down (top-ish views,
 * the default 3D orbit): the horizontal plane through the handle, so the drag
 * moves the endpoint in X/Y. Looking mostly sideways (front/side views): a
 * vertical plane facing the camera, so only the visible in-plane horizontal
 * axis moves (X in front view, Y in side view) and screen-vertical motion,
 * which is Z, is ignored.
 * @returns {{kind:'horizontal'|'vertical', normal:number[]}}
 */
export function dragPlane(viewDir) {
  const n = norm(viewDir);
  if (Math.abs(n[2]) >= 0.35) return { kind: 'horizontal', normal: [0, 0, 1] };
  const h = norm([n[0], n[1], 0]);
  return { kind: 'vertical', normal: h };
}

/**
 * Real-mm endpoint delta from a world-space hit delta on the drag plane, with
 * the display magnification removed. For a vertical plane the horizontal hit
 * delta is already perpendicular to the line of sight; it is projected onto the
 * plane anyway so float noise never leaks into the hidden axis.
 */
export function dragDelta(plane, worldDelta, magnification) {
  let [x, y] = worldDelta;
  if (plane.kind === 'vertical') {
    const [nx, ny] = plane.normal;
    const along = x * nx + y * ny;
    x -= along * nx;
    y -= along * ny;
    if (Math.abs(x) < 1e-12) x = 0;
    if (Math.abs(y) < 1e-12) y = 0;
  }
  return { dx: x / magnification, dy: y / magnification };
}

/** Effective "camera distance" for label layout: ortho uses its visible half-height. */
export function effectiveDistance({ ortho, distance, halfHeight, zoom, fovDeg }) {
  return ortho ? halfHeight / zoom / Math.tan((fovDeg * Math.PI) / 360) : distance;
}
