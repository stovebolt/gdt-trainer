// Scene building: static drawing elements (datums, basic dimensions, true
// position, FCF) and the dynamic part (plate with hole, tolerance zone, actual
// axis, drag handles) that is rebuilt from the evaluated state.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { SPEC } from '../config.js';
import { fmt, fmtLimit, fmtUp, fmtAgainst } from '../format.js';
import { fcfHTML, fmtNote } from '../fcf.js';
import { toVisualXY, visualZoneRadius } from '../exaggeration.js';
import { viewPose, effectiveDistance } from '../views.js';
import { notJudged } from '../tolerance.js';
import { reframePlan } from '../framing.js';
import { COLORS, fatLine, circlePoints, arrowHead, label, disposeObject, setLineResolution } from './primitives.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // Z-up, matching the drawing frame

const { x: L, y: W, z: H } = SPEC.plate;
const TP = SPEC.truePosition;
const HOLE_R = SPEC.hole.nominal / 2;

export const HOLE_CAMERA = Object.freeze({ position: [TP.x - 14, TP.y - 30, 32], target: [TP.x, TP.y, 4] });

// Phone-sized screens: same media logic as the small-3D-view rules in styles.css
// (portrait phones <= 700 px wide, landscape phones <= 500 px tall).
export const PHONE_QUERY = '(max-width: 700px), (max-height: 500px)';
export const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

// Phone close-up: same viewing direction as HOLE_CAMERA, pulled back by
// `distance` and with the target shifted so the hole sits below the verdict
// badge with room for the callout labels. Camera only.
export const PHONE_HOLE_FRAMING = { distance: 1.25, shift: [11, 2, 3] };
export function phoneHoleCamera(f = PHONE_HOLE_FRAMING) {
  const target = HOLE_CAMERA.target.map((t, i) => t + f.shift[i]);
  const position = target.map((t, i) => t + f.distance * (HOLE_CAMERA.position[i] - HOLE_CAMERA.target[i]));
  return { position, target };
}

// Callout labels (zone, actual axis). Two layouts, blended by camera distance:
//  - FAR (overview distance and beyond): fixed world positions (the layout
//    verified at the overview).
//  - NEAR (close-ups): a fixed number of SCREEN pixels from a 3D anchor next to
//    the hole, so the leader shrinks with camera distance and the labels stay
//    next to the hole at any zoom. [right, down] in CSS px.
// Labels are also nudged back inside the canvas if they would leave it.
export const CALLOUT_PX = { zone: [96, 0], axis: [100, 18] };
export const CALLOUT_BLEND = { near: 60, far: 130 }; // camera-to-target distance
export const DEFAULT_CAMERA = Object.freeze({ position: [-22, -88, 92], target: [47, 30, 0] });
// Named ortho views: centred on the hole mid-depth, showing ±VIEW_HALF mm vertically.
export const VIEW_TARGET = Object.freeze([TP.x, TP.y, H / 2]);
export const VIEW_HALF = { desktop: 26, phone: 21 };
const VIEW_DIST = 120; // camera distance for ortho views (only affects clipping)
const SNAP_MS = 420;

export function createViewer(container) {
  let keyPts = [], reframeAt = 0, reframeTries = 0, pointerDown = false; // auto-reframe state (see reframe())
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf8fafc);
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const persp = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
  let camera = persp; // the active camera (persp or ortho)
  const controls = new OrbitControls(camera, renderer.domElement);
  let viewName = '3d'; // last snapped view; null once the user orbits away
  let anim = null;
  controls.addEventListener('start', () => { if (!anim) { viewName = null; onViewChange(); } });
  let viewListeners = [];
  const onViewChange = () => viewListeners.forEach((f) => f({ view: viewName, ortho: camera === ortho }));
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  resetCamera();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-40, -80, 120);
  scene.add(sun);

  const staticGroup = buildStatic();
  scene.add(staticGroup);
  const drawing = staticGroup.getObjectByName('drawing');
  let showDrawing = true;
  // Datum references dropped: dim their planes and labels in the drawing.
  function setDatumsDim(datums) {
    for (const k of ['A', 'B', 'C']) {
      const on = datums?.[k] !== false;
      datumSheets[k].material.opacity = on ? 0.12 : 0.03;
      for (const el of container.querySelectorAll(`.datum-${k.toLowerCase()}`)) el.classList.toggle('dropped', !on);
    }
  }
  /** "Show drawing" toggle: datums, origin axes, true-position callout, basic
   *  dimensions, in-scene FCF + its leader. Display only. */
  function setDrawing(on) {
    showDrawing = !!on;
    drawing.visible = showDrawing;
    dynamic.traverse((o) => { if (o.userData.drawing) o.visible = showDrawing; });
    layoutKey = '';
  }

  const dynamic = new THREE.Group();
  scene.add(dynamic);
  const handles = buildHandles();
  scene.add(handles.group);

  const tanHalf = () => Math.tan((persp.fov * Math.PI) / 360);
  const aspect = () => (container.clientWidth || 1) / (container.clientHeight || 1);
  function fitOrtho(halfH) {
    ortho.top = halfH; ortho.bottom = -halfH;
    ortho.left = -halfH * aspect(); ortho.right = halfH * aspect();
    ortho.updateProjectionMatrix();
  }
  /** Switch projection keeping the current pose and apparent size. */
  function setProjection(kind) {
    const want = kind === 'ortho' ? ortho : persp;
    if (want === camera) return;
    const dist = camera.position.distanceTo(controls.target);
    if (want === ortho) {
      fitOrtho(dist * tanHalf()); ortho.zoom = 1;
      ortho.position.copy(persp.position); ortho.up.copy(persp.up);
    } else {
      const halfH = ortho.top / ortho.zoom;
      const dir = ortho.position.clone().sub(controls.target).normalize();
      persp.position.copy(controls.target).addScaledVector(dir, halfH / tanHalf());
    }
    want.updateProjectionMatrix();
    camera = want;
    controls.object = camera;
    controls.update();
    layoutKey = '';
    onViewChange();
  }
  /** Smoothly move the camera to `pose` ({position, target}); for ortho also to a visible half-height. */
  function animateTo(pose, { halfH = null, ms = SNAP_MS } = {}) {
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const p1 = new THREE.Vector3(...pose.position), t1 = new THREE.Vector3(...pose.target);
    const d0 = p0.clone().sub(t0), d1 = p1.clone().sub(t1);
    const l0 = d0.length(), l1 = d1.length();
    const u0 = d0.normalize(), u1 = d1.normalize();
    const z0 = camera === ortho ? ortho.zoom : 1, z1 = camera === ortho && halfH ? ortho.top / halfH : z0;
    const start = performance.now();
    anim = (now) => {
      const k = Math.min(1, (now - start) / ms), e = k * k * (3 - 2 * k);
      const u = u0.clone().lerp(u1, e);
      if (u.lengthSq() < 1e-8) u.copy(u1);
      u.normalize();
      controls.target.lerpVectors(t0, t1, e);
      camera.position.copy(controls.target).addScaledVector(u, l0 + (l1 - l0) * e);
      if (camera === ortho) { ortho.zoom = z0 + (z1 - z0) * e; ortho.updateProjectionMatrix(); }
      controls.update();
      layoutKey = '';
      if (k >= 1) { anim = null; if (reframeTries < 3) reframeAt = performance.now() + 120; }
    };
    if (ms <= 0) anim(performance.now() + 1);
  }
  // Phones: centre the part in the free band between the badge + view row and
  // the bottom HUD, not in the middle of the canvas (which the overlay covers).
  function freeAreaTarget(name, halfH) {
    const t = [...VIEW_TARGET];
    if (!isPhone()) return t;
    const cr = renderer.domElement.getBoundingClientRect();
    const rb = (id) => document.getElementById(id)?.getBoundingClientRect();
    const row = rb('view-bar'), hud = rb('hud-br'), mag = rb('mag-badge');
    if (!row || !cr.height) return t;
    const freeTop = row.bottom - cr.top;
    const freeBot = Math.min(...[mag].filter((r) => r && r.height).map((r) => r.top - cr.top), cr.height); void hud;
    const px = (freeTop + freeBot) / 2 - cr.height / 2; // + = content should move down
    const mm = (px * 2 * halfH) / cr.height;
    const up = name === 'top' ? [0, 1, 0] : [0, 0, 1]; // screen-up in world for that view
    return t.map((v, i) => v + up[i] * mm);
  }
  /** Named view: 'top' | 'front' | 'side' (ortho) or '3d' (default perspective orbit). */
  function setView(name, { ms = SNAP_MS } = {}) {
    if (name === '3d') {
      setProjection('persp');
      animateTo(isPhone() ? phoneHoleCamera() : DEFAULT_CAMERA, { ms });
    } else {
      setProjection('ortho');
      const halfH = isPhone() ? VIEW_HALF.phone : VIEW_HALF.desktop;
      animateTo(viewPose(name, freeAreaTarget(name, halfH), VIEW_DIST), { halfH, ms });
    }
    viewName = name;
    reframeTries = 0; reframeAt = performance.now() + 100; // slid zone may sit off the snapped view
    onViewChange();
  }
  function resetCamera(view = DEFAULT_CAMERA, name = view === DEFAULT_CAMERA ? '3d' : null) {
    anim = null; reframeAt = 0; // manual fallback: Reset camera is final until the axis changes again
    setProjection('persp');
    camera.position.set(...view.position);
    controls.target.set(...view.target);
    controls.update();
    viewName = name;
    onViewChange();
  }
  // On phones the hole close-up IS the default 3D view.
  const zoomToHole = () => resetCamera(isPhone() ? phoneHoleCamera() : HOLE_CAMERA, isPhone() ? '3d' : null);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    persp.aspect = w / h;
    persp.updateProjectionMatrix();
    if (camera === ortho) fitOrtho(ortho.top); else ortho.updateProjectionMatrix();
    setLineResolution(w, h);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  /**
   * Rebuild the dynamic geometry.
   * @param {object} state  {bottom:{dx,dy}, top:{dx,dy}, magnification, xray}
   * @param {object} result output of evaluatePosition()
   */
  function update(state, result) {
    const M = state.magnification;
    const vb = toVisualXY(TP, state.bottom.dx, state.bottom.dy, M);
    const vt = toVisualXY(TP, state.top.dx, state.top.dy, M);
    for (const child of [...dynamic.children]) disposeObject(child);
    dynamic.add(buildPlate(vb, vt, state.xray));
    const na = notJudged(result.verdict); // neutral gray: position not judged (size rejected / no datums)
    const f = result.freedom;
    const zc = toVisualXY(TP, result.zone.dx, result.zone.dy, M); // zone centre: slid along the freed axes
    const R = visualZoneRadius(result.tolerance, M);
    if (f.slides) dynamic.add(buildFreedom(f, zc, R));
    dynamic.add(buildZone(R, result.inTolerance, M, result.tolerance, na, zc, f.floats));
    fcfLabel.element.innerHTML = fcfDrawingHTML(state, result);
    dynamic.add(buildAxis(vb, vt, result, zc));
    const leader = buildLeader(vt);
    leader.userData.drawing = true;
    leader.visible = showDrawing;
    dynamic.add(leader);
    handles.place(vb, vt, result);
    keyPts = [[zc.x, zc.y, 0], [zc.x, zc.y, H], [vb.x, vb.y, 0], [vt.x, vt.y, H], [(vb.x + vt.x) / 2, (vb.y + vt.y) / 2, H / 2]].map((a) => new THREE.Vector3(...a));
    reframeTries = 0; reframeAt = performance.now() + 250; // auto-reframe after the change settles
    layoutKey = ''; // force callout layout
  }

  // ---- Auto-reframe: keep the hole in view after a big slide (pan, then dolly out only if needed) ----
  renderer.domElement.addEventListener('pointerdown', () => { pointerDown = true; });
  for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => { pointerDown = false; reframeAt = reframeAt ? performance.now() + 150 : 0; });
  /** Returns true if it started a camera move. Never rotates; never runs mid-drag. */
  function reframe() {
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    if (!w || !h || !keyPts.length) return false;
    camera.updateMatrixWorld();
    const cr = renderer.domElement.getBoundingClientRect();
    const rb = (id) => { const e = document.getElementById(id); if (!e || !e.offsetWidth) return null; const b = e.getBoundingClientRect(); return { t: b.top - cr.top, b: b.bottom - cr.top }; };
    const phone = isPhone();
    let top = 8, bot = h - 8;
    if (phone) { // the badge + view row above, the exaggeration badge below
      const sb = rb('status-badge'), vr = rb('view-bar'), mg = rb('mag-badge');
      top = Math.max(top, sb?.b ?? 0, vr?.b ?? 0) + 10;
      if (mg) bot = Math.min(bot, mg.t - 8);
    }
    const region = { l: phone ? 100 : 90, r: w - (phone ? 150 : 170), t: top, b: bot };
    if (region.r - region.l < 40 || region.b - region.t < 40) return false;
    const px = (v) => { const n = v.clone().project(camera); return { x: ((n.x + 1) / 2) * w, y: ((1 - n.y) / 2) * h }; };
    const ctr = px(controls.target);
    const plan = reframePlan(keyPts.map(px), region, ctr);
    if (!plan) return false;
    const dist = camera.position.distanceTo(controls.target);
    const halfH = camera === ortho ? ortho.top / ortho.zoom : dist * tanHalf();
    const mpp = ((2 * halfH) / h) * plan.scale; // world mm per px after the dolly
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const shift = right.multiplyScalar(-plan.dx * mpp).addScaledVector(up, plan.dy * mpp);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const target = controls.target.clone().add(shift);
    const pos = controls.target.clone().addScaledVector(dir, dist * plan.scale).add(shift);
    animateTo({ position: pos.toArray(), target: target.toArray() }, { halfH: camera === ortho ? halfH * plan.scale : null, ms: 320 });
    return true;
  }

  // Place callout labels + leaders (see CALLOUT_PX / CALLOUT_BLEND).
  const _a = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _f = new THREE.Vector3();
  let layoutKey = '';
  let tpLabel = null;
  function layoutCallouts() {
    camera.updateMatrixWorld();
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const key = `${camera.matrixWorld.elements.join(',')}|${camera.projectionMatrix.elements[0]}|${w}x${h}`;
    if (key === layoutKey || !w || !h) return;
    layoutKey = key;
    let unsized = false;
    const dist = effectiveDistance({ ortho: camera === ortho, distance: camera.position.distanceTo(controls.target), halfHeight: ortho.top, zoom: ortho.zoom, fovDeg: persp.fov });
    const t = THREE.MathUtils.smoothstep(dist, CALLOUT_BLEND.near, CALLOUT_BLEND.far); // 0 near .. 1 far
    // verdict badge rect in canvas px (labels are kept out from under it)
    const cr = renderer.domElement.getBoundingClientRect();
    const box = (id) => {
      const el = document.getElementById(id);
      if (!el || !el.offsetWidth) return null;
      const b = el.getBoundingClientRect();
      return { l: b.left - cr.left, r: b.right - cr.left, t: b.top - cr.top, b: b.bottom - cr.top };
    };
    const sb = box('status-badge'), vr = box('view-bar');
    const badge = sb && vr ? { l: Math.min(sb.l, vr.l), r: Math.max(sb.r, vr.r), t: Math.min(sb.t, vr.t), b: Math.max(sb.b, vr.b) } : sb || vr; // labels drop below the badge + view row
    const mag = box('mag-badge'); // labels lift above it
    const chip = box('hud-br'); // phone-only "Show drawing" button + FCF chip (bottom-right)
    const placed = [];
    dynamic.traverse((o) => {
      const c = o.userData.callout;
      if (!c) return;
      // anchor: blend of near/far anchors (world)
      _a.lerpVectors(c.near.anchor, c.far.anchor, t);
      // NEAR target: anchor projected + fixed px; FAR target: fixed world point projected
      _n.copy(c.near.anchor).project(camera);
      _n.x += (2 * c.near.px[0]) / w;
      _n.y -= (2 * c.near.px[1]) / h;
      _f.copy(c.far.at).project(camera);
      _n.lerp(_f, t); // NDC blend
      const cx = c.near.center[0] + t * (c.far.center[0] - c.near.center[0]);
      const cy = c.near.center[1] + t * (c.far.center[1] - c.near.center[1]);
      o.center.set(cx, cy);
      // keep the label box inside the canvas (4 px margin)
      const ew = o.element.offsetWidth;
      const eh = o.element.offsetHeight;
      if (!ew) unsized = true; // not in the DOM yet: lay out again next frame
      let sx = ((_n.x + 1) / 2) * w;
      let sy = ((1 - _n.y) / 2) * h;
      const left = sx - cx * ew, top = sy - cy * eh;
      sx += Math.max(0, 4 - left) - Math.max(0, left + ew - (w - 4));
      sy += Math.max(0, 4 - top) - Math.max(0, top + eh - (h - 4));
      if (badge) {
        const l2 = sx - cx * ew, t2 = sy - cy * eh;
        const under = l2 < badge.r && l2 + ew > badge.l && t2 < badge.b && t2 + eh > badge.t;
        if (under && badge.b + 4 + eh <= h - 4) sy += badge.b + 4 - t2; // drop below the badge
      }
      if (mag) {
        const l2 = sx - cx * ew, t2 = sy - cy * eh;
        const under = l2 < mag.r && l2 + ew > mag.l && t2 < mag.b && t2 + eh > mag.t;
        if (under && mag.t - 4 - eh >= (badge ? badge.b + 4 : 4)) sy -= t2 + eh - (mag.t - 4); // lift above it
      }
      if (chip) {
        const l2 = sx - cx * ew, t2 = sy - cy * eh;
        const under = l2 < chip.r && l2 + ew > chip.l && t2 < chip.b && t2 + eh > chip.t;
        if (under && chip.t - 4 - eh >= (badge ? badge.b + 4 : 4)) sy -= t2 + eh - (chip.t - 4); // lift above it
      }
      _n.x = (sx / w) * 2 - 1;
      _n.y = 1 - (sy / h) * 2;
      _n.unproject(camera);
      o.position.copy(_n);
      c.leader.geometry.setPositions([_a.x, _a.y, _a.z, _n.x, _n.y, _n.z]);
      placed.push({ o, c, sx, sy, l: sx - cx * ew, t: sy - cy * eh, ew, eh, anchor: _a.clone() });
    });
    // The drawing's "True position" note (fixed world point) can land under the
    // badge / view row / exaggeration badge (ortho views, iPad 3D); hide it there.
    if (!tpLabel) staticGroup.traverse((o) => { if (o.element?.classList?.contains('tp-label')) tpLabel = o; });
    if (tpLabel) {
      let hide = false;
      if (tpLabel.element.offsetWidth) { // any projection: never under the overlay
        tpLabel.getWorldPosition(_n).project(camera);
        const ew = tpLabel.element.offsetWidth, eh = tpLabel.element.offsetHeight;
        const l = ((_n.x + 1) / 2) * w - ew / 2, t = ((1 - _n.y) / 2) * h - eh / 2;
        hide = [badge, mag, chip].some((r) => r && l < r.r && l + ew > r.l && t < r.b && t + eh > r.t);
      }
      tpLabel.element.style.visibility = hide ? 'hidden' : '';
    }
    // Ortho views can bring the zone and axis anchors together on screen (top
    // view: the axis is a point inside the zone); stack the later label below.
    if (camera === ortho && placed.length > 1) {
      placed.sort((p, q) => p.t - q.t);
      for (let i = 1; i < placed.length; i++) {
        const p = placed[i - 1], q = placed[i];
        const overlap = q.l < p.l + p.ew && p.l < q.l + q.ew && q.t < p.t + p.eh + 4 && p.t < q.t + q.eh;
        if (!overlap) continue;
        const dy = p.t + p.eh + 4 - q.t;
        const hx = (r, o) => r && o.l < r.r && o.l + o.ew > r.l;
        const floor = Math.min(h - 4, ...[mag, chip].filter((r) => hx(r, q) && r.t > q.t).map((r) => r.t - 4));
        const ceil = Math.max(4, ...[badge].filter((r) => hx(r, p) && r.b < p.t + p.eh).map((r) => r.b + 4));
        // push the lower label down if it fits, else lift the upper one
        const mover = q.t + dy + q.eh <= floor || p.t - dy < ceil ? q : p;
        const shift = mover === q ? dy : -dy;
        mover.sy += shift; mover.t += shift;
        _n.set((mover.sx / w) * 2 - 1, 1 - (mover.sy / h) * 2, 0).unproject(camera);
        mover.o.position.copy(_n);
        mover.c.leader.geometry.setPositions([mover.anchor.x, mover.anchor.y, mover.anchor.z, _n.x, _n.y, _n.z]);
      }
    }
    // Ortho views: TOP/BOTTOM tags go above/below their handle along the
    // SCREEN vertical (in top view both handles coincide), "slide" to the right.
    if (camera === ortho) {
      // Tags sit to the LEFT of their handle (callouts are on the right); in top
      // view, where both handles coincide, TOP goes up and BOTTOM down as well.
      _a.setFromMatrixColumn(camera.matrixWorld, 1).normalize(); // screen up (world)
      _f.setFromMatrixColumn(camera.matrixWorld, 0).normalize(); // screen right (world)
      const pxw = (2 * (ortho.top / ortho.zoom)) / h; // world mm per CSS px
      const lookDown = Math.abs(camera.getWorldDirection(_n).z) > 0.9;
      const [tl, bl, ml] = [handles.labels[0], handles.labels[1], handles.midLabel];
      const off = (lbl, side) => {
        const ew = lbl.element.offsetWidth || 120, eh = lbl.element.offsetHeight || 16;
        // top view: both tags stacked below-left (the "True position" note sits above-left)
        const up = lookDown ? (side > 0 ? -(eh / 2 + 2) : -(eh * 1.5 + 6)) : 0;
        return _f.clone().multiplyScalar(-(ew / 2 + 20) * pxw).add(_a.clone().multiplyScalar(up * pxw));
      };
      tl.userData.base = off(tl, 1);
      bl.userData.base = off(bl, -1);
      ml.userData.base = _f.clone().multiplyScalar(((ml.element.offsetWidth || 30) / 2 + 16) * pxw);
    } else {
      handles.labels[0].userData.base = new THREE.Vector3(0, 0, 2.6);
      handles.labels[1].userData.base = new THREE.Vector3(0, 0, -2.8);
      handles.midLabel.userData.base = new THREE.Vector3(2.6, 0, 0);
    }
    for (const lbl of [...handles.labels, handles.midLabel]) lbl.position.copy(lbl.userData.base);
    // Phones: keep the TOP/BOTTOM readout tags inside the 3D view.
    // Ortho views (any device) also keep them below the badge + view row and
    // above the bottom HUD (exaggeration badge, phone FCF chip / drawing button).
    if (isPhone() || camera === ortho) {
      const orth = camera === ortho;
      for (const lbl of handles.labels) {
        lbl.position.copy(lbl.userData.base);
        const ew = lbl.element.offsetWidth, eh = lbl.element.offsetHeight;
        if (!ew || !lbl.parent) { if (!ew) unsized = true; continue; }
        lbl.getWorldPosition(_n).project(camera);
        if (_n.z < -1 || _n.z > 1) continue;
        const sx = ((_n.x + 1) / 2) * w, sy = ((1 - _n.y) / 2) * h;
        const left = sx - ew / 2, top = sy - eh / 2;
        const dx = Math.max(0, 4 - left) - Math.max(0, left + ew - (w - 4));
        let topMin = 4, botMax = h - 4;
        if (orth) {
          const hx = (r) => r && left + dx < r.r && left + dx + ew > r.l;
          if (hx(badge)) topMin = Math.max(topMin, badge.b + 4);
          for (const r of [mag, chip]) if (hx(r) && r.t > top + eh / 2) botMax = Math.min(botMax, r.t - 4); // only HUD below the tag
          for (const r of [mag]) if (hx(r) && r.b < top + eh / 2) topMin = Math.max(topMin, r.b + 4); // desktop: badge stack above
        }
        const dy = Math.max(0, topMin - top) - Math.max(0, top + eh - botMax);
        if (!dx && !dy) continue;
        _n.x += (2 * dx) / w;
        _n.y -= (2 * dy) / h;
        _n.unproject(camera);
        lbl.position.copy(lbl.parent.worldToLocal(_n));
      }
    }
    // Ortho: if the TOP and BOTTOM tags still meet on screen (e.g. a tilted
    // axis in top view), slide the lower one further down until they clear.
    if (camera === ortho) {
      const [tl, bl] = handles.labels;
      const rect = (lbl) => {
        lbl.getWorldPosition(_n).project(camera);
        const ew = lbl.element.offsetWidth, eh = lbl.element.offsetHeight;
        return { l: ((_n.x + 1) / 2) * w - ew / 2, t: ((1 - _n.y) / 2) * h - eh / 2, ew, eh };
      };
      if (tl.parent && bl.parent && tl.element.offsetWidth && bl.element.offsetWidth) {
        const a = rect(tl), b = rect(bl);
        if (a.l < b.l + b.ew && b.l < a.l + a.ew && a.t < b.t + b.eh + 2 && b.t < a.t + a.eh + 2) {
          const [up, lo, ru, rl] = a.t <= b.t ? [tl, bl, a, b] : [bl, tl, b, a];
          const need = ru.t + ru.eh + 3 - rl.t; // px down for the lower tag
          const pxw = (2 * (ortho.top / ortho.zoom)) / h;
          _a.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
          lo.position.addScaledVector(_a, -need * pxw);
          void up;
        }
        // "slide" tag: lift it clear of either end tag
        const ml = handles.midLabel;
        if (ml.parent && ml.element.offsetWidth) {
          const pxw = (2 * (ortho.top / ortho.zoom)) / h;
          _a.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
          for (const lbl of [tl, bl]) {
            const m = rect(ml), e = rect(lbl);
            if (m.l < e.l + e.ew && e.l < m.l + m.ew && m.t < e.t + e.eh + 2 && e.t < m.t + m.eh + 2) ml.position.addScaledVector(_a, (m.t + m.eh + 3 - e.t) * pxw);
          }
        }
      }
    }
    if (unsized) layoutKey = '';
  }

  function frame(now) {
    if (anim) anim(now);
    if (reframeAt && !anim && !pointerDown && performance.now() >= reframeAt) { reframeAt = 0; if (reframeTries++ < 3) reframe(); }
    controls.update();
    layoutCallouts();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    scene, renderer, controls, handles, update, setDrawing, setDatumsDim, reframe, resetCamera: () => resetCamera(), zoomToHole, domElement: renderer.domElement,
    get camera() { return camera; },
    setView, setProjection, onView: (f) => { viewListeners.push(f); },
    get view() { return { view: viewName, ortho: camera === ortho, animating: !!anim }; },
  };
}

// ---------------------------------------------------------------------------
// Static drawing elements
// ---------------------------------------------------------------------------

let datumSheets = null;
function buildStatic() {
  const g = new THREE.Group();
  g.name = 'static';
  const d = new THREE.Group(); // everything behind the "Show drawing" toggle
  d.name = 'drawing';

  // Datum planes (A primary, B secondary, C tertiary) as translucent sheets.
  const sheet = (w, h, color) =>
    new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
  const pad = 10;
  const a = sheet(L + 2 * pad, W + 2 * pad, COLORS.datumA);
  a.position.set(L / 2, W / 2, -0.4);
  const b = sheet(W + 2 * pad, H + 14, COLORS.datumB);
  b.rotation.set(Math.PI / 2, Math.PI / 2, 0); // into the YZ plane
  b.position.set(-0.4, W / 2, H / 2);
  const c = sheet(L + 2 * pad, H + 14, COLORS.datumC);
  c.rotation.x = Math.PI / 2; // into the XZ plane
  c.position.set(L / 2, -0.4, H / 2);
  d.add(a, b, c);
  datumSheets = { A: a, B: b, C: c };

  // Plane borders
  const rect = (pts, color) => fatLine([...pts, pts[0]], { color, width: 1.5, opacity: 0.7 });
  d.add(rect([[-pad, -pad, -0.4], [L + pad, -pad, -0.4], [L + pad, W + pad, -0.4], [-pad, W + pad, -0.4]], COLORS.datumA));
  d.add(rect([[-0.4, -pad, -7], [-0.4, W + pad, -7], [-0.4, W + pad, H + 7], [-0.4, -pad, H + 7]], COLORS.datumB));
  d.add(rect([[-pad, -0.4, -7], [L + pad, -0.4, -7], [L + pad, -0.4, H + 7], [-pad, -0.4, H + 7]], COLORS.datumC));

  // Datum labels (datum feature symbol style: boxed letter)
  d.add(label('<span class="dfs">A</span><small>primary · bottom face z=0</small>', 'datum datum-a', [L + pad - 2, -pad + 2, -0.4]));
  d.add(label('<span class="dfs">B</span><small>secondary · left edge x=0</small>', 'datum datum-b', [-0.4, W + pad - 4, H + 7]));
  d.add(label('<span class="dfs">C</span><small>tertiary · front edge y=0</small>', 'datum datum-c', [62, -0.4, H + 7]));

  // DRF origin axes
  const axLen = 14;
  for (const [dir, name] of [[[axLen, 0, 0], '+X'], [[0, axLen, 0], '+Y'], [[0, 0, axLen], '+Z']]) {
    d.add(fatLine([[0, 0, 0], dir], { color: COLORS.ink, width: 2.5 }));
    if (name !== '+Z') d.add(arrowHead([0, 0, 0], dir, 2.2, { color: COLORS.ink, width: 2.5 }));
    d.add(label(name, 'axis-label', dir.map((v) => v * 1.12)));
  }
  d.add(label('origin (A∩B∩C)', 'axis-label small', [-2, -2, -2]));

  // True position: dashed basic axis through the zone, plus crosshair on top face
  g.add(fatLine([[TP.x, TP.y, -8], [TP.x, TP.y, H + 9]], { color: COLORS.truePos, width: 2, dashed: true, dashSize: 1.2, gapSize: 0.9 }));
  d.add(label(`True position<br><b>(${fmt(TP.x)}, ${fmt(TP.y)})</b>`, 'tp-label', [TP.x - 9, TP.y + 4, H + 12]));

  // BASIC dimensions on the top face (boxed numbers = basic)
  const z = H + 0.05;
  const yDimX = W - 6; // the X dimension line runs along y = 54
  const xDimY = 12; // the Y dimension line runs along x = 12
  const dimOpts = { color: COLORS.ink, width: 2 };
  const extOpts = { color: COLORS.ink, width: 1.2, dashed: true, dashSize: 0.8, gapSize: 0.6 };
  // 35 from B
  d.add(fatLine([[0, yDimX, z], [TP.x, yDimX, z]], dimOpts));
  d.add(arrowHead([TP.x, yDimX, z], [0, yDimX, z], 2.2, dimOpts));
  d.add(arrowHead([0, yDimX, z], [TP.x, yDimX, z], 2.2, dimOpts));
  d.add(fatLine([[TP.x, TP.y + HOLE_R + 2, z], [TP.x, yDimX + 2, z]], extOpts));
  d.add(label(`<span class="basic">${SPEC.basic.fromB}</span>`, 'dim', [TP.x / 2, yDimX, z]));
  // 30 from C
  d.add(fatLine([[xDimY, 0, z], [xDimY, TP.y, z]], dimOpts));
  d.add(arrowHead([xDimY, TP.y, z], [xDimY, 0, z], 2.2, dimOpts));
  d.add(arrowHead([xDimY, 0, z], [xDimY, TP.y, z], 2.2, dimOpts));
  d.add(fatLine([[TP.x - HOLE_R - 2, TP.y, z], [xDimY - 2, TP.y, z]], extOpts));
  d.add(label(`<span class="basic">${SPEC.basic.fromC}</span>`, 'dim', [xDimY, TP.y / 2, z]));

  // Feature control frame + size callout (content set in update(): follows stated tolerance / Ⓜ)
  fcfLabel = label(fcfDrawingHTML({ stated: SPEC.position.tolerance, modifier: SPEC.position.modifier }), 'fcf-label', FCF_ANCHOR);
  d.add(fcfLabel);
  g.add(d);
  return g;
}

const FCF_ANCHOR = [TP.x + 30, TP.y + 20, H];
let fcfLabel = null;
function fcfDrawingHTML(state, result) {
  const vc = state.modifier !== 'RFS' ? `<div class="vc-note">${state.modifier === 'LMC' ? 'LMC ' : ''}virtual condition ⌀${fmtNote(state.modifier === 'LMC' ? SPEC.hole.lmc + state.stated : SPEC.hole.mmc - state.stated)}</div>${state.modifier === 'LMC' ? `<div class="vc-note rc-note">LMC resultant condition ⌀${fmtUp(Math.ceil((SPEC.hole.mmc - (state.stated + SPEC.hole.lmc - SPEC.hole.mmc)) * 1e4 - 1e-6) / 1e4)}</div>` : ''}` : '';
  return `<div class="callout">⌀${SPEC.hole.nominal} ±${SPEC.hole.plusMinus} THRU</div>${fcfHTML(state)}${vc}`;
}

// ---------------------------------------------------------------------------
// Dynamic part
// ---------------------------------------------------------------------------

/** Plate with a (possibly tilted) through hole whose ends sit at vb / vt. */
function buildPlate(vb, vt, xray) {
  const g = new THREE.Group();
  g.name = 'plate';
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS.plate,
    flatShading: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: xray ? 0.55 : 1,
    depthWrite: !xray,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const boreMat = mat.clone();
  boreMat.color.set(COLORS.bore);

  const face = (c, z) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(L, 0);
    s.lineTo(L, W);
    s.lineTo(0, W);
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(c.x, c.y, HOLE_R, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const geo = new THREE.ShapeGeometry(s, 48);
    geo.translate(0, 0, z);
    return new THREE.Mesh(geo, mat);
  };
  g.add(face(vb, 0), face(vt, H));

  // Four side walls
  const corners = [[0, 0], [L, 0], [L, W], [0, W]];
  const pos = [];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = corners[i];
    const [x1, y1] = corners[(i + 1) % 4];
    pos.push(x0, y0, 0, x1, y1, 0, x1, y1, H, x0, y0, 0, x1, y1, H, x0, y0, H);
  }
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sides.computeVertexNormals();
  g.add(new THREE.Mesh(sides, mat));

  // Bore: open cylinder sheared so its ends sit on vb (z=0) and vt (z=H)
  const bore = new THREE.CylinderGeometry(HOLE_R, HOLE_R, H, 64, 1, true);
  bore.rotateX(Math.PI / 2);
  bore.translate(0, 0, H / 2);
  const p = bore.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = p.getZ(i) / H;
    p.setX(i, p.getX(i) + vb.x + s * (vt.x - vb.x));
    p.setY(i, p.getY(i) + vb.y + s * (vt.y - vb.y));
  }
  bore.computeVertexNormals();
  g.add(new THREE.Mesh(bore, boreMat));

  // Bold outlines
  const ol = { color: COLORS.ink, width: 3 };
  const top = corners.map(([x, y]) => [x, y, H]);
  const bot = corners.map(([x, y]) => [x, y, 0]);
  g.add(fatLine([...top, top[0]], ol), fatLine([...bot, bot[0]], ol));
  for (const [x, y] of corners) g.add(fatLine([[x, y, 0], [x, y, H]], ol));
  g.add(fatLine(circlePoints(vt.x, vt.y, H, HOLE_R), ol));
  g.add(fatLine(circlePoints(vb.x, vb.y, 0, HOLE_R), { ...ol, width: 2 }));
  return g;
}

/**
 * Freed degrees of freedom: a translucent slab (visible in every view) over the
 * path the zone may sweep, plus double arrows beside the zone on the top face.
 * X free (B dropped): slab along X. Y free (C dropped): slab along Y. Both: a cross.
 */
function buildFreedom(f, c, R) {
  const g = new THREE.Group();
  g.name = 'freedom';
  const color = COLORS.free;
  const slab = (cx, cy, sx, sy) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, H),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false, depthTest: false }),
    );
    mesh.position.set(cx, cy, H / 2);
    mesh.renderOrder = 3;
    g.add(mesh);
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2;
    for (const z of [0, H]) g.add(fatLine([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z]], { color, width: 1.5, dashed: true, dashSize: 1.4, gapSize: 1, onTop: true, opacity: 0.9 }));
  };
  const arrows = (dx, dy) => {
    const o = R + 2, len = 10;
    for (const s of [1, -1]) {
      const from = [c.x + s * dx * o, c.y + s * dy * o, H], to = [c.x + s * dx * (o + len), c.y + s * dy * (o + len), H];
      g.add(fatLine([from, to], { color, width: 3, onTop: true }), arrowHead(from, to, 3.2, { color, width: 3, onTop: true }));
    }
  };
  // Best-fit zone centre (automatic, display only): a small diamond on the top and bottom faces + the zone centreline.
  const d = 1.6;
  for (const z of [0, H]) g.add(fatLine([[c.x, c.y - d, z], [c.x + d, c.y, z], [c.x, c.y + d, z], [c.x - d, c.y, z], [c.x, c.y - d, z]], { color, width: 3, onTop: true }));
  g.add(fatLine([[c.x, c.y, 0], [c.x, c.y, H]], { color, width: 1.5, dashed: true, dashSize: 0.8, gapSize: 0.6, onTop: true }));
  if (f.freeX) { slab(L / 2, c.y, L - 2, 2 * R); arrows(1, 0); }
  if (f.freeY) { slab(c.x, W / 2, 2 * R, W - 2); arrows(0, 1); }
  return g;
}

/** Translucent cylinder: zone of visual radius R, coaxial with true position, z = 0..H. */
function buildZone(R, inTol, M, allowed, na = false, zc = { x: TP.x, y: TP.y }, floats = false) {
  const color = na ? COLORS.na : inTol ? COLORS.in : COLORS.out;
  const g = new THREE.Group();
  g.name = 'zone';
  const geo = new THREE.CylinderGeometry(R, R, H, 64, 1, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(zc.x, zc.y, H / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
  );
  mesh.renderOrder = 5;
  g.add(mesh);
  const o = { color, width: 3.5, onTop: true };
  g.add(fatLine(circlePoints(zc.x, zc.y, 0, R), o), fatLine(circlePoints(zc.x, zc.y, H, R), o));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    const x = zc.x + R * Math.cos(a);
    const y = zc.y + R * Math.sin(a);
    g.add(fatLine([[x, y, 0], [x, y, H]], { color, width: 1.5, onTop: true, opacity: 0.8 }));
  }
  // Label so the cylinder is not mistaken for a gage pin. Anchored on the zone's
  // +X side at the top; placed CALLOUT_PX.zone screen px to the right
  // (the "hole's actual axis" label sits lower right), clear of the TOP/BOTTOM
  // handle labels at any zoom.
  const anchor = new THREE.Vector3(zc.x + R, zc.y, H);
  const leader = fatLine([anchor.toArray(), anchor.toArray()], { color, width: 2, onTop: true });
  const factor = M === 1 ? 'shown ×1, true size' : `shown ×${M}`;
  const zl = label(`position zone ⌀${fmtLimit(allowed)}<br>${floats ? 'floats free: no datums' : `(${factor}, not a pin)`}`, `zone-label ${na ? 'na' : inTol ? 'pass' : 'fail'}`, anchor.toArray());
  zl.userData.callout = {
    leader,
    near: { anchor, px: CALLOUT_PX.zone, center: [0, 0.5] }, // left edge at leader end
    far: { anchor: new THREE.Vector3(zc.x, zc.y - R, 0), at: new THREE.Vector3(zc.x + 2, zc.y - Math.max(R, 6) - 16, 0), center: [0.5, 0] }, // hangs below
  };
  g.add(leader, zl);
  return g;
}

/** Actual hole axis (bold), plus radial "r" ticks from true position at each end. */
function buildAxis(vb, vt, result, zc = TP) {
  const g = new THREE.Group();
  g.name = 'axis';
  const na = notJudged(result.verdict);
  const color = na ? COLORS.na : result.inTolerance ? COLORS.in : COLORS.out;
  // faint extension beyond the zone ends
  const ext = 4;
  const dx = (vt.x - vb.x) / H;
  const dy = (vt.y - vb.y) / H;
  g.add(fatLine([[vb.x - dx * ext, vb.y - dy * ext, -ext], [vb.x, vb.y, 0]], { color, width: 2, onTop: true, opacity: 0.45 }));
  g.add(fatLine([[vt.x, vt.y, H], [vt.x + dx * ext, vt.y + dy * ext, H + ext]], { color, width: 2, onTop: true, opacity: 0.45 }));
  g.add(fatLine([[vb.x, vb.y, 0], [vt.x, vt.y, H]], { color, width: 7, onTop: true }));
  // "hole's actual axis" label: anchored 10% up the axis, placed CALLOUT_PX.axis
  // screen px to the lower right (leader length scales with camera distance).
  const s = 0.1;
  const anchor = new THREE.Vector3(vb.x + s * (vt.x - vb.x), vb.y + s * (vt.y - vb.y), s * H);
  const leader = fatLine([anchor.toArray(), anchor.toArray()], { color, width: 2, onTop: true });
  const al = label("hole's actual axis", `axis-name-label ${na ? 'na' : result.inTolerance ? 'pass' : 'fail'}`, anchor.toArray());
  const farAnchor = new THREE.Vector3(vb.x + 0.3 * (vt.x - vb.x), vb.y + 0.3 * (vt.y - vb.y), 0.3 * H);
  al.userData.callout = {
    leader,
    near: { anchor, px: CALLOUT_PX.axis, center: [0, 0.5] }, // left edge at leader end
    far: { anchor: farAnchor, at: new THREE.Vector3(vb.x + HOLE_R + 26, vb.y - 13, 0), center: [0, 0.5] },
  };
  g.add(leader, al);
  // radial offset r at each end (true position -> endpoint)
  for (const [v, z, end] of [[vb, 0, result.bottom], [vt, H, result.top]]) {
    g.add(fatLine([[zc.x, zc.y, z], [v.x, v.y, z]], { color: na ? COLORS.na : end.inside ? COLORS.in : COLORS.out, width: 2, dashed: true, dashSize: 0.6, gapSize: 0.4, onTop: true }));
  }
  return g;
}

function buildLeader(vt) {
  const tip = new THREE.Vector2(FCF_ANCHOR[0] - vt.x, FCF_ANCHOR[1] - vt.y).normalize().multiplyScalar(HOLE_R);
  return fatLine([[vt.x + tip.x, vt.y + tip.y, H], [FCF_ANCHOR[0] - 4, FCF_ANCHOR[1] - 2, H]], { color: COLORS.ink, width: 2 });
}

// ---------------------------------------------------------------------------
// Drag handles (always drawn on top so they can be grabbed through the plate)
// ---------------------------------------------------------------------------

function buildHandles() {
  const group = new THREE.Group();
  group.name = 'handles';
  const make = (kind, radius, color) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 16),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }),
    );
    m.renderOrder = 20;
    m.userData.kind = kind;
    const ring = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.25, 24, 16),
      new THREE.MeshBasicMaterial({ color: COLORS.ink, depthTest: false, transparent: true, side: THREE.BackSide }),
    );
    ring.renderOrder = 19;
    ring.raycast = () => {};
    m.add(ring);
    group.add(m);
    return m;
  };
  const top = make('top', 1.5, COLORS.in);
  const bottom = make('bottom', 1.5, COLORS.in);
  const mid = make('mid', 1.1, 0xffffff);
  const topLabel = label('TOP z=10', 'handle-label', [0, 0, 2.6]);
  const botLabel = label('BOTTOM z=0', 'handle-label', [0, 0, -2.8]);
  const midLabel = label('slide', 'handle-label muted', [2.6, 0, 0]);
  midLabel.userData.base = midLabel.position.clone();
  top.add(topLabel);
  bottom.add(botLabel);
  mid.add(midLabel);
  for (const l of [topLabel, botLabel]) l.userData.base = l.position.clone();

  function place(vb, vt, result) {
    bottom.position.set(vb.x, vb.y, 0);
    top.position.set(vt.x, vt.y, H);
    mid.position.set((vb.x + vt.x) / 2, (vb.y + vt.y) / 2, H / 2);
    const na = notJudged(result.verdict); // size rejected / no datums: handles neutral, r for information
    bottom.material.color.set(na ? COLORS.na : result.bottom.inside ? COLORS.in : COLORS.out);
    top.material.color.set(na ? COLORS.na : result.top.inside ? COLORS.in : COLORS.out);
    const txt = (name, e) => (result.verdict === 'NO_DATUMS' ? `${name} (no datums: floats)` : na ? `${name} r=${fmtUp(e.r)} (size rejected)`
      : `${name} r=${fmtAgainst(e.r, result.radius, e.inside)} ${e.inside ? '≤' : '>'} ${fmtLimit(result.radius)} ${e.inside ? '✔' : '✘'}`);
    topLabel.element.textContent = txt('TOP z=10', result.top);
    botLabel.element.textContent = txt('BOTTOM z=0', result.bottom);
  }
  return { group, top, bottom, mid, list: [top, bottom, mid], labels: [topLabel, botLabel], midLabel, place };
}
