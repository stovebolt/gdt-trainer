import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configKey, explainFor, explainHTML, lineHTML } from '../src/explain.js';
import { DATUM_COPY, MC_COPY, MC_ZERO, TAGS, CITATION_TOPICS } from '../src/explain-copy.js';
import { evaluatePart } from '../src/tolerance.js';

const combos = [];
for (const A of [true, false]) for (const B of [true, false]) for (const C of [true, false]) combos.push({ A, B, C });

test('every one of the 8 A/B/C combinations maps to copy (B only and C only share one entry)', () => {
  const keys = new Set();
  for (const d of combos) {
    const k = configKey(d);
    assert.ok(DATUM_COPY[k], `${JSON.stringify(d)} -> ${k}`);
    keys.add(k);
    for (const m of ['RFS', 'MMC', 'LMC']) {
      const ex = explainFor(d, m);
      assert.ok(ex.controls.length > 0 && ex.label.length > 0 && ex.better.length > 0 && ex.mc.length >= 2);
      assert.ok(!JSON.stringify(ex).includes('{P}'), 'no unfilled placeholder');
    }
  }
  assert.deepEqual([...keys].sort(), ['A', 'AB', 'AC', 'ABC', 'BC', 'BorC', 'none'].sort());
  assert.equal(Object.keys(DATUM_COPY).length, 7);
  assert.equal(configKey({ A: false, B: true, C: false }), configKey({ A: false, B: false, C: true }));
  assert.equal(configKey({ A: true, B: true, C: false }), 'AB'); // A kept: B only is "AB"
});

test('every copy line has a valid type; citations are topic names only; clause numbers blank', () => {
  const lines = [...Object.values(DATUM_COPY).flatMap((c) => c.better), ...Object.values(MC_COPY).flat(), MC_ZERO];
  for (const l of lines) {
    assert.ok(l.type in TAGS, l.text);
    assert.ok(l.text.length > 0);
    assert.equal(l.clause, '', 'clause numbers left blank');
    if (l.citation) { assert.ok(CITATION_TOPICS.includes(l.citation), l.citation); assert.ok(!/\d/.test(l.citation), 'no clause numbers'); }
    if (l.type === 'practice') assert.equal(l.citation, '', 'advice is never cited like a rule');
  }
  for (const m of ['RFS', 'MMC', 'LMC']) assert.ok(MC_COPY[m].some((l) => l.type === 'rule'));
});

test("Sally's text is used verbatim (spot checks)", () => {
  assert.equal(DATUM_COPY.ABC.controls, 'X and Y location, axis square to A.');
  assert.equal(DATUM_COPY.AB.free, 'Sliding in Y.');
  assert.equal(DATUM_COPY.AC.better[1].text, 'Add B unless X is free on purpose.');
  assert.equal(DATUM_COPY.A.better[1].text, 'Use perpendicularity to A: it says what is controlled, while position implies a location that is not.');
  assert.equal(DATUM_COPY.BC.free, 'Z (not visible on a through hole).');
  assert.equal(DATUM_COPY.none.better[0].text, 'Reference at least A, and B and C to locate.');
  const b = explainFor({ A: false, B: true, C: false }), c = explainFor({ A: false, B: false, C: true });
  assert.equal(b.free, "Sliding along B and tilting about B's normal.");
  assert.equal(c.free, "Sliding along C and tilting about C's normal.");
  assert.equal(b.note, 'Simplified, this lesson keeps the zone vertical.');
  assert.equal(c.better[0].text, 'Add A first.');
  assert.equal(explainFor({}, 'MMC').mc[0].text, 'Bonus = size minus smallest hole.');
  assert.equal(explainFor({}, 'LMC').mc[0].text, 'Bonus = largest hole minus size.');
  assert.equal(explainFor({}, 'RFS').mc.at(-1).text, 'Zero tolerance only at MMC/LMC.');
});

test('tags: citation tag only when provided; Practice never styled as a rule', () => {
  const rule = lineHTML({ type: 'rule', text: 't', citation: 'basic dimensions', clause: '' });
  const bare = lineHTML({ type: 'rule', text: 't', citation: '', clause: '' });
  const prac = lineHTML({ type: 'practice', text: 't', citation: '', clause: '' });
  assert.match(rule, /ex-cite">basic dimensions · ASME Y14\.5-2018</);
  assert.ok(!/ex-cite/.test(bare) && !/ex-cite/.test(prac));
  assert.match(prac, /ex-tag ex-practice">Practice</);
  assert.ok(!/ex-rule/.test(prac) && !/ex-tag ex-practice/.test(rule));
  assert.match(lineHTML({ type: 'rule', text: 't', citation: 'x', clause: '4.2' }), /x 4\.2 · ASME/); // shown only when filled in
});

test('advice never changes IN/OUT: the explainer takes no result and the verdict ignores it', () => {
  assert.equal(explainFor.length <= 2, true);
  const base = { truePosition: { x: 35, y: 30 }, bottom: { x: 35.2, y: 30 }, top: { x: 35.2, y: 30 }, thickness: 10, stated: 0.25, modifier: 'RFS', actualSize: 10.1, mmc: 10, lmc: 10.2 };
  const before = evaluatePart(base).verdict;
  explainHTML(explainFor({ A: true, B: false, C: true }), 'RFS');
  assert.equal(evaluatePart(base).verdict, before);
});

test('markup includes Controls / Free / Better way and the advice-only footer', () => {
  const h = explainHTML(explainFor({ A: true, B: true, C: false }, 'MMC'), 'MMC');
  for (const s of ['Controls', 'Free', 'Better way', 'Material condition: MMC', 'advice only', 'Add C unless Y is free on purpose.']) assert.ok(h.includes(s), s);
  assert.ok(!explainHTML(explainFor({ A: true, B: true, C: true })).includes('class="ex-note"'));
  assert.ok(explainHTML(explainFor({ A: false, B: false, C: true })).includes('Simplified, this lesson keeps the zone vertical.'));
});
