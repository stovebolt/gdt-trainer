// Wires state -> tolerance math -> 3D scene + UI readout.
import { SPEC, VIEW, PRESETS } from './config.js';
import { evaluatePosition } from './tolerance.js';
import { createViewer, isPhone } from './viewer/scene.js';
import { attachDrag } from './interaction.js';
import { createUI } from './ui.js';

const TP = SPEC.truePosition;
const clampOffset = (v) => Math.max(-VIEW.maxDeviation, Math.min(VIEW.maxDeviation, Math.round(v * 1e4) / 1e4));

const state = {
  bottom: { dx: 0, dy: 0 }, // axis crossing at z = 0, offset from true position (mm)
  top: { dx: 0, dy: 0 }, //    axis crossing at z = 10
  magnification: VIEW.defaultMagnification,
  xray: true,
  drawing: !isPhone(), // phones start decluttered; "Show drawing" brings it back
};

export function evaluate(s = state) {
  return evaluatePosition({
    truePosition: TP,
    bottom: { x: TP.x + s.bottom.dx, y: TP.y + s.bottom.dy },
    top: { x: TP.x + s.top.dx, y: TP.y + s.top.dy },
    tolerance: SPEC.position.tolerance,
    thickness: SPEC.plate.z,
  });
}

const viewer = createViewer(document.getElementById('viewport'));
// Phone-only compact FCF chip (CSS hides it elsewhere); same content as the drawing's FCF.
document.getElementById('fcf-chip').innerHTML = `<table class="fcf"><tr><td class="sym"><svg class="possym" viewBox="-10 -10 20 20" aria-label="position"><circle r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M-9 0H9M0 -9V9" stroke="currentColor" stroke-width="2"/></svg></td><td>⌀${SPEC.position.tolerance.toFixed(2)}</td>${SPEC.position.datums.map((d) => `<td>${d}</td>`).join('')}</tr></table>`;
// Phone-sized screens (PHONE_QUERY in scene.js) start in the hole close-up;
// "Reset camera" still returns to the overview. Desktop/iPad start unchanged.
if (isPhone()) viewer.zoomToHole();
document.getElementById('drawing-btn').addEventListener('click', () => { state.drawing = !state.drawing; refresh(); });
const ui = createUI(document.getElementById('panel'), {
  clampOffset,
  onChange: (patch) => setAxis(patch),
  onPreset: (id) => applyPreset(id),
  onMagnification: (m) => { state.magnification = m; refresh(); },
  onXray: (on) => { state.xray = on; refresh(); },
  onDrawing: (on) => { state.drawing = on; refresh(); },
  onResetCamera: () => viewer.resetCamera(),
  onZoomHole: () => viewer.zoomToHole(),
});
attachDrag({
  camera: viewer.camera,
  domElement: viewer.domElement,
  controls: viewer.controls,
  handles: viewer.handles,
  getState: () => state,
  onChange: (patch) => setAxis(patch),
  clampOffset,
});

function setAxis(patch) {
  if (patch.bottom) state.bottom = { ...state.bottom, ...patch.bottom };
  if (patch.top) state.top = { ...state.top, ...patch.top };
  refresh();
}

function applyPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset ${id}`);
  setAxis({ bottom: { ...p.bottom }, top: { ...p.top } });
}

let last;
function refresh() {
  last = evaluate();
  viewer.update(state, last);
  viewer.setDrawing(state.drawing);
  const btn = document.getElementById('drawing-btn');
  btn.setAttribute('aria-pressed', String(state.drawing));
  btn.textContent = state.drawing ? 'Hide drawing' : 'Show drawing';
  ui.render(state, last);
}
refresh();

// Small hook for automated browser checks / the Domain Expert's console use.
window.gdt = {
  state,
  setAxis,
  applyPreset,
  result: () => last,
  setMagnification: (m) => { state.magnification = m; refresh(); },
  setDrawing: (on) => { state.drawing = !!on; refresh(); },
  _debug: { handles: viewer.handles, camera: viewer.camera, canvas: viewer.domElement, controls: viewer.controls },
  ready: true,
};
