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

  // ---- Phone declutter: drawing hidden by default, FCF chip always visible --
  {
    const isPhone = await page.evaluate(() => window.matchMedia('(max-width: 700px), (max-height: 500px)').matches);
    const DRAWING = '.tp-label, .dim, .fcf-label, .datum, .axis-label';
    const probe = () => page.evaluate((sel) => {
      const r = (e) => e.getBoundingClientRect();
      const shown = (e) => e && getComputedStyle(e).display !== 'none' && r(e).width > 0;
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const drawingShown = [...document.querySelectorAll(sel)].filter(shown).length;
      const chip = document.getElementById('fcf-chip');
      const toggle = document.getElementById('drawing');
      const chipHits = [];
      const btn = document.getElementById('drawing-btn');
      const bt = btn && r(btn);
      const btnInfo = shown(btn) ? { w: Math.round(bt.width), h: Math.round(bt.height), inViewport: bt.top >= 0 && bt.bottom <= innerHeight && bt.left >= 0 && bt.right <= innerWidth, text: btn.innerText, pressed: btn.getAttribute('aria-pressed') } : null;
      const hud = document.getElementById('hud-br');
      if (shown(chip)) {
        const cb = r(hud), cv = r(window.gdt._debug.canvas);
        const za = [...document.querySelectorAll('.zone-label, .axis-name-label')].filter(shown);
        if (za.length === 2 && hit(r(za[0]), r(za[1]))) chipHits.push('zone~axis');
        if (cb.left < cv.left || cb.right > cv.right || cb.top < cv.top || cb.bottom > cv.bottom) chipHits.push('off-view');
        for (const e of document.querySelectorAll('.zone-label, .axis-name-label, .handle-label, #status-badge, #mag-badge')) if (shown(e) && hit(cb, r(e))) chipHits.push(e.id || e.className.split(' ')[1] || e.innerText.split(' ')[0]);
        const cam = window.gdt._debug.camera, hv = window.gdt._debug.handles;
        for (const k of ['top', 'bottom', 'mid']) { const v = hv[k].position.clone().project(cam); const x = cv.left + (v.x + 1) / 2 * cv.width, y = cv.top + (1 - v.y) / 2 * cv.height; if (x > cb.left - 6 && x < cb.right + 6 && y > cb.top - 6 && y < cb.bottom + 6) chipHits.push(k + ' handle'); }
      }
      return { btnInfo, drawingShown, chip: shown(chip), chipText: chip?.innerText.replace(/\s+/g, ' ').trim(), chipHits, toggleShown: shown(toggle?.closest('label')), toggleOn: !!toggle?.checked };
    }, DRAWING);
    const p0 = await probe();
    if (isPhone) {
      check('declutter: drawing hidden by default on phones, toggle off', p0.drawingShown === 0 && p0.toggleShown && !p0.toggleOn, `drawing labels shown ${p0.drawingShown}, toggle shown ${p0.toggleShown} on ${p0.toggleOn}`);
      const b0 = p0.btnInfo;
      check('declutter: "Show drawing" button in 3D view (no scroll), >= 40px, off', !!b0 && b0.inViewport && b0.h >= 40 && b0.w >= 40 && b0.pressed === 'false', JSON.stringify(b0));
      check('declutter: FCF chip + button visible, clear of hole/handles/labels/badges', p0.chip && /⌀0\.25 A B C/.test(p0.chipText) && p0.chipHits.length === 0, `"${p0.chipText}" ${p0.chipHits.join(', ')}`);
      const tapToggle = async () => {
        const bb = await page.locator('#drawing-btn').boundingBox(); // no scrolling: it's in the 3D view
        await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await page.waitForTimeout(400);
      };
      await tapToggle();
      const p1 = await probe();
      await page.screenshot({ path: `${OUT}/${slug(name)}-drawing-on-${TAG}.png` });
      check('declutter: button tap shows drawing (chip stays, panel toggle in sync, nothing overlaps)', p1.drawingShown >= 5 && p1.toggleOn && p1.chip && p1.btnInfo?.pressed === 'true' && p1.chipHits.length === 0, `drawing labels shown ${p1.drawingShown}, button "${p1.btnInfo?.text}" ${p1.chipHits.join(', ')}`);
      await tapToggle();
      const p2 = await probe();
      check('declutter: tapping again hides drawing', p2.drawingShown === 0 && !p2.toggleOn && p2.chip && p2.btnInfo?.pressed === 'false', `drawing labels shown ${p2.drawingShown}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => { const pn = document.getElementById('panel'); pn.scrollTop = 0; });
    } else {
      check('declutter: non-phone unchanged (drawing shown, no chip/toggle)', p0.drawingShown >= 5 && !p0.chip && !p0.btnInfo && !p0.toggleShown && p0.toggleOn, `drawing labels shown ${p0.drawingShown}, chip ${p0.chip}, toggle ${p0.toggleShown}`);
    }
  }

  // ---- MMC / bonus: controls reachable by touch, nothing overlaps in 3D -----
  {
    const tapEl = async (sel) => {
      await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
      await page.waitForTimeout(250);
      const bb = await page.locator(sel).boundingBox();
      await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(300);
      return bb;
    };
    const mmcBB = await tapEl('#mod-mmc');
    await tapEl('#n-size');
    await page.locator('#n-size').fill('10.15');
    await page.locator('#n-size').press('Enter');
    await page.locator('#n-size').blur();
    await page.evaluate(() => window.gdt.applyPreset('tilt-out'));
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('panel').scrollTop = 0; });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const shown = (e) => e && getComputedStyle(e).display !== 'none' && r(e).width > 0;
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const res = window.gdt.result(); const cv = r(window.gdt._debug.canvas);
      const items = [...document.querySelectorAll('.zone-label, .axis-name-label, .handle-label, #status-badge, #mag-badge, #hud-br')].filter(shown);
      const name = (e) => e.id || e.className.split(' ')[1] || e.innerText.split(' ')[0];
      const issues = [];
      for (const e of items) { const b = r(e); if (b.left < cv.left - 0.5 || b.right > cv.right + 0.5 || b.top < cv.top - 0.5 || b.bottom > cv.bottom + 0.5) issues.push(name(e) + ' off-view'); }
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const [a, b] = [items[i], items[j]];
        if (a.id === 'status-badge' && b.id === 'mag-badge') continue;
        if (hit(r(a), r(b))) issues.push(`${name(a)}~${name(b)}`);
      }
      return { modifier: window.gdt.state.modifier, size: window.gdt.state.size, verdict: res.verdict, allowed: res.tolerance, chipMMC: !!document.querySelector('#fcf-chip .mmcsym'), zone: document.querySelector('.zone-label')?.innerText.replace(/\s+/g, ' '), issues };
    });
    check('MMC: RFS/MMC + size controls work by touch (MMC button >= 40px)', m.modifier === 'MMC' && m.size === 10.15 && mmcBB.height >= 40, `modifier ${m.modifier}, size ${m.size}, MMC button ${Math.round(mmcBB.width)}x${Math.round(mmcBB.height)}`);
    check('MMC ⌀10.15: allowed 0.4, zone label ⌀0.4, chip shows Ⓜ, tilt-out IN', m.allowed === 0.4 && m.verdict === 'IN' && m.chipMMC && /⌀0\.4 /.test(m.zone), `${m.verdict} allowed ${m.allowed} zone "${m.zone}" chipⓂ ${m.chipMMC}`);
    check('MMC ⌀10.15: 3D labels/handles/badges/HUD in view, nothing overlaps', m.issues.length === 0, m.issues.join(', '));
    await page.screenshot({ path: `${OUT}/${slug(name)}-mmc-10.15-${TAG}.png` });
    await page.evaluate(() => window.gdt.setSize(10.22));
    await page.waitForTimeout(500);
    const rj = await page.evaluate(() => ({ verdict: window.gdt.result().verdict, badge: document.getElementById('status-badge').innerText.split('\n')[0], status: document.getElementById('pos-status').innerText,
      tol: document.getElementById('tol-line').innerText, pos: document.getElementById('pos-value').innerText,
      gray: ['top', 'bottom'].every((k) => window.gdt._debug.handles[k].material.color.getHexString() === '64748b') && document.querySelector('.zone-label').classList.contains('na') && document.querySelector('.axis-name-label').classList.contains('na') }));
    check('REJECT: size shown on badge and panel; bonus n/a; zone/axis/handles neutral gray; position kept', rj.verdict === 'REJECT_SIZE' && rj.badge.includes('REJECT: size') && rj.status === 'REJECT: size' && rj.tol.includes('bonus n/a') && !/bonus ⌀/.test(rj.tol) && rj.gray && /^⌀\d/.test(rj.pos), JSON.stringify(rj));
    await page.screenshot({ path: `${OUT}/${slug(name)}-mmc-reject-${TAG}.png` });
    await page.evaluate(() => window.gdt.setSize(10.1));
    const segBB = { rfs: await tapEl('#mod-rfs'), mmc: await tapEl('#mod-mmc'), lmc: await tapEl('#mod-lmc') };
    await page.locator('#n-size').fill('10.05'); await page.locator('#n-size').press('Enter'); await page.locator('#n-size').blur();
    await page.evaluate(() => { window.gdt.applyPreset('tilt-out'); window.scrollTo(0, 0); document.getElementById('panel').scrollTop = 0; });
    await page.waitForTimeout(600);
    const lm = await page.evaluate(() => ({ modifier: window.gdt.state.modifier, allowed: window.gdt.result().tolerance, verdict: window.gdt.result().verdict, chipL: !!document.querySelector('#fcf-chip .mmcsym[aria-label="LMC"]'), vc: document.getElementById('vc-text').innerText, rc: document.getElementById('rc-text').innerText, rcVis: getComputedStyle(document.getElementById('rc-text')).visibility }));
    const segOk = Object.values(segBB).every((b) => b.height >= 40 && b.width >= 40);
    check('RFS | MMC | LMC segments each >= 40px and work by touch', segOk && lm.modifier === 'LMC', Object.entries(segBB).map(([k, b]) => `${k} ${Math.round(b.width)}x${Math.round(b.height)}`).join(', ') + ` → ${lm.modifier}`);
    check('LMC ⌀10.05: allowed 0.4, chip shows Ⓛ, LMC VC ⌀10.45 + resultant ⌀9.55, tilt-out IN', lm.allowed === 0.4 && lm.verdict === 'IN' && lm.chipL && lm.vc === 'LMC virtual condition ⌀10.45' && lm.rc === 'LMC resultant condition ⌀9.55' && lm.rcVis === 'visible', JSON.stringify(lm));
    await page.screenshot({ path: `${OUT}/${slug(name)}-lmc-10.05-${TAG}.png` });
    await page.evaluate(() => { window.gdt.setSize(10.1); window.gdt.setModifier('RFS'); window.gdt.applyPreset('centered'); window.scrollTo(0, 0); document.getElementById('panel').scrollTop = 0; });
    await page.waitForTimeout(400);
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

  // ---- Lock in tolerance: shrink -> OUT + note, then drag the handle back IN ----
  {
    const lockBB = await (async () => { const b = page.locator('#lock-btn'); await b.scrollIntoViewIfNeeded(); await b.tap(); await page.waitForTimeout(100); const bb = await b.boundingBox(); const hits = await page.evaluate(() => { const r = (e) => e.getBoundingClientRect(); const a = r(document.getElementById('lock-btn')); return ['#n-stated', '#mod-rfs', '#mod-mmc', '#mod-lmc', '#r-size', '#n-size'].filter((q) => { const b = r(document.querySelector(q)); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; }); }); check('lock toggle reachable, >= 40px, overlaps nothing', bb.height >= 40 && bb.width >= 40 && hits.length === 0, `${Math.round(bb.width)}x${Math.round(bb.height)} ${hits.join(',')}`); return bb; })();
    await page.evaluate(() => { window.gdt.setModifier('MMC'); window.gdt.setStated(0.25); window.gdt.setSize(10.2); window.gdt.applyPreset('centered'); window.gdt.dragAxis({ top: { dx: 0.4, dy: 0.05 } }); });
    await page.waitForTimeout(200);
    const L0 = await page.evaluate(() => ({ lock: window.gdt.state.lock, top: { ...window.gdt.state.top }, v: window.gdt.result().verdict }));
    const r0 = Math.hypot(L0.top.dx, L0.top.dy);
    check('lock: toggle on (>= 40px), a drag past the edge clamps to the zone (IN)', L0.lock && lockBB.height >= 40 && r0 <= 0.225 && r0 > 0.22 && L0.v === 'IN', `btn ${Math.round(lockBB.width)}x${Math.round(lockBB.height)} r=${r0.toFixed(4)} ${L0.v}`);
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('panel').scrollTop = 0; }); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${slug(name)}-lock-boundary-${TAG}.png` });
    await page.evaluate(() => window.gdt.setSize(10.0));
    await page.waitForTimeout(300);
    const L1 = await page.evaluate(() => ({ top: { ...window.gdt.state.top }, v: window.gdt.result().verdict, note: getComputedStyle(document.getElementById('shrink-note')).visibility, noteText: document.getElementById('shrink-note').innerText, badge: document.getElementById('status-badge').innerText.split('\n')[0] }));
    check('lock: size 10.2 -> 10.0 leaves the axis put, OUT (red) + "zone shrank: less bonus at this size"', L1.top.dx === L0.top.dx && L1.top.dy === L0.top.dy && L1.v === 'OUT' && L1.badge.includes('OUT') && L1.note === 'visible' && L1.noteText.includes('zone shrank: less bonus at this size'), JSON.stringify(L1));
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('panel').scrollTop = 0; }); await page.waitForTimeout(400);
    const pts = await page.evaluate(() => {
      const { top, bottom } = window.gdt._debug.handles, cam = window.gdt._debug.camera, r = window.gdt._debug.canvas.getBoundingClientRect();
      const P = (v) => { const p = v.clone().project(cam); return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }; };
      return { h: P(top.position), c: P(top.position.clone().setX(bottom.position.x).setY(bottom.position.y)) };
    });
    // Path: a tangential/sideways wiggle first (must not stick), then inward to the centre.
    const vx = pts.c.x - pts.h.x, vy = pts.c.y - pts.h.y;
    const path = [[pts.h.x - vy * 0.3, pts.h.y + vx * 0.3], [pts.h.x + vy * 0.3, pts.h.y - vx * 0.3], [pts.h.x + vx * 0.5 + vy * 0.2, pts.h.y + vy * 0.5 - vx * 0.2], [pts.c.x, pts.c.y]];
    const rs = [];
    await (async (h, path, each) => { await touch('touchStart', [[h.x, h.y]]); let cur = h; for (const [x, y] of path) { for (let i = 1; i <= 6; i++) { await touch('touchMove', [[cur.x + ((x - cur.x) * i) / 6, cur.y + ((y - cur.y) * i) / 6]]); await page.waitForTimeout(16); await each(); } cur = { x, y }; } await touch('touchEnd', []); })(pts.h, path, async () => rs.push(await page.evaluate(() => Math.hypot(window.gdt.state.top.dx, window.gdt.state.top.dy))));
    await page.waitForTimeout(250);
    const L2 = await page.evaluate(() => ({ top: { ...window.gdt.state.top }, v: window.gdt.result().verdict, note: getComputedStyle(document.getElementById('shrink-note')).visibility }));
    const r2 = Math.hypot(L2.top.dx, L2.top.dy);
    const mono = rs.every((x, i) => i === 0 || x <= rs[i - 1] + 1e-9);
    check('lock: dragging the OUT handle back (sideways wiggle, then inward) never sticks and ends IN', L2.v === 'IN' && r2 < 0.125 && mono && L2.note === 'hidden' && rs.length > 3, `r ${rs.map((x) => x.toFixed(3)).join('→')} → ${r2.toFixed(3)} ${L2.v}`);
    await page.screenshot({ path: `${OUT}/${slug(name)}-lock-in-${TAG}.png` });
    await page.evaluate(() => { window.gdt.setLock(false); window.gdt.setSize(10.1); window.gdt.setModifier('RFS'); window.gdt.applyPreset('centered'); window.scrollTo(0, 0); document.getElementById('panel').scrollTop = 0; });
    await page.waitForTimeout(300);
  }

  // ---- Views, Lock tilt and the 2D-trap preset (touch) ----------------------
  {
    const tapSel = async (sel) => { const b = page.locator(sel); await b.scrollIntoViewIfNeeded(); const bb = await b.boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(120); return bb; };
    const home = () => page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('panel').scrollTop = 0; });
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify({ b: window.gdt.state.bottom, t: window.gdt.state.top, v: window.gdt.view(), verdict: window.gdt.result().verdict })));
    const overlapCheck = () => page.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const shown = (e) => e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && r(e).width > 0;
      const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const cv = r(window.gdt._debug.canvas);
      const items = [...document.querySelectorAll('.zone-label, .axis-name-label, .handle-label, .tp-label, #status-badge, #mag-badge, #hud-br, #view-row, #vc-rfs-note, .lock-badge')].filter(shown);
      const name = (e) => e.id || e.className.split(' ')[1] || e.innerText.split(' ')[0];
      const issues = [];
      for (const e of items) { const b = r(e); if (b.left < cv.left - 0.5 || b.right > cv.right + 0.5 || b.top < cv.top - 0.5 || b.bottom > cv.bottom + 0.5) issues.push(name(e) + ' off-view'); }
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const [a, b] = [items[i], items[j]]; if (a.id === 'status-badge' && b.id === 'mag-badge') continue; if (hit(r(a), r(b))) issues.push(`${name(a)}~${name(b)}`); }
      // handle spheres must not sit under the overlay controls (they must stay grabbable)
      const cam = window.gdt._debug.camera, hv = window.gdt._debug.handles;
      for (const k of ['top', 'bottom']) {
        const v = hv[k].position.clone().project(cam); const x = cv.left + (v.x + 1) / 2 * cv.width, y = cv.top + (1 - v.y) / 2 * cv.height;
        if (x < cv.left || x > cv.right || y < cv.top || y > cv.bottom) issues.push(k + ' handle off-view');
        for (const id of ['view-row', 'status-badge', 'hud-br', 'mag-badge']) { const b = document.getElementById(id); if (shown(b)) { const q = r(b); if (x > q.left - 6 && x < q.right + 6 && y > q.top - 6 && y < q.bottom + 6) issues.push(`${k} handle under #${id}`); } }
      }
      const fonts = [...document.querySelectorAll('.zone-label, .axis-name-label, .handle-label')].filter(shown).map((e) => parseFloat(getComputedStyle(e).fontSize));
      return { issues, minFont: Math.min(...fonts) };
    });
    await page.evaluate(() => { window.gdt.setLock(false); window.gdt.setTiltLock(false); window.gdt.setModifier('RFS'); window.gdt.setSize(10.1); window.gdt.applyPreset('centered'); });
    await home(); await page.waitForTimeout(300);
    const btns = await page.evaluate(() => [...document.querySelectorAll('#view-row button')].map((b) => { const q = b.getBoundingClientRect(); return { t: b.innerText, w: Math.round(q.width), h: Math.round(q.height) }; }));
    check('view row (Top Z / Front Y / Side X / 3D / Ortho + Position / VC) in the 3D view, every shown button >= 40px', btns.filter((b) => b.w > 0).length >= 6 && btns.filter((b) => b.w > 0).every((b) => b.w >= 40 && b.h >= 40), btns.map((b) => `${b.t} ${b.w}x${b.h}`).join(', '));
    const expect = {
      top: { k: 'top', dx: 40, dy: -30, ok: (a, b) => b.t.dx > a.t.dx + 0.02 && b.t.dy > a.t.dy + 0.02 && b.b.dx === a.b.dx, what: 'TOP moves +X/+Y' },
      front: { k: 'bottom', dx: 40, dy: -30, ok: (a, b) => b.b.dx > a.b.dx + 0.02 && b.b.dy === a.b.dy && b.t.dx === a.t.dx, what: 'BOTTOM moves in X only' },
      side: { k: 'top', dx: 40, dy: -30, ok: (a, b) => b.t.dy > a.t.dy + 0.02 && b.t.dx === a.t.dx && b.b.dy === a.b.dy, what: 'TOP moves in Y only' },
    };
    for (const v of ['top', 'front', 'side']) {
      await page.evaluate(() => window.gdt.applyPreset('diag-out'));
      await home();
      await tapSel(`#view-row [data-view="${v}"]`);
      await home(); await page.waitForTimeout(700);
      const s0 = await st();
      const ov = await overlapCheck();
      check(`view ${v} (tap): ortho snap; labels/handles in view, readable, nothing overlaps`, s0.v.view === v && s0.v.ortho && ov.issues.length === 0 && ov.minFont >= 10, `${JSON.stringify(s0.v)} ${ov.issues.join(', ')} font ${ov.minFont}`);
      if (v === 'top') await page.screenshot({ path: `${OUT}/${slug(name)}-view-top-diag-${TAG}.png` });
      if (v === 'front') await page.screenshot({ path: `${OUT}/${slug(name)}-view-front-${TAG}.png` });
      await page.evaluate(() => window.gdt.applyPreset('centered')); await page.waitForTimeout(250);
      const e = expect[v];
      const a = await st();
      const h = await handleXY(e.k);
      await drag1(h.x, h.y, e.dx, e.dy);
      const b = await st();
      check(`view ${v}: touch drag of ${e.k.toUpperCase()} — ${e.what}`, e.ok(a, b), `before ${JSON.stringify([a.b, a.t])} after ${JSON.stringify([b.b, b.t])}`);
    }
    await home();
    await tapSel('#view-row [data-view="3d"]'); await page.waitForTimeout(700);
    const s3 = await st();
    check('3D button returns to the default perspective view', s3.v.view === '3d' && !s3.v.ortho, JSON.stringify(s3.v));
    // Lock tilt (touch)
    await page.evaluate(() => window.gdt.applyPreset('tilt-in'));
    const a0 = await st();
    const tbb = await tapSel('#tilt-lock-btn');
    const hits = await page.evaluate(() => { const r = (e) => e.getBoundingClientRect(); const a = r(document.getElementById('tilt-lock-btn')); return ['#lock-btn', '#n-stated', '#mod-rfs', '#mod-mmc', '#mod-lmc'].filter((q) => { const b = r(document.querySelector(q)); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; }); });
    const a1 = await st();
    check('Lock tilt toggle (tap) >= 40px, no overlap; turning it ON leaves both endpoints unchanged', tbb.height >= 40 && tbb.width >= 40 && hits.length === 0 && (await page.evaluate(() => window.gdt.state.tiltLock)) && JSON.stringify([a0.b, a0.t]) === JSON.stringify([a1.b, a1.t]), `${Math.round(tbb.width)}x${Math.round(tbb.height)} ${hits.join(',')}`);
    await home(); await page.waitForTimeout(300);
    const dif = (s) => [Math.round((s.t.dx - s.b.dx) * 1e6), Math.round((s.t.dy - s.b.dy) * 1e6)];
    const ht = await handleXY('top');
    await drag1(ht.x, ht.y, 30, 10);
    const a2 = await st();
    check('Lock tilt: touch drag of TOP translates both ends; top − bottom constant', JSON.stringify(dif(a2)) === JSON.stringify(dif(a0)) && a2.b.dx !== a0.b.dx, `${JSON.stringify(dif(a0))} → ${JSON.stringify(dif(a2))} ${JSON.stringify([a2.b, a2.t])}`);
    await page.screenshot({ path: `${OUT}/${slug(name)}-tilt-lock-${TAG}.png` });
    // Lock badges (display-only) in the 3D view
    const badges = () => page.evaluate(() => ['badge-tilt', 'badge-tol'].map((id) => { const e = document.getElementById(id); const q = e.getBoundingClientRect(); return { shown: !e.hidden && q.width > 0, font: parseFloat(getComputedStyle(e).fontSize), w: Math.round(q.width), h: Math.round(q.height) }; }));
    let bg = await badges();
    check('lock badge "Tilt locked" shown with only tilt lock on', bg[0].shown && !bg[1].shown, JSON.stringify(bg));
    await tapSel('#lock-btn');
    await home(); await page.waitForTimeout(400);
    bg = await badges();
    let ovb = await overlapCheck();
    check('both locks on: "Tilt locked" + "Tolerance locked" readable (>= 10px), nothing overlaps (3D)', bg.every((x) => x.shown && x.font >= 10) && ovb.issues.length === 0, `${JSON.stringify(bg)} ${ovb.issues.join(', ')}`);
    await page.screenshot({ path: `${OUT}/${slug(name)}-both-locks-${TAG}.png` });
    for (const v of ['top', 'front', 'side']) {
      await tapSel(`#view-row [data-view="${v}"]`); await home(); await page.waitForTimeout(700);
      ovb = await overlapCheck();
      check(`both locks on, ${v} view: badges + labels + handles + controls, nothing overlaps`, ovb.issues.length === 0, ovb.issues.join(', '));
    }
    await tapSel('#view-row [data-view="3d"]'); await home(); await page.waitForTimeout(700);
    await tapSel('#tilt-lock-btn');
    bg = await badges();
    check('tilt lock off -> only "Tolerance locked"', !bg[0].shown && bg[1].shown, JSON.stringify(bg));
    await tapSel('#lock-btn');
    bg = await badges();
    check('both locks off -> no lock badges', bg.every((x) => !x.shown), JSON.stringify(bg));
    // ---- Datum references (A/B/C toggles; zone slides when B / C are dropped) ----
    {
      const sl = slug(name);
      const D = () => page.evaluate(() => { const g = window.gdt, r = g.result(); const e = (id) => document.getElementById(id); return {
        verdict: r.verdict, zone: r.zone, dev: r.deviation, chip: e('fcf-chip').innerText.replace(/\s+/g, ' ').trim(), chipDatums: e('fcf-chip').querySelector('table').dataset.datums,
        panelFcf: e('spec-fcf').innerText.replace(/\s+/g, ' ').trim(), badge: e('badge-datum').hidden ? '' : e('badge-datum').innerText, note: getComputedStyle(e('datum-note')).visibility === 'visible' ? e('datum-note').innerText : '',
        slide: getComputedStyle(e('slide-line')).visibility === 'visible' ? e('slide-line').innerText : '', status: e('pos-status').innerText, overall: e('overall').className, pressed: ['A', 'B', 'C'].map((d) => e('datum-' + d).getAttribute('aria-pressed')).join(''),
        next: Math.round(document.querySelector('#datums + section').getBoundingClientRect().top + scrollY + document.getElementById('panel').scrollTop), }; });
      await page.evaluate(() => { window.gdt.setLock(false); window.gdt.setTiltLock(false); window.gdt.setModifier('RFS'); window.gdt.setSize(10.1); window.gdt.setDatums({ A: true, B: true, C: true }); window.gdt.setAxis({ bottom: { dx: 0, dy: 0.3 }, top: { dx: 0, dy: 0.3 } }); });
      await home(); await page.waitForTimeout(300);
      const btns = await page.evaluate(() => ['A', 'B', 'C'].map((d) => { const q = document.getElementById('datum-' + d).getBoundingClientRect(); return { d, w: Math.round(q.width), h: Math.round(q.height), l: q.left, r: q.right, t: q.top, b: q.bottom }; }));
      const ov = btns.some((a, i) => btns.some((b, j) => i < j && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b));
      const d0 = await D();
      check('datum toggles A/B/C: all on by default, each >= 40px, no overlap, FCF shows A B C', btns.every((b) => b.w >= 40 && b.h >= 40) && !ov && d0.pressed === 'truetruetrue' && d0.chipDatums === 'ABC' && /A\s*B\s*C/.test(d0.chip) && d0.verdict === 'OUT' && d0.badge === '', `${btns.map((b) => `${b.d} ${b.w}x${b.h}`).join(', ')} chip "${d0.chip}" ${d0.verdict}`);
      await tapSel('#datum-C');
      const d1 = await D();
      check('tap C: zone slides in Y (axis 0.3 off in Y now IN), FCF chip + panel FCF drop C, badge + slide line shown', d1.pressed === 'truetruefalse' && d1.verdict === 'IN' && Math.abs(d1.zone.dy - 0.3) < 1e-9 && d1.zone.dx === 0 && d1.chipDatums === 'AB' && !/C/.test(d1.chip.replace(/[^A-Z]/g, '').slice(0)) && !/\bC\b/.test(d1.panelFcf) && /C dropped.*slides in Y/.test(d1.badge) && /slides in Y/.test(d1.slide), JSON.stringify({ ...d1, next: undefined }));
      await home(); await page.waitForTimeout(400);
      const ov1 = await overlapCheck();
      check('C dropped (3D): datum badge + labels + handles + controls readable, nothing overlaps', ov1.issues.length === 0 && ov1.minFont >= 10, `${ov1.issues.join(', ')} font ${ov1.minFont}`);
      await page.screenshot({ path: `${OUT}/${sl}-datum-c-dropped-${TAG}.png` });
      await page.evaluate(() => document.getElementById('datums').scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${sl}-datum-c-dropped-panel-${TAG}.png` });
      // freed Y: touch-drag TOP along Y in the top view with the tolerance lock ON: no wall in Y, still IN
      await page.evaluate(() => { window.gdt.setAxis({ bottom: { dx: 0, dy: 0 }, top: { dx: 0, dy: 0 } }); window.gdt.setLock(true); });
      await home(); await page.waitForTimeout(400);
      { const h = await handleXY('mid'); await drag1(h.x, h.y, 0, -50, 12); }
      const d2 = await D(); const s2 = await st();
      check('C dropped + Lock in tolerance: touch drag of the slide handle along Y is not walled (zone slides), both ends move together, stay IN', Math.abs(s2.t.dy) > 0.2 && Math.abs(s2.t.dy - s2.b.dy) < 1e-9 && Math.abs(s2.t.dx) <= 0.125 && d2.verdict === 'IN', `top ${JSON.stringify(s2.t)} bottom ${JSON.stringify(s2.b)} ${d2.verdict}`);
      await page.evaluate(() => window.gdt.setLock(false));
      // B and C dropped: A only, slides in X and Y, perpendicular (spread = ⌀)
      await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0.12, dy: -0.06 }, top: { dx: 0.12, dy: -0.06 } }));
      await tapSel('#datum-B');
      const d3 = await D();
      check('tap B too (A only): slides in X and Y, shown FCF is A only, perpendicularity note, still IN', d3.pressed === 'truefalsefalse' && d3.verdict === 'IN' && d3.chipDatums === 'A' && /perpendicularity/.test(d3.note) && /slides in X and Y/.test(d3.slide), JSON.stringify({ ...d3, next: undefined }));
      await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0.12 - 0.13, dy: -0.06 }, top: { dx: 0.12 + 0.13, dy: -0.06 } })); await page.waitForTimeout(150);
      const d3b = await D();
      check('A only: a tilt whose endpoint spread (0.26) exceeds ⌀0.25 is OUT (perpendicularity)', d3b.verdict === 'OUT' && d3b.dev > 0.25, `${d3b.verdict} ⌀${d3b.dev}`);
      await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0.12 - 0.1, dy: -0.06 }, top: { dx: 0.12 + 0.1, dy: -0.06 } })); await home(); await page.waitForTimeout(400);
      const ov3 = await overlapCheck();
      check('B and C dropped (3D): badge + labels + handles + controls, nothing overlaps', ov3.issues.length === 0 && ov3.minFont >= 10, ov3.issues.join(', '));
      await page.screenshot({ path: `${OUT}/${sl}-datum-bc-dropped-${TAG}.png` });
      await page.evaluate(() => document.getElementById('datums').scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${sl}-datum-bc-dropped-panel-${TAG}.png` });
      await home();
      for (const v of ['top', 'front', 'side']) {
        await tapSel(`#view-row [data-view="${v}"]`); await home(); await page.waitForTimeout(700);
        const ovv = await overlapCheck();
        check(`B and C dropped, ${v} view: freedom slab + badge + labels + handles + controls, nothing overlaps`, ovv.issues.length === 0, ovv.issues.join(', '));
        if (v === 'top') await page.screenshot({ path: `${OUT}/${sl}-datum-bc-dropped-top-${TAG}.png` });
      }
      await tapSel('#view-row [data-view="3d"]'); await home(); await page.waitForTimeout(500);
      // A alone: nothing visible changes, note says so
      await page.evaluate(() => { window.gdt.setDatums({ A: true, B: true, C: true }); window.gdt.applyPreset('diag-out'); });
      const dAll = await D();
      await tapSel('#datum-A');
      const dA = await D();
      check('drop A alone: verdict, zone and numbers unchanged; on-screen note says it changes nothing visible; FCF shows B C', dA.pressed === 'falsetruetrue' && dA.verdict === dAll.verdict && dA.dev === dAll.dev && dA.zone.dx === 0 && dA.zone.dy === 0 && /Dropping A alone changes nothing visible/.test(dA.note) && dA.chipDatums === 'BC' && dA.slide === '', JSON.stringify({ ...dA, next: undefined }));
      await page.evaluate(() => document.getElementById('datums').scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${sl}-datum-a-note-${TAG}.png` });
      await home();
      // all dropped: floats free, nothing to judge
      await tapSel('#datum-B'); await tapSel('#datum-C');
      const dN = await D();
      check('A, B, C all dropped: NO DATUMS (neutral, not IN/OUT), "floats free / means nothing" note, FCF has no datum cells', dN.verdict === 'NO_DATUMS' && dN.status === 'NO DATUMS' && /na/.test(dN.overall) && /means nothing/.test(dN.note) && dN.chipDatums === '' && /floats free/.test(dN.badge), JSON.stringify({ ...dN, next: undefined }));
      await home(); await page.waitForTimeout(300);
      const ovN = await overlapCheck();
      check('NO DATUMS (3D): nothing overlaps', ovN.issues.length === 0, ovN.issues.join(', '));
      await page.screenshot({ path: `${OUT}/${sl}-datum-none-${TAG}.png` });
      // ---- Sally's rulings: big slide auto-reframes; exaggeration cap; ×N label; Reset camera fallback ----
      {
        const isPh = await page.evaluate(() => window.matchMedia('(max-width: 700px), (max-height: 500px)').matches);
        await page.evaluate(() => { window.gdt.setDatums({ A: true, B: true, C: true }); window.gdt.setLock(false); window.gdt.setTiltLock(false); window.gdt.setMagnification(24); window.gdt.applyPreset('centered'); window.gdt.setView('3d', { ms: 0 }); });
        await page.evaluate(() => window.gdt._debug.controls.update()); await page.waitForTimeout(500);
        const inViewAll = () => page.evaluate(() => {
          const cam = window.gdt._debug.camera, cv = window.gdt._debug.canvas.getBoundingClientRect(), hv = window.gdt._debug.handles;
          const rr = (id) => { const e = document.getElementById(id); return e && e.offsetWidth ? e.getBoundingClientRect() : null; };
          const bad = [];
          for (const k of ['top', 'bottom', 'mid']) {
            const v = hv[k].position.clone().project(cam), x = cv.left + (v.x + 1) / 2 * cv.width, y = cv.top + (1 - v.y) / 2 * cv.height;
            if (x < cv.left + 6 || x > cv.right - 6 || y < cv.top + 6 || y > cv.bottom - 6) bad.push(k + ' off-view');
            for (const id of ['status-badge', 'view-bar', 'mag-badge', 'hud-br']) { const b = rr(id); if (b && x > b.left && x < b.right && y > b.top && y < b.bottom) bad.push(`${k} under #${id}`); }
          }
          return { bad, cam: cam.position.toArray().map((v) => +v.toFixed(1)) };
        });
        const cam0 = (await inViewAll()).cam;
        await page.evaluate(() => { window.gdt.setDatum('C', false); window.gdt.setAxis({ bottom: { dx: 0, dy: 1.0 }, top: { dx: 0, dy: 1.0 } }); });
        await page.waitForTimeout(1800);
        let iv = await inViewAll();
        const ovR = await overlapCheck();
        check('big slide (C dropped, axis 1.0 mm off in Y at ×24): view auto-reframes, handles stay in view and clear of the badges', iv.bad.length === 0 && (!isPh || JSON.stringify(iv.cam) !== JSON.stringify(cam0)), `${iv.bad.join(', ')} cam ${cam0} -> ${iv.cam}`);
        check('after the auto-reframe: labels + badges + handles + controls readable, nothing overlaps', ovR.issues.length === 0 && ovR.minFont >= 10, ovR.issues.join(', '));
        await page.screenshot({ path: `${OUT}/${sl}-datum-bigslide-reframed-${TAG}.png` });
        for (const v of ['top', 'front', 'side']) {
          await tapSel(`#view-row [data-view="${v}"]`); await home(); await page.waitForTimeout(1800);
          const ivv = await inViewAll();
          check(`big slide, ${v} view: reframed, handles in view`, ivv.bad.length === 0 || (v !== 'top' && ivv.bad.every((b) => !/off-view/.test(b))), ivv.bad.join(', '));
        }
        await tapSel('#view-row [data-view="3d"]'); await home(); await page.waitForTimeout(1500);
        // Reset camera stays a manual fallback: returns to the framed default and does not fight back
        await page.evaluate(() => document.getElementById('reset-cam').scrollIntoView({ block: 'center' })); await tapSel('#reset-cam'); await page.waitForTimeout(1200);
        const camR = (await inViewAll()).cam;
        const wantR = [-22, -88, 92]; // Reset camera = the overview (as before)
        check('Reset camera stays the manual fallback: returns to the overview camera and stays there (no auto-reframe fight)', Math.hypot(...camR.map((v, i) => v - wantR[i])) < 0.6, `cam ${camR} want ${wantR}`);
        await home();
        await page.evaluate(() => { window.gdt.applyPreset('centered'); window.gdt.setDatums({ A: true, B: true, C: true }); window.gdt.setView('3d', { ms: 0 }); }); await page.waitForTimeout(600);
        // exaggeration cap on phones; ×N label whenever above ×1
        const caps = await page.evaluate(() => { window.gdt.setMagnification(80); return { m: window.gdt.state.magnification, max: Number(document.getElementById('mag').max), api: window.gdt.magnificationMax() }; });
        check(`exaggeration ${isPh ? 'capped at ×40 on phones' : 'keeps the full ×80 range off phones'} (state, slider max, API)`, caps.m === (isPh ? 40 : 80) && caps.max === caps.m && caps.api === caps.m, JSON.stringify(caps));
        for (const M of [2, 24, caps.m]) {
          await page.evaluate((M) => { window.gdt.setMagnification(M); window.gdt.setView('3d', { ms: 0 }); }, M); await home(); await page.waitForTimeout(500);
          const mb = await page.evaluate(() => { const e = document.getElementById('mag-badge'); const q = e.getBoundingClientRect(), cv = window.gdt._debug.canvas.getBoundingClientRect(); return { text: e.innerText, vis: getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && q.width > 0, inside: q.left >= cv.left - 0.5 && q.right <= cv.right + 0.5 && q.top >= cv.top - 0.5 && q.bottom <= cv.bottom + 0.5, font: parseFloat(getComputedStyle(e).fontSize) }; });
          const ovm = await overlapCheck();
          check(`×${M}: "×${M}" label visible, inside the 3D view, readable, nothing overlaps`, mb.vis && mb.inside && mb.text.includes(`×${M}`) && mb.font >= 10 && ovm.issues.length === 0, `${JSON.stringify(mb)} ${ovm.issues.join(', ')}`);
        }
        await page.evaluate(() => { window.gdt.setMagnification(24); });
        // Read-only analysis states: A dropped with only B kept / only C kept (current behaviour: zone stays vertical)
        for (const [tag, keep, ax] of [['b-only', 'B', { bottom: { dx: 0.05, dy: -0.2 }, top: { dx: 0.05, dy: 0.2 } }], ['c-only', 'C', { bottom: { dx: -0.2, dy: 0.05 }, top: { dx: 0.2, dy: 0.05 } }]]) {
          await page.evaluate(([keep, ax]) => { window.gdt.setDatums({ A: false, B: keep === 'B', C: keep === 'C' }); window.gdt.setAxis(ax); window.gdt.setView('3d', { ms: 0 }); }, [keep, ax]);
          await home(); await page.waitForTimeout(1500);
          const r = await D();
          const ovA = await overlapCheck();
          check(`A dropped, only ${keep} kept: zone slides in ${keep === 'B' ? 'Y' : 'X'} only, stays vertical, verdict from the held axis + spread (analysis state)`, r.chipDatums === keep && r.verdict === 'OUT' && ovA.issues.length === 0, JSON.stringify({ v: r.verdict, zone: r.zone, dev: r.dev, slide: r.slide, issues: ovA.issues }));
          await page.screenshot({ path: `${OUT}/${sl}-datum-${tag}-${TAG}.png` });
          await page.evaluate(() => document.getElementById('datums').scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
          await page.screenshot({ path: `${OUT}/${sl}-datum-${tag}-panel-${TAG}.png` });
          await home();
        }
        await page.evaluate(() => { window.gdt.setDatums({ A: true, B: true, C: true }); window.gdt.applyPreset('centered'); window.gdt.setView('3d', { ms: 0 }); }); await home(); await page.waitForTimeout(500);
      }
      // ---- Position / Virtual condition toggle (Sally) ----
      {
        await page.evaluate(() => { window.gdt.setView('3d', { ms: 0 }); }); await home(); await page.waitForTimeout(300);
        const CK = (l, ok, d) => check(l, ok, typeof d === 'string' ? d : JSON.stringify(d)), TAP = tapSel;
        const SHOT = async (n) => { await home(); await page.waitForTimeout(700); const ov = await overlapCheck(); check(`${n}: labels, badges, VC toggle, handles: nothing overlaps, all in view`, ov.issues.length === 0 && ov.minFont >= 10, ov.issues.join(', ')); await page.screenshot({ path: `${OUT}/${sl}-${n}-${TAG}.png` }); };
        const mb = await page.evaluate(() => { const q = (s) => document.querySelector(s).getBoundingClientRect(); const bs = [...document.querySelectorAll('#view-row button')].filter((b) => b.offsetWidth).map((b) => b.getBoundingClientRect()); const c = window.gdt._debug.canvas.getBoundingClientRect(); const v = q('#view-row'); return { n: bs.length, minH: Math.min(...bs.map((b) => b.height)), minW: Math.min(...bs.map((b) => b.width)), inside: v.left >= c.left && v.right <= c.right + 0.5 && v.top >= c.top, clearOfRow: true }; });
        check('Position / Virtual condition toggle in the view row (phones: one VC toggle): every button >= 40px, row inside the 3D view', mb.minH >= 40 && mb.minW >= 40 && mb.inside, JSON.stringify(mb));
        const VC = () => page.evaluate(() => { const r = window.gdt.result(), e = (id) => document.getElementById(id); const btn = document.querySelector('#view-row [data-mode="vc"]'); const lab = document.querySelector('.vc-label'); const zl = [...document.querySelectorAll('.zone-label')].find((x) => !x.classList.contains('vc-label'));
          return { verdict: r.verdict, shown: r.vcShown, applies: r.vc.applies, inside: r.vc.inside, lockR: r.vc.lockRadius, kind: r.vc.kind, vc: r.vc.vc, cmin: r.vc.clearance?.min, clear: e('vc-clear').innerText, clearCls: e('vc-clear').className, disabled: btn.disabled, pressed: btn.getAttribute('aria-pressed'), note: e('vc-rfs-note').hidden ? '' : e('vc-rfs-note').innerText, label: lab ? lab.textContent.replace(/\s+/g, ' ') : '', zoneLabel: !!zl, mag: e('mag-badge').innerText, tb: r.top.r, bb: r.bottom.r, zone: r.zone }; });
        const vcReset = () => page.evaluate(() => { const g = window.gdt; g.setLock(false); g.setTiltLock(false); g.setDatums({ A: true, B: true, C: true }); g.setStated(0.25); g.setModifier('RFS'); g.setSize(10.1); g.setVcView(false); g.applyPreset('centered'); });
        await vcReset(); await page.waitForTimeout(200);
        let v = await VC();
        CK('VC toggle at RFS: "Virtual condition" disabled, note "Virtual condition applies at MMC or LMC.", Position view stays', v.disabled && v.note === 'Virtual condition applies at MMC or LMC.' && v.clear === v.note && !v.shown && v.zoneLabel && v.pressed === 'false', v);
        await page.locator('#view-row [data-mode="vc"]').click({ force: true }).catch(() => {}); await page.waitForTimeout(150); v = await VC();
        CK('tapping the disabled VC button at RFS does nothing', !v.shown && v.zoneLabel, v);
        await page.evaluate(() => window.gdt.setModifier('MMC')); await page.waitForTimeout(100);
        await TAP('#view-row [data-mode="vc"]'); await page.waitForTimeout(400); v = await VC();
        CK('MMC: Virtual condition on: red VC pin ⌀9.75 drawn (label), zone label gone, note hidden, badge says VC true size', v.shown && v.pressed === 'true' && v.kind === 'pin' && v.vc === 9.75 && /VC pin ⌀9\.75 \(MMC\)/.test(v.label) && !v.zoneLabel && v.note === '' && /VC true size/.test(v.mag), v);
        const sizes = [];
        for (const s of [10, 10.1, 10.2]) { await page.evaluate((s) => window.gdt.setSize(s), s); await page.waitForFunction(() => /⌀9\.75/.test(document.querySelector('.vc-label')?.textContent ?? ''), null, { timeout: 3000 }).catch(() => {}); const x = await VC(); sizes.push([s, x.vc, x.label.match(/⌀[\d.]+/)?.[0]]); }
        CK('MMC: VC size follows stated + modifier only (⌀9.75 at every hole size)', sizes.every((x) => x[1] === 9.75 && x[2] === '⌀9.75'), sizes);
        await page.evaluate(() => window.gdt.setStated(0.4)); await page.waitForFunction(() => /⌀9\.6/.test(document.querySelector('.vc-label')?.textContent ?? ''), null, { timeout: 3000 }).catch(() => {}); v = await VC();
        CK('MMC: stated ⌀0.4 -> VC ⌀9.6', v.vc === 9.6 && /⌀9\.6/.test(v.label), v.label);
        await page.evaluate(() => { window.gdt.setStated(0.25); window.gdt.setSize(10.1); }); await page.waitForTimeout(80);
        // equivalence sweep: VC view vs bonus-zone view, both modifiers, sizes, offsets (incl. exact boundary)
        const bad = await page.evaluate(() => { const g = window.gdt, out = []; let n = 0;
          for (const m of ['MMC', 'LMC']) { g.setModifier(m); for (const s of [10, 10.05, 10.1, 10.2, 9.99, 10.21]) { g.setSize(s);
            for (const dx of [0, 0.05, 0.1, 0.125, 0.15, 0.175, 0.2, 0.225, 0.25, 0.3]) for (const dy of [0, 0.05, -0.1]) {
              g.setVcView(false); g.setAxis({ bottom: { dx, dy }, top: { dx: -dx / 2, dy } }); const a = g.result().verdict;
              g.setVcView(true); const r = g.result(); n++;
              const clsOk = ['REJECT_SIZE', 'NO_DATUMS'].includes(r.verdict) ? !/pass|fail/.test(document.getElementById('vc-clear').className) : document.getElementById('vc-clear').classList.contains(r.verdict === 'IN' ? 'pass' : 'fail');
              if (a !== r.verdict || (r.verdict === 'IN') !== r.vc.inside && r.verdict !== 'REJECT_SIZE' || !clsOk) out.push([m, s, dx, dy, a, r.verdict, r.vc.inside]);
            } } }
          return { n, out: out.slice(0, 5), nbad: out.length }; });
        CK(`VC view and Position view never disagree on IN/OUT (${bad.n} cases, MMC + LMC, boundary incl.), clearance line colour agrees`, bad.nbad === 0, bad);
        await page.evaluate(() => { const g = window.gdt; g.setModifier('MMC'); g.setSize(10.1); g.setVcView(true); g.setAxis({ bottom: { dx: 0.1, dy: 0.05 }, top: { dx: 0, dy: 0 } }); }); await page.waitForTimeout(100); v = await VC();
        CK('clearance readout = leftover tolerance (⌀10.1 MMC, r 0.112: clearance 0.063 mm = leftover ⌀0.126; rounded down)', /clearance 0\.063 mm = leftover ⌀0\.126/.test(v.clear) && /pass/.test(v.clearCls), v.clear);
        // lock: the VC is impermeable; a drag stops at contact
        await page.evaluate(() => { const g = window.gdt; g.applyPreset('centered'); g.setLock(true); for (let i = 1; i <= 40; i++) g.dragAxis({ top: { dx: 0.01 * i, dy: 0.004 * i } }); }); await page.waitForTimeout(100); v = await VC();
        CK('MMC lock: dragging TOP outward stops at contact (r = (d − 9.75)/2 = 0.175), wall never crosses, IN, clearance 0', v.inside && v.verdict === 'IN' && Math.abs(v.tb - 0.175) < 0.0015 && /clearance 0 mm/.test(v.clear), v);
        if (SHOT) await SHOT('vc-mmc-locked');
        await page.evaluate(() => { const g = window.gdt; g.setModifier('LMC'); g.setSize(10.05); g.applyPreset('centered'); for (let i = 1; i <= 40; i++) g.dragAxis({ bottom: { dx: -0.01 * i, dy: 0 } }); }); await page.waitForTimeout(150); v = await VC();
        CK('LMC: VC boundary ⌀10.45 (hole stays inside); lock stops at (10.45 − d)/2 = 0.2; IN', v.kind === 'boundary' && v.vc === 10.45 && /VC boundary ⌀10\.45 \(LMC\)/.test(v.label) && Math.abs(v.bb - 0.2) < 0.0015 && v.inside && v.verdict === 'IN', v);
        if (SHOT) await SHOT('vc-lmc');
        // datums dropped: the VC slides with the zone's best fit
        await page.evaluate(() => { const g = window.gdt; g.setLock(false); g.setModifier('MMC'); g.setSize(10.1); g.setDatum('C', false); g.setAxis({ bottom: { dx: 0, dy: 0.3 }, top: { dx: 0, dy: 0.3 } }); }); await page.waitForTimeout(150); v = await VC();
        CK('C dropped: the VC slides with the zone best fit (centre dy +0.3), still IN, label shown', v.shown && Math.abs(v.zone.dy - 0.3) < 1e-9 && v.verdict === 'IN' && v.inside && v.label !== '', v);
        await page.evaluate(() => window.gdt.setModifier('RFS')); await page.waitForTimeout(150); v = await VC();
        CK('switching to RFS while in VC view: back to Position view, VC disabled, note shown', !v.shown && v.disabled && v.zoneLabel && v.note !== '', v);
        if (SHOT) await SHOT('vc-rfs-disabled');
        await vcReset(); await page.waitForTimeout(200);
      }
      // ---- Explain this setup (collapsed on phones, tap to expand; Sally's copy; advice never changes IN/OUT) ----
      {
        const isPh = await page.evaluate(() => window.matchMedia('(max-width: 700px), (max-height: 500px)').matches);
        await page.evaluate(() => { window.gdt.setLock(false); window.gdt.setTiltLock(false); window.gdt.setModifier('RFS'); window.gdt.setSize(10.1); window.gdt.setMagnification(24); window.gdt.setDatums({ A: true, B: true, C: true }); window.gdt.applyPreset('diag-out'); window.gdt.setView('3d', { ms: 0 }); });
        await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => window.gdt?.ready === true); await page.waitForTimeout(500);
        await page.evaluate(() => window.gdt.applyPreset('diag-out'));
        const X = () => page.evaluate(() => { const d = document.getElementById('explain'), b = document.getElementById('ex-body'), s = document.getElementById('ex-summary'); const r = (e) => e.getBoundingClientRect(); return { open: d.open, sumH: Math.round(r(s).height), sumW: Math.round(r(s).width), cfg: document.getElementById('ex-config').innerText, text: b.innerText.replace(/\s+/g, ' '), overflow: b.scrollWidth > b.clientWidth + 1, tags: [...b.querySelectorAll('.ex-tag')].map((t) => t.className.replace('ex-tag ', '') + ':' + t.innerText).join(','), cites: b.querySelectorAll('.ex-cite').length, rulesCited: b.querySelectorAll('.ex-line-rule .ex-cite').length, practiceCited: b.querySelectorAll('.ex-line-practice .ex-cite').length, verdict: window.gdt.result().verdict, bodyShown: r(d).height > r(s).height + 8, sumX: r(s).left >= 0 && r(s).right <= innerWidth + 0.5 }; });
        let x = await X();
        check(`explainer: ${isPh ? 'collapsed by default on phones' : 'open by default off phones'}; summary tap target >= 40px, inside the screen, shows the setup`, x.open === !isPh && x.sumH >= 40 && x.sumX && /A \| B \| C · RFS/.test(x.cfg) && (isPh ? !x.bodyShown : x.bodyShown), JSON.stringify({ open: x.open, sumH: x.sumH, cfg: x.cfg, shown: x.bodyShown }));
        await page.evaluate(() => document.getElementById('explain').scrollIntoView({ block: 'center' })); await page.waitForTimeout(250);
        await page.screenshot({ path: `${OUT}/${sl}-explain-collapsed-${TAG}.png` });
        const v0 = x.verdict;
        if (isPh) { await tapSel('#ex-summary'); await page.waitForTimeout(200); }
        x = await X();
        check('explainer: tap on the summary expands it (Controls / Free / Better way / Material condition), verdict untouched', x.open && x.bodyShown && /Controls X and Y location, axis square to A\./.test(x.text) && /Free Nothing\./.test(x.text) && /Better way/.test(x.text) && /Material condition: RFS/.test(x.text) && x.verdict === v0, x.text.slice(0, 220));
        const cases = [
          ['a-only', { A: true, B: false, C: false }, /A only/, [/Controls Axis direction only\./, /Free X and Y\./, /With no location datums, the basic dimensions locate nothing\./, /Use perpendicularity to A: it says what is controlled, while position implies a location that is not\./]],
          ['b-only', { A: false, B: true, C: false }, /B only/, [/Location across B, axis parallel to B\./, /Sliding along B and tilting about B's normal\./, /Simplified, this lesson keeps the zone vertical\./, /Add A first\./]],
          ['c-only', { A: false, B: false, C: true }, /C only/, [/Location across C, axis parallel to C\./, /Sliding along C and tilting about C's normal\./, /Simplified, this lesson keeps the zone vertical\./, /Add A first\./]],
          ['ab', { A: true, B: true, C: false }, /A \| B \(C dropped\)/, [/Axis square to A, X location\./, /Sliding in Y\./, /Add C unless Y is free on purpose\./]],
          ['ac', { A: true, B: false, C: true }, /A \| C \(B dropped\)/, [/Axis square to A, Y location\./, /Sliding in X\./, /Add B unless X is free on purpose\./]],
          ['bc', { A: false, B: true, C: true }, /B \| C \(A dropped\)/, [/axis held parallel to B and C \(vertical\)\./, /Z \(not visible on a through hole\)\./, /List A first: the hole is square to A and A gives a stable seat\./]],
          ['none', { A: false, B: false, C: false }, /No datums/, [/Position is undefined: nothing to measure the basic dimensions from\. Gray, no IN\/OUT\./, /Reference at least A, and B and C to locate\./]],
        ];
        const BASIC = 'Basic dimensions take no default tolerance. With this datum dropped, this frame no longer locates the hole in that direction; a separate toleranced dimension or another control is needed.';
        for (const [tag, d, cfgRe, lines] of cases) {
          await page.evaluate((d) => window.gdt.setDatums(d), d); await page.waitForTimeout(200);
          x = await X();
          const ok = cfgRe.test(x.cfg) && lines.every((re) => re.test(x.text)) && !x.overflow && x.open && x.bodyShown && x.practiceCited === 0 && x.tags.includes('ex-practice:') && x.text.includes(BASIC) === ['a-only', 'b-only', 'c-only', 'ab', 'ac'].includes(tag) && x.text.includes("The slide limit here is only the lesson's drag range. It is not a tolerance.") === ['a-only', 'b-only', 'c-only', 'ab', 'ac'].includes(tag);
          check(`explainer ${tag}: Sally's text verbatim, [Rule]/[Practice] tags, citations on rules only, no horizontal overflow`, ok, JSON.stringify({ cfg: x.cfg, tags: x.tags, overflow: x.overflow, text: x.text.slice(0, 200) }));
          if (['a-only', 'b-only', 'ac'].includes(tag)) {
            await page.evaluate(() => document.getElementById('explain').scrollIntoView({ block: 'center' })); await page.waitForTimeout(250);
            await page.screenshot({ path: `${OUT}/${sl}-explain-${tag}-open-${TAG}.png` });
          }
        }
        // MMC / LMC copy, same panel
        for (const [m, re] of [['MMC', /Bonus = size minus smallest hole\./], ['LMC', /Bonus = largest hole minus size\./], ['RFS', /Tolerance fixed at stated value\./]]) {
          await page.evaluate((m) => { window.gdt.setModifier(m); if (m !== 'RFS') window.gdt.setSize(10.1); }, m); await page.waitForTimeout(200);
          x = await X();
          check(`explainer ${m}: material-condition lines + zero-tolerance rule`, re.test(x.text) && /Zero tolerance only at MMC\/LMC\./.test(x.text) && x.cites >= 2, x.text.slice(-260));
        }
        await page.evaluate(() => { window.gdt.setModifier('RFS'); window.gdt.setDatums({ A: true, B: true, C: true }); });
        // panel stays put with the explainer open, across every datum state and every modifier
        const tops = [], docs = []; globalThis.__tm = {};
        for (const d of [{ A: 1, B: 1, C: 1 }, { A: 1, B: 1, C: 0 }, { A: 1, B: 0, C: 1 }, { A: 1, B: 0, C: 0 }, { A: 0, B: 1, C: 1 }, { A: 0, B: 1, C: 0 }, { A: 0, B: 0, C: 1 }, { A: 0, B: 0, C: 0 }]) for (const m of ['RFS', 'MMC', 'LMC']) {
          await page.evaluate(([d, m]) => { window.gdt.setDatums({ A: !!d.A, B: !!d.B, C: !!d.C }); window.gdt.setModifier(m); window.gdt.setSize(10.1); }, [d, m]);
          await page.waitForTimeout(40);
          const t = await page.evaluate(() => { const e = document.querySelector('#explain-wrap + section'); const w = document.getElementById('explain-wrap').getBoundingClientRect(); return [Math.round(e.getBoundingClientRect().top + scrollY + document.getElementById('panel').scrollTop), Math.round(w.height)]; });
          tops.push(t[0]); docs.push(t[1]); (globalThis.__tm ||= {})[m] = ((globalThis.__tm ||= {})[m] || new Set()).add(t[0]);
        }
        check('panel layout stable with the explainer open: all 8 datum states x RFS/MMC/LMC (section below never moves)', Object.values(globalThis.__tm).every((v) => v.size === 1) && new Set(docs).size === 1, `explainer box height ${[...new Set(docs)]}; section-below top per modifier ${JSON.stringify(Object.fromEntries(Object.entries(globalThis.__tm).map(([k, v]) => [k, [...v]])))} (RFS vs MMC/LMC differ 3px above the datum block already: teach-line)`);
        await page.evaluate(() => { window.gdt.setModifier('RFS'); window.gdt.setDatums({ A: true, B: true, C: true }); window.gdt.applyPreset('centered'); });
        await home(); await page.waitForTimeout(300);
      }
      // panel stays put: the section after the datum block does not move across every datum state
      const tops = [];
      for (const c of [{ A: 1, B: 1, C: 1 }, { A: 1, B: 1, C: 0 }, { A: 1, B: 0, C: 1 }, { A: 1, B: 0, C: 0 }, { A: 0, B: 1, C: 1 }, { A: 0, B: 0, C: 0 }]) {
        await page.evaluate((c) => window.gdt.setDatums({ A: !!c.A, B: !!c.B, C: !!c.C }), c);
        await page.waitForTimeout(80); tops.push((await D()).next);
      }
      check('panel layout stable across every datum state (section below the datum block does not move)', new Set(tops).size === 1, tops.join(','));
      // restore
      await page.evaluate(() => { window.gdt.setDatums({ A: true, B: true, C: true }); window.gdt.setLock(false); window.gdt.setTiltLock(false); window.gdt.applyPreset('centered'); });
      await home(); await page.waitForTimeout(300);
    }
    await page.evaluate(() => { window.gdt.setTiltLock(false); window.gdt.setLock(false); window.gdt.applyPreset('centered'); });
    await home(); await page.waitForTimeout(300);
  }

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
    // start on bare canvas (not on the HUD button/chip or a label)
    const [ox, oy] = await page.evaluate(({ x, y, w, h }) => {
      for (const [fx, fy] of [[0.82, 0.85], [0.6, 0.85], [0.85, 0.6], [0.3, 0.7], [0.5, 0.5]]) {
        const px = x + w * fx, py = y + h * fy;
        if (document.elementFromPoint(px, py) === window.gdt._debug.canvas) return [px, py];
      }
      return [x + w * 0.5, y + h * 0.5];
    }, { x: vr.x, y: vr.y, w: vr.w, h: vr.h });
    await drag1(ox, oy, -60, -20);
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
