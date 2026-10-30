// Proof check (Sally): in the Virtual condition view the DRAWN hole wall touches the red VC
// object exactly when the clearance readout hits 0, at MMC and LMC; not early, not late.
// Reads the rendered geometry (world units) from the scene: VC cylinder radius + centre,
// bore (hole wall) radius, and the drawn axis ends (handles). Drawn gap (world) must equal
// clearance (mm) x the drawn magnification at each end, and be ~0 exactly at contact.
// Usage: URL=... TAG=... node scripts/vc-contact.mjs
import { chromium, devices } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
const URL = process.env.URL || 'https://stovebolt.github.io/gdt-trainer/preview/vc/';
const TAG = process.env.TAG || 'check';
const OUT = 'screenshots/mobile';
mkdirSync(OUT, { recursive: true });
const executablePath = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fail = false;
const ck = (l, ok, d) => { fail ||= !ok; console.log(`${ok ? '  OK  ' : '  FAIL'} ${l} — ${typeof d === 'string' ? d : JSON.stringify(d)}`); };

const measure = (page) => page.evaluate(() => {
  const g = window.gdt, r = g.result(), sc = g._debug.scene;
  let vc = null, bore = null;
  sc.traverse((o) => {
    if (o.name === 'vc' && !vc) o.traverse((m) => { if (!vc && m.isMesh && m.geometry?.parameters?.radiusTop) { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; vc = { R: m.geometry.parameters.radiusTop, seg: m.geometry.parameters.radialSegments, cx: (b.min.x + b.max.x) / 2, cy: (b.min.y + b.max.y) / 2 }; } });
    if (o.name === 'plate' && !bore) o.traverse((m) => { if (!bore && m.isMesh && m.geometry?.parameters?.radiusTop) bore = { R: m.geometry.parameters.radiusTop, seg: m.geometry.parameters.radialSegments }; });
  });
  const h = g._debug.handles;
  const ends = { bottom: [h.bottom.position.x, h.bottom.position.y], top: [h.top.position.x, h.top.position.y] };
  return { vc, bore, ends, vcMag: r.vcMag, kind: r.vc.kind, clear: r.vc.clearance, shown: document.getElementById('vc-clear').textContent, verdict: r.verdict };
});
// drawn gap at one end (world mm): MMC pin inside the hole: wallR − (d + Rv); LMC boundary outside: Rv − (d + wallR)
const gapAt = (m, end) => { const [x, y] = m.ends[end]; const d = Math.hypot(x - m.vc.cx, y - m.vc.cy); return m.kind === 'pin' ? m.bore.R - (d + m.vc.R) : m.vc.R - (d + m.bore.R); };

for (const [dev, ctx] of [['desktop-1280', { viewport: { width: 1280, height: 860 } }], ['iphone-14', devices['iPhone 14']]]) {
  console.log(`=== ${dev} ===`);
  const page = await (await browser.newContext(ctx)).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${URL}?cb=${Date.now()}`, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.gdt?.ready === true);
  for (const [mod, size] of [['MMC', 10.1], ['MMC', 10], ['MMC', 10.2], ['LMC', 10.05], ['LMC', 10.2], ['LMC', 10]]) {
    const R = await page.evaluate(([mod, size]) => { const g = window.gdt; g.setLock(false); g.setModifier(mod); g.setSize(size); g.setVcView(true); g.applyPreset('centered'); return g.result().vc.lockRadius; }, [mod, size]);
    for (const [what, dr] of [['contact', 0], ['+0.001 mm clearance', -0.001], ['−0.001 mm (crossing)', 0.001]]) {
      // put the TOP end on a diagonal at r = lockRadius + dr (exact, no lock clamping); bottom centred
      const r = Math.max(0, R + dr), a = 0.6;
      await page.evaluate(([dx, dy]) => window.gdt.setAxis({ bottom: { dx: 0, dy: 0 }, top: { dx, dy } }), [Math.round(r * Math.cos(a) * 1e9) / 1e9, Math.round(r * Math.sin(a) * 1e9) / 1e9]);
      await page.waitForTimeout(60);
      const m = await measure(page);
      const gT = gapAt(m, 'top'), want = m.clear.top * m.vcMag;
      const sag = m.vc.R * (1 - Math.cos(Math.PI / m.vc.seg)); // facet sag of the drawn 72-gon (display tolerance)
      const exact = Math.abs(gT - want) < 1e-5; // geometry is stored as float32 (~2e-6 at x≈35): 1e-5 world is far below one pixel
      const sign = what === 'contact' ? Math.abs(gT) < 1e-5 && m.clear.top >= -1e-9 && /clearance 0 mm/.test(m.shown) && m.verdict === 'IN'
        : dr < 0 ? gT > 0 && m.clear.top > 0 && m.verdict === 'IN' : gT < 0 && m.clear.top < 0 && m.verdict === 'OUT' && /crosses/.test(m.shown);
      ck(`${mod} ⌀${size} ${what}: drawn wall-to-VC gap = clearance × ${m.vcMag} (world), touches exactly at readout 0`, exact && sign,
        { drawnGapWorld: +gT.toFixed(7), clearanceMm: +m.clear.top.toFixed(7), x: m.vcMag, expectWorld: +want.toFixed(7), wallR: +m.bore.R.toFixed(5), vcR: m.vc.R, readout: m.shown, verdict: m.verdict, facetSag: +sag.toFixed(4) });
      if (what === 'contact' && dev === 'iphone-14' && size === (mod === 'MMC' ? 10.1 : 10.05)) {
        // close-up: top view, zoomed on the contact point
        await page.evaluate(() => window.gdt.setView('top', { ms: 0 })); await page.waitForTimeout(1500); // let any auto-reframe finish first
        await page.evaluate(([cx, cy]) => { const d = window.gdt._debug, c = d.camera, t = d.controls.target; const k = 14; c.position.x += cx - t.x; c.position.y += cy - t.y; t.set(cx, cy, t.z); c.zoom *= k; c.updateProjectionMatrix(); d.controls.update(); for (const h of Object.values(d.handles)) if (h?.isObject3D) h.visible = false; }, (() => { const [x, y] = m.ends.top; const d = Math.hypot(x - m.vc.cx, y - m.vc.cy); const ux = (x - m.vc.cx) / d, uy = (y - m.vc.cy) / d; const sgn = m.kind === 'pin' ? -1 : 1; /* MMC: the pin touches the wall on the side away from the offset; LMC: the wall touches the boundary on the offset side */ return [m.vc.cx + sgn * ux * m.vc.R, m.vc.cy + sgn * uy * m.vc.R]; })());
        await page.waitForTimeout(500);
        const p = `${OUT}/iphone-14-vc-contact-${mod.toLowerCase()}-${TAG}.png`;
        await page.screenshot({ path: p }); console.log(`        screenshot ${p} (top view ×14 zoom on the contact point (canvas centre); drag handles hidden for this shot only)`);
        await page.evaluate(() => { for (const h of Object.values(window.gdt._debug.handles)) if (h?.isObject3D) h.visible = true; window.gdt.setView('3d', { ms: 0 }); }); await page.waitForTimeout(300);
      }
    }
  }
  ck('no page errors', errs.length === 0, errs.join(' | '));
  await page.close();
}
await browser.close();
console.log(fail ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
