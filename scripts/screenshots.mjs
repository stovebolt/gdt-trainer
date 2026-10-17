// Headless browser check: loads the viewer, fails on console errors, checks
// the readout for each preset, and writes screenshots to ./screenshots.
// Usage: npm run screenshots   (server must be running; URL env overrides)
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:8123/';
const executablePath = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.gdt?.ready === true, null, { timeout: 15000 });
await page.waitForTimeout(800);

const shots = [
  { file: 'in.png', setup: () => page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0.06, dy: 0.05 }, top: { dx: 0.06, dy: 0.05 } })), expect: true },
  { file: 'out.png', setup: () => page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0.11, dy: 0.08 }, top: { dx: 0.11, dy: 0.08 } })), expect: false },
  { file: 'tilt_in.png', setup: () => page.click('button[data-preset="tilt-in"]'), expect: true },
  { file: 'tilt_out.png', setup: () => page.click('button[data-preset="tilt-out"]'), expect: false },
];

let failed = false;
for (const s of shots) {
  await s.setup();
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const res = window.gdt.result();
    return { inTolerance: res.inTolerance, deviation: res.deviation, b: res.bottom, t: res.top, badge: document.getElementById('status-badge').innerText, pos: document.getElementById('pos-value').innerText };
  });
  const ok = r.inTolerance === s.expect;
  failed ||= !ok;
  await page.screenshot({ path: `screenshots/${s.file}` });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${s.file}: in=${r.inTolerance} position=${r.pos} bottom r=${r.b.r.toFixed(4)} top r=${r.t.r.toFixed(4)} badge="${r.badge.replace(/\n/g, ' | ')}"`);
}

// Display/verdict consistency (metric, ≤ 3 decimals, measured values round up), plus the size note.
for (const [dx, expectR, file] of [[0.1251, '0.126 > 0.125', 'boundary_0.1251.png'], [0.12503, '0.126 > 0.125', null], [0.125, '0.125 ≤ 0.125', null]]) {
  await page.evaluate((v) => window.gdt.setAxis({ bottom: { dx: v, dy: 0 }, top: { dx: v, dy: 0 } }), dx);
  await page.waitForTimeout(250);
  const ui = await page.evaluate(() => ({
    rowR: document.querySelector('#row-top .r').innerText,
    mark: document.querySelector('#row-top .mark').innerText,
    pos: document.getElementById('pos-value').innerText,
    badge: document.getElementById('status-badge').innerText,
    notes: [...document.querySelectorAll('.size-note')].filter((n) => n.offsetParent && n.innerText.includes('⌀10–10.2')).length,
    handle: [...document.querySelectorAll('.handle-label')].map((n) => n.innerText).join(' | '),
  }));
  const expectPass = dx <= 0.125;
  const ok = ui.rowR.startsWith(expectR) && ui.mark.includes(expectPass ? 'PASS' : 'FAIL') && ui.notes >= 2 && ui.badge.includes(expectPass ? 'IN' : 'OUT');
  failed ||= !ok;
  if (file) await page.screenshot({ path: `screenshots/${file}` });
  console.log(`${ok ? 'OK  ' : 'FAIL'} dx=${dx}: r "${ui.rowR}" ${ui.mark}, position ${ui.pos}, size notes visible=${ui.notes}, 3D labels "${ui.handle}"${file ? ` -> ${file}` : ''}`);
}

// Clarifying labels: zone (live ×N, "not a pin"), actual axis, inset zone text; no overlap with handle labels.
async function labelInfo() {
  return page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const zone = document.querySelector('.zone-label'), axis = document.querySelector('.axis-name-label');
    const handles = [...document.querySelectorAll('.handle-label')];
    const overlaps = [];
    for (const [n, el] of [['zone', zone], ['axis', axis]]) for (const h of handles) if (el && hit(r(el), r(h))) overlaps.push(`${n}~${h.innerText.split(' ')[0]}`);
    return { zone: zone?.innerText.replace(/\n/g, ' '), axis: axis?.innerText, inset: document.querySelector('#inset .t-zone')?.textContent, overlaps };
  });
}
await page.click('button[data-preset="tilt-in"]');
await page.waitForTimeout(300);
let li = await labelInfo();
let lok = li.zone === 'position zone ⌀0.25 (shown ×24, not a pin)' && li.axis === "hole's actual axis" && li.inset === '⌀0.25 position zone' && li.overlaps.length === 0;
await page.screenshot({ path: 'screenshots/labels.png' });
console.log(`${lok ? 'OK  ' : 'FAIL'} labels: zone "${li.zone}" · axis "${li.axis}" · inset "${li.inset}" · overlaps [${li.overlaps}] -> labels.png`);
failed ||= !lok;
for (const [m, want] of [[40, 'shown ×40, not a pin'], [1, 'shown ×1, true size, not a pin'], [24, 'shown ×24, not a pin']]) {
  await page.locator('#mag').fill(String(m)); // drives the real slider input event
  await page.waitForTimeout(150);
  li = await labelInfo();
  lok = li.zone.includes(want);
  failed ||= !lok;
  console.log(`${lok ? 'OK  ' : 'FAIL'} exaggeration slider ×${m} -> zone label "${li.zone}"`);
}

// Close-up of the tilted-out state
await page.click('button[data-preset="tilt-out"]');
await page.click('#zoom-hole');
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/tilt_out_closeup.png' });
console.log('OK   tilt_out_closeup.png (Zoom to hole)');
await page.click('#reset-cam');

// Pointer-drag smoke test: grab the TOP handle in the 3D view and move it.
await page.click('button[data-preset="centered"]');
await page.waitForTimeout(200);
const handle = await page.evaluate(() => {
  const { top } = window.gdt._debug.handles;
  const cam = window.gdt._debug.camera;
  const v = top.getWorldPosition(top.position.clone()).project(cam);
  const r = window.gdt._debug.canvas.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
});
await page.mouse.move(handle.x, handle.y);
await page.mouse.down();
await page.mouse.move(handle.x + 40, handle.y, { steps: 5 });
await page.mouse.up();
const afterDrag = await page.evaluate(() => ({ ...window.gdt.state.top, bottom: { ...window.gdt.state.bottom } }));
const dragOk = Math.abs(afterDrag.dx) > 0.005 && afterDrag.bottom.dx === 0;
failed ||= !dragOk;
console.log(`${dragOk ? 'OK  ' : 'FAIL'} 3D drag of TOP handle -> top dx=${afterDrag.dx}, dy=${afterDrag.dy}; bottom unchanged=${afterDrag.bottom.dx === 0 && afterDrag.bottom.dy === 0}`);

// Inset drag: move the B (bottom) dot in the top-view inset.
await page.click('button[data-preset="tilt-in"]');
await page.locator('#inset').scrollIntoViewIfNeeded();
const box = await page.locator('#i-bottom').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 4 });
await page.mouse.up();
const inset = await page.evaluate(() => ({ b: { ...window.gdt.state.bottom }, t: { ...window.gdt.state.top } }));
const insetOk = inset.b.dx > -0.09 && Math.abs(inset.b.dy) < 2e-3 && inset.t.dx === 0.1;
failed ||= !insetOk;
console.log(`${insetOk ? 'OK  ' : 'FAIL'} inset drag of B -> bottom dx=${inset.b.dx}, dy=${inset.b.dy}; top unchanged=${inset.t.dx === 0.1}`);

  // ---- Lock in tolerance: shrink -> OUT + note, then drag the handle back IN ----
  {
    const ckL = (l, ok, x) => { failed ||= !ok; console.log(`${ok ? 'OK  ' : 'FAIL'} ${l} — ${x}`); };
    const lockBB = await (async () => { await page.locator('#lock-btn').scrollIntoViewIfNeeded(); await page.click('#lock-btn'); return page.locator('#lock-btn').boundingBox(); })();
    await page.evaluate(() => { window.gdt.setModifier('MMC'); window.gdt.setStated(0.25); window.gdt.setSize(10.2); window.gdt.applyPreset('centered'); window.gdt.dragAxis({ top: { dx: 0.4, dy: 0.05 } }); });
    await page.waitForTimeout(200);
    const L0 = await page.evaluate(() => ({ lock: window.gdt.state.lock, top: { ...window.gdt.state.top }, v: window.gdt.result().verdict }));
    const r0 = Math.hypot(L0.top.dx, L0.top.dy);
    ckL('lock: toggle on, a drag past the edge clamps to the zone (IN)', L0.lock && r0 <= 0.225 && r0 > 0.22 && L0.v === 'IN', `btn ${Math.round(lockBB.width)}x${Math.round(lockBB.height)} r=${r0.toFixed(4)} ${L0.v}`);
    await page.evaluate(() => window.gdt.setSize(10.0));
    await page.waitForTimeout(300);
    const L1 = await page.evaluate(() => ({ top: { ...window.gdt.state.top }, v: window.gdt.result().verdict, note: getComputedStyle(document.getElementById('shrink-note')).visibility, noteText: document.getElementById('shrink-note').innerText, badge: document.getElementById('status-badge').innerText.split('\n')[0] }));
    ckL('lock: size 10.2 -> 10.0 leaves the axis put, OUT (red) + "zone shrank: less bonus at this size"', L1.top.dx === L0.top.dx && L1.top.dy === L0.top.dy && L1.v === 'OUT' && L1.badge.includes('OUT') && L1.note === 'visible' && L1.noteText.includes('zone shrank: less bonus at this size'), JSON.stringify(L1));
    await page.screenshot({ path: 'screenshots/lock_shrunk_out.png' });
    const pts = await page.evaluate(() => {
      const { top, bottom } = window.gdt._debug.handles, cam = window.gdt._debug.camera, r = window.gdt._debug.canvas.getBoundingClientRect();
      const P = (v) => { const p = v.clone().project(cam); return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }; };
      return { h: P(top.position), c: P(top.position.clone().setX(bottom.position.x).setY(bottom.position.y)) };
    });
    // Path: a tangential/sideways wiggle first (must not stick), then inward to the centre.
    const vx = pts.c.x - pts.h.x, vy = pts.c.y - pts.h.y;
    const path = [[pts.h.x - vy * 0.3, pts.h.y + vx * 0.3], [pts.h.x + vy * 0.3, pts.h.y - vx * 0.3], [pts.h.x + vx * 0.5 + vy * 0.2, pts.h.y + vy * 0.5 - vx * 0.2], [pts.c.x, pts.c.y]];
    const rs = [];
    await (async (h, path, each) => { await page.mouse.move(h.x, h.y); await page.mouse.down(); let cur = h; for (const [x, y] of path) { for (let i = 1; i <= 6; i++) { await page.mouse.move(cur.x + ((x - cur.x) * i) / 6, cur.y + ((y - cur.y) * i) / 6); await each(); } cur = { x, y }; } await page.mouse.up(); })(pts.h, path, async () => rs.push(await page.evaluate(() => Math.hypot(window.gdt.state.top.dx, window.gdt.state.top.dy))));
    await page.waitForTimeout(250);
    const L2 = await page.evaluate(() => ({ top: { ...window.gdt.state.top }, v: window.gdt.result().verdict, note: getComputedStyle(document.getElementById('shrink-note')).visibility }));
    const r2 = Math.hypot(L2.top.dx, L2.top.dy);
    const mono = rs.every((x, i) => i === 0 || x <= rs[i - 1] + 1e-9);
    ckL('lock: dragging the OUT handle back (sideways wiggle, then inward) never sticks and ends IN', L2.v === 'IN' && r2 < 0.125 && mono && L2.note === 'hidden' && rs.length > 3, `r ${rs.map((x) => x.toFixed(3)).join('→')} → ${r2.toFixed(3)} ${L2.v}`);
    await page.screenshot({ path: 'screenshots/lock_dragged_in.png' });
    await page.evaluate(() => { window.gdt.setLock(false); window.gdt.setSize(10.1); window.gdt.setModifier('RFS'); window.gdt.applyPreset('centered'); window.scrollTo(0, 0); document.getElementById('panel').scrollTop = 0; });
    await page.waitForTimeout(300);
  }

// ---- MMC / bonus (Sally's rules), driven through the real controls ----------
{
  const setNum = async (sel, v) => { await page.locator(sel).fill(String(v)); await page.locator(sel).press('Enter'); await page.locator(sel).blur(); await page.waitForTimeout(120); };
  const read = async () => { await page.waitForTimeout(150); return readNow(); };
  const readNow = () => page.evaluate(() => {
    const r = window.gdt.result();
    const t = (id) => document.getElementById(id).innerText.replace(/\s+/g, ' ').trim();
    return { verdict: r.verdict, allowed: r.tolerance, radius: r.radius, status: t('pos-status'), tol: t('tol-line'), vcVis: getComputedStyle(document.getElementById('vc-line')).visibility, vc: t('vc-text'), rc: t('rc-text'),
      badge: document.getElementById('status-badge').innerText.split('\n')[0], zone: document.querySelector('.zone-label')?.innerText.replace(/\s+/g, ' '),
      zoneClass: document.querySelector('.zone-label')?.className, axisClass: document.querySelector('.axis-name-label')?.className,
      handleColors: ['top', 'bottom'].map((k) => '#' + window.gdt._debug.handles[k].material.color.getHexString()),
      handleText: [...document.querySelectorAll('.handle-label')].map((n) => n.innerText).join(' | '),
      marks: [...document.querySelectorAll('.readout .mark')].map((n) => n.innerText).join('/'), posValue: t('pos-value'), insetZone: document.querySelector('#inset .zone')?.getAttribute('class'),
      mmcSym: { panel: !!document.querySelector('#spec-fcf .mmcsym'), drawing: !!document.querySelector('.fcf-label .mmcsym'), vcNote: document.querySelector('.fcf-label .vc-note')?.innerText ?? '' }, msg: t('mc-msg') };
  });
  const ck = (ok, label, d) => { failed ||= !ok; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} — ${JSON.stringify(d)}`); };
  await page.click('button[data-preset="tilt-out"]'); // 2r = 0.26
  await page.click('#mod-rfs');
  await setNum('#n-size', 10.15);
  let d = await read();
  ck(d.verdict === 'OUT' && d.allowed === 0.25 && d.tol === 'stated ⌀0.25 = allowed ⌀0.25 (RFS: no bonus)' && d.vcVis === 'hidden' && !d.mmcSym.panel && !d.mmcSym.drawing, 'RFS ⌀10.15: allowed stays ⌀0.25, no bonus line/VC/Ⓜ, 2r 0.26 OUT', d);
  await page.screenshot({ path: 'screenshots/mmc_rfs.png' });
  await page.click('#mod-mmc');
  d = await read();
  ck(d.verdict === 'IN' && d.allowed === 0.4 && d.radius === 0.2 && d.tol === 'stated ⌀0.25 + bonus ⌀0.15 = allowed ⌀0.4' && d.vcVis === 'visible' && d.vc === 'virtual condition ⌀9.75' && d.mmcSym.panel && d.mmcSym.drawing && d.zone.includes('⌀0.4 ') && d.mmcSym.vcNote === 'virtual condition ⌀9.75', 'MMC ⌀10.15: bonus 0.15, allowed 0.4, zone ⌀0.4, Ⓜ in FCFs, VC ⌀9.75, IN', d);
  await page.screenshot({ path: 'screenshots/mmc_10.15.png' });
  for (const [sz, want] of [[10.0, 0.25], [10.2, 0.45], [9.99, 'REJECT_SIZE'], [10.21, 'REJECT_SIZE'], [9.95, 'REJECT_SIZE'], [10.25, 'REJECT_SIZE']]) {
    await setNum('#n-size', sz);
    d = await read();
    const ok = want === 'REJECT_SIZE' ? d.verdict === 'REJECT_SIZE' && d.status === 'REJECT: size' && d.badge.includes('REJECT: size') : d.allowed === want && d.verdict !== 'REJECT_SIZE';
    ck(ok, `MMC size ⌀${sz} -> ${want}`, { verdict: d.verdict, allowed: d.allowed, vc: d.vc });
    if (sz === 9.99) { await page.click('button[data-preset="centered"]'); d = await read(); ck(d.verdict === 'REJECT_SIZE', 'REJECT: size even with a perfect axis', { verdict: d.verdict });
      await page.click('button[data-preset="tilt-out"]'); d = await read();
      const gray = '#64748b';
      ck(d.tol.includes('bonus n/a') && !/bonus ⌀/.test(d.tol) && !/bonus ⌀|bonus = /.test(await page.locator('#bonus-detail').innerText()), 'REJECT: size -> readout "bonus n/a", no bonus amount', { tol: d.tol });
      ck(d.zoneClass.includes(' na') && d.axisClass.includes(' na') && d.handleColors.every((c) => c === gray) && d.insetZone.includes('na') && d.marks === 'n/a/n/a' && !/[✔✘]/.test(d.handleText), 'REJECT: size -> zone, axis, handles, inset, rows neutral gray (no ✔/✘)', { zone: d.zoneClass, handles: d.handleColors, marks: d.marks, handleText: d.handleText });
      ck(d.posValue === '⌀0.26', 'REJECT: size keeps the position number for information', { posValue: d.posValue }); await page.screenshot({ path: 'screenshots/mmc_reject_size.png' }); await page.click('button[data-preset="tilt-out"]'); }
    if (d.vc !== 'virtual condition ⌀9.75') ck(false, 'VC never changes with size', d);
  }
  await setNum('#n-size', 10.15);
  await setNum('#n-stated', 0.3);
  d = await read();
  ck(d.vc === 'virtual condition ⌀9.7', 'VC follows stated (0.3 -> ⌀9.7)', d.vc);
  await setNum('#n-stated', 0);
  d = await read();
  ck(d.allowed === 0.15 && d.tol === 'stated ⌀0 + bonus ⌀0.15 = allowed ⌀0.15', 'stated ⌀0 valid at MMC (all from bonus)', d.tol);
  await page.click('#mod-rfs');
  d = await read();
  const st = await page.evaluate(() => window.gdt.state.modifier);
  ck(st === 'MMC' && d.msg === '⌀0 is only meaningful at MMC or LMC, where bonus supplies the tolerance.', 'switching to RFS with stated ⌀0 is blocked', { modifier: st, msg: d.msg });
  await setNum('#n-stated', 0.25);
  await page.click('#mod-rfs');
  await setNum('#n-stated', 0);
  d = await read();
  const st2 = await page.evaluate(() => window.gdt.state.stated);
  ck(st2 === 0.25 && d.msg === '⌀0 is only meaningful at MMC or LMC, where bonus supplies the tolerance.' && (await page.locator('#n-stated').inputValue()) === '0.25', 'typing ⌀0 at RFS is refused (reverted)', { stated: st2, msg: d.msg });
  // ---- LMC + Sally's spot-check table (driven through the real segmented switch) ----
  await setNum('#n-stated', 0.25);
  await page.click('button[data-preset="centered"]');
  const spot = { 10.0: [0.25, 0.25, 0.45], 10.1: [0.25, 0.35, 0.35], 10.2: [0.25, 0.45, 0.25] };
  for (const [sz, exp] of Object.entries(spot)) {
    await setNum('#n-size', sz);
    const got = [];
    for (const m of ['rfs', 'mmc', 'lmc']) { await page.click(`#mod-${m}`); got.push((await read()).allowed); }
    ck(JSON.stringify(got) === JSON.stringify(exp), `spot-check ⌀${Number(sz).toFixed(2)}: RFS/MMC/LMC allowed = ${exp.join(' / ')}`, got);
  }
  const vcSweep = { MMC: new Set(), LMC: new Set() };
  for (const m of ['MMC', 'LMC']) {
    await page.click(`#mod-${m.toLowerCase()}`);
    for (const sz of [10.0, 10.05, 10.1, 10.15, 10.2, 10.22]) { await setNum('#n-size', sz); const x = await read(); vcSweep[m].add(x.vc + ' | ' + x.rc + ' | ' + x.mmcSym.vcNote + ' | rc:' + (await page.evaluate(() => [getComputedStyle(document.getElementById('rc-text')).visibility, document.querySelector('.fcf-label .rc-note')?.innerText ?? ''].join('/')))); }
  }
  const mv = [...vcSweep.MMC], lv = [...vcSweep.LMC];
  ck(mv.length === 1 && lv.length === 1 && /^virtual condition ⌀9\.75 \| .* \| virtual condition ⌀9\.75 \| rc:hidden\/$/.test(mv[0]) && lv[0] === 'LMC virtual condition ⌀10.45 | LMC resultant condition ⌀9.55 | LMC virtual condition ⌀10.45 | rc:visible/LMC resultant condition ⌀9.55', 'VC labels at default: MMC ⌀9.75, LMC ⌀10.45 + LMC resultant ⌀9.55 (LMC only), unchanged while size moves (panel + drawing)', { mv, lv });
  await setNum('#n-size', 10.05);
  await page.click('button[data-preset="tilt-out"]');
  d = await read();
  const lx = await page.evaluate(() => ({ lsym: !!document.querySelector('#spec-fcf .mmcsym[aria-label="LMC"]'), dsym: !!document.querySelector('.fcf-label .mmcsym[aria-label="LMC"]'), teach: getComputedStyle(document.getElementById('teach-line')).visibility, teachText: document.getElementById('teach-line').innerText, bd: document.getElementById('bonus-detail').innerText }));
  ck(d.verdict === 'IN' && d.allowed === 0.4 && d.tol === 'stated ⌀0.25 + bonus ⌀0.15 = allowed ⌀0.4' && lx.bd === 'bonus = LMC ⌀10.2 − actual ⌀10.05' && lx.lsym && lx.dsym && lx.teach === 'visible' && lx.teachText === 'MMC protects assembly, LMC protects material.', 'LMC ⌀10.05: bonus 0.15, allowed 0.4, Ⓛ in FCFs, teaching line shown, IN', { ...d, ...lx });
  await page.screenshot({ path: 'screenshots/lmc_10.05.png' });
  await setNum('#n-size', 10.22);
  d = await read();
  ck(d.verdict === 'REJECT_SIZE' && d.tol.includes('bonus n/a') && d.handleColors.every((c) => c === '#64748b') && d.zoneClass.includes(' na') && d.posValue === '⌀0.26', 'LMC ⌀10.22: REJECT: size, bonus n/a, gray, position kept', { verdict: d.verdict, tol: d.tol, posValue: d.posValue });
  await setNum('#n-size', 10.1);
  await setNum('#n-stated', 0);
  d = await read();
  ck(d.verdict !== 'INVALID_TOL' && d.allowed === 0.1, 'stated ⌀0 valid at LMC (bonus 0.1 at ⌀10.1)', { verdict: d.verdict, allowed: d.allowed });
  await setNum('#n-stated', 0.25);
  await page.click('#mod-rfs');
  const tv = await page.evaluate(() => getComputedStyle(document.getElementById('teach-line')).visibility);
  ck(tv === 'hidden', 'teaching line hidden at RFS', tv);
  await setNum('#n-size', 10.1);
}

// ---- Views (Top Z / Front Y / Side X / 3D + Ortho/Persp), tilt lock, 2D-trap preset ----
{
  const ckV = (l, ok, x) => { failed ||= !ok; console.log(`${ok ? 'OK  ' : 'FAIL'} ${l} — ${typeof x === 'string' ? x : JSON.stringify(x)}`); };
  await page.evaluate(() => { window.gdt.setLock(false); window.gdt.setTiltLock(false); window.gdt.setModifier('RFS'); window.gdt.setStated(0.25); window.gdt.setSize(10.1); window.gdt.applyPreset('centered'); window.scrollTo(0, 0); });
  const scr = (k) => page.evaluate((k) => {
    const h = window.gdt._debug.handles[k], cam = window.gdt._debug.camera, r = window.gdt._debug.canvas.getBoundingClientRect();
    const v = h.position.clone().project(cam);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, k);
  const mdrag = async (k, dx, dy) => { const p = await scr(k); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(150); };
  const st = () => page.evaluate(() => JSON.parse(JSON.stringify({ b: window.gdt.state.bottom, t: window.gdt.state.top, v: window.gdt.view(), verdict: window.gdt.result().verdict })));
  const labelsOk = () => page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const shown = (e) => e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && r(e).width > 0 && e.closest('[style*="display: none"]') == null;
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const cv = r(window.gdt._debug.canvas);
    const items = [...document.querySelectorAll('.zone-label, .axis-name-label, .handle-label, .tp-label, #status-badge, #mag-badge, #view-row')].filter(shown);
    const name = (e) => e.id || e.className.split(' ')[1] || e.innerText.split(' ')[0];
    const issues = [];
    for (const e of items) { const b = r(e); if (b.left < cv.left - 0.5 || b.right > cv.right + 0.5 || b.top < cv.top - 0.5 || b.bottom > cv.bottom + 0.5) issues.push(name(e) + ' off-view'); }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (hit(r(items[i]), r(items[j]))) issues.push(`${name(items[i])}~${name(items[j])}`);
    const minFont = Math.min(...[...document.querySelectorAll('.zone-label, .axis-name-label, .handle-label')].filter(shown).map((e) => parseFloat(getComputedStyle(e).fontSize)));
    return { issues, minFont };
  });
  const look = () => page.evaluate(() => { const d = window.gdt._debug.camera.getWorldDirection(window.gdt._debug.camera.position.clone()); return [d.x, d.y, d.z].map((v) => Math.round(v * 1000) / 1000); });
  const expectLook = { top: [0, 0, -1], front: [0, 1, 0], side: [-1, 0, 0] };
  const dragExpect = {
    top: { k: 'top', dx: 40, dy: -30, ok: (a, b) => b.t.dx > a.t.dx + 0.02 && b.t.dy > a.t.dy + 0.02 && b.b.dx === a.b.dx && b.b.dy === a.b.dy, what: 'TOP moves +X/+Y, BOTTOM unchanged' },
    front: { k: 'bottom', dx: 40, dy: -30, ok: (a, b) => b.b.dx > a.b.dx + 0.02 && b.b.dy === a.b.dy && b.t.dx === a.t.dx, what: 'BOTTOM moves in X only (screen-vertical = Z ignored)' },
    side: { k: 'top', dx: 40, dy: -30, ok: (a, b) => b.t.dy > a.t.dy + 0.02 && b.t.dx === a.t.dx && b.b.dy === a.b.dy, what: 'TOP moves in Y only' },
  };
  for (const v of ['top', 'front', 'side']) {
    await page.evaluate(() => window.gdt.applyPreset('centered'));
    await page.click(`#view-row [data-view="${v}"]`);
    await page.waitForTimeout(700);
    const s0 = await st(), lk = await look();
    const pressed = await page.evaluate((v) => ({ btn: document.querySelector(`#view-row [data-view="${v}"]`).getAttribute('aria-pressed'), proj: document.getElementById('proj-btn').innerText }), v);
    ckV(`view ${v}: snaps (animated) to ortho, looking ${expectLook[v]}`, s0.v.view === v && s0.v.ortho && !s0.v.animating && lk.every((c, i) => Math.abs(c - expectLook[v][i]) < 0.01) && pressed.btn === 'true' && pressed.proj === 'Ortho', { view: s0.v, look: lk, pressed });
    const L = await labelsOk();
    ckV(`view ${v}: labels in view, no overlaps, font >= 10px`, L.issues.length === 0 && L.minFont >= 10, L);
    const e = dragExpect[v];
    await mdrag(e.k, e.dx, e.dy);
    const s1 = await st();
    ckV(`view ${v}: mouse drag of ${e.k.toUpperCase()} — ${e.what}`, e.ok(s0, s1), { before: { b: s0.b, t: s0.t }, after: { b: s1.b, t: s1.t } });
    await page.screenshot({ path: `screenshots/view_${v}.png` });
  }
  await page.click('#proj-btn'); await page.waitForTimeout(200);
  const pp = await st();
  await page.click('#proj-btn'); await page.waitForTimeout(200);
  const po = await st();
  ckV('Ortho/Persp switch toggles the projection, keeping the pose', !pp.v.ortho && po.v.ortho, { afterFirst: pp.v, afterSecond: po.v });
  await page.click('#view-row [data-view="3d"]'); await page.waitForTimeout(700);
  const s3 = await st();
  const cam3 = await page.evaluate(() => window.gdt._debug.camera.position.toArray().map((v) => Math.round(v * 10) / 10));
  ckV('3D returns to the default perspective orbit', s3.v.view === '3d' && !s3.v.ortho && JSON.stringify(cam3) === JSON.stringify([-22, -88, 92]), { view: s3.v, cam: cam3 });
  await page.evaluate(() => window.gdt.applyPreset('centered'));
  await mdrag('top', 40, 0);
  const s3d = await st();
  ckV('3D view drag still works (TOP moves, BOTTOM unchanged)', Math.abs(s3d.t.dx) > 0.005 && s3d.b.dx === 0, s3d);

  // Lock tilt: turning it on leaves the axis exactly where it is; drags then keep top − bottom constant
  await page.click('button[data-preset="tilt-in"]');
  const a0 = await st();
  await page.locator('#tilt-lock-btn').scrollIntoViewIfNeeded();
  await page.click('#tilt-lock-btn');
  const a1 = await st();
  const tl = await page.evaluate(() => ({ on: window.gdt.state.tiltLock, pressed: document.getElementById('tilt-lock-btn').getAttribute('aria-pressed'), text: document.getElementById('tilt-lock-btn').innerText }));
  ckV('Lock tilt ON leaves both endpoints unchanged (tilted axis not straightened)', tl.on && tl.pressed === 'true' && tl.text === 'Lock tilt' && JSON.stringify([a0.b, a0.t]) === JSON.stringify([a1.b, a1.t]), { before: [a0.b, a0.t], after: [a1.b, a1.t] });
  const dif = (s) => [Math.round((s.t.dx - s.b.dx) * 1e6), Math.round((s.t.dy - s.b.dy) * 1e6)];
  await page.evaluate(() => window.scrollTo(0, 0));
  await mdrag('top', 30, -20);
  const a2 = await st();
  await mdrag('bottom', -25, 10);
  const a3 = await st();
  ckV('Lock tilt: TOP and BOTTOM drags translate both ends (top − bottom constant)', JSON.stringify(dif(a2)) === JSON.stringify(dif(a0)) && JSON.stringify(dif(a3)) === JSON.stringify(dif(a0)) && a2.b.dx !== a0.b.dx && a3.t.dx !== a2.t.dx, { d0: dif(a0), d2: dif(a2), d3: dif(a3), a3: [a3.b, a3.t] });
  await page.screenshot({ path: 'screenshots/tilt_lock.png' });
  // both locks
  await page.evaluate(() => { window.gdt.applyPreset('tilt-in'); window.gdt.setLock(true); });
  await mdrag('mid', 200, 0);
  const b1 = await st();
  const rr = (p) => Math.hypot(p.dx, p.dy);
  ckV('Lock tilt + Lock in tolerance: the end that would leave first stops the move; tilt kept; IN', b1.verdict === 'IN' && JSON.stringify(dif(b1)) === JSON.stringify(dif(a0)) && Math.max(rr(b1.t), rr(b1.b)) > 0.12 && Math.max(rr(b1.t), rr(b1.b)) <= 0.125, { b: b1.b, t: b1.t, verdict: b1.verdict });
  await page.evaluate(() => { window.gdt.setLock(false); window.gdt.setTiltLock(false); });

  // Diagonal (2D trap)
  await page.click('button[data-preset="diag-out"]');
  await page.click('#view-row [data-view="top"]'); await page.waitForTimeout(700);
  const dg = await page.evaluate(() => ({ verdict: window.gdt.result().verdict, pos: document.getElementById('pos-value').innerText, cmp: document.getElementById('pos-compare').innerText, note: document.getElementById('preset-note').innerText, vis: getComputedStyle(document.getElementById('preset-note')).visibility, label: document.querySelector('button[data-preset="diag-out"]').innerText }));
  ckV('Diagonal (2D trap): OUT, ⌀0.283 > ⌀0.25, note shown', dg.verdict === 'OUT' && dg.pos === '⌀0.283' && /> ⌀0\.25/.test(dg.cmp) && dg.vis === 'visible' && dg.note === 'Inside the band in front and side views, but outside the round zone.' && dg.label === 'Diagonal (2D trap)', dg);
  await page.screenshot({ path: 'screenshots/diag_top_view.png' });
  await page.evaluate(() => window.gdt.applyPreset('centered'));
  const nv = await page.evaluate(() => getComputedStyle(document.getElementById('preset-note')).visibility);
  ckV('preset note hides once the axis is no longer the diagonal preset', nv === 'hidden', nv);
  await page.click('#view-row [data-view="3d"]'); await page.waitForTimeout(700);

  // URL params for lessons
  const u = new globalThis.URL(URL); u.searchParams.set('view', 'top'); u.searchParams.set('tiltlock', '1'); u.searchParams.set('lock', '1');
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p2.goto(u.toString(), { waitUntil: 'networkidle' }); await p2.waitForTimeout(800);
  const q = await p2.evaluate(() => ({ v: window.gdt.view(), tilt: window.gdt.state.tiltLock, lock: window.gdt.state.lock, api: ['setTiltLock', 'setLock', 'setView', 'setProjection'].every((f) => typeof window.gdt[f] === 'function') }));
  ckV('URL ?view=top&tiltlock=1&lock=1 and JS API (gdt.setTiltLock/setLock/setView/setProjection)', q.v.view === 'top' && q.v.ortho && q.tilt && q.lock && q.api, q);
  await p2.close();
}

console.log(errors.length ? `Console errors/warnings:\n  ${errors.join('\n  ')}` : 'No console errors or warnings.');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
