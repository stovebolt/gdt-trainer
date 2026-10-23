// Panel layout must not move when the verdict changes (IN / OUT / REJECT: size),
// at RFS and at MMC, also with a wider font. The status slot must fit every status string.
import { chromium } from 'playwright-core';
const URL = process.env.URL || 'http://localhost:8123/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let ok = true;
const STATUS = ['IN TOLERANCE', 'OUT OF TOLERANCE', 'REJECT: size', 'INVALID: ⌀0 at RFS', 'NO DATUMS'];
for (const font of ['', 'DejaVu Sans, Verdana, sans-serif']) for (const width of [1280, 1440]) {
  const p = await b.newPage({ viewport: { width, height: 900 } }); const errs = [];
  p.on('console', (m) => ['error', 'warning'].includes(m.type()) && errs.push(m.text())); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL + '?v=' + Date.now()); await p.waitForFunction(() => window.gdt?.ready);
  if (font) await p.addStyleTag({ content: `.pos-line, .overall { font-family: ${font} !important; }` });
  const hasMMC = await p.evaluate(() => typeof window.gdt.setModifier === 'function');
  const snap = () => p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => +v.toFixed(2)).join(','); };
    return { panel: r('#panel'), overall: r('.overall'), line: r('.pos-line'), after: r('.pos-line + *'), next: r('.overall + section'), text: document.getElementById('pos-status').textContent }; });
  const set = (mod, size, dx) => p.evaluate(([mod, size, dx]) => { if (window.gdt.setModifier) { window.gdt.setModifier(mod); window.gdt.setSize(size); } window.gdt.setAxis({ top: { dx, dy: 0 }, bottom: { dx, dy: 0 } }); }, [mod, size, dx]);
  const keys = ['panel', 'overall', 'line', 'after', 'next'];
  const groups = hasMMC
    ? { RFS: [['in', 'RFS', 10.1, 0.1249], ['out', 'RFS', 10.1, 0.1251], ['reject', 'RFS', 10.21, 0], ['reject-lo', 'RFS', 9.99, 0.2]], MMC: [['in', 'MMC', 10.15, 0.1999], ['out', 'MMC', 10.15, 0.2001], ['reject', 'MMC', 10.21, 0], ['in-max', 'MMC', 10.2, 0.225]] }
    : { RFS: [['in', 'RFS', 0, 0.1249], ['out', 'RFS', 0, 0.1251]] };
  if (hasMMC) groups.LMC = [['in', 'LMC', 10.05, 0.1], ['out', 'LMC', 10.2, 0.13], ['reject', 'LMC', 10.22, 0.13], ['in-max', 'LMC', 10.0, 0.13]];
  if (hasMMC) groups.MMCvsLMC = [['mmc', 'MMC', 10.1, 0.1], ['lmc', 'LMC', 10.1, 0.1], ['rfs', 'RFS', 10.1, 0.1]];
  if (hasMMC) groups.RFSvsMMC = [['rfs', 'RFS', 10.1, 0.1], ['mmc', 'MMC', 10.1, 0.1], ['rfs-out', 'RFS', 10.15, 0.13], ['mmc-in', 'MMC', 10.15, 0.13]];
  for (const [g, states] of Object.entries(groups)) {
    const res = {};
    for (const [k, mod, size, dx] of states) { await set(mod, size, dx); await p.waitForTimeout(100); res[k] = await snap(); }
    const first = Object.values(res)[0];
    const same = Object.values(res).every((s) => keys.every((k) => s[k] === first[k]));
    ok &&= same;
    console.log(width, font || 'default font', g, same ? 'STABLE' : 'JUMPS', JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, `${v.text} line=${v.line} next=${v.next}`]))));
  }
  // datum states (A/B/C toggles): nothing in the panel moves between IN / OUT / NO DATUMS
  if (await p.evaluate(() => typeof window.gdt.setDatums === 'function')) {
    await p.evaluate(() => { window.gdt.setModifier('RFS'); window.gdt.setSize(10.1); window.gdt.setAxis({ bottom: { dx: 0.1, dy: 0.2 }, top: { dx: 0.1, dy: 0.2 } }); });
    const dk = [...keys, 'datums', 'afterDatums'];
    const dsnap = () => p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => +v.toFixed(2)).join(','); };
      return { panel: r('#panel'), overall: r('.overall'), line: r('.pos-line'), after: r('.pos-line + *'), next: r('.overall + section'), datums: r('#datums'), afterDatums: r('#datums + section'), text: document.getElementById('pos-status').textContent }; });
    const res = {};
    for (const [k, d] of Object.entries({ all: 'ABC', C: 'AB', B: 'AC', BC: 'A', A: 'BC', B_only: 'B', none: '' })) {
      await p.evaluate((d) => window.gdt.setDatums({ A: d.includes('A'), B: d.includes('B'), C: d.includes('C') }), d);
      await p.waitForTimeout(100); res[k] = await dsnap();
    }
    const first = Object.values(res)[0];
    const same = Object.values(res).every((s) => dk.every((k) => s[k] === first[k]));
    ok &&= same;
    console.log(width, font || 'default font', 'DATUMS', same ? 'STABLE' : 'JUMPS', JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, `${v.text} line=${v.line} datums=${v.datums} next=${v.afterDatums}`]))));
    await p.evaluate(() => window.gdt.setDatums({ A: true, B: true, C: true }));
  }
  // status slot fits every status string (measured in the live #pos-status font)
  const fit = await p.evaluate((list) => {
    const el = document.getElementById('pos-status'); const slot = el.getBoundingClientRect().width;
    const m = document.createElement('span'); const cs = getComputedStyle(el); m.style.cssText = `font:${cs.font};letter-spacing:${cs.letterSpacing};white-space:nowrap;position:absolute;visibility:hidden`;
    document.body.appendChild(m); const w = list.map((t) => { m.textContent = t; return [t, +m.getBoundingClientRect().width.toFixed(1)]; }); m.remove();
    return { slot: +slot.toFixed(1), w };
  }, STATUS);
  const fits = fit.w.every(([, w]) => w <= fit.slot + 0.5);
  ok &&= fits && !errs.length;
  console.log(width, font || 'default font', fits ? 'STATUS FITS' : 'STATUS TOO WIDE', JSON.stringify(fit), 'errors', errs.length);
  await p.close();
}
await b.close(); process.exit(ok ? 0 : 1);
