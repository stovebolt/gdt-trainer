// Lesson 2 explainer copy: Sally's spec.md §7, used verbatim. Citations are topic names
// only (no clause numbers). Edit THIS file to change wording. Pure data.
export const STANDARD = 'ASME Y14.5-2018';
const R = (text, ...citations) => ({ type: 'rule', text, citations });
const P = (text) => ({ type: 'practice', text, citations: [] });
const N = (text) => ({ type: 'note', text, citations: [] });
// Citation topics (Sally, 2026-10-30): topic names only, each shown with "· ASME Y14.5-2018".
export const TOPICS = Object.freeze({
  PLZ: 'Composite position: pattern-locating zones (upper line)',
  FRZ: 'Composite position: feature-relating zones (lower line)',
  DRF: 'Datum reference frame',
  BASIC: 'Basic dimensions',
});
const { PLZ, FRZ, DRF, BASIC } = TOPICS;
export const EXPLAIN = Object.freeze([
  R('A composite position frame has one position symbol over two rows. The upper row locates the pattern to the datums; the lower row controls the holes relative to each other.', PLZ, FRZ),
  R('The upper-row zones (Ø0.50) are fixed at the true positions set by the basic dimensions from A, B and C.', PLZ, BASIC),
  R("In a composite frame, datums in the lower row only orient the zones; they never locate them. Here the lower row's A keeps the Ø0.10 zones square to A.", FRZ, DRF),
  R('The four Ø0.10 zones keep their basic 50 × 30 spacing as a rigid set, but the set may shift and rotate as a unit.', FRZ),
  R('Each hole axis must lie in its Ø0.50 zone and in its Ø0.10 zone at the same time, with one placement of the Ø0.10 set for all holes.', PLZ, FRZ),
  R('Lower-row datums must repeat the upper-row datums in the same order, starting from the first.', FRZ, DRF),
  P("Composite position is used when the pattern's location to the part can be loose but the holes must match a mating part's pattern closely, for example a bolt pattern."),
  P("The small zones don't have to sit inside the big ones; only the axes must be in both."),
  N("The slide limit here is only the lesson's drag range. It is not a tolerance."),
  N('The blue zones are drawn at their best-fit placement.'),
]);
/** Plain-text list for review: tag, text, citations. */
export const explainText = () => EXPLAIN.map((l, i) => `${i + 1}. [${l.type === 'rule' ? 'Rule' : l.type === 'practice' ? 'Practice' : 'Trainer note, untagged'}] ${l.text}\n   Citation: ${l.citations.length ? l.citations.map((c) => `${c} · ${STANDARD}`).join(' | ') : 'none'}`).join('\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function explainHTML() {
  const line = (l) => l.type === 'note'
    ? `<div class="ex-display-note">${esc(l.text)}</div>`
    : `<div class="ex-line ex-line-${l.type}"><span class="ex-tag ex-${l.type}">${l.type === 'rule' ? 'Rule' : 'Practice'}</span><span class="ex-text">${esc(l.text)}</span>${l.citations.map((c) => ` <span class="ex-cite">${esc(c)} · ${STANDARD}</span>`).join('')}</div>`;
  return `<div class="ex-sec">${EXPLAIN.map(line).join('')}</div><div class="ex-foot">Advice and rules only: they never change PASS / FAIL.</div>`;
}
export const POS_SYM = '<svg class="possym" viewBox="-10 -10 20 20" aria-label="position"><circle r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M-9 0H9M0 -9V9" stroke="currentColor" stroke-width="2"/></svg>';
/** Composite FCF: one position symbol spanning two rows. */
export const fcfHTML = (cls = 'fcf') => `<table class="${cls} fcf-composite" aria-label="Composite position frame: upper diameter 0.50 to A B C, lower diameter 0.10 to A"><tr><td class="sym" rowspan="2">${POS_SYM}</td><td class="tol up">⌀0.50</td><td>A</td><td>B</td><td>C</td></tr><tr><td class="tol lo">⌀0.10</td><td>A</td><td class="empty" colspan="2"></td></tr></table>`;
