// DOM side panel: numeric controls, presets, the per-endpoint readout, and a
// 2D top-down "zone inset" (also draggable). No Three.js dependency.
import { SPEC, VIEW, PRESETS } from './config.js';
import { fmt, fmtLimit, fmtUp, fmtSigned, fmtAgainst, fmtMargin } from './format.js';
import { notJudged } from './tolerance.js';
import { fcfHTML, fmtNote, MMC_SYM, LMC_SYM, modSym, datumSummary, NO_DATUM_TEXT, PERP_LABEL } from './fcf.js';

const SIZE_LIMITS = `⌀${fmt(SPEC.hole.mmc)}–${fmt(SPEC.hole.lmc)}`;
/** Size note shown next to every verdict (same length IN / REJECT, so no layout jump). */
export const sizeNote = (size) => size.sizeOk
  ? `Hole size ⌀${fmt(size.actualSize)} ✔ within ${SIZE_LIMITS}`
  : `Hole size ⌀${fmt(size.actualSize)} ✘ outside ${SIZE_LIMITS}`;
export const STATUS = { IN: 'IN TOLERANCE', OUT: 'OUT OF TOLERANCE', REJECT_SIZE: 'REJECT: size', INVALID_TOL: 'INVALID: ⌀0 at RFS', NO_DATUMS: 'NO DATUMS' };
/** Shown when a stated ⌀0 is refused at RFS (Sally). */
/** Teaching line shown (small) at MMC and LMC. */
/** Lock on, zone shrank (size / mode / stated) and that shrink caused the OUT. */
export const SHRINK_NOTE = 'zone shrank: less bonus at this size';
/** Lock on, a datum was restored and the less free zone left the axis outside. */
export const DATUM_SHRINK_NOTE = 'datum restored: zone less free, axis unmoved';
export const TEACH = 'MMC protects assembly, LMC protects material.';
export const ZERO_REASON = '⌀0 is only meaningful at MMC or LMC, where bonus supplies the tolerance.';
const BADGE = { IN: '✔ IN', OUT: '✘ OUT', REJECT_SIZE: '✘ REJECT: size', INVALID_TOL: '✘ INVALID', NO_DATUMS: '– NO DATUMS' };
const SVGNS = 'http://www.w3.org/2000/svg';

export function createUI(root, { onChange, onPreset, onMagnification, onXray, onDrawing, onSize, onModifier, onStated, onLock, onTiltLock, onDatum, onResetCamera, onZoomHole, clampOffset }) {
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
  $('#drawing').addEventListener('change', (e) => onDrawing?.(e.target.checked));
  $('#reset-cam').addEventListener('click', onResetCamera);
  $('#zoom-hole').addEventListener('click', onZoomHole);

  // --- hole size, RFS / MMC, stated tolerance --------------------------------
  const msg = (t) => { $('#mc-msg').textContent = t; };
  $('#r-size').addEventListener('input', (e) => onSize(Number(e.target.value)));
  $('#n-size').addEventListener('change', (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onSize(v); });
  for (const m of ['RFS', 'MMC', 'LMC']) {
    $(`#mod-${m.toLowerCase()}`).addEventListener('click', () => {
      if (onModifier(m) === false) msg(ZERO_REASON);
      else msg('');
    });
  }
  for (const d of ['A', 'B', 'C']) $(`#datum-${d}`).addEventListener('click', () => onDatum(d, $(`#datum-${d}`).getAttribute('aria-pressed') !== 'true'));
  $('#tilt-lock-btn').addEventListener('click', () => onTiltLock($('#tilt-lock-btn').getAttribute('aria-pressed') !== 'true'));
  $('#lock-btn').addEventListener('click', () => onLock($('#lock-btn').getAttribute('aria-pressed') !== 'true'));
  $('#n-stated').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || onStated(v) === false) {
      msg(ZERO_REASON);
      e.target.value = lastStated;
    } else msg('');
  });
  let lastStated = '';

  const inset = createInset($('#inset'), { onChange, clampOffset });

  function render(state, res) {
    for (const f of fields) {
      const v = state[f.end][f.axis];
      f.range.value = String(v);
      if (document.activeElement !== f.num) f.num.value = fmtSigned(v).replace('−', '-').replace('+', '');
    }
    $('#mag').max = String(res.magMax ?? VIEW.maxMagnification);
    $('#mag').value = String(state.magnification);
    $('#mag-val').textContent = `×${state.magnification}`;
    $('#xray').checked = state.xray;
    $('#drawing').checked = state.drawing;
    $('#r-size').value = String(state.size);
    if (document.activeElement !== $('#n-size')) $('#n-size').value = fmt(state.size);
    lastStated = fmt(state.stated);
    if (document.activeElement !== $('#n-stated')) $('#n-stated').value = lastStated;
    $('#shrink-note').textContent = res.shrinkNote === 'datum' ? DATUM_SHRINK_NOTE : SHRINK_NOTE;
    $('#shrink-note').style.visibility = res.shrinkNote ? 'visible' : 'hidden';
    const ds = datumSummary(state.datums, res.zone);
    for (const d of ['A', 'B', 'C']) $(`#datum-${d}`).setAttribute('aria-pressed', String(state.datums[d]));
    $('#slide-line').textContent = ds.slide || '\u00a0';
    $('#slide-line').style.visibility = ds.slide ? 'visible' : 'hidden';
    $('#datum-note').textContent = ds.note || '\u00a0';
    $('#datum-note').style.visibility = ds.note ? 'visible' : 'hidden';
    $('#datum-note').dataset.kind = ds.freedom.floats ? 'floats' : ds.freedom.perpOnly ? 'perp' : ds.note ? 'a' : '';
    $('#lock-btn').setAttribute('aria-pressed', String(!!state.lock));
    $('#tilt-lock-btn').setAttribute('aria-pressed', String(!!state.tiltLock));
    $('#preset-note').textContent = res.presetNote || '\u00a0';
    $('#preset-note').style.visibility = res.presetNote ? 'visible' : 'hidden';
    for (const m of ['RFS', 'MMC', 'LMC']) $(`#mod-${m.toLowerCase()}`).setAttribute('aria-pressed', String(state.modifier === m));
    const TOL = res.tolerance; // allowed (stated + bonus)
    const R = res.radius;
    const sz = res.size;
    $('#spec-fcf').innerHTML = fcfHTML(state, 'fcf big');
    $('#spec-zone').textContent = `${state.modifier} · cylindrical zone (⌀ = allowed)`;
    const rej = res.verdict === 'REJECT_SIZE';
    const nod = res.verdict === 'NO_DATUMS';
    const na = rej || nod; // neutral: position not judged
    const slid = ds.freedom.slides;
    const perp = ds.freedom.perpOnly; // A only: reads like a perpendicularity control
    $('#pos-label').innerHTML = perp ? `<b>${PERP_LABEL}</b>, reported as 2r` : 'Position (reported as a <b>diameter</b> = 2r, not a radius)';
    const bon = state.modifier !== 'RFS';
    $('#tol-line').innerHTML = bon && rej
      ? `stated ⌀${fmt(sz.stated)} + bonus n/a <span class="muted">(size rejected)</span>`
      : bon
      ? `stated ⌀${fmt(sz.stated)} + bonus ⌀${fmtLimit(sz.bonus)} = allowed ⌀${fmtLimit(sz.allowed)}`
      : `stated ⌀${fmt(sz.stated)} = allowed ⌀${fmtLimit(sz.allowed)} <span class="muted">(RFS: no bonus)</span>`;
    $('#bonus-detail').textContent = bon ? (rej ? `no bonus: hole ⌀${fmt(sz.actualSize)} is outside ${SIZE_LIMITS}` : state.modifier === 'LMC' ? `bonus = LMC ⌀${fmt(SPEC.hole.lmc)} − actual ⌀${fmt(sz.actualSize)}` : `bonus = actual ⌀${fmt(sz.actualSize)} − MMC ⌀${fmt(SPEC.hole.mmc)}`) : '\u00a0'; // keep the line's height at RFS (no jump)
    $('#vc-text').textContent = bon ? `${state.modifier === 'LMC' ? 'LMC ' : ''}virtual condition ⌀${fmtNote(sz.virtualCondition)}` : '\u00a0';
    const lmc = state.modifier === 'LMC';
    $('#rc-text').textContent = `LMC resultant condition ⌀${fmtUp(lmc ? sz.resultantCondition : SPEC.hole.mmc - (state.stated + SPEC.hole.lmc - SPEC.hole.mmc))}`;
    $('#rc-text').style.visibility = lmc ? '' : 'hidden'; // reserve its space at RFS/MMC (no layout jump)
    $('#vc-line').style.visibility = bon ? 'visible' : 'hidden';
    $('#bonus-detail').style.visibility = bon ? 'visible' : 'hidden';
    $('#teach-line').style.visibility = bon ? 'visible' : 'hidden';
    $('#th-r').textContent = `r vs ${fmtLimit(R)}`;
    $('#th-d').textContent = `2r vs ⌀${fmtLimit(TOL)}`;
    $('#rule-note').innerHTML = `mm, offsets from ${slid ? `the slid zone centre (true position ${ds.freedom.freeX ? `dx ${fmtSigned(res.zone.dx)}` : ''}${ds.freedom.freeX && ds.freedom.freeY ? ', ' : ''}${ds.freedom.freeY ? `dy ${fmtSigned(res.zone.dy)}` : ''})` : 'true position'}. r = √(dx² + dy²). IN only if <b>both</b> endpoints have r ≤ ${fmtLimit(R)} (boundary inclusive). Metric display: up to 3 decimals; measured values round up, limits round down.`;
    for (const el of root.querySelectorAll('.size-note')) el.textContent = sizeNote(sz);

    for (const end of ['bottom', 'top']) {
      const e = res[end];
      const row = $(`#row-${end}`);
      row.className = na ? 'na' : e.inside ? 'pass' : 'fail';
      row.querySelector('.dx').textContent = fmtSigned(slid ? e.rx : e.dx);
      row.querySelector('.dy').textContent = fmtSigned(slid ? e.ry : e.dy);
      if (nod) { // nothing to measure against: the zone floats
        row.querySelector('.r').textContent = '—';
        row.querySelector('.d').textContent = '—';
        row.querySelector('.mark').textContent = 'n/a';
        continue;
      }
      if (rej) { // size rejected: values for information only, no comparison
        row.querySelector('.r').textContent = fmtUp(e.r);
        row.querySelector('.d').textContent = `⌀${fmtUp(e.deviation)}`;
        row.querySelector('.mark').textContent = 'n/a';
        continue;
      }
      row.querySelector('.r').innerHTML = `${fmtAgainst(e.r, R, e.inside)} <span class="${e.inside ? 'le' : 'gt'}">${e.inside ? '≤' : '>'}</span> ${fmtLimit(R)}`;
      row.querySelector('.d').innerHTML = `⌀${fmtAgainst(e.deviation, TOL, e.inside)} <span class="${e.inside ? 'le' : 'gt'}">${e.inside ? '≤' : '>'}</span> ⌀${fmtLimit(TOL)}`;
      row.querySelector('.mark').textContent = e.inside ? '✔ PASS' : '✘ FAIL';
    }
    const worst = res.top.r >= res.bottom.r ? 'top' : 'bottom';
    const overall = $('#overall');
    overall.className = `overall ${nod ? 'na' : res.accept ? 'pass' : 'fail'}`;
    const posShown = nod ? '—' : rej ? fmtUp(res.deviation) : fmtAgainst(res.deviation, TOL, res.inTolerance);
    $('#pos-value').textContent = nod ? '—' : `⌀${posShown}`;
    $('#pos-compare').innerHTML = nod ? '' : rej ? '<span class="muted">(info)</span>' : `${res.inTolerance ? '≤' : '>'} ⌀${fmtLimit(TOL)}`;
    $('#pos-status').textContent = STATUS[res.verdict];
    $('#pos-detail').textContent = nod ? NO_DATUM_TEXT : rej ? `= 2 × r(${worst}) = 2 × ${fmtUp(res[worst].r)} · not judged: size rejected` : `= 2 × r(${worst}) = 2 × ${fmtAgainst(res[worst].r, R, res.inTolerance)} · margin ${fmtMargin(res.deviation, TOL, res.inTolerance)} mm`;
    $('#mid').textContent = `mid-plane (z=5) offset: dx ${fmtSigned(res.mid.dx)}, dy ${fmtSigned(res.mid.dy)} · tilt ${fmt(res.tilt)}°`;

    const badge = document.getElementById('status-badge');
    badge.className = `status-badge ${nod ? 'na' : res.accept ? 'pass' : 'fail'}`;
    const small = nod ? NO_DATUM_TEXT : res.verdict === 'REJECT_SIZE' ? `hole ⌀${fmt(sz.actualSize)} outside ${SIZE_LIMITS}`
      : res.verdict === 'INVALID_TOL' ? 'stated ⌀0 needs MMC or LMC'
      
      : perp ? `perpendicularity to A ⌀${posShown} ${res.inTolerance ? '≤' : '>'} ⌀${fmtLimit(TOL)}${bon ? ` ${modSym(state.modifier)}` : ''}`
      : `position ⌀${posShown} ${res.inTolerance ? '≤' : '>'} ⌀${fmtLimit(TOL)}${bon ? ` ${modSym(state.modifier)}` : ''}`;
    badge.innerHTML = `${BADGE[res.verdict]}<small>${small}</small><span class="size-note">${sizeNote(sz)}</span>`;
    document.getElementById('mag-badge').textContent = `Zone & deviations drawn ×${state.magnification} (display only)`;
    inset.render(state, res);
  }
  return { render };
}

// --- Top-down inset: zone circle at TRUE scale relationship ------------------
function createInset(svg, { onChange, clampOffset }) {
  const HALF = 0.25; // mm shown from centre to edge (fits the largest MMC zone, ⌀0.45)
  const R = SPEC.position.tolerance / 2; // initial label placement only
  svg.setAttribute('viewBox', `${-HALF} ${-HALF} ${2 * HALF} ${2 * HALF}`);
  svg.innerHTML = `
    <g transform="scale(1,-1)">
      <g id="i-grid"><circle class="grid" r="0.05"/><circle class="grid" r="0.1"/><circle class="grid" r="0.15"/><circle class="grid" r="0.2"/>
      <line class="grid" x1="${-HALF}" y1="0" x2="${HALF}" y2="0"/><line class="grid" x1="0" y1="${-HALF}" x2="0" y2="${HALF}"/></g>
      <g id="i-free" class="free" style="display:none"></g>
      <path id="i-centre" class="centre" d="M0 -0.016 L0.016 0 L0 0.016 L-0.016 0Z" style="display:none"/>
      <path id="i-tp" class="tp" d="M-0.02 0H0.02M0 -0.02V0.02" style="display:none"/>
      <circle class="zone" r="${R}"/>
      <line class="axis" id="i-axis"/>
      <circle class="mid" id="i-mid" r="0.007"/>
      <circle class="pt" id="i-bottom" r="0.011" data-end="bottom"/>
      <circle class="pt" id="i-top" r="0.011" data-end="top"/>
    </g>
    <text x="${-R * 0.72 - 0.065}" y="${R * 0.72 + 0.02}" class="t-zone" id="t-zone">⌀${fmtNote(SPEC.position.tolerance)} position zone</text>
    <text id="t-view" x="${-HALF + 0.008}" y="${-HALF + 0.022}" class="t-small">top view (from +Z)</text>
    <text id="t-grid" x="${-HALF + 0.008}" y="${HALF - 0.008}" class="t-small">grid rings r = 0.05 / 0.1 / 0.15 / 0.2 mm</text>
    <text id="t-tp" class="t-small t-tp" style="display:none">true position</text>
    <text id="t-bottom" class="t-pt">B</text><text id="t-top" class="t-pt">T</text>`;
  const q = (id) => svg.querySelector(id);

  // Drag directly in the inset (exact mm, no 3D projection involved)
  let drag = null;
  const toMM = (ev) => {
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: -p.y };
  };
  svg.addEventListener('pointerdown', (ev) => {
    let end = ev.target.dataset?.end || null;
    if (!end) {
      // Finger-friendly: grab the nearest endpoint dot within ~22 px (touch) / 8 px (mouse)
      const p = toMM(ev);
      const s = svg.__state;
      const mmPerPx = (2 * HALF) / svg.getBoundingClientRect().width;
      let bestD = (ev.pointerType === 'mouse' ? 8 : 22) * mmPerPx;
      for (const e of ['top', 'bottom']) {
        const d = Math.hypot(p.x - s[e].dx, p.y - s[e].dy);
        if (d < bestD) { bestD = d; end = e; }
      }
    }
    if (!end && (ev.target.id === 'i-mid' || ev.target.id === 'i-axis')) end = 'mid';
    if (!end) return;
    // Pixel-based: the view may re-centre on the slid zone while dragging, so mm = px × (fixed scale).
    drag = { end, x0: ev.clientX, y0: ev.clientY, mmPerPx: (2 * HALF) / svg.getBoundingClientRect().width, s: structuredClone(svg.__state) };
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const d = { dx: (ev.clientX - drag.x0) * drag.mmPerPx, dy: -(ev.clientY - drag.y0) * drag.mmPerPx };
    const mv = (o) => ({ dx: clampOffset(o.dx + d.dx), dy: clampOffset(o.dy + d.dy) });
    const next = {};
    if (drag.end !== 'bottom') next.top = mv(drag.s.top);
    if (drag.end !== 'top') next.bottom = mv(drag.s.bottom);
    onChange(next);
  });
  svg.addEventListener('pointerup', () => (drag = null));

  function render(state, res) {
    svg.__state = { bottom: { ...state.bottom }, top: { ...state.top } };
    const f = res.freedom;
    // With a slid zone the view re-centres on it (rings stay r-from-zone-centre); otherwise it is the fixed true-position view.
    const zc = f.slides ? { x: res.zone.dx, y: res.zone.dy } : { x: 0, y: 0 };
    svg.setAttribute('viewBox', `${zc.x - HALF} ${-zc.y - HALF} ${2 * HALF} ${2 * HALF}`);
    q('#i-grid').setAttribute('transform', `translate(${zc.x} ${zc.y})`);
    const clip = (v, c) => Math.max(c - HALF * 0.97, Math.min(c + HALF * 0.97, v));
    const b = { x: clip(state.bottom.dx, zc.x), y: clip(state.bottom.dy, zc.y) };
    const t = { x: clip(state.top.dx, zc.x), y: clip(state.top.dy, zc.y) };
    const na = notJudged(res.verdict);
    const tone = (ok) => (na ? 'na' : ok ? 'pass' : 'fail');
    const zone = q('.zone');
    zone.setAttribute('class', `zone ${tone(res.inTolerance)}`);
    zone.setAttribute('r', res.radius);
    zone.setAttribute('cx', zc.x);
    zone.setAttribute('cy', zc.y);
    const tz = q('#t-zone');
    tz.textContent = `⌀${fmtLimit(res.tolerance)} position zone`;
    tz.setAttribute('x', zc.x - res.radius * 0.72 - 0.065);
    tz.setAttribute('y', -zc.y + res.radius * 0.72 + 0.02);
    // freed degrees of freedom: the band the zone can sweep + double arrows beside it
    const fr = q('#i-free');
    const showFree = f.slides || f.floats;
    fr.style.display = showFree ? '' : 'none';
    if (showFree) {
      const r = res.radius, o = r + 0.012, h = 0.02;
      const arrow = (dx, dy) => { // tip at distance o+0.04 from centre along (dx,dy)
        const tip = [zc.x + dx * (o + 0.04), zc.y + dy * (o + 0.04)], base = [zc.x + dx * o, zc.y + dy * o];
        const px = -dy, py = dx;
        return `<path d="M${base} L${tip}" /><path class="head" d="M${tip} L${tip[0] - dx * h + px * h * 0.6} ${tip[1] - dy * h + py * h * 0.6} L${tip[0] - dx * h - px * h * 0.6} ${tip[1] - dy * h - py * h * 0.6}Z"/>`;
      };
      fr.innerHTML = f.floats ? '' :
        (f.freeX ? `<rect class="band" x="${zc.x - HALF}" y="${zc.y - r}" width="${2 * HALF}" height="${2 * r}"/>${arrow(1, 0)}${arrow(-1, 0)}` : '') +
        (f.freeY ? `<rect class="band" x="${zc.x - r}" y="${zc.y - HALF}" width="${2 * r}" height="${2 * HALF}"/>${arrow(0, 1)}${arrow(0, -1)}` : '');
    }
    const ctr = q('#i-centre');
    ctr.style.display = f.slides ? '' : 'none';
    ctr.setAttribute('transform', `translate(${zc.x} ${zc.y})`);
    // true position cross + label, only when the zone has slid away from it (and it is in view)
    const tp = q('#i-tp'), tpt = q('#t-tp');
    const away = f.slides && Math.hypot(zc.x, zc.y) > 0.02;
    const inView = Math.abs(zc.x) < HALF * 0.85 && Math.abs(zc.y) < HALF * 0.85;
    tp.style.display = away && inView ? '' : 'none';
    tpt.style.display = tp.style.display;
    tpt.setAttribute('x', -0.05); tpt.setAttribute('y', 0.05);
    q('#t-view').textContent = f.slides ? 'top view · ◆ auto best-fit zone centre' : 'top view (from +Z)';
    q('#t-view').setAttribute('x', zc.x - HALF + 0.008); q('#t-view').setAttribute('y', -zc.y - HALF + 0.022);
    q('#t-grid').setAttribute('x', zc.x - HALF + 0.008); q('#t-grid').setAttribute('y', -zc.y + HALF - 0.008);
    q('#t-grid').textContent = f.slides ? 'rings r = 0.05 / 0.1 / 0.15 / 0.2 mm from the slid zone centre' : 'grid rings r = 0.05 / 0.1 / 0.15 / 0.2 mm';
    Object.entries({ x1: b.x, y1: b.y, x2: t.x, y2: t.y }).forEach(([k, v]) => q('#i-axis').setAttribute(k, v));
    q('#i-axis').setAttribute('class', `axis ${tone(res.inTolerance)}`);
    q('#i-mid').setAttribute('cx', (b.x + t.x) / 2);
    q('#i-mid').setAttribute('cy', (b.y + t.y) / 2);
    for (const [end, p] of [['bottom', b], ['top', t]]) {
      const c = q(`#i-${end}`);
      c.setAttribute('cx', p.x);
      c.setAttribute('cy', p.y);
      c.setAttribute('class', `pt ${tone(res[end].inside)}`);
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
      <input type="range" id="r-${end}-${axis}" min="${-m}" max="${m}" step="0.001" />
      <input type="number" id="n-${end}-${axis}" min="${-m}" max="${m}" step="0.001" />
    </label>`;
}

function template() {
  const S = SPEC.hole.sizeSlider;
  return `
  <header>
    <h1>Position of a hole</h1>
    <div class="spec">
      <div>Hole ⌀${SPEC.hole.nominal} ±${SPEC.hole.plusMinus} THRU at BASIC <span class="basic">${SPEC.basic.fromB}</span> from B, <span class="basic">${SPEC.basic.fromC}</span> from C</div>
      <div id="spec-fcf"></div>
      <div class="muted">Plate ${SPEC.plate.x} × ${SPEC.plate.y} × ${SPEC.plate.z} mm · <span id="spec-zone"></span> ⟂ A at (${SPEC.truePosition.x}, ${SPEC.truePosition.y}), z = 0…${SPEC.plate.z}</div>
    </div>
  </header>

  <section id="overall" class="overall">
    <div id="pos-label" class="pos-label">Position (reported as a <b>diameter</b> = 2r, not a radius)</div>
    <div class="pos-line"><span id="pos-value"></span> <span id="pos-compare"></span> <span id="pos-status"></span></div>
    <div id="pos-detail" class="muted"></div>
    <div id="tol-line" class="tol-line"></div>
    <div id="bonus-detail" class="muted small"></div>
    <div id="shrink-note" class="shrink-note" style="visibility:hidden">${SHRINK_NOTE}</div>
    <div id="vc-line" class="vc-line"><span id="vc-text"></span><span id="rc-text" class="rc"></span></div>
    <div id="teach-line" class="muted small teach">${TEACH}</div>
    <div class="size-note"></div>
  </section>

  <section id="mc" class="mc">
    <h2>Hole size &amp; material condition</h2>
    <label class="ctl"><span>Hole ⌀</span><input type="range" id="r-size" min="${S.min}" max="${S.max}" step="${S.step}"/><input type="number" id="n-size" min="${S.min}" max="${S.max}" step="0.001"/></label>
    <div class="mc-row">
      <span class="seg" role="group" aria-label="Material condition"><button id="mod-rfs" type="button" aria-pressed="true">RFS</button><button id="mod-mmc" type="button" aria-pressed="false">MMC ${MMC_SYM}</button><button id="mod-lmc" type="button" aria-pressed="false">LMC ${LMC_SYM}</button></span>
      <label class="stated"><span>Stated ⌀</span><input type="number" id="n-stated" min="0" max="1" step="0.001"/></label>
      <button id="lock-btn" type="button" class="lock-btn" aria-pressed="false" title="Endpoints cannot leave the allowed zone (bonus included)">Lock in tolerance</button>
      <button id="tilt-lock-btn" type="button" class="lock-btn" aria-pressed="false" title="Both endpoints move together: the current tilt is frozen (never straightened)">Lock tilt</button>
    </div>
    <div id="mc-msg" class="mc-msg" role="status"></div>
    <div class="muted small">Size limits ${SIZE_LIMITS} (MMC ⌀${fmt(SPEC.hole.mmc)}). Outside them the part is <b>REJECT: size</b>, whatever the axis. At MMC, bonus = actual size − ${fmt(SPEC.hole.mmc)}; at LMC, bonus = ${fmt(SPEC.hole.lmc)} − actual size.</div>
  </section>

  <section id="datums" class="datums">
    <h2>Datum references in the FCF</h2>
    <div class="datum-row">
      <span class="seg datum-seg" role="group" aria-label="Datum references kept in the feature control frame"><button id="datum-A" type="button" aria-pressed="true" title="Datum A: primary plane (perpendicular to the hole)">A</button><button id="datum-B" type="button" aria-pressed="true" title="Datum B: locates the zone in X (dropped: the zone slides in X)">B</button><button id="datum-C" type="button" aria-pressed="true" title="Datum C: locates the zone in Y (dropped: the zone slides in Y)">C</button></span>
      <span class="muted small">on = kept in the FCF</span>
    </div>
    <div id="slide-line" class="slide-line" style="visibility:hidden">\u00a0</div>
    <div id="datum-note" class="datum-note" style="visibility:hidden">\u00a0</div>
  </section>

  <section>
    <h2>Axis endpoints vs zone</h2>
    <table class="readout">
      <thead><tr><th>Endpoint</th><th>dx</th><th>dy</th><th id="th-r"></th><th id="th-d"></th><th></th></tr></thead>
      <tbody>
        <tr id="row-bottom"><th>Bottom<br><small>z = 0</small></th><td class="dx"></td><td class="dy"></td><td class="r"></td><td class="d"></td><td class="mark"></td></tr>
        <tr id="row-top"><th>Top<br><small>z = 10</small></th><td class="dx"></td><td class="dy"></td><td class="r"></td><td class="d"></td><td class="mark"></td></tr>
      </tbody>
    </table>
    <div id="rule-note" class="muted small"></div>
    <div id="mid" class="muted small"></div>
  </section>

  <section class="inset-wrap">
    <svg id="inset" aria-label="Top view of zone and axis endpoints"></svg>
    <div class="muted small">Drag <b>T</b> (top), <b>B</b> (bottom) or the axis line. Real mm, no exaggeration. View ±0.25 mm.</div>
  </section>

  <section>
    <h2>Presets</h2>
    <div class="presets">${PRESETS.map((p) => `<button data-preset="${p.id}">${p.label}</button>`).join('')}</div>
    <div id="preset-note" class="muted small preset-note" style="visibility:hidden">\u00a0</div>
  </section>

  <section>
    <h2>Axis crossing at TOP (z = 10)</h2>${slider('top', 'dx')}${slider('top', 'dy')}
    <h2>Axis crossing at BOTTOM (z = 0)</h2>${slider('bottom', 'dx')}${slider('bottom', 'dy')}
  </section>

  <section>
    <h2>View</h2>
    <label class="ctl"><span>Exaggeration</span><input type="range" id="mag" min="${VIEW.minMagnification}" max="${VIEW.maxMagnification}" step="1"/><b id="mag-val"></b></label>
    <label class="check phone-only"><input type="checkbox" id="drawing"/> Show drawing (datums, basic 35/30, true position, ⌀10.1 callout, FCF leader)</label>
    <label class="check"><input type="checkbox" id="xray"/> X-ray plate (see the axis inside the hole)</label>
    <button id="reset-cam">Reset camera</button> <button id="zoom-hole">Zoom to hole</button>
    <p class="muted small">3D view: drag the <b>TOP</b> / <b>BOTTOM</b> spheres to tilt, the white <b>slide</b> sphere to shift. Left-drag elsewhere to orbit, right-drag to pan, wheel to zoom. View row: <b>Top Z / Front Y / Side X</b> snap to an ortho view (drags move X/Y in top view, X in front view, Y in side view); <b>3D</b> returns to the perspective orbit.</p>
  </section>`;
}
