// DOM side panel: numeric controls, presets, the per-endpoint readout, and a
// 2D top-down "zone inset" (also draggable). No Three.js dependency.
import { SPEC, VIEW, PRESETS, SIZE_NOTE } from './config.js';
import { fmt, fmtSigned, fmtAgainst, fmtMargin } from './format.js';

const TOL = SPEC.position.tolerance;
const R = TOL / 2;
const SVGNS = 'http://www.w3.org/2000/svg';

export function createUI(root, { onChange, onPreset, onMagnification, onXray, onResetCamera, onZoomHole, clampOffset }) {
  root.innerHTML = template();
  const $ = (sel) => root.querySelector(sel);

  // --- endpoint sliders + numeric inputs (two-way bound) --------------------
  const fields = [
    ['bottom', 'dx'], ['bottom', 'dy'], ['top', 'dx'], ['top', 'dy'],
  ].map(([end, axis]) => {
    const range = $(`#r-${end}-${axis}`);
    const num = $(`#n-${end}-${axis}`);
    const handler = (src) => () => {
      const v = clampOffset(Number(src.value));
      if (!Number.isFinite(v)) return;
      onChange({ [end]: { [axis]: v } });
    };
    range.addEventListener('input', handler(range));
    num.addEventListener('change', handler(num));
    return { end, axis, range, num };
  });

  for (const btn of root.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => onPreset(btn.dataset.preset));
  }
  $('#mag').addEventListener('input', (e) => onMagnification(Number(e.target.value)));
  $('#xray').addEventListener('change', (e) => onXray(e.target.checked));
  $('#reset-cam').addEventListener('click', onResetCamera);
  $('#zoom-hole').addEventListener('click', onZoomHole);

  const inset = createInset($('#inset'), { onChange, clampOffset });

  function render(state, res) {
    for (const f of fields) {
      const v = state[f.end][f.axis];
      f.range.value = String(v);
      if (document.activeElement !== f.num) f.num.value = v.toFixed(4);
    }
    $('#mag').value = String(state.magnification);
    $('#mag-val').textContent = `×${state.magnification}`;
    $('#xray').checked = state.xray;

    for (const end of ['bottom', 'top']) {
      const e = res[end];
      const row = $(`#row-${end}`);
      row.className = e.inside ? 'pass' : 'fail';
      row.querySelector('.dx').textContent = fmtSigned(e.dx);
      row.querySelector('.dy').textContent = fmtSigned(e.dy);
      row.querySelector('.r').innerHTML = `${fmtAgainst(e.r, R, e.inside)} <span class="${e.inside ? 'le' : 'gt'}">${e.inside ? '≤' : '>'}</span> ${fmt(R)}`;
      row.querySelector('.d').innerHTML = `⌀${fmtAgainst(e.deviation, TOL, e.inside)} <span class="${e.inside ? 'le' : 'gt'}">${e.inside ? '≤' : '>'}</span> ⌀${fmt(TOL)}`;
      row.querySelector('.mark').textContent = e.inside ? '✔ PASS' : '✘ FAIL';
    }
    const worst = res.top.r >= res.bottom.r ? 'top' : 'bottom';
    const overall = $('#overall');
    overall.className = `overall ${res.inTolerance ? 'pass' : 'fail'}`;
    const posShown = fmtAgainst(res.deviation, TOL, res.inTolerance);
    $('#pos-value').textContent = `⌀${posShown}`;
    $('#pos-compare').innerHTML = `${res.inTolerance ? '≤' : '>'} ⌀${fmt(TOL)}`;
    $('#pos-status').textContent = res.inTolerance ? 'IN TOLERANCE' : 'OUT OF TOLERANCE';
    $('#pos-detail').textContent = `= 2 × r(${worst}) = 2 × ${fmtAgainst(res[worst].r, R, res.inTolerance)} · margin ${fmtMargin(res.deviation, TOL, res.inTolerance)} mm`;
    $('#mid').textContent = `mid-plane (z=5) offset: dx ${fmtSigned(res.mid.dx)}, dy ${fmtSigned(res.mid.dy)} · tilt ${res.tilt.toFixed(4)}°`;

    const badge = document.getElementById('status-badge');
    badge.className = `status-badge ${res.inTolerance ? 'pass' : 'fail'}`;
    badge.innerHTML = `${res.inTolerance ? '✔ IN' : '✘ OUT'}<small>position ⌀${posShown} ${res.inTolerance ? '≤' : '>'} ⌀${fmt(TOL)}</small><span class="size-note">${SIZE_NOTE}</span>`;
    document.getElementById('mag-badge').textContent = `Zone & deviations drawn ×${state.magnification} (display only)`;
    inset.render(state, res);
  }
  return { render };
}

// --- Top-down inset: zone circle at TRUE scale relationship ------------------
function createInset(svg, { onChange, clampOffset }) {
  const HALF = 0.2; // mm shown from centre to edge
  svg.setAttribute('viewBox', `${-HALF} ${-HALF} ${2 * HALF} ${2 * HALF}`);
  svg.innerHTML = `
    <g transform="scale(1,-1)">
      <circle class="grid" r="0.05"/><circle class="grid" r="0.1"/><circle class="grid" r="0.15"/>
      <line class="grid" x1="${-HALF}" y1="0" x2="${HALF}" y2="0"/><line class="grid" x1="0" y1="${-HALF}" x2="0" y2="${HALF}"/>
      <circle class="zone" r="${R}"/>
      <line class="axis" id="i-axis"/>
      <circle class="mid" id="i-mid" r="0.007"/>
      <circle class="pt" id="i-bottom" r="0.011" data-end="bottom"/>
      <circle class="pt" id="i-top" r="0.011" data-end="top"/>
    </g>
    <text x="${-R * 0.72 - 0.065}" y="${R * 0.72 + 0.02}" class="t-zone">⌀${fmt(TOL)} zone</text>
    <text x="${-HALF + 0.008}" y="${-HALF + 0.022}" class="t-small">top view (from +Z)</text>
    <text x="${-HALF + 0.008}" y="${HALF - 0.008}" class="t-small">grid rings r = 0.0500 / 0.1000 / 0.1500 mm</text>
    <text id="t-bottom" class="t-pt">B</text><text id="t-top" class="t-pt">T</text>`;
  const q = (id) => svg.querySelector(id);

  // Drag directly in the inset (exact mm, no 3D projection involved)
  let drag = null;
  const toMM = (ev) => {
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: -p.y };
  };
  svg.addEventListener('pointerdown', (ev) => {
    const end = ev.target.dataset?.end || (ev.target.id === 'i-mid' || ev.target.id === 'i-axis' ? 'mid' : null);
    if (!end) return;
    drag = { end, start: toMM(ev), s: structuredClone(svg.__state) };
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const p = toMM(ev);
    const d = { dx: p.x - drag.start.x, dy: p.y - drag.start.y };
    const mv = (o) => ({ dx: clampOffset(o.dx + d.dx), dy: clampOffset(o.dy + d.dy) });
    const next = {};
    if (drag.end !== 'bottom') next.top = mv(drag.s.top);
    if (drag.end !== 'top') next.bottom = mv(drag.s.bottom);
    onChange(next);
  });
  svg.addEventListener('pointerup', () => (drag = null));

  function render(state, res) {
    svg.__state = { bottom: { ...state.bottom }, top: { ...state.top } };
    const clip = (v) => Math.max(-HALF * 0.97, Math.min(HALF * 0.97, v));
    const b = { x: clip(state.bottom.dx), y: clip(state.bottom.dy) };
    const t = { x: clip(state.top.dx), y: clip(state.top.dy) };
    q('.zone').setAttribute('class', `zone ${res.inTolerance ? 'pass' : 'fail'}`);
    Object.entries({ x1: b.x, y1: b.y, x2: t.x, y2: t.y }).forEach(([k, v]) => q('#i-axis').setAttribute(k, v));
    q('#i-axis').setAttribute('class', `axis ${res.inTolerance ? 'pass' : 'fail'}`);
    q('#i-mid').setAttribute('cx', (b.x + t.x) / 2);
    q('#i-mid').setAttribute('cy', (b.y + t.y) / 2);
    for (const [end, p] of [['bottom', b], ['top', t]]) {
      const c = q(`#i-${end}`);
      c.setAttribute('cx', p.x);
      c.setAttribute('cy', p.y);
      c.setAttribute('class', `pt ${res[end].inside ? 'pass' : 'fail'}`);
      const txt = q(`#t-${end}`);
      txt.setAttribute('x', p.x + 0.014);
      txt.setAttribute('y', -p.y + (end === 'top' ? -0.012 : 0.026));
    }
  }
  return { render };
}

function slider(end, axis) {
  const m = VIEW.maxDeviation;
  return `
    <label class="ctl">
      <span>${axis === 'dx' ? 'dx' : 'dy'}</span>
      <input type="range" id="r-${end}-${axis}" min="${-m}" max="${m}" step="0.0001" />
      <input type="number" id="n-${end}-${axis}" min="${-m}" max="${m}" step="0.0001" />
    </label>`;
}

function template() {
  const fcf = `<table class="fcf big"><tr><td class="sym"><svg class="possym" viewBox="-10 -10 20 20" aria-label="position"><circle r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M-9 0H9M0 -9V9" stroke="currentColor" stroke-width="2"/></svg></td><td>⌀${TOL.toFixed(2)}</td>${SPEC.position.datums.map((d) => `<td>${d}</td>`).join('')}</tr></table>`;
  return `
  <header>
    <h1>Position of a hole</h1>
    <div class="spec">
      <div>Hole ⌀${SPEC.hole.nominal} ±${SPEC.hole.plusMinus} THRU at BASIC <span class="basic">${SPEC.basic.fromB}</span> from B, <span class="basic">${SPEC.basic.fromC}</span> from C</div>
      ${fcf}
      <div class="muted">Plate ${SPEC.plate.x} × ${SPEC.plate.y} × ${SPEC.plate.z} mm · RFS · zone = ⌀${fmt(TOL)} cylinder ⟂ A at (${SPEC.truePosition.x}, ${SPEC.truePosition.y}), z = 0…${SPEC.plate.z}</div>
    </div>
  </header>

  <section id="overall" class="overall">
    <div class="pos-label">Position (reported as a <b>diameter</b> = 2r, not a radius)</div>
    <div class="pos-line"><span id="pos-value"></span> <span id="pos-compare"></span> <span id="pos-status"></span></div>
    <div id="pos-detail" class="muted"></div>
    <div class="size-note">${SIZE_NOTE}</div>
  </section>

  <section>
    <h2>Axis endpoints vs zone</h2>
    <table class="readout">
      <thead><tr><th>Endpoint</th><th>dx</th><th>dy</th><th>r vs ${fmt(R)}</th><th>2r vs ⌀${fmt(TOL)}</th><th></th></tr></thead>
      <tbody>
        <tr id="row-bottom"><th>Bottom<br><small>z = 0</small></th><td class="dx"></td><td class="dy"></td><td class="r"></td><td class="d"></td><td class="mark"></td></tr>
        <tr id="row-top"><th>Top<br><small>z = 10</small></th><td class="dx"></td><td class="dy"></td><td class="r"></td><td class="d"></td><td class="mark"></td></tr>
      </tbody>
    </table>
    <div class="muted small">mm, offsets from true position. r = √(dx² + dy²). IN only if <b>both</b> endpoints have r ≤ ${fmt(R)} (boundary inclusive). Values shown to 0.0001 mm.</div>
    <div id="mid" class="muted small"></div>
  </section>

  <section class="inset-wrap">
    <svg id="inset" aria-label="Top view of zone and axis endpoints"></svg>
    <div class="muted small">Drag <b>T</b> (top), <b>B</b> (bottom) or the axis line. Real mm, no exaggeration. View ±0.2000 mm.</div>
  </section>

  <section>
    <h2>Presets</h2>
    <div class="presets">${PRESETS.map((p) => `<button data-preset="${p.id}">${p.label}</button>`).join('')}</div>
  </section>

  <section>
    <h2>Axis crossing at TOP (z = 10)</h2>${slider('top', 'dx')}${slider('top', 'dy')}
    <h2>Axis crossing at BOTTOM (z = 0)</h2>${slider('bottom', 'dx')}${slider('bottom', 'dy')}
  </section>

  <section>
    <h2>View</h2>
    <label class="ctl"><span>Exaggeration</span><input type="range" id="mag" min="${VIEW.minMagnification}" max="${VIEW.maxMagnification}" step="1"/><b id="mag-val"></b></label>
    <label class="check"><input type="checkbox" id="xray"/> X-ray plate (see the axis inside the hole)</label>
    <button id="reset-cam">Reset camera</button> <button id="zoom-hole">Zoom to hole</button>
    <p class="muted small">3D view: drag the <b>TOP</b> / <b>BOTTOM</b> spheres to tilt, the white <b>slide</b> sphere to shift. Left-drag elsewhere to orbit, right-drag to pan, wheel to zoom.</p>
  </section>`;
}
