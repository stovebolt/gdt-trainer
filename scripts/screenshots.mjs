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

// Display/verdict consistency at 4 decimals, plus the size note.
for (const [dx, expectR, file] of [[0.1251, '0.1251', 'boundary_0.1251.png'], [0.12503, '0.1251', null], [0.125, '0.1250', null]]) {
  await page.evaluate((v) => window.gdt.setAxis({ bottom: { dx: v, dy: 0 }, top: { dx: v, dy: 0 } }), dx);
  await page.waitForTimeout(250);
  const ui = await page.evaluate(() => ({
    rowR: document.querySelector('#row-top .r').innerText,
    mark: document.querySelector('#row-top .mark').innerText,
    pos: document.getElementById('pos-value').innerText,
    badge: document.getElementById('status-badge').innerText,
    notes: [...document.querySelectorAll('.size-note')].filter((n) => n.offsetParent && n.innerText.includes('⌀10.0–10.2')).length,
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

console.log(errors.length ? `Console errors/warnings:\n  ${errors.join('\n  ')}` : 'No console errors or warnings.');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
