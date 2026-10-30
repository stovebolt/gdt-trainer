// Lesson 2 wiring: state -> composite math -> 3D scene + panel.
import { VIEW, PRESETS, EXTRA_PRESETS } from './config.js';
import { evaluate as evalComposite } from './composite.js';
import { devsFromState } from './state.js';
import { createViewer, isPhone } from './viewer/scene.js';
import { attachDrag } from './interaction.js';
import { createUI } from './ui.js';
import { fcfHTML } from './copy.js';

const clamp = (v, m) => Math.max(-m, Math.min(m, Math.round(v * 1e6) / 1e6));
const PHONE_MAX_MAG = 40;
const magCap = () => (isPhone() ? Math.min(VIEW.maxMagnification, PHONE_MAX_MAG) : VIEW.maxMagnification);

const state = {
  pattern: { tx: 0, ty: 0, deg: 0 },
  local: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  sizes: [10.1, 10.1, 10.1, 10.1],
  selected: 0,
  preset: 'P0-NOMINAL',
  magnification: VIEW.defaultMagnification,
  xray: true,
  drawing: !isPhone(),
};
export const evaluate = (s = state) => evalComposite(devsFromState(s), s.sizes);

const viewer = createViewer(document.getElementById('viewport'));
const setPattern = (p, local = null) => {
  state.pattern = { tx: clamp(p.tx, VIEW.maxDeviation), ty: clamp(p.ty, VIEW.maxDeviation), deg: clamp(p.deg, VIEW.maxRotationDeg) };
  if (local) state.local = local.map((l) => l.map((v) => clamp(v, VIEW.maxDeviation)));
  state.preset = null;
  refresh();
};
const setHole = (i, l) => { state.local[i] = l.map((v) => clamp(v, VIEW.maxDeviation)); state.selected = i; state.preset = null; refresh(); };
const setSize = (v, i = state.selected) => { if (!Number.isFinite(v)) return; state.sizes[i] = Math.max(9.95, Math.min(10.25, Math.round(v * 1e3) / 1e3)); refresh(); };
const setMagnification = (m) => { state.magnification = Math.max(VIEW.minMagnification, Math.min(magCap(), Math.round(m))); refresh(); };
function applyPreset(id) {
  const p = PRESETS.concat(EXTRA_PRESETS).find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset ${id}`);
  state.pattern = { ...p.pattern };
  state.local = p.local.map((l) => [...l]);
  state.sizes = [10.1, 10.1, 10.1, 10.1];
  state.preset = id;
  refresh();
}

const ui = createUI(document.getElementById('panel'), {
  onPreset: applyPreset,
  onPatternField: (k, v) => setPattern({ ...state.pattern, [k]: v }),
  onHoleField: (k, v) => { const l = [...state.local[state.selected]]; l[k] = v; setHole(state.selected, l); },
  onSize: (v) => setSize(v),
  onSelect: (i) => { state.selected = i; refresh(); },
  onMagnification: setMagnification,
  onXray: (on) => { state.xray = on; refresh(); },
  onDrawing: (on) => { state.drawing = on; refresh(); },
  onResetCamera: () => viewer.resetCamera(),
  onZoomHole: () => viewer.zoomToHole(state.selected),
});
attachDrag({
  getCamera: () => viewer.camera, domElement: viewer.domElement, controls: viewer.controls, handles: viewer.handles,
  getState: () => state,
  onHole: setHole,
  onPattern: (p, local) => setPattern(p, local),
});
document.getElementById('drawing-btn').addEventListener('click', () => { state.drawing = !state.drawing; refresh(); });
document.getElementById('fcf-chip').innerHTML = fcfHTML();

let last;
function refresh() {
  if (state.magnification > magCap()) state.magnification = magCap();
  last = evaluate();
  last.magMax = magCap();
  viewer.update(state, last);
  ui.render(state, last);
  const btn = document.getElementById('drawing-btn');
  btn.setAttribute('aria-pressed', String(state.drawing));
  btn.textContent = state.drawing ? 'Hide drawing' : 'Show drawing';
}
refresh();
addEventListener('resize', () => { if (state.magnification > magCap()) refresh(); });

const viewRow = document.getElementById('view-row');
viewRow.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'proj-btn') viewer.setProjection(viewer.view.ortho ? 'persp' : 'ortho');
  else viewer.setView(b.dataset.view);
});
const syncViewRow = ({ view, ortho }) => {
  for (const b of viewRow.querySelectorAll('button[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  const pb = document.getElementById('proj-btn');
  pb.setAttribute('aria-pressed', String(ortho));
  pb.textContent = ortho ? 'Ortho' : 'Persp';
};
viewer.onView(syncViewRow);
syncViewRow(viewer.view);
const qp = new URLSearchParams(location.search);
if (qp.has('preset')) applyPreset(qp.get('preset'));
if (qp.has('view')) viewer.setView(qp.get('view'), { ms: 0 });

window.gdt = {
  state, evaluate, applyPreset, setPattern, setHole, setSize, setMagnification,
  select: (i) => { state.selected = i; refresh(); },
  result: () => last,
  setView: (v, o) => viewer.setView(v, o),
  setDrawing: (on) => { state.drawing = !!on; refresh(); },
  _debug: { handles: viewer.handles, get camera() { return viewer.camera; }, canvas: viewer.domElement, controls: viewer.controls, scene: viewer.scene },
  ready: true,
};
