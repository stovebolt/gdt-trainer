// Lesson 2 side panel: verdict per tier, per-hole readout, explainer, presets, pattern and
// hole controls, view settings. Same section order and classes as Lesson 1. No Three.js.
import { VIEW, PRESETS, EXTRA_PRESETS } from './config.js';
import { disp, dispUp, HOLE_NAMES, T_UP, T_LO, VERDICT_TEXT, SIZE_LO, SIZE_HI } from './composite.js';
import { explainHTML, fcfHTML } from './copy.js';

const sgn = (v) => { const s = disp(v); return s === '0' ? '+0' : s.startsWith('−') ? s : `+${s}`; };
const BADGE = { PASS: '✔ PASS', FAIL_UPPER: '✘ FAIL: upper', FAIL_LOWER: '✘ FAIL: lower', FAIL_BOTH: '✘ FAIL: both', REJECT_SIZE: '✘ REJECT: size' };
export const STATUS_LIST = Object.values(VERDICT_TEXT);
const tone = (code) => (code === 'PASS' ? 'pass' : code === 'REJECT_SIZE' ? 'na' : 'fail');
const cmp = (v, lim, ok) => `⌀${disp(v, lim, ok)} ${ok ? '≤' : '>'} ⌀${disp(lim)}`;

export function createUI(root, h) {
  root.innerHTML = template();
  const $ = (s) => root.querySelector(s);
  for (const b of root.querySelectorAll('[data-preset]')) b.addEventListener('click', () => h.onPreset(b.dataset.preset));
  const bind = (id, f) => {
    const r = $(`#r-${id}`), n = $(`#n-${id}`);
    r.addEventListener('input', () => f(Number(r.value)));
    n.addEventListener('change', () => { const v = Number(n.value); if (Number.isFinite(v)) f(v); });
    return { r, n };
  };
  const pat = { tx: bind('p-tx', (v) => h.onPatternField('tx', v)), ty: bind('p-ty', (v) => h.onPatternField('ty', v)), deg: bind('p-deg', (v) => h.onPatternField('deg', v)) };
  const hole = [0, 1, 2, 3].map((k) => bind(`h-${k}`, (v) => h.onHoleField(k, v)));
  const size = bind('size', (v) => h.onSize(v));
  for (const b of root.querySelectorAll('[data-hole]')) b.addEventListener('click', () => h.onSelect(Number(b.dataset.hole)));
  $('#mag').addEventListener('input', (e) => h.onMagnification(Number(e.target.value)));
  $('#xray').addEventListener('change', (e) => h.onXray(e.target.checked));
  $('#drawing').addEventListener('change', (e) => h.onDrawing(e.target.checked));
  $('#reset-cam').addEventListener('click', h.onResetCamera);
  $('#zoom-hole').addEventListener('click', h.onZoomHole);
  const explain = $('#explain');
  explain.open = !window.matchMedia('(max-width: 700px), (max-height: 500px)').matches;
  $('#ex-body').innerHTML = explainHTML();
  const setF = (f, v, txt) => { f.r.value = String(v); if (document.activeElement !== f.n) f.n.value = txt; };

  function render(state, res) {
    const t = tone(res.code), rej = res.code === 'REJECT_SIZE';
    $('#overall').className = `overall ${t}`;
    $('#pos-status').textContent = VERDICT_TEXT[res.code];
    const worst = res.up.indexOf(Math.max(...res.up));
    const upLine = $('#tier-up'), loLine = $('#tier-lo');
    upLine.className = `tier ${rej ? 'na' : res.allUp ? 'pass' : 'fail'}`;
    loLine.className = `tier ${rej ? 'na' : res.loOk ? 'pass' : 'fail'}`;
    upLine.querySelector('.v').textContent = rej ? `⌀${dispUp(res.up[worst])} (info)` : cmp(res.up[worst], T_UP, res.allUp);
    upLine.querySelector('.w').textContent = `worst ${HOLE_NAMES[worst]}`;
    upLine.querySelector('.m').textContent = rej ? 'n/a' : res.allUp ? '✔ IN' : '✘ OUT';
    loLine.querySelector('.v').textContent = rej ? `⌀${dispUp(res.lo)} (info)` : cmp(res.lo, T_LO, res.loOk);
    loLine.querySelector('.m').textContent = rej ? 'n/a' : res.loOk ? '✔ IN' : '✘ OUT';
    const fails = [];
    if (!rej && !res.allUp) fails.push(`upper row (${res.failUpper.join(', ')})`);
    if (!rej && !res.loOk) fails.push(`lower row (${res.failLower.join(', ')}${res.outlier ? `; the outlier: ${res.outlier}` : ''})`);
    $('#fail-line').textContent = rej ? `hole size outside ⌀${disp(SIZE_LO)}–${disp(SIZE_HI)}: position not judged` : fails.length ? `Fails: ${fails.join(' and ')}` : 'Both rows pass: every axis is in its green and its blue zone.';
    $('#fit-line').textContent = `blue set best fit: shift dx ${sgn(res.fit.tx)}, dy ${sgn(res.fit.ty)} · rotation ${sgn(res.fit.deg)}° (information)`;
    $('#size-line').textContent = res.sizes.every((s, i) => res.sizeOk[i]) ? `Hole sizes ✔ within ⌀${disp(SIZE_LO)}–${disp(SIZE_HI)}` : `Hole size ✘ ${HOLE_NAMES.filter((_, i) => !res.sizeOk[i]).join(', ')} outside ⌀${disp(SIZE_LO)}–${disp(SIZE_HI)}`;
    HOLE_NAMES.forEach((n, i) => {
      const row = $(`#row-${i}`);
      const ok = res.upOk[i] && res.loHoleOk[i];
      row.className = `${rej ? 'na' : ok ? 'pass' : 'fail'}${state.selected === i ? ' sel' : ''}`;
      row.querySelector('.u').textContent = rej ? `⌀${dispUp(res.up[i])}` : cmp(res.up[i], T_UP, res.upOk[i]);
      const lo = 2 * res.loHoleR[i];
      row.querySelector('.l').textContent = rej ? `⌀${dispUp(lo)}` : cmp(lo, T_LO, res.loHoleOk[i]);
      row.querySelector('.s').textContent = `⌀${disp(res.sizes[i])}`;
      row.querySelector('.mark').textContent = rej ? 'n/a' : ok ? '✔' : '✘';
    });
    const p = PRESETS.concat(EXTRA_PRESETS).find((q) => q.id === state.preset);
    $('#preset-note').textContent = p?.note || '\u00a0';
    $('#preset-note').style.visibility = p?.note ? 'visible' : 'hidden';
    for (const b of root.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', String(b.dataset.preset === state.preset));
    setF(pat.tx, state.pattern.tx, disp(state.pattern.tx).replace('−', '-'));
    setF(pat.ty, state.pattern.ty, disp(state.pattern.ty).replace('−', '-'));
    setF(pat.deg, state.pattern.deg, disp(state.pattern.deg).replace('−', '-'));
    const l = state.local[state.selected];
    hole.forEach((f, k) => setF(f, l[k], disp(l[k]).replace('−', '-')));
    setF(size, state.sizes[state.selected], disp(state.sizes[state.selected]));
    for (const b of root.querySelectorAll('[data-hole]')) b.setAttribute('aria-pressed', String(Number(b.dataset.hole) === state.selected));
    for (const el of root.querySelectorAll('.sel-name')) el.textContent = HOLE_NAMES[state.selected];
    $('#mag').max = String(res.magMax ?? VIEW.maxMagnification);
    $('#mag').value = String(state.magnification);
    $('#mag-val').textContent = `×${state.magnification}`;
    $('#xray').checked = state.xray;
    $('#drawing').checked = state.drawing;
    const badge = document.getElementById('status-badge');
    badge.className = `status-badge ${t}`;
    badge.innerHTML = `${BADGE[res.code] ?? res.code}<small>upper ${rej ? `⌀${dispUp(res.up[worst])}` : cmp(res.up[worst], T_UP, res.allUp)} · lower ${rej ? `⌀${dispUp(res.lo)}` : cmp(res.lo, T_LO, res.loOk)}</small><span class="size-note">${fails.length ? fails.join(' · ') : rej ? 'size rejected: position not judged' : 'both rows pass'}</span>`;
    document.getElementById('mag-badge').innerHTML = `<span class="lg-up">■</span> upper ⌀0.5 fixed · <span class="lg-lo">■</span> lower ⌀0.1 best fit · ×${state.magnification}`;
  }
  return { render };
}

const ctl = (id, label, min, max, step) => `<label class="ctl"><span>${label}</span><input type="range" id="r-${id}" min="${min}" max="${max}" step="${step}"/><input type="number" id="n-${id}" min="${min}" max="${max}" step="${step}"/></label>`;

function template() {
  const m = VIEW.maxDeviation, rd = VIEW.maxRotationDeg;
  return `
  <header>
    <h1>Composite position: 4-hole pattern</h1>
    <div class="spec">
      <div>4X ⌀10.1 ±0.1 THRU at BASIC <span class="basic">25</span> from B, <span class="basic">50</span> apart; <span class="basic">15</span> from C, <span class="basic">30</span> apart</div>
      <div id="spec-fcf">${fcfHTML('fcf big')}</div>
      <div class="muted">Plate 100 × 60 × 10 mm · RFS · upper zones fixed at true position, lower zones a rigid set that may shift and turn · all ⟂ A, z = 0…10</div>
    </div>
  </header>

  <section id="overall" class="overall">
    <div class="pos-label">Composite position (each row reported as a <b>diameter</b> = 2r)</div>
    <div class="pos-line"><span id="pos-status"></span></div>
    <div id="tier-up" class="tier"><span class="k"><i class="sw up"></i>Upper ⌀0.5 |A|B|C|</span><span class="v"></span><span class="w muted small"></span><span class="m"></span></div>
    <div id="tier-lo" class="tier"><span class="k"><i class="sw lo"></i>Lower ⌀0.1 |A|</span><span class="v"></span><span class="w muted small">best fit</span><span class="m"></span></div>
    <div id="fail-line" class="fail-line"></div>
    <div id="fit-line" class="muted small"></div>
    <div id="size-line" class="size-note"></div>
  </section>

  <section id="explain-wrap" class="explain-wrap">
    <details id="explain" class="explain">
      <summary id="ex-summary"><span class="ex-title">Explain this setup</span><span class="ex-config">⌀0.50 |A|B|C| over ⌀0.10 |A| · RFS</span></summary>
      <div id="ex-body" class="ex-body"></div>
    </details>
  </section>

  <section>
    <h2>Holes vs both zones</h2>
    <table class="readout holes">
      <thead><tr><th>Hole</th><th>upper 2r vs ⌀0.5</th><th>lower 2r vs ⌀0.1</th><th>size</th><th></th></tr></thead>
      <tbody>${HOLE_NAMES.map((n, i) => `<tr id="row-${i}"><th>${n}</th><td class="u"></td><td class="l"></td><td class="s"></td><td class="mark"></td></tr>`).join('')}</tbody>
    </table>
    <div class="muted small">mm. Upper: r from each hole's true position. Lower: r from its blue zone centre at the one shared best fit. Each row passes only if <b>both</b> axis ends (z = 0 and z = 10) are inside (boundary inclusive). Display: up to 3 decimals; a failing value never shows as the limit.</div>
  </section>

  <section>
    <h2>Presets</h2>
    <div class="presets">${PRESETS.concat(EXTRA_PRESETS).map((p) => `<button data-preset="${p.id}" aria-pressed="false">${p.label}</button>`).join('')}</div>
    <div id="preset-note" class="muted small preset-note" style="visibility:hidden">\u00a0</div>
  </section>

  <section>
    <h2>Whole pattern (moves all 4 holes)</h2>
    ${ctl('p-tx', 'shift X', -m, m, 0.001)}${ctl('p-ty', 'shift Y', -m, m, 0.001)}${ctl('p-deg', 'turn °', -rd, rd, 0.001)}
    <div class="muted small">Turn is about the pattern centre (50, 30), CCW positive.</div>
  </section>

  <section>
    <h2>One hole: <span class="sel-name">H1</span></h2>
    <span class="seg hole-seg" role="group" aria-label="Hole">${HOLE_NAMES.map((n, i) => `<button type="button" data-hole="${i}" aria-pressed="${i === 0}">${n}</button>`).join('')}</span>
    <h2>Axis at TOP (z = 10)</h2>${ctl('h-2', 'dx', -m, m, 0.001)}${ctl('h-3', 'dy', -m, m, 0.001)}
    <h2>Axis at BOTTOM (z = 0)</h2>${ctl('h-0', 'dx', -m, m, 0.001)}${ctl('h-1', 'dy', -m, m, 0.001)}
    ${ctl('size', 'Hole ⌀', 9.95, 10.25, 0.01)}
    <div class="muted small">Offsets are in the pattern's own frame, on top of the whole-pattern move.</div>
  </section>

  <section>
    <h2>View</h2>
    <label class="ctl"><span>Exaggeration</span><input type="range" id="mag" min="${VIEW.minMagnification}" max="${VIEW.maxMagnification}" step="1"/><b id="mag-val"></b></label>
    <label class="check phone-only"><input type="checkbox" id="drawing"/> Show drawing (datums, basic 25/50 and 15/30)</label>
    <label class="check"><input type="checkbox" id="xray"/> X-ray plate (see the axes inside the holes)</label>
    <button id="reset-cam">Reset camera</button> <button id="zoom-hole">Zoom to <span class="sel-name">H1</span></button>
    <p class="muted small">3D view: drag a hole's <b>top</b> / <b>bottom</b> sphere to tilt it, its white sphere to shift it. Drag the blue <b>pattern</b> sphere to shift all four, the white <b>rotate</b> sphere to turn them (desktop: Shift + drag any hole sphere also shifts the pattern). Left-drag elsewhere to orbit, right-drag to pan, wheel to zoom.</p>
  </section>`;
}
