// Wires state -> tolerance math -> 3D scene + UI readout.
import { SPEC, VIEW, PRESETS } from './config.js';
import { evaluatePart, allowedTolerance, lockDrag, shrinkCausedOut, translateAxis } from './tolerance.js';
import { fcfHTML } from './fcf.js';
import { createViewer, isPhone } from './viewer/scene.js';
import { attachDrag } from './interaction.js';
import { createUI } from './ui.js';

const TP = SPEC.truePosition;
const clampOffset = (v) => Math.max(-VIEW.maxDeviation, Math.min(VIEW.maxDeviation, Math.round(v * 1e3) / 1e3));

const state = {
  bottom: { dx: 0, dy: 0 }, // axis crossing at z = 0, offset from true position (mm)
  top: { dx: 0, dy: 0 }, //    axis crossing at z = 10
  magnification: VIEW.defaultMagnification,
  xray: true,
  drawing: !isPhone(), // phones start decluttered; "Show drawing" brings it back
  size: SPEC.hole.sizeSlider.default, // actual hole diameter (mm)
  modifier: SPEC.position.modifier, // 'RFS' | 'MMC' | 'LMC'
  stated: SPEC.position.tolerance, // stated position tolerance ⌀ (mm), editable
  lock: false, // "Lock in tolerance": user drags/tilts can't take an endpoint out of the allowed zone
  tiltLock: false, // "Lock tilt": both endpoints move together (tilt frozen as it is when turned on)
  shrinkFrom: null, // allowed ⌀ before a zone shrink that happened while locked (for the note)
};
const q3 = (v) => Math.round(v * 1e3) / 1e3; // UI inputs in 0.001 mm (metric display)
const clampSize = (v) => q3(Math.max(SPEC.hole.sizeSlider.min, Math.min(SPEC.hole.sizeSlider.max, v)));
const clampStated = (v) => q3(Math.max(0, Math.min(1, v)));

export function evaluate(s = state) {
  return evaluatePart({
    truePosition: TP,
    bottom: { x: TP.x + s.bottom.dx, y: TP.y + s.bottom.dy },
    top: { x: TP.x + s.top.dx, y: TP.y + s.top.dy },
    thickness: SPEC.plate.z,
    stated: s.stated,
    modifier: s.modifier,
    actualSize: s.size,
    mmc: SPEC.hole.mmc,
    lmc: SPEC.hole.lmc,
  });
}

const viewer = createViewer(document.getElementById('viewport'));
// Phone-only compact FCF chip (CSS hides it elsewhere); same content as the drawing's FCF.
// (filled in refresh(): it follows the stated tolerance and shows Ⓜ at MMC)
// Phone-sized screens (PHONE_QUERY in scene.js) start in the hole close-up;
// "Reset camera" still returns to the overview. Desktop/iPad start unchanged.
if (isPhone()) viewer.zoomToHole();
document.getElementById('drawing-btn').addEventListener('click', () => { state.drawing = !state.drawing; refresh(); });
const ui = createUI(document.getElementById('panel'), {
  clampOffset,
  onChange: (patch) => setAxis(patch, { user: true }),
  onPreset: (id) => applyPreset(id),
  onMagnification: (m) => { state.magnification = m; refresh(); },
  onXray: (on) => { state.xray = on; refresh(); },
  onDrawing: (on) => { state.drawing = on; refresh(); },
  onSize: (v) => setSize(v),
  // A stated ⌀0 is only valid at MMC: block it at RFS (returns false = refused).
  onModifier: (m) => setModifier(m),
  onStated: (v) => setStated(v),
  onLock: (on) => setLock(on),
  onTiltLock: (on) => setTiltLock(on),
  onResetCamera: () => viewer.resetCamera(),
  onZoomHole: () => viewer.zoomToHole(),
});
attachDrag({
  getCamera: () => viewer.camera,
  domElement: viewer.domElement,
  controls: viewer.controls,
  handles: viewer.handles,
  getState: () => state,
  onChange: (patch) => setAxis(patch, { user: true }),
  clampOffset,
});

const allowedNow = () => allowedTolerance({ stated: state.stated, modifier: state.modifier, actualSize: state.size, mmc: SPEC.hole.mmc, lmc: SPEC.hole.lmc }).allowed;

// user = a drag or tilt/offset control: clamped when locked. Presets are not.
function setAxis(patch, { user = false } = {}) {
  if (user && state.tiltLock) {
    // Lock tilt: one translation for both ends. Mean of the requested end
    // deltas (a one-end drag moves both by that end's delta; any tilt part of
    // a two-end request is dropped). With the tolerance lock on, the delta is
    // clamped so neither end leaves the zone (whichever would leave first).
    const ds = ['bottom', 'top'].filter((k) => patch[k]).map((k) => { const n = { ...state[k], ...patch[k] }; return { dx: n.dx - state[k].dx, dy: n.dy - state[k].dy }; });
    const delta = ds.length ? { dx: ds.reduce((a, d) => a + d.dx, 0) / ds.length, dy: ds.reduce((a, d) => a + d.dy, 0) / ds.length } : { dx: 0, dy: 0 };
    const t = translateAxis({ bottom: state.bottom, top: state.top, delta, allowed: state.lock ? allowedNow() : null, maxDev: VIEW.maxDeviation });
    state.bottom = t.bottom; state.top = t.top;
  } else for (const k of ['bottom', 'top']) {
    if (!patch[k]) continue;
    const next = { ...state[k], ...patch[k] };
    state[k] = user && state.lock ? lockDrag({ prev: state[k], next, allowed: allowedNow() }) : next;
  }
  // A preset moves the axis wholesale: any OUT is now the axis's doing. A locked
  // drag can't push an outside endpoint further out, so the shrink note stays.
  if (!user || !state.lock) state.shrinkFrom = null;
  refresh();
}

// Size / mode / stated changes never move the axis. If the zone shrinks while
// locked, remember the previous allowed value so the note can explain an OUT.
function changeZone(fn) {
  const before = allowedNow();
  const ok = fn();
  if (ok === false) return false;
  const now = allowedNow();
  if (state.lock && now < before) state.shrinkFrom = Math.max(state.shrinkFrom ?? 0, before);
  else if (now >= (state.shrinkFrom ?? Infinity)) state.shrinkFrom = null;
  refresh();
  return true;
}
const setSize = (v) => changeZone(() => { state.size = clampSize(v); });
const setModifier = (m) => changeZone(() => { if (m === 'RFS' && state.stated <= 0) return false; state.modifier = m; });
const setStated = (v) => changeZone(() => { const s = clampStated(v); if (state.modifier === 'RFS' && s <= 0) return false; state.stated = s; });
// Lock tilt never moves the axis by itself: it only freezes the current tilt.
const setTiltLock = (on) => { state.tiltLock = !!on; refresh(); };
const setLock = (on) => { state.lock = !!on; if (!state.lock) state.shrinkFrom = null; refresh(); };
export const shrinkNoteFor = (s, res) => res.verdict === 'OUT' && shrinkCausedOut({ rBottom: res.bottom.r, rTop: res.top.r, allowedBefore: s.shrinkFrom, allowedNow: res.tolerance });

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
  document.getElementById('fcf-chip').innerHTML = fcfHTML(state);
  const btn = document.getElementById('drawing-btn');
  btn.setAttribute('aria-pressed', String(state.drawing));
  btn.textContent = state.drawing ? 'Hide drawing' : 'Show drawing';
  last.shrinkNote = shrinkNoteFor(state, last);
  last.presetNote = PRESETS.find((p) => p.note && ['bottom', 'top'].every((k) => p[k].dx === state[k].dx && p[k].dy === state[k].dy))?.note ?? '';
  ui.render(state, last);
}
refresh();

// ---- View controls (Top Z / Front Y / Side X / 3D + Ortho/Persp) -----------
const viewRow = document.getElementById('view-row');
viewRow.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'proj-btn') viewer.setProjection(viewer.view.ortho ? 'persp' : 'ortho');
  else viewer.setView(b.dataset.view);
});
const syncViewRow = ({ view, ortho }) => {
  for (const b of viewRow.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  const pb = document.getElementById('proj-btn');
  pb.setAttribute('aria-pressed', String(ortho));
  pb.textContent = ortho ? 'Ortho' : 'Persp';
};
viewer.onView(syncViewRow);
syncViewRow(viewer.view);

// URL params for lessons: ?view=top|front|side|3d &tiltlock=1 &lock=1
const qp = new URLSearchParams(location.search);
const on = (v) => v === '1' || v === 'true' || v === 'on';
if (qp.has('lock')) setLock(on(qp.get('lock')));
if (qp.has('tiltlock')) setTiltLock(on(qp.get('tiltlock')));
if (qp.has('view') && ['top', 'front', 'side', '3d'].includes(qp.get('view'))) viewer.setView(qp.get('view'), { ms: 0 });

// Small hook for automated browser checks / the Domain Expert's console use.
window.gdt = {
  state,
  setAxis,
  applyPreset,
  result: () => last,
  setMagnification: (m) => { state.magnification = m; refresh(); },
  setDrawing: (on) => { state.drawing = !!on; refresh(); },
  setSize,
  setModifier,
  setLock,
  setStated,
  setTiltLock,
  setView: (v, o) => viewer.setView(v, o),
  setProjection: (p) => viewer.setProjection(p),
  view: () => viewer.view,
  dragAxis: (patch) => setAxis(patch, { user: true }), // same path as a handle drag / tilt control
  _debug: { handles: viewer.handles, get camera() { return viewer.camera; }, canvas: viewer.domElement, controls: viewer.controls },
  ready: true,
};
