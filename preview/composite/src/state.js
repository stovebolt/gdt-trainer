// Pattern + local offsets -> the 4 × [dxb, dyb, dxt, dyt] deviations the math uses. Pure.
import { BASIC, CEN } from './composite.js';

/** Endpoint = C + t + R(deg)(b + local − C); returned as offsets from b. */
export function devsFromState({ pattern, local }) {
  const th = (pattern.deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  return BASIC.map(([bx, by], i) => {
    const l = local[i];
    const end = (dx, dy) => {
      const qx = bx + dx - CEN[0], qy = by + dy - CEN[1];
      return [CEN[0] + pattern.tx + c * qx - s * qy - bx, CEN[1] + pattern.ty + s * qx + c * qy - by];
    };
    return [...end(l[0], l[1]), ...end(l[2], l[3])];
  });
}
