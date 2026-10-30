// Lesson 2 panel must not move when the verdict changes (PASS / FAIL_UPPER / FAIL_LOWER /
// FAIL_BOTH / REJECT: size), also with a wider font; the status slot fits every status string.
import { chromium } from 'playwright-core';
const URL = process.env.URL || 'http://localhost:8131/composite/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let ok = true;
const STATES = [
  ['P0', (g) => g.applyPreset('P0-NOMINAL')], ['P1', (g) => g.applyPreset('P1-AHA-SHIFT')], ['P2', (g) => g.applyPreset('P2-AHA-ROTATE')],
  ['P3', (g) => g.applyPreset('P3-PATTERN-OUT')], ['P4', (g) => g.applyPreset('P4-ONE-HOLE-OUT')], ['P5', (g) => g.applyPreset('P5-TILT-LEAN')],
  ['diag', (g) => g.applyPreset('EC6-DIAGONAL')], ['both', (g) => { g.applyPreset('P0-NOMINAL'); g.setHole(0, [0.3, 0, 0.3, 0]); }],
  ['all-lean', (g) => { g.applyPreset('P0-NOMINAL'); for (let i = 0; i < 4; i++) g.setHole(i, [0, 0, 0.12, 0]); }],
  ['reject', (g) => { g.applyPreset('P4-ONE-HOLE-OUT'); g.setSize(10.25, 2); }], ['rot-neg', (g) => g.setPattern({ tx: -0.4, ty: -0.4, deg: -0.6 })],
];
for (const font of ['', 'DejaVu Sans, Verdana, sans-serif']) for (const width of [1280, 1440]) {
  const p = await b.newPage({ viewport: { width, height: 900 } }); const errs = [];
  p.on('console', (m) => ['error', 'warning'].includes(m.type()) && errs.push(m.text())); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL + '?v=' + Date.now()); await p.waitForFunction(() => window.gdt?.ready);
  if (font) await p.addStyleTag({ content: `#panel { font-family: ${font} !important; }` });
  const snap = () => p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const q = e.getBoundingClientRect(); return [q.x, q.y, q.width, q.height].map((v) => +v.toFixed(2)).join(','); };
    return { panel: r('#panel'), overall: r('.overall'), line: r('.pos-line'), up: r('#tier-up'), lo: r('#tier-lo'), fail: r('#fail-line'), fit: r('#fit-line'), next: r('.overall + section'), table: r('.readout.holes'), presets: r('.presets'), text: document.getElementById('pos-status').textContent }; });
  const res = {};
  for (const [k, f] of STATES) { await p.evaluate(`(${f.toString()})(window.gdt)`); await p.waitForTimeout(80); res[k] = await snap(); }
  const keys = ['panel', 'overall', 'line', 'up', 'lo', 'fail', 'fit', 'next', 'table', 'presets'];
  const first = res.P0;
  const bad = Object.entries(res).flatMap(([k, s]) => keys.filter((q) => s[q] !== first[q]).map((q) => `${k}.${q}`));
  ok &&= !bad.length;
  console.log(width, font || 'default font', bad.length ? `JUMPS ${bad.join(' ')}` : 'STABLE', Object.values(res).map((v) => v.text).join(' | '));
  const fit = await p.evaluate(() => {
    const list = ['PASS', 'FAIL: upper row', 'FAIL: lower row', 'FAIL: both rows', 'REJECT: size'];
    const el = document.getElementById('pos-status'); const slot = el.getBoundingClientRect().width;
    const m = document.createElement('span'); const cs = getComputedStyle(el); m.style.cssText = `font:${cs.font};white-space:nowrap;position:absolute;visibility:hidden`;
    document.body.appendChild(m); const w = list.map((t) => { m.textContent = t; return m.getBoundingClientRect().width; }); m.remove();
    return { slot, max: Math.max(...w) };
  });
  ok &&= fit.max <= fit.slot + 0.5 && !errs.length;
  console.log(width, font || 'default font', fit.max <= fit.slot + 0.5 ? 'STATUS FITS' : 'STATUS TOO WIDE', JSON.stringify(fit), 'errors', errs.length);
  await p.close();
}
await b.close(); process.exit(ok ? 0 : 1);
