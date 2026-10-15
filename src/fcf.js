// Feature control frame markup (panel, phone chip, 3D drawing). Pure strings, no DOM.
import { SPEC } from './config.js';

/** Drawing-style number: 4 decimals with trailing zeros trimmed, at least 2 (0.25, 0.4, 9.8766 -> "0.25", "0.40", "9.8766"). */
export function fmtNote(v) {
  let s = Math.abs(v).toFixed(4);
  while (s.endsWith('0') && s.split('.')[1].length > 2) s = s.slice(0, -1);
  return s;
}

const POS_SYM = '<svg class="possym" viewBox="-10 -10 20 20" aria-label="position"><circle r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M-9 0H9M0 -9V9" stroke="currentColor" stroke-width="2"/></svg>';
// Circled M drawn as SVG (no font dependency for the Ⓜ glyph).
export const MMC_SYM = '<svg class="mmcsym" viewBox="-10 -10 20 20" role="img" aria-label="MMC"><circle r="8.6" fill="none" stroke="currentColor" stroke-width="1.7"/><text x="0" y="4.3" text-anchor="middle" font-size="12.5" font-weight="800" font-family="system-ui, Arial, sans-serif" fill="currentColor">M</text></svg>';

/** <table class="fcf ..."> ⊕ | ⌀stated [Ⓜ] | A | B | C </table> */
export function fcfHTML({ stated, modifier }, cls = 'fcf') {
  const tol = `⌀${fmtNote(stated)}${modifier === 'MMC' ? MMC_SYM : ''}`;
  return `<table class="${cls}" data-modifier="${modifier}"><tr><td class="sym">${POS_SYM}</td><td class="tol">${tol}</td>${SPEC.position.datums.map((d) => `<td>${d}</td>`).join('')}</tr></table>`;
}
