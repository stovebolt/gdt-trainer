// Small Three.js helpers: thick screen-space lines, labels, disposal.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const COLORS = Object.freeze({
  in: 0x16a34a,
  out: 0xdc2626,
  ink: 0x0f172a,
  plate: 0xd5dbe3,
  bore: 0x8a96a8,
  datumA: 0x2563eb,
  datumB: 0xd97706,
  datumC: 0x7c3aed,
  truePos: 0x0f172a,
});

const lineMaterials = new Set();
let resolution = new THREE.Vector2(1, 1);

/** Keep every LineMaterial's pixel resolution in sync with the canvas. */
export function setLineResolution(w, h) {
  resolution = new THREE.Vector2(w, h);
  for (const m of lineMaterials) m.resolution.copy(resolution);
}

/**
 * A thick, screen-space-width polyline (WebGL ignores linewidth on plain lines).
 * @param {number[][]} points  [[x,y,z], ...]
 */
export function fatLine(points, { color = COLORS.ink, width = 3, dashed = false, dashSize = 1.2, gapSize = 0.8, onTop = false, opacity = 1 } = {}) {
  const geo = new LineGeometry();
  geo.setPositions(points.flat());
  const mat = new LineMaterial({
    color,
    linewidth: width,
    dashed,
    dashSize,
    gapSize,
    transparent: opacity < 1 || onTop,
    opacity,
    depthTest: !onTop,
  });
  mat.resolution.copy(resolution);
  lineMaterials.add(mat);
  const line = new Line2(geo, mat);
  if (dashed) line.computeLineDistances();
  if (onTop) line.renderOrder = 10;
  return line;
}

/** Points on a circle in a plane z = const. */
export function circlePoints(cx, cy, z, r, n = 96) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
  }
  return pts;
}

/** Open arrowhead (chevron) at `to`, pointing from `from`, in a z = const plane. */
export function arrowHead(from, to, size = 2, opts = {}) {
  const d = new THREE.Vector2(to[0] - from[0], to[1] - from[1]).normalize();
  const n = new THREE.Vector2(-d.y, d.x);
  const z = to[2];
  const back = [to[0] - d.x * size, to[1] - d.y * size];
  return fatLine(
    [
      [back[0] + n.x * size * 0.45, back[1] + n.y * size * 0.45, z],
      to,
      [back[0] - n.x * size * 0.45, back[1] - n.y * size * 0.45, z],
    ],
    opts,
  );
}

/** HTML label positioned in 3D (rendered by CSS2DRenderer). */
export function label(html, className, position) {
  const div = document.createElement('div');
  div.className = `label ${className || ''}`;
  div.innerHTML = html;
  const obj = new CSS2DObject(div);
  if (position) obj.position.set(...position);
  return obj;
}

/** Recursively free GPU resources and detach CSS2D labels. */
export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      lineMaterials.delete(m);
      m.dispose();
    }
    if (o.isCSS2DObject) o.element.remove();
  });
  root.removeFromParent();
}
