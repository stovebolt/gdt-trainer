// Feature control frame markup (panel, phone chip, 3D drawing). Pure strings, no DOM.
import { SPEC } from './config.js';

import { fmt, fmtSigned } from './format.js';
import { datumFreedom } from './tolerance.js';

/** Drawing-style number: metric, at most 3 decimals, trailing zeros dropped (0.25, 0.4, 9.75). */
export const fmtNote = fmt;

const POS_SYM = '<svg class="possym" viewBox="-10 -10 20 20" aria-label="position"><circle r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M-9 0H9M0 -9V9" stroke="currentColor" stroke-width="2"/></svg>';
// Circled M drawn as SVG (no font dependency for the Ⓜ glyph).
export const MMC_SYM = '<svg class="mmcsym" viewBox="-10 -10 20 20" role="img" aria-label="MMC"><circle r="8.6" fill="none" stroke="currentColor" stroke-width="1.7"/><text x="0" y="4.3" text-anchor="middle" font-size="12.5" font-weight="800" font-family="system-ui, Arial, sans-serif" fill="currentColor">M</text></svg>';

/** <table class="fcf ..."> ⊕ | ⌀stated [Ⓜ] | A | B | C </table> */
export const LMC_SYM = MMC_SYM.replace('aria-label="MMC"', 'aria-label="LMC"').replace('>M</text>', '>L</text>');
export const modSym = (m) => (m === 'MMC' ? MMC_SYM : m === 'LMC' ? LMC_SYM : '');
export function fcfHTML({ stated, modifier, datums }, cls = 'fcf') {
  // dropped datum references disappear from the frame (datums: {A,B,C} booleans; default all kept)
  const kept = SPEC.position.datums.filter((d) => !datums || datums[d] !== false);
  const tol = `⌀${fmtNote(stated)}${modSym(modifier)}`;
  return `<table class="${cls}" data-modifier="${modifier}" data-datums="${kept.join('')}"><tr><td class="sym">${POS_SYM}</td><td class="tol">${tol}</td>${kept.map((d) => `<td>${d}</td>`).join('')}</tr></table>`;
}

// ---------------------------------------------------------------------------
// Datum-reference wording (panel notes, 3D badge). Pure strings.
// ---------------------------------------------------------------------------
export const DATUM_NOTES = {
  aDropped: 'Dropping A alone changes nothing visible here.',
  perp: 'A only: the zone slides in X and Y but stays ⟂ A, so it acts like a perpendicularity control.',
  floats: 'No datums: the zone floats free, so for a single hole this control means nothing.',
};
const axes = (f) => [f.freeX && 'X', f.freeY && 'Y'].filter(Boolean).join(' and ');

/**
 * @param {{A?:boolean,B?:boolean,C?:boolean}} datums
 * @param {{dx:number,dy:number}} [zone] slid zone centre (mm from true position)
 * @returns {{dropped:string[], badge:string, slide:string, note:string, freedom:object}}
 *   badge: short 3D-view label ('' when nothing dropped); slide: one panel line; note: one teaching note.
 */
export function datumSummary(datums, zone = { dx: 0, dy: 0 }) {
  const f = datumFreedom(datums);
  const dropped = ['A', 'B', 'C'].filter((k) => !f[k]);
  const list = dropped.join(', ');
  let badge = '', slide = '', note = '';
  if (dropped.length) badge = f.floats ? `${list} dropped: zone floats free` : f.slides ? `${list} dropped: zone slides in ${axes(f)}` : `${list} dropped: no visible change`;
  if (f.floats) { slide = 'zone floats free · no datums'; note = DATUM_NOTES.floats; }
  else if (f.slides) {
    const c = [f.freeX && `dx ${fmtSigned(zone.dx)}`, f.freeY && `dy ${fmtSigned(zone.dy)}`].filter(Boolean).join(', ');
    slide = `zone slides in ${axes(f)} · centre ${c}`;
    if (f.perpOnly) note = DATUM_NOTES.perp;
  }
  if (f.aDropped && !f.slides) note = DATUM_NOTES.aDropped;
  else if (f.aDropped) note = ''; // A dropped together with B or C: slide line already says it (A's own drop is not visible)
  return { dropped, badge, slide, note, freedom: f };
}
