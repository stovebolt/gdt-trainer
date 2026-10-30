// Pointer drags in the 3D view (Lesson 2).
//   per hole: TOP / BOTTOM sphere -> that axis end (tilt), white sphere -> both ends (slide)
//   blue "pattern" sphere -> the whole pattern shifts in X/Y
//   white "rotate" sphere on the blue arm -> the whole pattern turns about (50, 30)
//   Shift + drag on any hole sphere -> whole-pattern shift (desktop shortcut)
// Motion is divided by the magnification (real mm); rotation likewise (drawn turn / M).
import * as THREE from 'three';
import { dragPlane, dragDelta } from './views.js';

export function attachDrag({ getCamera, domElement, controls, handles, getState, onHole, onPattern }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let drag = null;
  const active = new Set();
  const setRay = (ev) => {
    const r = domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, getCamera());
  };
  const grabRadius = (ev) => (ev.pointerType === 'touch' || ev.pointerType === 'pen' ? 24 : 10);
  const pick = (ev) => {
    setRay(ev);
    const h = raycaster.intersectObjects(handles.list, false)[0]?.object;
    if (h) return h;
    const r = domElement.getBoundingClientRect();
    let best = null, bestD = grabRadius(ev);
    for (const o of handles.list) {
      tmp.copy(o.position).project(getCamera());
      if (tmp.z > 1) continue;
      const d = Math.hypot(ev.clientX - (r.left + ((tmp.x + 1) / 2) * r.width), ev.clientY - (r.top + ((1 - tmp.y) / 2) * r.height));
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  };

  domElement.addEventListener('pointerdown', (ev) => {
    active.add(ev.pointerId);
    if (drag && ev.pointerId !== drag.pointerId) { drag.restore(); finish(); return; }
    if (ev.button !== 0 || active.size > 1) return;
    const obj = pick(ev);
    if (!obj) return;
    let { kind, hole } = obj.userData;
    if (ev.shiftKey && kind !== 'rot') kind = 'move';
    const look = getCamera().getWorldDirection(new THREE.Vector3());
    const dp = kind === 'rot' ? { kind: 'horizontal', normal: [0, 0, 1] } : dragPlane([look.x, look.y, look.z]);
    plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(...dp.normal), obj.position);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    const s = getState();
    const saved = structuredClone({ pattern: s.pattern, local: s.local });
    const centre = handles.move.position.clone();
    drag = {
      pointerId: ev.pointerId, kind, hole, start: hit.clone(), plane: dp, saved, centre,
      a0: Math.atan2(hit.y - centre.y, hit.x - centre.x),
      restore: () => onPattern(saved.pattern, saved.local),
    };
    controls.enableRotate = false;
    domElement.setPointerCapture(ev.pointerId);
    domElement.style.cursor = 'grabbing';
    ev.preventDefault();
  });

  domElement.addEventListener('pointermove', (ev) => {
    if (!drag) { if (ev.pointerType === 'mouse') domElement.style.cursor = pick(ev) ? 'grab' : ''; return; }
    if (ev.pointerId !== drag.pointerId) return;
    setRay(ev);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    const M = getState().magnification;
    const { saved } = drag;
    if (drag.kind === 'rot') {
      let da = Math.atan2(hit.y - drag.centre.y, hit.x - drag.centre.x) - drag.a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      onPattern({ ...saved.pattern, deg: saved.pattern.deg + (da * 180) / Math.PI / M }, null);
      return;
    }
    const d = dragDelta(drag.plane, [hit.x - drag.start.x, hit.y - drag.start.y], M);
    if (drag.kind === 'move') { onPattern({ ...saved.pattern, tx: saved.pattern.tx + d.dx, ty: saved.pattern.ty + d.dy }, null); return; }
    // one hole: world delta -> pattern frame (undo the pattern turn)
    const th = (-saved.pattern.deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    const lx = c * d.dx - s * d.dy, ly = s * d.dx + c * d.dy;
    const l = [...saved.local[drag.hole]];
    if (drag.kind !== 'top') { l[0] += lx; l[1] += ly; }
    if (drag.kind !== 'bottom') { l[2] += lx; l[3] += ly; }
    onHole(drag.hole, l);
  });

  function finish() {
    if (!drag) return;
    if (domElement.hasPointerCapture(drag.pointerId)) domElement.releasePointerCapture(drag.pointerId);
    drag = null;
    controls.enableRotate = true;
    domElement.style.cursor = '';
  }
  const end = (ev) => { active.delete(ev.pointerId); if (drag && ev.pointerId === drag.pointerId) finish(); };
  domElement.addEventListener('pointerup', end);
  domElement.addEventListener('pointercancel', end);
  domElement.addEventListener('lostpointercapture', (ev) => { if (drag && ev.pointerId === drag.pointerId) finish(); });
}
