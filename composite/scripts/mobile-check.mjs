// Lesson 2 (composite) mobile + desktop check with Playwright device emulation.
// Layout (no page overflow, badge on screen, tag/text sizes), preset taps -> verdicts,
// real touch drags (CDP) of a hole handle, the pattern handle and the rotate handle,
// one-finger orbit, console errors. iPhone 14: screenshots of the four teaching states.
// Usage: URL=http://localhost:8131/composite/ OUT=screenshots/composite node composite/scripts/mobile-check.mjs
import { chromium, devices } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:8131/composite/';
const OUT = process.env.OUT || 'screenshots/composite';
const DEVICES = (process.env.DEVICES || 'Desktop 1440,iPhone 13,iPhone 13 landscape,iPhone 14,iPhone 14 landscape,Pixel 7,Pixel 7 landscape,iPad (gen 7),iPad (gen 7) landscape').split(',');
const EXPECT = { 'P0-NOMINAL': 'PASS', 'P1-AHA-SHIFT': 'PASS', 'P2-AHA-ROTATE': 'PASS', 'P3-PATTERN-OUT': 'FAIL_UPPER', 'P4-ONE-HOLE-OUT': 'FAIL_LOWER', 'P5-TILT-LEAN': 'FAIL_LOWER', 'EC6-DIAGONAL': 'FAIL_UPPER' };
const SHOTS = { 'P1-AHA-SHIFT': 'p1-aha-shift', 'P2-AHA-ROTATE': 'p2-aha-rotate', 'P4-ONE-HOLE-OUT': 'one-hole-fails-lower-only', 'EC6-DIAGONAL': 'diagonal-shift-fails-upper' };
const executablePath = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
mkdirSync(OUT, { recursive: true });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let anyFail = false;
const shots = [];

for (const name of DEVICES) {
  const desc = name === 'Desktop 1440' ? { viewport: { width: 1440, height: 900 }, hasTouch: true } : (({ defaultBrowserType, ...d }) => d)(devices[name]);
  const ctx = await browser.newContext(desc);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  const cdp = await ctx.newCDPSession(page);
  const checks = [];
  const check = (label, ok, detail = '') => { checks.push({ label, ok, detail }); if (!ok) anyFail = true; };
  await page.goto(URL + (URL.includes('?') ? '&' : '?') + 'cb=' + Date.now(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.gdt?.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(600);

  const lay = await page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const cv = r(window.gdt._debug.canvas), b = r(document.getElementById('status-badge'));
    const out = [];
    for (const el of document.querySelectorAll('.hole-tag, .pattern-tag')) { const q = r(el); if (q.width && (q.left < cv.left - 1 || q.right > cv.right + 1 || q.top < cv.top - 1 || q.bottom > cv.bottom + 1)) out.push(el.textContent); }
    return { overflowX: document.documentElement.scrollWidth - innerWidth, badgeIn: b.left >= 0 && b.right <= innerWidth + 1 && b.top >= 0, canvasH: cv.height, canvasW: cv.width, off: out,
      minFont: Math.min(...[...document.querySelectorAll('.hole-tag, .tier, #pos-status')].map((e) => parseFloat(getComputedStyle(e).fontSize))) };
  });
  check('no horizontal page overflow', lay.overflowX <= 1, `${lay.overflowX}px`);
  check('verdict badge on screen', lay.badgeIn);
  check('3D view has a usable size', lay.canvasH >= 180 && lay.canvasW >= 300, `${lay.canvasW}x${lay.canvasH}`);
  check('hole / pattern tags inside the 3D view', !lay.off.length, lay.off.join(','));
  check('text >= 11px', lay.minFont >= 11, `${lay.minFont}px`);

  for (const [id, want] of Object.entries(EXPECT)) {
    const btn = page.locator(`[data-preset="${id}"]`);
    await btn.scrollIntoViewIfNeeded();
    await btn.tap();
    await page.waitForTimeout(120);
    const got = await page.evaluate(() => window.gdt.result().code);
    const badge = await page.evaluate(() => document.getElementById('status-badge').textContent);
    check(`tap ${id} -> ${want}`, got === want && badge.includes(want === 'PASS' ? 'PASS' : want === 'FAIL_UPPER' ? 'upper' : 'lower'), `${got} · ${badge.slice(0, 40)}`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);

  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i, radiusX: 4, radiusY: 4, force: 1 })) });
  async function drag1(x, y, dx, dy, steps = 8) {
    await touch('touchStart', [[x, y]]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x + (dx * i) / steps, y + (dy * i) / steps]]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(150);
  }
  const screenOf = (which) => page.evaluate((which) => {
    const g = window.gdt._debug, h = g.handles, cv = g.canvas.getBoundingClientRect();
    const o = which === 'move' ? h.move : which === 'rot' ? h.rot : h.per[1].mid;
    const v = o.position.clone().project(g.camera);
    return [cv.left + ((v.x + 1) / 2) * cv.width, cv.top + ((1 - v.y) / 2) * cv.height, cv.top, cv.bottom];
  }, which);
  const reset = async () => { await page.evaluate(() => window.gdt.applyPreset('P0-NOMINAL')); await page.waitForTimeout(150); };
  await reset();
  {
    const [x, y, t, b] = await screenOf('mid');
    const vis = y > t + 4 && y < b - 4;
    if (vis) await drag1(x, y, 30, 0);
    const l = await page.evaluate(() => window.gdt.state.local[1]);
    const ptx = await page.evaluate(() => window.gdt.state.pattern.tx);
    check('touch drag H2 slide sphere moves H2 only', vis && Math.abs(l[0]) > 0.005 && l[0] === l[2] && ptx === 0, `local ${l.map((v) => v.toFixed(3))}`);
  }
  await reset();
  {
    const [x, y, t, b] = await screenOf('move');
    if (y > t + 4 && y < b - 4) await drag1(x, y, 30, -10);
    const s = await page.evaluate(() => ({ p: window.gdt.state.pattern, lo: window.gdt.result().lo }));
    check('touch drag pattern sphere shifts all 4 (lower stays 0)', Math.hypot(s.p.tx, s.p.ty) > 0.005 && s.lo < 1e-6, `tx ${s.p.tx.toFixed(3)} ty ${s.p.ty.toFixed(3)} lo ${s.lo.toExponential(1)}`);
  }
  await reset();
  {
    const [x, y, t, b] = await screenOf('rot');
    if (y > t + 4 && y < b - 4) await drag1(x, y, -20, -60, 12);
    const s = await page.evaluate(() => ({ p: window.gdt.state.pattern, lo: window.gdt.result().lo }));
    check('touch drag rotate sphere turns the pattern (≤ 0.6°, lower stays 0)', Math.abs(s.p.deg) > 0.01 && Math.abs(s.p.deg) <= 0.6 && s.lo < 1e-5, `deg ${s.p.deg.toFixed(3)} lo ${s.lo.toExponential(1)}`);
  }
  await reset();
  {
    const before = await page.evaluate(() => window.gdt._debug.camera.position.toArray());
    const cv = await page.evaluate(() => { const r = window.gdt._debug.canvas.getBoundingClientRect(); return [r.left + r.width * 0.5, r.bottom - r.height * 0.1]; });
    await drag1(cv[0], cv[1], 40, -20);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.gdt._debug.camera.position.toArray());
    const st = await page.evaluate(() => JSON.stringify(window.gdt.state.local) + JSON.stringify(window.gdt.state.pattern));
    check('one-finger drag on empty space orbits (part unchanged)', Math.hypot(...before.map((v, i) => v - after[i])) > 0.5 && st === '[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]{"tx":0,"ty":0,"deg":0}');
  }
  await page.evaluate(() => window.gdt.setView('3d', { ms: 0 }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${slug(name)}-start.png` });
  if (name === 'iPhone 14') {
    await page.evaluate(() => { document.getElementById('panel').scrollTop = 0; window.scrollTo(0, 0); });
    for (const [id, file] of Object.entries(SHOTS)) {
      await page.evaluate((id) => window.gdt.applyPreset(id), id);
      await page.waitForTimeout(400);
      for (const v of ['3d', 'top']) {
        await page.evaluate((v) => window.gdt.setView(v, { ms: 0 }), v);
        await page.waitForTimeout(300);
        const path = `${OUT}/iphone-14-${file}-${v}.png`;
        await page.screenshot({ path });
        shots.push(path);
      }
    }
  }
  check('no console errors / warnings', !errors.length, errors.slice(0, 3).join(' | '));
  console.log(`\n${name}: ${checks.filter((c) => c.ok).length}/${checks.length}`);
  for (const c of checks) console.log(`  ${c.ok ? '✔' : '✘'} ${c.label}${c.detail ? `  (${c.detail})` : ''}`);
  await ctx.close();
}
console.log('\nscreenshots:', shots.join(' '));
await browser.close();
process.exit(anyFail ? 1 : 0);
