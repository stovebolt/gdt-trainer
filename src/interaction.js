// Pointer drag of the axis handles in the 3D view.
//   TOP handle    -> moves the axis crossing at z = 10 (tilts the axis)
//   BOTTOM handle -> moves the axis crossing at z = 0  (tilts the axis)
//   SLIDE handle  -> moves both together (lateral shift, tilt unchanged)
// Each drag happens in the horizontal plane through the grabbed handle, and
// screen motion is divided by the magnification to get real millimetres.
import * as THREE from 'three';
import { fromVisualDelta } from './exaggeration.js';

export function attachDrag({ camera, domElement, controls, handles, getState, onChange, clampOffset }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  let drag = null;

  const setRay = (ev) => {
    const r = domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  };
  // Screen-space grab radius around each handle (CSS px). Fingers get a much
  // larger target than a mouse; a direct ray hit always wins.
  const grabRadius = (ev) => (ev.pointerType === 'touch' || ev.pointerType === 'pen' ? 28 : 10);
  const tmp = new THREE.Vector3();
  const pick = (ev) => {
    setRay(ev);
    const hitObj = raycaster.intersectObjects(handles.list, false)[0]?.object;
    if (hitObj) return hitObj;
    const r = domElement.getBoundingClientRect();
    let best = null;
    let bestD = grabRadius(ev);
    for (const h of handles.list) {
      tmp.copy(h.position).project(camera);
      if (tmp.z > 1) continue; // behind the camera
      const sx = r.left + ((tmp.x + 1) / 2) * r.width;
      const sy = r.top + ((1 - tmp.y) / 2) * r.height;
      const d = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  };

  // Active pointers on the canvas (for multi-touch arbitration).
  const active = new Set();

  domElement.addEventListener('pointerdown', (ev) => {
    active.add(ev.pointerId);
    // A second finger while dragging a handle means "pinch/pan the view":
    // cancel the handle drag (restore the axis) and let OrbitControls take it.
    if (drag && ev.pointerId !== drag.pointerId) {
      onChange({ bottom: drag.bottom, top: drag.top });
      finish();
      return;
    }
    if (ev.button !== 0 || active.size > 1) return; // never grab a handle mid-gesture
    const obj = pick(ev);
    if (!obj) return;
    plane.set(new THREE.Vector3(0, 0, 1), -obj.position.z);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    const s = getState();
    drag = { pointerId: ev.pointerId, kind: obj.userData.kind, start: hit.clone(), bottom: { ...s.bottom }, top: { ...s.top } };
    // Keep OrbitControls enabled so it still tracks this pointer (needed for a
    // later two-finger pinch); only suppress its rotation while dragging.
    controls.enableRotate = false;
    domElement.setPointerCapture(ev.pointerId);
    domElement.style.cursor = 'grabbing';
    ev.preventDefault();
  });

  domElement.addEventListener('pointermove', (ev) => {
    if (!drag) {
      if (ev.pointerType === 'mouse') domElement.style.cursor = pick(ev) ? 'grab' : '';
      return;
    }
    if (ev.pointerId !== drag.pointerId) return;
    setRay(ev);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    const s = getState();
    const d = fromVisualDelta(hit.x - drag.start.x, hit.y - drag.start.y, s.magnification);
    const move = (p) => ({ dx: clampOffset(p.dx + d.dx), dy: clampOffset(p.dy + d.dy) });
    const next = { bottom: drag.bottom, top: drag.top };
    if (drag.kind === 'top' || drag.kind === 'mid') next.top = move(drag.top);
    if (drag.kind === 'bottom' || drag.kind === 'mid') next.bottom = move(drag.bottom);
    onChange(next);
  });

  function finish() {
    if (!drag) return;
    if (domElement.hasPointerCapture(drag.pointerId)) domElement.releasePointerCapture(drag.pointerId);
    drag = null;
    controls.enableRotate = true;
    domElement.style.cursor = '';
  }
  const end = (ev) => {
    active.delete(ev.pointerId);
    if (drag && ev.pointerId === drag.pointerId) finish();
  };
  domElement.addEventListener('pointerup', end);
  domElement.addEventListener('pointercancel', end);
  domElement.addEventListener('lostpointercapture', (ev) => { if (drag && ev.pointerId === drag.pointerId) finish(); });
}
