import { chromium } from 'playwright-core';
// Panel layout must not move when the verdict flips IN <-> OUT (also with a wider font).
const URL = process.env.URL || 'http://localhost:8123/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let ok = true;
for (const font of ['', 'DejaVu Sans, Verdana, sans-serif']) for (const width of [1280, 1440]) {
  const p = await b.newPage({ viewport: { width, height: 900 } }); const errs = [];
  p.on('console', (m) => ['error', 'warning'].includes(m.type()) && errs.push(m.text())); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL + '?v=' + Date.now()); await p.waitForFunction(() => window.gdt?.ready);
  if (font) await p.addStyleTag({ content: `.pos-line { font-family: ${font} !important; }` });
  const snap = () => p.evaluate(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => +v.toFixed(2)).join(','); };
    return { panel: r('#panel'), overall: r('.overall'), status: r('#pos-status'), line: r('.pos-line'), after: r('.pos-line + *'), text: document.getElementById('pos-status').textContent }; });
  const res = {};
  for (const [k, d] of [['in', 0.1249], ['out', 0.1251], ['in2', 0.05], ['out2', 0.2]]) { await p.evaluate((d) => window.gdt.setAxis({ top: { dx: d, dy: 0 }, bottom: { dx: d, dy: 0 } }), d); await p.waitForTimeout(100); res[k] = await snap(); }
  const keys = ['panel', 'overall', 'line', 'after'];
  const same = Object.values(res).every((s) => keys.every((k) => s[k] === res.in[k]));
  ok &&= same && !errs.length;
  console.log(width, font || 'default font', same ? 'STABLE' : 'JUMPS', JSON.stringify({ in: res.in.line, out: res.out.line, after_in: res.in.after, after_out: res.out.after, panel: res.in.panel }), 'errors', errs.length);
  await p.close();
}
await b.close(); process.exit(ok ? 0 : 1);
