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
  const pick = (ev) => {
    setRay(ev);
    return raycaster.intersectObjects(handles.list, false)[0]?.object ?? null;
  };

  domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const obj = pick(ev);
    if (!obj) return;
    plane.set(new THREE.Vector3(0, 0, 1), -obj.position.z);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    const s = getState();
    drag = { kind: obj.userData.kind, start: hit.clone(), bottom: { ...s.bottom }, top: { ...s.top } };
    controls.enabled = false;
    domElement.setPointerCapture(ev.pointerId);
    domElement.style.cursor = 'grabbing';
    ev.preventDefault();
  });

  domElement.addEventListener('pointermove', (ev) => {
    if (!drag) {
      domElement.style.cursor = pick(ev) ? 'grab' : '';
      return;
    }
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

  const end = (ev) => {
    if (!drag) return;
    drag = null;
    controls.enabled = true;
    domElement.style.cursor = '';
    if (domElement.hasPointerCapture(ev.pointerId)) domElement.releasePointerCapture(ev.pointerId);
  };
  domElement.addEventListener('pointerup', end);
  domElement.addEventListener('pointercancel', end);
}
