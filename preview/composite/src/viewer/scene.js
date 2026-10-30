// Lesson 2 scene: plate with a 4-hole pattern, the fixed ⌀0.50 upper-row zones (green),
// the ⌀0.10 lower-row set at its best-fit placement (blue), the actual axes and drag handles.
// Display exaggeration: every deviation is drawn ×M about each hole's own true position
// (visual = b + M·(p − b)); zone radii ×M too, so IN/OUT on screen matches the math.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { PLATE, BASIC, CEN, R_UP, R_LO, HOLE_NAMES } from '../composite.js';
import { viewPose } from '../views.js';
import { COLORS, fatLine, circlePoints, arrowHead, label, disposeObject, setLineResolution } from './primitives.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const { x: L, y: W, z: H } = PLATE;
const HOLE_R = 10.1 / 2;
export const BLUE = 0x2563eb;
const BLUE_FILL = 0x3b82f6;
export const PHONE_QUERY = '(max-width: 700px), (max-height: 500px)';
export const isPhone = () => window.matchMedia(PHONE_QUERY).matches;
export const DEFAULT_CAMERA = Object.freeze({ position: [-22, -88, 92], target: [47, 30, 0] });
const VIEW_TARGET = [CEN[0], CEN[1], H / 2];
const VIEW_DIST = 160;
const SNAP_MS = 420;
export const ROT_ARM = 13; // visual length of the rotate-handle arm (mm, not scaled)

/** Visual XY of a real point p belonging to hole i at magnification M. */
export const vis = (i, p, M) => [BASIC[i][0] + M * (p[0] - BASIC[i][0]), BASIC[i][1] + M * (p[1] - BASIC[i][1])];

export function createViewer(container) {
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
  let camera = persp;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  let viewName = '3d', anim = null;
  const viewListeners = [];
  const onViewChange = () => viewListeners.forEach((f) => f({ view: viewName, ortho: camera === ortho }));
  controls.addEventListener('start', () => { if (!anim) { viewName = null; onViewChange(); } });

  scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-40, -80, 120);
  scene.add(sun);
  const staticGroup = buildStatic();
  scene.add(staticGroup);
  const drawing = staticGroup.getObjectByName('drawing');
  const dynamic = new THREE.Group();
  scene.add(dynamic);
  const handles = buildHandles();
  scene.add(handles.group);

  const tanHalf = () => Math.tan((persp.fov * Math.PI) / 360);
  const aspect = () => (container.clientWidth || 1) / (container.clientHeight || 1);
  const fitOrtho = (halfH) => { ortho.top = halfH; ortho.bottom = -halfH; ortho.left = -halfH * aspect(); ortho.right = halfH * aspect(); ortho.updateProjectionMatrix(); };
  // Narrow canvases (phones, portrait): pull the overview back so the whole plate fits.
  const fitScale = () => Math.min(2.4, Math.max(1, 1.45 / aspect()));
  const overview = () => {
    // phones: the badge + view row cover the top of the canvas, so aim higher (part sits lower) and pull back
    const t = isPhone() ? [DEFAULT_CAMERA.target[0], DEFAULT_CAMERA.target[1] + 9, DEFAULT_CAMERA.target[2] + 8] : DEFAULT_CAMERA.target, s = fitScale() * (isPhone() ? 1.18 : 1);
    return { position: DEFAULT_CAMERA.position.map((p, i) => t[i] + s * (p - t[i])), target: [...t] };
  };
  function setProjection(kind) {
    const want = kind === 'ortho' ? ortho : persp;
    if (want === camera) return;
    const dist = camera.position.distanceTo(controls.target);
    if (want === ortho) { fitOrtho(dist * tanHalf()); ortho.zoom = 1; ortho.position.copy(persp.position); ortho.up.copy(persp.up); }
    else { const halfH = ortho.top / ortho.zoom; const dir = ortho.position.clone().sub(controls.target).normalize(); persp.position.copy(controls.target).addScaledVector(dir, halfH / tanHalf()); }
    want.updateProjectionMatrix();
    camera = want; controls.object = camera; controls.update(); onViewChange();
  }
  function animateTo(pose, { halfH = null, ms = SNAP_MS } = {}) {
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const p1 = new THREE.Vector3(...pose.position), t1 = new THREE.Vector3(...pose.target);
    const d0 = p0.clone().sub(t0), d1 = p1.clone().sub(t1);
    const l0 = d0.length(), l1 = d1.length(), u0 = d0.normalize(), u1 = d1.normalize();
    const z0 = camera === ortho ? ortho.zoom : 1, z1 = camera === ortho && halfH ? ortho.top / halfH : z0;
    const start = performance.now();
    anim = (now) => {
      const k = Math.min(1, (now - start) / Math.max(ms, 1)), e = k * k * (3 - 2 * k);
      const u = u0.clone().lerp(u1, e); if (u.lengthSq() < 1e-8) u.copy(u1); u.normalize();
      controls.target.lerpVectors(t0, t1, e);
      camera.position.copy(controls.target).addScaledVector(u, l0 + (l1 - l0) * e);
      if (camera === ortho) { ortho.zoom = z0 + (z1 - z0) * e; ortho.updateProjectionMatrix(); }
      controls.update();
      if (k >= 1) anim = null;
    };
    if (ms <= 0) anim(performance.now() + 1);
  }
  const halfFor = () => { const a = aspect(); return Math.max(36, 58 / a) * (isPhone() ? 1.5 : 1); };
  // phones: the overlay covers the top of the canvas, so the view centre sits higher (part lower)
  const orthoTarget = (name, halfH) => {
    if (!isPhone()) return VIEW_TARGET;
    const up = name === 'top' ? [0, 1, 0] : [0, 0, 1];
    const right = name === 'side' ? [0, 1, 0] : [1, 0, 0]; // and a little right of centre: the HUD sits bottom-right
    return VIEW_TARGET.map((v, i) => v + up[i] * 0.2 * halfH + right[i] * 0.16 * halfH * aspect());
  };
  function setView(name, { ms = SNAP_MS } = {}) {
    if (name === '3d') { setProjection('persp'); animateTo(overview(), { ms }); }
    else { setProjection('ortho'); fitOrtho(halfFor()); const halfH = halfFor(); animateTo(viewPose(name, orthoTarget(name, halfH), VIEW_DIST), { halfH, ms }); }
    viewName = name; onViewChange();
  }
  function resetCamera() { setProjection('persp'); const p = overview(); camera.position.set(...p.position); controls.target.set(...p.target); controls.update(); viewName = '3d'; onViewChange(); }
  function zoomToHole(i) {
    setProjection('persp');
    const [bx, by] = BASIC[i];
    animateTo({ position: [bx - 14, by - 34, 36], target: [bx, by, 4] });
    viewName = null; onViewChange();
  }
  resetCamera();

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`; renderer.domElement.style.height = `${h}px`;
    labelRenderer.setSize(w, h);
    persp.aspect = w / h; persp.updateProjectionMatrix();
    const halfH = ortho.top; fitOrtho(halfH);
    setLineResolution(w, h);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  /** Rebuild the dynamic part from state + evaluation. */
  function update(state, res, devs) {
    for (const ch of [...dynamic.children]) disposeObject(ch);
    const M = state.magnification;
    const na = res.code === 'REJECT_SIZE';
    const holes = res.holes;
    const vb = holes.map(([pb], i) => vis(i, pb, M));
    const vt = holes.map(([, pt], i) => vis(i, pt, M));
    dynamic.add(buildPlate(vb, vt, state.xray));
    const q = res.lowerCentres.map((c, i) => vis(i, c, M));
    for (let i = 0; i < 4; i++) {
      const upCol = na ? COLORS.na : res.upOk[i] ? COLORS.in : COLORS.out;
      dynamic.add(buildZone(BASIC[i], R_UP * M, COLORS.in, upCol, 0.16, 5, `upper-${i}`));
      const loCol = na ? COLORS.na : res.loOk ? BLUE : COLORS.out;
      dynamic.add(buildZone(q[i], R_LO * M, BLUE_FILL, loCol, 0.42, 7, `lower-${i}`));
      const axCol = na ? COLORS.na : !res.upOk[i] || res.failLower.includes(HOLE_NAMES[i]) ? COLORS.out : COLORS.in;
      dynamic.add(buildAxis(vb[i], vt[i], axCol));
    }
    // the blue set's frame: a thin rectangle through the 4 lower-zone centres (shows the set moves as one)
    dynamic.add(fatLine([...[0, 1, 3, 2, 0].map((k) => [q[k][0], q[k][1], H + 0.15])], { color: BLUE, width: 1.5, dashed: true, dashSize: 1.4, gapSize: 1, onTop: true, opacity: 0.8 }));
    drawing.visible = !!state.drawing;
    handles.place(state, res, vb, vt, M);
    void devs;
  }

  function frame() {
    if (anim) anim(performance.now());
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    scene, renderer, controls, handles, update, resetCamera, zoomToHole, setView, setProjection, domElement: renderer.domElement,
    get camera() { return camera; },
    onView: (f) => viewListeners.push(f),
    get view() { return { view: viewName, ortho: camera === ortho, animating: !!anim }; },
  };
}

function buildStatic() {
  const g = new THREE.Group();
  const d = new THREE.Group();
  d.name = 'drawing';
  const sheet = (w, h, color) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  const pad = 10;
  const a = sheet(L + 2 * pad, W + 2 * pad, COLORS.datumA); a.position.set(L / 2, W / 2, -0.4);
  const b = sheet(W + 2 * pad, H + 14, COLORS.datumB); b.rotation.set(Math.PI / 2, Math.PI / 2, 0); b.position.set(-0.4, W / 2, H / 2);
  const c = sheet(L + 2 * pad, H + 14, COLORS.datumC); c.rotation.x = Math.PI / 2; c.position.set(L / 2, -0.4, H / 2);
  d.add(a, b, c);
  const rect = (pts, color) => fatLine([...pts, pts[0]], { color, width: 1.5, opacity: 0.7 });
  d.add(rect([[-pad, -pad, -0.4], [L + pad, -pad, -0.4], [L + pad, W + pad, -0.4], [-pad, W + pad, -0.4]], COLORS.datumA));
  d.add(rect([[-0.4, -pad, -7], [-0.4, W + pad, -7], [-0.4, W + pad, H + 7], [-0.4, -pad, H + 7]], COLORS.datumB));
  d.add(rect([[-pad, -0.4, -7], [L + pad, -0.4, -7], [L + pad, -0.4, H + 7], [-pad, -0.4, H + 7]], COLORS.datumC));
  d.add(label('<span class="dfs">A</span><small>primary · bottom face z=0</small>', 'datum datum-a', [L + pad - 2, -pad + 2, -0.4]));
  d.add(label('<span class="dfs">B</span><small>secondary · left edge x=0</small>', 'datum datum-b', [-0.4, W + pad - 4, H + 7]));
  d.add(label('<span class="dfs">C</span><small>tertiary · front edge y=0</small>', 'datum datum-c', [92, -0.4, H + 7]));
  const axLen = 14;
  for (const [dir, name] of [[[axLen, 0, 0], '+X'], [[0, axLen, 0], '+Y'], [[0, 0, axLen], '+Z']]) {
    d.add(fatLine([[0, 0, 0], dir], { color: COLORS.ink, width: 2.5 }));
    if (name !== '+Z') d.add(arrowHead([0, 0, 0], dir, 2.2, { color: COLORS.ink, width: 2.5 }));
    d.add(label(name, 'axis-label', dir.map((v) => v * 1.12)));
  }
  // true-position axes (dashed), one per hole
  for (const [x, y] of BASIC) g.add(fatLine([[x, y, -6], [x, y, H + 7]], { color: COLORS.truePos, width: 2, dashed: true, dashSize: 1.2, gapSize: 0.9 }));
  // BASIC dimensions on the top face: 25 from B then 50 between columns; 15 from C then 30 between rows
  const z = H + 0.05, dim = { color: COLORS.ink, width: 2 }, ext = { color: COLORS.ink, width: 1.2, dashed: true, dashSize: 0.8, gapSize: 0.6 };
  const dimLine = (p0, p1, text, at) => {
    d.add(fatLine([p0, p1], dim), arrowHead(p1, p0, 2, dim), arrowHead(p0, p1, 2, dim));
    d.add(label(`<span class="basic">${text}</span>`, 'dim', at));
  };
  const yd = W - 4; // X chain along y = 56
  dimLine([0, yd, z], [25, yd, z], '25', [12.5, yd, z]);
  dimLine([25, yd, z], [75, yd, z], '50', [50, yd, z]);
  for (const x of [25, 75]) d.add(fatLine([[x, 45 + HOLE_R + 1.5, z], [x, yd + 1.5, z]], ext));
  const xd = 6; // Y chain along x = 6
  dimLine([xd, 0, z], [xd, 15, z], '15', [xd, 7.5, z]);
  dimLine([xd, 15, z], [xd, 45, z], '30', [xd, 30, z]);
  for (const y of [15, 45]) d.add(fatLine([[25 - HOLE_R - 1.5, y, z], [xd - 1.5, y, z]], ext));
  g.add(d);
  return g;
}

function buildPlate(vb, vt, xray) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(L, 0); shape.lineTo(L, W); shape.lineTo(0, W); shape.lineTo(0, 0);
  for (let i = 0; i < 4; i++) {
    const k = (v, lo, hi) => Math.max(lo, Math.min(hi, v)); // huge ×N: keep the cut inside the plate
    const cx = k((vb[i][0] + vt[i][0]) / 2, HOLE_R + 0.5, L - HOLE_R - 0.5), cy = k((vb[i][1] + vt[i][1]) / 2, HOLE_R + 0.5, W - HOLE_R - 0.5);
    const p = new THREE.Path(); p.absarc(cx, cy, HOLE_R, 0, Math.PI * 2, true); shape.holes.push(p);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false, curveSegments: 48 });
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COLORS.plate, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: xray ? 0.55 : 1, depthWrite: !xray }));
  g.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.6 }));
  g.add(edges);
  // bore rims follow each axis end (a tilted hole shows offset rims)
  for (let i = 0; i < 4; i++) {
    g.add(fatLine(circlePoints(vb[i][0], vb[i][1], 0, HOLE_R), { color: COLORS.bore, width: 2 }));
    g.add(fatLine(circlePoints(vt[i][0], vt[i][1], H, HOLE_R), { color: COLORS.bore, width: 2 }));
  }
  return g;
}

/** Cylinder zone ⟂ A, z = 0..H, visual radius R at c; translucent fill + outline in `edge`. */
function buildZone(c, R, fill, edge, opacity, order, name) {
  const g = new THREE.Group();
  g.name = name;
  const geo = new THREE.CylinderGeometry(R, R, H, 64, 1, true);
  geo.rotateX(Math.PI / 2); geo.translate(c[0], c[1], H / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
  mesh.renderOrder = order;
  g.add(mesh);
  const o = { color: edge, width: order > 5 ? 2.5 : 3, onTop: true };
  g.add(fatLine(circlePoints(c[0], c[1], 0, R), o), fatLine(circlePoints(c[0], c[1], H, R), o));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    g.add(fatLine([[c[0] + R * Math.cos(a), c[1] + R * Math.sin(a), 0], [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a), H]], { color: edge, width: 1.2, onTop: true, opacity: 0.7 }));
  }
  return g;
}

function buildAxis(vb, vt, color) {
  const g = new THREE.Group();
  const dx = (vt[0] - vb[0]) / H, dy = (vt[1] - vb[1]) / H, e = 3;
  g.add(fatLine([[vb[0] - dx * e, vb[1] - dy * e, -e], [vb[0], vb[1], 0]], { color, width: 2, onTop: true, opacity: 0.45 }));
  g.add(fatLine([[vt[0], vt[1], H], [vt[0] + dx * e, vt[1] + dy * e, H + e]], { color, width: 2, onTop: true, opacity: 0.45 }));
  g.add(fatLine([[vb[0], vb[1], 0], [vt[0], vt[1], H]], { color, width: 6, onTop: true }));
  return g;
}

function buildHandles() {
  const group = new THREE.Group();
  const list = [];
  const make = (kind, hole, radius, color) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
    m.renderOrder = 20; m.userData = { kind, hole };
    const ring = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.25, 20, 14), new THREE.MeshBasicMaterial({ color: COLORS.ink, depthTest: false, transparent: true, side: THREE.BackSide }));
    ring.renderOrder = 19; ring.raycast = () => {};
    m.add(ring); group.add(m); list.push(m);
    return m;
  };
  const per = [0, 1, 2, 3].map((i) => {
    const top = make('top', i, 0.8, COLORS.in), bottom = make('bottom', i, 0.8, COLORS.in), mid = make('mid', i, 0.6, 0xffffff);
    // name tag beside the hole, outward from the pattern centre (never on top of the zones)
    const [bx, by] = BASIC[i], ox = Math.sign(bx - CEN[0]), oy = Math.sign(by - CEN[1]);
    const tag = label(HOLE_NAMES[i], 'handle-label hole-tag', [bx + ox * 9.5, by + oy * 8.5, H]);
    group.add(tag);
    return { top, bottom, mid, tag };
  });
  const move = make('move', -1, 1.5, BLUE);
  const rot = make('rot', -1, 1.2, 0xffffff);
  move.add(label('pattern', 'handle-label pattern-tag', [0, -3.2, 0]));
  rot.add(label('rotate', 'handle-label pattern-tag', [0, 3, 0]));
  const arm = new THREE.Group(); group.add(arm);
  function place(state, res, vb, vt, M) {
    const na = res.code === 'REJECT_SIZE';
    per.forEach((h, i) => {
      h.bottom.position.set(vb[i][0], vb[i][1], 0);
      h.top.position.set(vt[i][0], vt[i][1], H);
      h.mid.position.set((vb[i][0] + vt[i][0]) / 2, (vb[i][1] + vt[i][1]) / 2, H / 2);
      const ok = res.upOk[i] && !res.failLower.includes(HOLE_NAMES[i]);
      const col = na ? COLORS.na : ok ? COLORS.in : COLORS.out;
      h.top.material.color.set(col); h.bottom.material.color.set(col);
      h.tag.element.classList.toggle('sel', state.selected === i);
      const out = !na && res.outlier === HOLE_NAMES[i];
      h.tag.element.classList.toggle('outlier', out);
      h.tag.element.textContent = out ? `${HOLE_NAMES[i]} · the outlier` : HOLE_NAMES[i];
    });
    const p = state.pattern;
    const c = [CEN[0] + M * p.tx, CEN[1] + M * p.ty];
    const a = (M * p.deg * Math.PI) / 180; // drawn turn (exaggerated like the corner moves)
    move.position.set(c[0], c[1], H + 0.2);
    rot.position.set(c[0] + ROT_ARM * Math.cos(a), c[1] + ROT_ARM * Math.sin(a), H + 0.2);
    for (const ch of [...arm.children]) disposeObject(ch);
    arm.add(fatLine([[c[0], c[1], H + 0.2], rot.position.toArray()], { color: BLUE, width: 2, onTop: true }));
    arm.add(fatLine(circlePoints(c[0], c[1], H + 0.2, ROT_ARM, 72), { color: BLUE, width: 1, onTop: true, opacity: 0.35, dashed: true, dashSize: 1, gapSize: 1 }));
  }
  return { group, list, per, move, rot, place };
}
