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
    const items = [...document.querySelectorAll('.zone-label, .axis-name-label, .handle-label, .tp-label, #status-badge, #mag-badge, #view-row, .lock-badge')].filter(shown);
    const name = (e) => e.id || e.className.split(' ')[1] || e.innerText.split(' ')[0];
    const issues = [];
    for (const e of items) { const b = r(e); if (b.left < cv.left - 0.5 || b.right > cv.right + 0.5 || b.top < cv.top - 0.5 || b.bottom > cv.bottom + 0.5) issues.push(name(e) + ' off-view'); }
    const rr = (e) => { const q = r(e); return `[${Math.round(q.left)},${Math.round(q.top)} ${Math.round(q.width)}x${Math.round(q.height)}]`; };
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (hit(r(items[i]), r(items[j]))) issues.push(`${name(items[i])}${rr(items[i])}~${name(items[j])}${rr(items[j])}`);
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
  // Lock badges in the 3D view: each shown only while its lock is on; no overlaps
  const badges = () => page.evaluate(() => ['badge-tilt', 'badge-tol'].map((id) => { const e = document.getElementById(id); return { id, shown: !e.hidden && e.getBoundingClientRect().width > 0, text: e.innerText }; }));
  let bg = await badges();
  ckV('lock badges: "Tilt locked" + "Tolerance locked" both shown with both locks on', bg.every((x) => x.shown) && bg[0].text === 'Tilt locked' && bg[1].text === 'Tolerance locked', bg);
  for (const v of ['3d', 'top', 'front']) {
    await page.click(`#view-row [data-view="${v}"]`); await page.waitForTimeout(700);
    const L = await labelsOk();
    ckV(`lock badges (${v} view): nothing overlaps badges, labels or controls`, L.issues.length === 0, L);
  }
  await page.click('#view-row [data-view="3d"]'); await page.waitForTimeout(700);
  await page.locator('#lock-btn').scrollIntoViewIfNeeded(); await page.click('#lock-btn');
  bg = await badges();
  ckV('lock badges: tolerance lock off -> only "Tilt locked"', bg[0].shown && !bg[1].shown, bg);
  await page.click('#tilt-lock-btn'); await page.click('#lock-btn');
  bg = await badges();
  ckV('lock badges: tilt lock off -> only "Tolerance locked"', !bg[0].shown && bg[1].shown, bg);
  await page.click('#lock-btn');
  bg = await badges();
  ckV('lock badges: both locks off -> no badges', bg.every((x) => !x.shown), bg);
  await page.evaluate(() => { window.gdt.setLock(false); window.gdt.setTiltLock(false); window.scrollTo(0, 0); });

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

  // ---- Datum references: A/B/C toggles, sliding zone, locks, MMC/LMC, notes, views ----
  {
    const R = () => page.evaluate(() => { const r = window.gdt.result(), e = (id) => document.getElementById(id); return { verdict: r.verdict, dev: r.deviation, tol: r.tolerance, zone: r.zone, pos: e('pos-value').innerText, cmp: e('pos-compare').innerText, status: e('pos-status').innerText, chip: e('fcf-chip').querySelector('table').dataset.datums, panel: e('spec-fcf').querySelector('table').dataset.datums, scene: document.querySelector('.label .fcf')?.dataset.datums, badge: e('badge-datum').hidden ? '' : e('badge-datum').innerText, slide: getComputedStyle(e('slide-line')).visibility === 'visible' ? e('slide-line').innerText : '', note: getComputedStyle(e('datum-note')).visibility === 'visible' ? e('datum-note').innerText : '', rows: ['bottom', 'top'].map((k) => e('row-' + k).className), insetZone: document.querySelector('#inset .zone').getAttribute('class'), insetFree: getComputedStyle(document.getElementById('i-free')).display, st: JSON.parse(JSON.stringify({ b: window.gdt.state.bottom, t: window.gdt.state.top })) }; });
    const reset = () => page.evaluate(() => { window.gdt.setLock(false); window.gdt.setTiltLock(false); window.gdt.setModifier('RFS'); window.gdt.setStated(0.25); window.gdt.setSize(10.1); window.gdt.setDatums({ A: true, B: true, C: true }); window.gdt.applyPreset('centered'); window.scrollTo(0, 0); });
    await reset(); await page.click('#view-row [data-view="3d"]'); await page.waitForTimeout(600);
    let r = await R();
    ckV('datums: all three on by default; FCF (panel, chip, 3D drawing) shows A B C; no badge, no notes', r.chip === 'ABC' && r.panel === 'ABC' && r.scene === 'ABC' && r.badge === '' && r.slide === '' && r.note === '', r);
    // C dropped: slides in Y
    await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0, dy: 0.2 }, top: { dx: 0, dy: 0.2 } }));
    r = await R(); ckV('with all datums the axis 0.2 off in Y is OUT', r.verdict === 'OUT', { v: r.verdict, pos: r.pos });
    await page.locator('#datum-C').scrollIntoViewIfNeeded(); await page.click('#datum-C'); await page.waitForTimeout(300);
    r = await R();
    ckV('drop C: IN (slides in Y), zone centre dy +0.2, FCF drops C everywhere, badge + slide line, inset shows freedom band', r.verdict === 'IN' && Math.abs(r.zone.dy - 0.2) < 1e-9 && r.zone.dx === 0 && r.chip === 'AB' && r.panel === 'AB' && r.scene === 'AB' && /C dropped.*Y/.test(r.badge) && /slides in Y/.test(r.slide) && r.insetFree !== 'none', r);
    await page.screenshot({ path: 'screenshots/datum_c_dropped_3d.png' });
    // X is still held with C dropped
    await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0.2, dy: 0 }, top: { dx: 0.2, dy: 0 } }));
    r = await R(); ckV('C dropped: an X offset of 0.2 is still OUT (X is held by B)', r.verdict === 'OUT', { v: r.verdict, dev: r.dev });
    // B dropped
    await page.click('#datum-C'); await page.click('#datum-B'); await page.waitForTimeout(300);
    r = await R(); ckV('drop B only: slides in X, the same 0.2 X offset is IN; Y offset is OUT', r.verdict === 'IN' && Math.abs(r.zone.dx - 0.2) < 1e-9 && r.chip === 'AC' && /slides in X/.test(r.slide), r);
    await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0, dy: 0.2 }, top: { dx: 0, dy: 0.2 } }));
    r = await R(); ckV('B dropped: Y offset 0.2 OUT', r.verdict === 'OUT', r.verdict);
    // B and C dropped: perpendicularity
    await page.click('#datum-C'); await page.waitForTimeout(300);
    await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0.4, dy: -0.3 }, top: { dx: 0.4, dy: -0.3 } }));
    r = await R(); ckV('B and C dropped (A only): any shift is IN, FCF = A, perpendicularity note, inset band cross', r.verdict === 'IN' && r.chip === 'A' && /perpendicularity/.test(r.note) && /X and Y/.test(r.slide) && r.dev === 0, r);
    { const w = await page.evaluate(() => ({ label: document.getElementById('pos-label').innerText, badge: document.getElementById('status-badge').innerText, centre: getComputedStyle(document.getElementById('i-centre')).display, slide: document.getElementById('slide-line').innerText }));
      ckV('A only: readout labelled "⌀ (acts like perpendicularity to A)" (not "position ⌀"); centre marker shown', w.label.startsWith('⌀ (acts like perpendicularity to A)') && !/Position/.test(w.label) && /perpendicularity to A ⌀/.test(w.badge) && !/position ⌀/.test(w.badge) && w.centre !== 'none' && /◆ centre/.test(w.slide), w); }
    await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0.4, dy: -0.3 }, top: { dx: 0.4, dy: -0.3 } }));
    for (const [d, want] of [[0.1, 'IN'], [0.13, 'OUT']]) {
      await page.evaluate((d) => window.gdt.setAxis({ bottom: { dx: -d, dy: 0 }, top: { dx: d, dy: 0 } }), d);
      r = await R(); ckV(`A only: tilt ±${d} (spread ${2 * d}) is ${want} like perpendicularity ⌀${(2 * d).toFixed(2)} vs ⌀0.25`, r.verdict === want, { v: r.verdict, pos: r.pos, cmp: r.cmp });
    }
    // conservative rounding on the slid zone: spread 0.2501 → OUT shows ⌀0.251 > ⌀0.25 ; 0.2499 → IN shows ≤
    await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: -0.12505, dy: 0 }, top: { dx: 0.12505, dy: 0 } }));
    r = await R(); ckV('rounding: A only, spread 0.2501 -> OUT and displays ⌀0.251 > ⌀0.25 (never ≤)', r.verdict === 'OUT' && /^⌀0\.251$/.test(r.pos) && /^>/.test(r.cmp), { pos: r.pos, cmp: r.cmp, v: r.verdict });
    await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: -0.1249, dy: 0 }, top: { dx: 0.1249, dy: 0 } }));
    r = await R(); ckV('rounding: A only, spread 0.2498 -> IN (≤ ⌀0.25)', r.verdict === 'IN' && /^≤/.test(r.cmp), { pos: r.pos, cmp: r.cmp });
    // MMC / LMC bonus on the slid zone
    await page.evaluate(() => { window.gdt.setModifier('MMC'); window.gdt.setSize(10.2); window.gdt.setAxis({ bottom: { dx: -0.22, dy: 0 }, top: { dx: 0.22, dy: 0 } }); });
    r = await R(); ckV('MMC ⌀10.2 (allowed ⌀0.45) + A only: tilt spread 0.44 IN', r.verdict === 'IN' && Math.abs(r.tol - 0.45) < 1e-9, { v: r.verdict, tol: r.tol, pos: r.pos });
    await page.evaluate(() => { window.gdt.setModifier('LMC'); window.gdt.setSize(10.1); window.gdt.setAxis({ bottom: { dx: -0.2, dy: 0 }, top: { dx: 0.2, dy: 0 } }); });
    r = await R(); ckV('LMC ⌀10.1 (allowed ⌀0.35) + A only: spread 0.4 OUT, displays > limit', r.verdict === 'OUT' && /^>/.test(r.cmp), { v: r.verdict, tol: r.tol, pos: r.pos, cmp: r.cmp });
    await page.evaluate(() => { window.gdt.setModifier('RFS'); window.gdt.setSize(10.1); });
    // views: freedom visible, nothing overlaps
    await page.evaluate(() => window.gdt.setAxis({ bottom: { dx: 0.15, dy: -0.05 }, top: { dx: 0.25, dy: 0.05 } }));
    for (const v of ['3d', 'top', 'front', 'side']) {
      await page.click(`#view-row [data-view="${v}"]`); await page.waitForTimeout(800);
      const L = await labelsOk();
      ckV(`B and C dropped, ${v} view: badge + labels + handles + controls, nothing overlaps`, L.issues.length === 0, L);
      await page.screenshot({ path: `screenshots/datum_bc_dropped_${v}.png` });
    }
    await page.click('#view-row [data-view="3d"]'); await page.waitForTimeout(600);
    // A alone
    await reset();
    await page.evaluate(() => window.gdt.applyPreset('diag-out'));
    const all = await R();
    await page.locator('#datum-A').scrollIntoViewIfNeeded(); await page.click('#datum-A'); await page.waitForTimeout(300);
    r = await R();
    ckV('drop A alone: nothing visible changes (verdict, ⌀, rows, inset) and the on-screen note says so', r.verdict === all.verdict && r.pos === all.pos && r.cmp === all.cmp && JSON.stringify(r.rows) === JSON.stringify(all.rows) && r.zone.dx === 0 && r.zone.dy === 0 && r.chip === 'BC' && r.note === 'Dropping A alone changes nothing visible here.' && r.insetFree === 'none', { all: [all.verdict, all.pos], now: [r.verdict, r.pos], note: r.note });
    await page.screenshot({ path: 'screenshots/datum_a_note.png' });
    // all three dropped
    await page.click('#datum-B'); await page.click('#datum-C'); await page.waitForTimeout(300);
    r = await R();
    ckV('A, B, C dropped: NO DATUMS (neutral), zone floats free, "means nothing" note, rows n/a, FCF has no datum cells', r.verdict === 'NO_DATUMS' && r.status === 'NO DATUMS' && r.chip === '' && r.scene === '' && /means nothing/.test(r.note) && r.rows.every((c) => c === 'na') && /na/.test(r.insetZone), r);
    { const w = await page.evaluate(() => ({ detail: document.getElementById('pos-detail').innerText, badge: document.getElementById('status-badge').innerText, cls: document.getElementById('status-badge').className, overall: document.getElementById('overall').className, centre: getComputedStyle(document.getElementById('i-centre')).display }));
      ckV('all dropped: wording "No datum reference: position is undefined" in the panel and the badge; neutral gray; no centre marker', w.detail === 'No datum reference: position is undefined' && w.badge.includes('No datum reference: position is undefined') && /na/.test(w.cls) && /na/.test(w.overall) && !/pass|fail/.test(w.cls + w.overall) && w.centre === 'none', w); }
    await page.screenshot({ path: 'screenshots/datum_none.png' });
    // ---- Position / Virtual condition toggle (Sally) ----
    {
      const CK = ckV, TAP = (sel) => page.click(sel), SHOT = (n) => page.screenshot({ path: `screenshots/${n.replace(/-/g, '_')}.png` });
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
    // ---- Explain this setup (desktop: open by default, updates live) ----
    {
      const reset = () => page.evaluate(() => { window.gdt.setLock(false); window.gdt.setTiltLock(false); window.gdt.setModifier('RFS'); window.gdt.setStated(0.25); window.gdt.setSize(10.1); window.gdt.setDatums({ A: true, B: true, C: true }); window.gdt.applyPreset('centered'); window.scrollTo(0, 0); });
      await reset(); await page.click('#view-row [data-view="3d"]'); await page.waitForTimeout(500);
      const X = () => page.evaluate(() => { const b = document.getElementById('ex-body'); return { open: document.getElementById('explain').open, cfg: document.getElementById('ex-config').innerText, text: b.innerText.replace(/\s+/g, ' '), tags: [...b.querySelectorAll('.ex-tag')].map((t) => t.className.replace('ex-tag ', '')).join(','), cites: b.querySelectorAll('.ex-cite').length, practiceCited: b.querySelectorAll('.ex-line-practice .ex-cite').length, verdict: window.gdt.result().verdict, h: Math.round(b.getBoundingClientRect().height), next: Math.round(document.querySelector('#explain-wrap + section').getBoundingClientRect().top + document.getElementById('panel').scrollTop) }; });
      let x = await X();
      ckV('explainer: open by default on desktop; shows A | B | C · RFS with Controls / Free / Better way', x.open && /A \| B \| C · RFS/.test(x.cfg) && /Controls X and Y location, axis square to A\./.test(x.text) && /None, this is the complete frame\./.test(x.text), x);
      const seen = {}; const nexts = new Set();
      for (const [name, d] of Object.entries({ ABC: 'ABC', AB: 'AB', AC: 'AC', A: 'A', BC: 'BC', B: 'B', C: 'C', none: '' })) for (const m of ['RFS', 'MMC', 'LMC']) {
        await page.evaluate(([d, m]) => { window.gdt.setDatums({ A: d.includes('A'), B: d.includes('B'), C: d.includes('C') }); window.gdt.setModifier(m); window.gdt.setSize(10.1); }, [d, m]);
        await page.waitForTimeout(40); x = await X(); nexts.add(x.next); seen[name + m] = x.cfg;
      }
      ckV('explainer: panel stable across all 8 datum configs x RFS/MMC/LMC (section below never moves)', nexts.size === 1, [...nexts]);
      await page.evaluate(() => { window.gdt.setModifier('RFS'); window.gdt.setDatums({ A: true, B: false, C: false }); }); await page.waitForTimeout(150); x = await X();
      ckV('explainer A only: perpendicularity advice shown as a Practice (not a Rule); citations only on Rule lines', /Use perpendicularity to A: it says what is controlled, while position implies a location that is not\./.test(x.text) && /ex-practice/.test(x.tags) && /ex-rule/.test(x.tags) && x.practiceCited === 0 && x.cites >= 2, x);
      await page.evaluate(() => document.getElementById('explain').scrollIntoView({ block: 'center' })); await page.screenshot({ path: 'screenshots/explain_a_only.png' });
      for (const [k, d] of [['B', { A: false, B: true, C: false }], ['C', { A: false, B: false, C: true }]]) {
        await page.evaluate((d) => window.gdt.setDatums(d), d); await page.waitForTimeout(150); x = await X();
        ckV(`explainer ${k} only (A dropped): one shared entry, "Simplified, this lesson keeps the zone vertical.", zone stays vertical (no tilt built)`, x.text.includes('Simplified, this lesson keeps the zone vertical.') && x.text.includes(`tilting about ${k}'s normal`) && x.text.includes('Add A first.'), x.text.slice(0, 200));
        if (k === 'B') { await page.evaluate(() => document.getElementById('explain').scrollIntoView({ block: 'center' })); await page.screenshot({ path: 'screenshots/explain_b_only.png' }); }
      }
      // advice never changes IN/OUT: toggling the panel and changing nothing else keeps the verdict
      for (const [k, d, want] of [['AB', { A: true, B: true, C: false }, true], ['AC', { A: true, B: false, C: true }, true], ['A', { A: true, B: false, C: false }, true], ['B', { A: false, B: true, C: false }, true], ['C', { A: false, B: false, C: true }, true], ['ABC', { A: true, B: true, C: true }, false], ['BC', { A: false, B: true, C: true }, false], ['none', { A: false, B: false, C: false }, false]]) {
        await page.evaluate((d) => window.gdt.setDatums(d), d); await page.waitForTimeout(150); const t = (await X()).text;
        ckV(`explainer ${k}: basic-dimension Rule ${want ? 'shown (B and/or C dropped)' : 'absent'}`, t.includes('Basic dimensions take no default tolerance. With this datum dropped, this frame no longer locates the hole in that direction; a separate toleranced dimension or another control is needed.') === want && t.includes("The slide limit here is only the lesson's drag range. It is not a tolerance.") === want, t.slice(0, 200));
      }
      await page.evaluate(() => window.gdt.setDatums({ A: true, B: true, C: true })); await page.waitForTimeout(150);
      const v1 = (await X()).verdict; await page.evaluate(() => { document.getElementById('explain').open = false; }); const v2 = (await X()).verdict; await page.evaluate(() => { document.getElementById('explain').open = true; });
      ckV('explainer is advice only: collapsing / expanding it never changes the verdict', v1 === v2, [v1, v2]);
      await reset();
    }
    // Lock in tolerance with freed axes (mouse)
    await reset();
    await page.click('#view-row [data-view="top"]'); await page.waitForTimeout(700);
    await page.evaluate(() => { window.gdt.applyPreset('tilt-in'); window.gdt.setLock(true); });
    await mdrag('mid', 0, -150);
    let a = await R();
    ckV('lock on, all datums: sliding the whole axis in Y is walled (|dy| <= 0.124)', Math.abs(a.st.t.dy) <= 0.124 + 1e-9 && Math.abs(a.st.t.dy) > 0.05 && a.verdict === 'IN', { b: a.st.b, t: a.st.t });
    await reset(); await page.evaluate(() => { window.gdt.applyPreset('tilt-in'); window.gdt.setLock(true); window.gdt.setDatum('C', false); });
    await mdrag('mid', 0, -150);
    a = await R();
    ckV('lock on, C dropped: sliding the axis in Y is NOT walled (zone slides), both ends move together, still IN', Math.abs(a.st.t.dy) > 0.2 && Math.abs(a.st.t.dy - a.st.b.dy) < 1e-9 && a.verdict === 'IN', { b: a.st.b, t: a.st.t, v: a.verdict });
    await mdrag('mid', 200, 0);
    a = await R();
    ckV('lock on, C dropped: sliding in X is still walled (X is held)', Math.abs(a.st.t.dx) <= 0.124 + 1e-9 && a.verdict === 'IN', { t: a.st.t });
    // tilt lock + tolerance lock with B dropped
    await reset(); await page.evaluate(() => { window.gdt.applyPreset('tilt-in'); window.gdt.setTiltLock(true); window.gdt.setLock(true); window.gdt.setDatum('B', false); });
    const a0 = await R();
    await mdrag('mid', 250, 0);
    a = await R();
    ckV('tilt lock + tolerance lock + B dropped: X slide free, tilt kept, IN', a.verdict === 'IN' && Math.abs((a.st.t.dx - a.st.b.dx) - (a0.st.t.dx - a0.st.b.dx)) < 1e-9 && Math.abs(a.st.t.dx) > 0.3, { b: a.st.b, t: a.st.t, v: a.verdict });
    // restoring a datum while locked: the axis stays put, shrink note
    await page.evaluate(() => window.gdt.setDatum('B', true)); await page.waitForTimeout(250);
    a = await R();
    const sn = await page.evaluate(() => ({ vis: getComputedStyle(document.getElementById('shrink-note')).visibility, text: document.getElementById('shrink-note').innerText }));
    ckV('restore B while locked: axis does not move, now OUT, note "datum restored" shown', a.verdict === 'OUT' && sn.vis === 'visible' && /datum restored/.test(sn.text) && Math.abs(a.st.t.dx) > 0.3, { sn, v: a.verdict });
    await reset();
    // URL ?datums=
    const u2 = new globalThis.URL(URL); u2.searchParams.set('datums', 'AB');
    const p3 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p3.goto(u2.toString(), { waitUntil: 'networkidle' }); await p3.waitForTimeout(800);
    const q3 = await p3.evaluate(() => ({ d: window.gdt.state.datums, api: ['setDatum', 'setDatums'].every((f) => typeof window.gdt[f] === 'function') }));
    ckV('URL ?datums=AB keeps A and B (C dropped); JS API gdt.setDatum/setDatums', q3.d.A && q3.d.B && !q3.d.C && q3.api, q3);
    await p3.close();
  }
}

console.log(errors.length ? `Console errors/warnings:\n  ${errors.join('\n  ')}` : 'No console errors or warnings.');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
