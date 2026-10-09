// Mobile usability check with Playwright device emulation (Chromium engine).
// Checks layout (overflow/clipping/sizes), touch drags of the 3D handles and
// inset dots (real touch events via CDP -> pointer events), one-finger orbit,
// two-finger pinch, tap on presets/sliders, verdict consistency, console errors.
// Usage: URL=https://... TAG=before node scripts/mobile-check.mjs
import { chromium, devices } from 'playwright-core';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const URL = process.env.URL || 'https://stovebolt.github.io/gdt-trainer/';
const TAG = process.env.TAG || 'check';
const OUT = 'screenshots/mobile';
const DEVICES = (process.env.DEVICES || 'iPhone 13,iPhone 13 landscape,iPhone 14,iPhone 14 landscape,Pixel 7,Pixel 7 landscape,iPad (gen 7),iPad (gen 7) landscape').split(',');
const EXPECT = { centered: true, 'tilt-in': true, 'tilt-out': false, 'edge-in': true, 'edge-out': false, 'diag-out': false };
const executablePath = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
mkdirSync(OUT, { recursive: true });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = [];
let anyFail = false;

for (const name of DEVICES) {
  const { defaultBrowserType, ...desc } = devices[name];
  const ctx = await browser.newContext({ ...desc });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`));
  const cdp = await ctx.newCDPSession(page);
  const checks = [];
  const check = (label, ok, detail = '') => { checks.push({ label, ok, detail }); if (!ok) anyFail = true; };

  await page.goto(URL + (URL.includes('?') ? '&' : '?') + 'cb=' + Date.now(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.gdt?.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(700);

  // ---- Starting camera: phones start in "Zoom to hole", others in the overview --
  const OVERVIEW = [-22, -88, 92], HOLE = [28.5, -5.5, 42]; // HOLE = phoneHoleCamera() in scene.js
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.5;
  {
    const isPhone = await page.evaluate(() => window.matchMedia('(max-width: 700px), (max-height: 500px)').matches);
    const cam = await page.evaluate(() => window.gdt._debug.camera.position.toArray());
    const want = isPhone ? HOLE : OVERVIEW;
    check(`start view: ${isPhone ? 'phone -> Zoom to hole' : 'non-phone -> overview (unchanged)'}`, near(cam, want), `camera ${cam.map((v) => v.toFixed(1)).join(',')}`);
    const startShot = `${OUT}/${slug(name)}-${isPhone ? 'zoomstart' : 'start'}-${TAG}.png`;
    await page.screenshot({ path: startShot });
    const li0 = await page.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const cv = r(window.gdt._debug.canvas);
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const out = [];
      for (const el of document.querySelectorAll('.zone-label, .axis-name-label, .handle-label')) {
        const b = r(el);
        if (b.left < cv.left || b.right > cv.right || b.top < cv.top || b.bottom > cv.bottom) out.push(`${el.innerText.slice(0, 14)} off-view`);
      }
      for (const a of document.querySelectorAll('.zone-label, .axis-name-label')) for (const h of document.querySelectorAll('.handle-label')) if (hit(r(a), r(h))) out.push(`${a.className.split(' ')[1]}~${h.innerText.split(' ')[0]}`);
      const fonts = [...document.querySelectorAll('.zone-label, .axis-name-label, .handle-label')].map((e) => parseFloat(getComputedStyle(e).fontSize));
      return { out, minFont: Math.min(...fonts) };
    });
    check('start view: zone/axis/handle labels in view, no overlap, font >= 10px', li0.out.length === 0 && li0.minFont >= 10, `${li0.out.join(', ')} min font ${li0.minFont}px -> ${startShot}`);
  }

  // ---- Layout -------------------------------------------------------------
  const L = await page.evaluate(() => {
    const rect = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) }; };
    const panel = document.getElementById('panel');
    const pr = panel.getBoundingClientRect();
    const overflowing = [];
    for (const el of panel.querySelectorAll('section, header, table, .size-note, .presets, button, .ctl, svg#inset, .overall')) {
      const b = el.getBoundingClientRect();
      if (b.width && (b.right > pr.right + 1 || b.right > innerWidth + 1)) overflowing.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} right=${Math.round(b.right)}`);
    }
    const badge = document.getElementById('status-badge');
    const btns = [...panel.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height);
    const fonts = [...panel.querySelectorAll('.readout td, .readout th, .size-note, button')].map((e) => parseFloat(getComputedStyle(e).fontSize));
    return {
      inner: { w: innerWidth, h: innerHeight },
      docScrollW: document.documentElement.scrollWidth,
      docScrollH: document.documentElement.scrollHeight,
      viewport: rect(document.getElementById('viewport')),
      panel: rect(panel),
      panelScrollW: panel.scrollWidth,
      panelClientW: panel.clientWidth,
      badge: rect(badge),
      overflowing,
      minButtonH: Math.round(Math.min(...btns)),
      minFont: Math.min(...fonts),
      metaViewport: document.querySelector('meta[name=viewport]')?.content,
    };
  });
  check('no horizontal page overflow', L.docScrollW <= L.inner.w + 1, `doc scrollWidth ${L.docScrollW} vs ${L.inner.w}`);
  check('3D view usable size (>= 280x220 css px)', L.viewport.w >= 280 && L.viewport.h >= 220, `${L.viewport.w}x${L.viewport.h}`);
  check('panel has no internal horizontal overflow', L.panelScrollW <= L.panelClientW + 1, `scrollW ${L.panelScrollW} vs clientW ${L.panelClientW}`);
  check('no clipped panel elements', L.overflowing.length === 0, L.overflowing.slice(0, 6).join('; '));
  check('status badge fits inside 3D view', L.badge.w > 0 && L.badge.right <= L.viewport.x + L.viewport.w + 1 && L.badge.w <= L.viewport.w, `badge ${L.badge.w}w right=${L.badge.right}, view ${L.viewport.w}w`);
  check('buttons >= 36px tall (touch target)', L.minButtonH >= 36, `min ${L.minButtonH}px`);

  // Screenshots (tilt-out = red, the most informative state)
  await page.evaluate(() => window.gdt.applyPreset('tilt-out'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const shot = `${OUT}/${slug(name)}-${TAG}.png`;
  const full = `${OUT}/${slug(name)}-${TAG}-full.png`;
  await page.screenshot({ path: shot });
  await page.screenshot({ path: full, fullPage: true });

  // ---- Clarifying labels (zone "not a pin", actual axis, inset) ---------------
  {
    const li = await page.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const cv = r(window.gdt._debug.canvas);
      const zone = document.querySelector('.zone-label'), axis = document.querySelector('.axis-name-label');
      const issues = [];
      for (const [n, el] of [['zone', zone], ['axis', axis]]) {
        if (!el) { issues.push(`${n} missing`); continue; }
        const b = r(el);
        if (b.left < cv.left || b.right > cv.right || b.top < cv.top || b.bottom > cv.bottom) issues.push(`${n} off-view`);
        for (const h of document.querySelectorAll('.handle-label')) if (hit(b, r(h))) issues.push(`${n}~${h.innerText.split(' ')[0]}`);
      }
      return { zone: zone?.innerText.replace(/\n/g, ' '), axis: axis?.innerText, inset: document.querySelector('#inset .t-zone')?.textContent, font: zone && getComputedStyle(zone).fontSize, issues };
    });
    check('labels: zone "not a pin" (×24), actual axis, inset text; visible, no overlap with TOP/BOTTOM labels',
      li.zone === 'position zone ⌀0.25 (shown ×24, not a pin)' && li.axis === "hole's actual axis" && li.inset === '⌀0.25 position zone' && li.issues.length === 0,
      `"${li.zone}" · "${li.axis}" · inset "${li.inset}" · ${li.font} ${li.issues.join(', ')}`);
  }

  // ---- Touch helpers ------------------------------------------------------
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i, radiusX: 4, radiusY: 4, force: 1 })) });
  async function drag1(x, y, dx, dy, steps = 8) {
    await touch('touchStart', [[x, y]]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x + (dx * i) / steps, y + (dy * i) / steps]]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(150);
  }
  async function pinch(cx, cy, from, to, steps = 10) {
    await touch('touchStart', [[cx - from, cy], [cx + from, cy]]);
    for (let i = 1; i <= steps; i++) { const d = from + ((to - from) * i) / steps; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(600);
  }
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify({ b: window.gdt.state.bottom, t: window.gdt.state.top })));
  const camPos = () => page.evaluate(() => window.gdt._debug.camera.position.toArray());
  const scrollPos = () => page.evaluate(() => ({ x: scrollX, y: scrollY, p: document.getElementById('panel').scrollTop, ph: document.getElementById('panel').scrollHeight }));
  // Panel scrollTop may be clamped by the browser when content height changes (wrapped readout text); that is not a touch scroll.
  const noTouchScroll = (a, b) => a.y === b.y && (a.p === b.p || a.ph !== b.ph);
  const handleXY = (kind) => page.evaluate((k) => {
    const h = window.gdt._debug.handles[k], cam = window.gdt._debug.camera;
    const v = h.position.clone().project(cam), r = window.gdt._debug.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, inView: r.width > 0 && v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1 };
  }, kind);

  // ---- Presets by tap: verdict matches -------------------------------------
  const presetResults = [];
  for (const [id, expectIn] of Object.entries(EXPECT)) {
    const btn = page.locator(`button[data-preset="${id}"]`);
    await btn.scrollIntoViewIfNeeded();
    await btn.tap();
    await page.waitForTimeout(120);
    const r = await page.evaluate(() => ({ inTol: window.gdt.result().inTolerance, panel: document.getElementById('pos-status').innerText, badge: document.getElementById('status-badge').innerText.split('\n')[0] }));
    const ok = r.inTol === expectIn && r.panel === (expectIn ? 'IN TOLERANCE' : 'OUT OF TOLERANCE') && r.badge.includes(expectIn ? 'IN' : 'OUT');
    presetResults.push(`${id}:${r.inTol ? 'IN' : 'OUT'}${ok ? '' : '(!)'}`);
    if (!ok) check(`preset ${id} verdict`, false, JSON.stringify(r));
  }
  check('preset taps give expected verdicts (panel + badge)', !presetResults.some((s) => s.includes('(!)')), presetResults.join(' '));

  // ---- 3D handle touch drags -------------------------------------------------
  await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('viewport').scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(200);
  for (const kind of ['top', 'bottom', 'mid']) {
    await page.evaluate(() => window.gdt.applyPreset('centered'));
    await page.waitForTimeout(100);
    const h = await handleXY(kind);
    if (!h.inView) { check(`3D touch drag ${kind}`, false, 'handle not in view'); continue; }
    const s0 = await scrollPos();
    await drag1(h.x, h.y, 35, 0);
    const s = await state();
    const moved = (p) => Math.abs(p.dx) > 0.005 || Math.abs(p.dy) > 0.005;
    const expectTop = kind !== 'bottom', expectBot = kind !== 'top';
    const s1 = await scrollPos();
    check(`3D touch drag ${kind.toUpperCase()} handle`, moved(s.t) === expectTop && moved(s.b) === expectBot && noTouchScroll(s0, s1),
      `top=(${s.t.dx},${s.t.dy}) bottom=(${s.b.dx},${s.b.dy}) scroll ${s0.y}->${s1.y}`);
  }

  // ---- One-finger orbit on empty canvas; two-finger pinch ------------------
  await page.evaluate(() => window.gdt.applyPreset('tilt-in'));
  const vr = await page.evaluate(() => { const b = window.gdt._debug.canvas.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  {
    const before = await state(); const c0 = await camPos(); const s0 = await scrollPos();
    await drag1(vr.x + vr.w * 0.82, vr.y + vr.h * 0.85, -60, -20);
    await page.waitForTimeout(500);
    const after = await state(); const c1 = await camPos(); const s1 = await scrollPos();
    const camMoved = Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]) > 1;
    check('one-finger drag on empty canvas orbits (axis unchanged, no page scroll)', camMoved && JSON.stringify(before) === JSON.stringify(after) && s0.y === s1.y, `cam moved ${camMoved}, scroll ${s0.y}->${s1.y}`);
  }
  {
    const before = await state();
    const d0 = await page.evaluate(() => (() => { const c = window.gdt._debug.camera.position, t = window.gdt._debug.controls?.target ?? { x: 47, y: 30, z: 0 }; return Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z); })());
    const s0 = await scrollPos();
    await pinch(vr.x + vr.w / 2, vr.y + vr.h / 2, 30, Math.min(110, vr.w / 2 - 10));
    const d1 = await page.evaluate(() => (() => { const c = window.gdt._debug.camera.position, t = window.gdt._debug.controls?.target ?? { x: 47, y: 30, z: 0 }; return Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z); })());
    const after = await state(); const s1 = await scrollPos();
    const zoom = await page.evaluate(() => window.visualViewport.scale);
    check('two-finger pinch zooms 3D view (axis unchanged, page not zoomed)', d1 < d0 - 0.5 && JSON.stringify(before) === JSON.stringify(after) && zoom === 1 && s0.y === s1.y,
      `distance ${d0.toFixed(1)}->${d1.toFixed(1)}, page scale ${zoom}`);
  }

  {
    // Pinch where the first finger lands ON the TOP handle: must zoom, not drag the axis.
    // Start from the overview so the earlier pinch can't leave the camera at its zoom limit.
    await page.evaluate(() => document.getElementById('reset-cam').click());
    await page.waitForTimeout(100);
    await page.evaluate(() => window.gdt.applyPreset('tilt-in'));
    await page.waitForTimeout(100);
    const h = await handleXY('top');
    const before = await state();
    const dist = () => page.evaluate(() => { const c = window.gdt._debug.camera.position, t = window.gdt._debug.controls?.target ?? { x: 47, y: 30, z: 0 }; return Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z); });
    const d0 = await dist();
    await touch('touchStart', [[h.x, h.y], [h.x + 40, h.y + 10]]);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [[h.x - 6 * i, h.y - 2 * i], [h.x + 40 + 6 * i, h.y + 10 + 2 * i]]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(600);
    const d1 = await dist(); const after = await state();
    check('pinch starting on a handle zooms and leaves the axis unchanged', d1 < d0 - 0.5 && JSON.stringify(before) === JSON.stringify(after), `distance ${d0.toFixed(1)}->${d1.toFixed(1)}, axis ${JSON.stringify(before) === JSON.stringify(after) ? 'unchanged' : 'CHANGED ' + JSON.stringify(after)}`);
    await page.evaluate(() => document.getElementById('reset-cam').click()); // app's own overview reset
  }

  // ---- Inset touch drags -----------------------------------------------------
  for (const [end, other] of [['bottom', 'top'], ['top', 'bottom']]) {
    await page.evaluate(() => window.gdt.applyPreset('tilt-in'));
    const dot = page.locator(`#i-${end}`);
    await dot.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const b = await dot.boundingBox();
    const before = await state();
    const s0 = await scrollPos();
    await drag1(b.x + b.width / 2, b.y + b.height / 2, 0, -30);
    const after = await state(); const s1 = await scrollPos();
    const k = end === 'bottom' ? 'b' : 't', o = other === 'bottom' ? 'b' : 't';
    check(`inset touch drag ${end === 'bottom' ? 'B' : 'T'} dot`, after[k].dy > before[k].dy + 0.005 && JSON.stringify(after[o]) === JSON.stringify(before[o]) && noTouchScroll(s0, s1),
      `${k}.dy ${before[k].dy}->${after[k].dy}, scroll ${s0.y}/${s0.p}->${s1.y}/${s1.p}`);
  }

  // ---- Slider tap + number input ------------------------------------------
  {
    await page.evaluate(() => window.gdt.applyPreset('centered'));
    const range = page.locator('#r-top-dx');
    await range.scrollIntoViewIfNeeded();
    const b = await range.boundingBox();
    await page.touchscreen.tap(b.x + b.width * 0.8, b.y + b.height / 2);
    await page.waitForTimeout(150);
    const s = await state();
    const ui = await page.evaluate(() => ({ r: document.querySelector('#row-top .r').innerText, mark: document.querySelector('#row-top .mark').innerText, inTol: window.gdt.result().top.inside }));
    check('slider responds to tap; readout consistent', s.t.dx > 0.1 && ui.mark.includes(ui.inTol ? 'PASS' : 'FAIL'), `top.dx=${s.t.dx} row "${ui.r}" ${ui.mark}`);
    const num = page.locator('#n-top-dy');
    await num.scrollIntoViewIfNeeded();
    const nb = await num.boundingBox();
    await page.touchscreen.tap(nb.x + nb.width / 2, nb.y + nb.height / 2); // real touch tap focuses the input
    const focused = await page.evaluate(() => document.activeElement?.id);
    if (focused !== 'n-top-dy') check('number input focuses on tap', false, `active=${focused}`);
    await num.fill('0.0500');
    await num.press('Enter');
    await num.blur();
    await page.waitForTimeout(150);
    const s2 = await state();
    check('number input accepts typed value', Math.abs(s2.t.dy - 0.05) < 1e-9, `top.dy=${s2.t.dy}`);
  }

  {
    const btn = page.locator('#reset-cam');
    await btn.scrollIntoViewIfNeeded();
    const bb = await btn.boundingBox();
    await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); // real touch tap
    await page.waitForTimeout(300);
    const cam = await page.evaluate(() => window.gdt._debug.camera.position.toArray());
    check('Reset camera tap returns to the overview', near(cam, OVERVIEW), `camera ${cam.map((v) => v.toFixed(1)).join(',')}`);
  }
  check('no console errors/warnings', errors.length === 0, errors.slice(0, 5).join(' | '));
  report.push({ device: name, viewport: desc.viewport, layout: L, checks, screenshots: [shot, full] });
  console.log(`\n=== ${name} (${desc.viewport.width}x${desc.viewport.height}, dpr ${desc.deviceScaleFactor}) ===`);
  console.log(`  3D view ${L.viewport.w}x${L.viewport.h} · panel ${L.panel.w}x${L.panel.h} @(${L.panel.x},${L.panel.y}) · doc ${L.docScrollW}x${L.docScrollH} · min button ${L.minButtonH}px · min font ${L.minFont}px`);
  for (const c of checks) console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
  await ctx.close();
}
writeFileSync(`${OUT}/report-${TAG}.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(`\n${anyFail ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED'} · report: ${OUT}/report-${TAG}.json`);
process.exit(anyFail ? 1 : 0);
