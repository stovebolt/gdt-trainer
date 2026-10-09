// Scene building: static drawing elements (datums, basic dimensions, true
// position, FCF) and the dynamic part (plate with hole, tolerance zone, actual
// axis, drag handles) that is rebuilt from the evaluated state.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { SPEC } from '../config.js';
import { fmt, fmtAgainst } from '../format.js';
import { toVisualXY, visualZoneRadius } from '../exaggeration.js';
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

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf8fafc);
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  resetCamera();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-40, -80, 120);
  scene.add(sun);

  scene.add(buildStatic());

  const dynamic = new THREE.Group();
  scene.add(dynamic);
  const handles = buildHandles();
  scene.add(handles.group);

  function resetCamera(view = DEFAULT_CAMERA) {
    camera.position.set(...view.position);
    controls.target.set(...view.target);
    controls.update();
  }
  const zoomToHole = () => resetCamera(isPhone() ? phoneHoleCamera() : HOLE_CAMERA);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
    dynamic.add(buildZone(visualZoneRadius(SPEC.position.tolerance, M), result.inTolerance, M));
    dynamic.add(buildAxis(vb, vt, result));
    dynamic.add(buildLeader(vt));
    handles.place(vb, vt, result);
    layoutKey = ''; // force callout layout
  }

  // Place callout labels + leaders (see CALLOUT_PX / CALLOUT_BLEND).
  const _a = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _f = new THREE.Vector3();
  let layoutKey = '';
  function layoutCallouts() {
    camera.updateMatrixWorld();
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const key = `${camera.matrixWorld.elements.join(',')}|${camera.projectionMatrix.elements[0]}|${w}x${h}`;
    if (key === layoutKey || !w || !h) return;
    layoutKey = key;
    let unsized = false;
    const dist = camera.position.distanceTo(controls.target);
    const t = THREE.MathUtils.smoothstep(dist, CALLOUT_BLEND.near, CALLOUT_BLEND.far); // 0 near .. 1 far
    // verdict badge rect in canvas px (labels are kept out from under it)
    const cr = renderer.domElement.getBoundingClientRect();
    const box = (id) => {
      const el = document.getElementById(id);
      if (!el || !el.offsetWidth) return null;
      const b = el.getBoundingClientRect();
      return { l: b.left - cr.left, r: b.right - cr.left, t: b.top - cr.top, b: b.bottom - cr.top };
    };
    const badge = box('status-badge'); // labels drop below it
    const mag = box('mag-badge'); // labels lift above it
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
      _n.x = (sx / w) * 2 - 1;
      _n.y = 1 - (sy / h) * 2;
      _n.unproject(camera);
      o.position.copy(_n);
      c.leader.geometry.setPositions([_a.x, _a.y, _a.z, _n.x, _n.y, _n.z]);
    });
    if (unsized) layoutKey = '';
  }

  function frame() {
    controls.update();
    layoutCallouts();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { scene, camera, renderer, controls, handles, update, resetCamera: () => resetCamera(), zoomToHole, domElement: renderer.domElement };
}

// ---------------------------------------------------------------------------
// Static drawing elements
// ---------------------------------------------------------------------------

function buildStatic() {
  const g = new THREE.Group();
  g.name = 'static';

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
  g.add(a, b, c);

  // Plane borders
  const rect = (pts, color) => fatLine([...pts, pts[0]], { color, width: 1.5, opacity: 0.7 });
  g.add(rect([[-pad, -pad, -0.4], [L + pad, -pad, -0.4], [L + pad, W + pad, -0.4], [-pad, W + pad, -0.4]], COLORS.datumA));
  g.add(rect([[-0.4, -pad, -7], [-0.4, W + pad, -7], [-0.4, W + pad, H + 7], [-0.4, -pad, H + 7]], COLORS.datumB));
  g.add(rect([[-pad, -0.4, -7], [L + pad, -0.4, -7], [L + pad, -0.4, H + 7], [-pad, -0.4, H + 7]], COLORS.datumC));

  // Datum labels (datum feature symbol style: boxed letter)
  g.add(label('<span class="dfs">A</span><small>primary · bottom face z=0</small>', 'datum datum-a', [L + pad - 2, -pad + 2, -0.4]));
  g.add(label('<span class="dfs">B</span><small>secondary · left edge x=0</small>', 'datum datum-b', [-0.4, W + pad - 4, H + 7]));
  g.add(label('<span class="dfs">C</span><small>tertiary · front edge y=0</small>', 'datum datum-c', [62, -0.4, H + 7]));

  // DRF origin axes
  const axLen = 14;
  for (const [dir, name] of [[[axLen, 0, 0], '+X'], [[0, axLen, 0], '+Y'], [[0, 0, axLen], '+Z']]) {
    g.add(fatLine([[0, 0, 0], dir], { color: COLORS.ink, width: 2.5 }));
    if (name !== '+Z') g.add(arrowHead([0, 0, 0], dir, 2.2, { color: COLORS.ink, width: 2.5 }));
    g.add(label(name, 'axis-label', dir.map((v) => v * 1.12)));
  }
  g.add(label('origin (A∩B∩C)', 'axis-label small', [-2, -2, -2]));

  // True position: dashed basic axis through the zone, plus crosshair on top face
  g.add(fatLine([[TP.x, TP.y, -8], [TP.x, TP.y, H + 9]], { color: COLORS.truePos, width: 2, dashed: true, dashSize: 1.2, gapSize: 0.9 }));
  g.add(label(`True position<br><b>(${fmt(TP.x)}, ${fmt(TP.y)})</b>`, 'tp-label', [TP.x - 9, TP.y + 4, H + 12]));

  // BASIC dimensions on the top face (boxed numbers = basic)
  const z = H + 0.05;
  const yDimX = W - 6; // the X dimension line runs along y = 54
  const xDimY = 12; // the Y dimension line runs along x = 12
  const dimOpts = { color: COLORS.ink, width: 2 };
  const extOpts = { color: COLORS.ink, width: 1.2, dashed: true, dashSize: 0.8, gapSize: 0.6 };
  // 35 from B
  g.add(fatLine([[0, yDimX, z], [TP.x, yDimX, z]], dimOpts));
  g.add(arrowHead([TP.x, yDimX, z], [0, yDimX, z], 2.2, dimOpts));
  g.add(arrowHead([0, yDimX, z], [TP.x, yDimX, z], 2.2, dimOpts));
  g.add(fatLine([[TP.x, TP.y + HOLE_R + 2, z], [TP.x, yDimX + 2, z]], extOpts));
  g.add(label(`<span class="basic">${SPEC.basic.fromB}</span>`, 'dim', [TP.x / 2, yDimX, z]));
  // 30 from C
  g.add(fatLine([[xDimY, 0, z], [xDimY, TP.y, z]], dimOpts));
  g.add(arrowHead([xDimY, TP.y, z], [xDimY, 0, z], 2.2, dimOpts));
  g.add(arrowHead([xDimY, 0, z], [xDimY, TP.y, z], 2.2, dimOpts));
  g.add(fatLine([[TP.x - HOLE_R - 2, TP.y, z], [xDimY - 2, TP.y, z]], extOpts));
  g.add(label(`<span class="basic">${SPEC.basic.fromC}</span>`, 'dim', [xDimY, TP.y / 2, z]));

  // Feature control frame + size callout
  const fcf = `
    <div class="callout">⌀${SPEC.hole.nominal} ±${SPEC.hole.plusMinus} THRU</div>
    <table class="fcf"><tr>
      <td class="sym"><svg class="possym" viewBox="-10 -10 20 20" aria-label="position"><circle r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M-9 0H9M0 -9V9" stroke="currentColor" stroke-width="2"/></svg></td><td>⌀${SPEC.position.tolerance.toFixed(2)}</td>
      ${SPEC.position.datums.map((d) => `<td>${d}</td>`).join('')}
    </tr></table>`;
  g.add(label(fcf, 'fcf-label', FCF_ANCHOR));
  return g;
}

const FCF_ANCHOR = [TP.x + 30, TP.y + 20, H];

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

/** Translucent cylinder: zone of visual radius R, coaxial with true position, z = 0..H. */
function buildZone(R, inTol, M) {
  const color = inTol ? COLORS.in : COLORS.out;
  const g = new THREE.Group();
  g.name = 'zone';
  const geo = new THREE.CylinderGeometry(R, R, H, 64, 1, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(TP.x, TP.y, H / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
  );
  mesh.renderOrder = 5;
  g.add(mesh);
  const o = { color, width: 3.5, onTop: true };
  g.add(fatLine(circlePoints(TP.x, TP.y, 0, R), o), fatLine(circlePoints(TP.x, TP.y, H, R), o));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    const x = TP.x + R * Math.cos(a);
    const y = TP.y + R * Math.sin(a);
    g.add(fatLine([[x, y, 0], [x, y, H]], { color, width: 1.5, onTop: true, opacity: 0.8 }));
  }
  // Label so the cylinder is not mistaken for a gage pin. Anchored on the zone's
  // +X side at the top; placed CALLOUT_PX.zone screen px to the right
  // (the "hole's actual axis" label sits lower right), clear of the TOP/BOTTOM
  // handle labels at any zoom.
  const anchor = new THREE.Vector3(TP.x + R, TP.y, H);
  const leader = fatLine([anchor.toArray(), anchor.toArray()], { color, width: 2, onTop: true });
  const factor = M === 1 ? 'shown ×1, true size' : `shown ×${M}`;
  const zl = label(`position zone ⌀${SPEC.position.tolerance}<br>(${factor}, not a pin)`, `zone-label ${inTol ? 'pass' : 'fail'}`, anchor.toArray());
  zl.userData.callout = {
    leader,
    near: { anchor, px: CALLOUT_PX.zone, center: [0, 0.5] }, // left edge at leader end
    far: { anchor: new THREE.Vector3(TP.x, TP.y - R, 0), at: new THREE.Vector3(TP.x + 2, TP.y - Math.max(R, 6) - 16, 0), center: [0.5, 0] }, // hangs below
  };
  g.add(leader, zl);
  return g;
}

/** Actual hole axis (bold), plus radial "r" ticks from true position at each end. */
function buildAxis(vb, vt, result) {
  const g = new THREE.Group();
  g.name = 'axis';
  const color = result.inTolerance ? COLORS.in : COLORS.out;
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
  const al = label("hole's actual axis", `axis-name-label ${result.inTolerance ? 'pass' : 'fail'}`, anchor.toArray());
  const farAnchor = new THREE.Vector3(vb.x + 0.3 * (vt.x - vb.x), vb.y + 0.3 * (vt.y - vb.y), 0.3 * H);
  al.userData.callout = {
    leader,
    near: { anchor, px: CALLOUT_PX.axis, center: [0, 0.5] }, // left edge at leader end
    far: { anchor: farAnchor, at: new THREE.Vector3(vb.x + HOLE_R + 26, vb.y - 13, 0), center: [0, 0.5] },
  };
  g.add(leader, al);
  // radial offset r at each end (true position -> endpoint)
  for (const [v, z, end] of [[vb, 0, result.bottom], [vt, H, result.top]]) {
    g.add(fatLine([[TP.x, TP.y, z], [v.x, v.y, z]], { color: end.inside ? COLORS.in : COLORS.out, width: 2, dashed: true, dashSize: 0.6, gapSize: 0.4, onTop: true }));
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
  top.add(topLabel);
  bottom.add(botLabel);
  mid.add(midLabel);

  function place(vb, vt, result) {
    bottom.position.set(vb.x, vb.y, 0);
    top.position.set(vt.x, vt.y, H);
    mid.position.set((vb.x + vt.x) / 2, (vb.y + vt.y) / 2, H / 2);
    bottom.material.color.set(result.bottom.inside ? COLORS.in : COLORS.out);
    top.material.color.set(result.top.inside ? COLORS.in : COLORS.out);
    const txt = (name, e) => `${name} r=${fmtAgainst(e.r, result.radius, e.inside)} ${e.inside ? '≤' : '>'} ${fmt(result.radius)} ${e.inside ? '✔' : '✘'}`;
    topLabel.element.textContent = txt('TOP z=10', result.top);
    botLabel.element.textContent = txt('BOTTOM z=0', result.bottom);
  }
  return { group, top, bottom, mid, list: [top, bottom, mid], place };
}
