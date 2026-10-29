// Explain-this-setup panel: picks the copy for the current datum configuration
// and material condition and builds the markup. Pure strings, no DOM, no verdict input:
// advice can never change IN / OUT.
import { datumFreedom } from './tolerance.js';
import { DATUM_COPY, MC_COPY, MC_ZERO, TAGS, UI_TEXT, STANDARD } from './explain-copy.js';

/** 'ABC' | 'AB' | 'AC' | 'A' | 'BC' | 'BorC' | 'none' (B only and C only share one entry). */
export function configKey(datums) {
  const kept = datumFreedom(datums).kept.join('');
  return kept === 'B' || kept === 'C' ? 'BorC' : kept === '' ? 'none' : kept;
}

const fill = (t, p) => t.replaceAll('{P}', p);

/** @returns {{key:string,label:string,controls:string,free:string,note:string,better:object[],mc:object[]}} */
export function explainFor(datums, modifier = 'RFS') {
  const key = configKey(datums);
  const c = DATUM_COPY[key];
  const kept = datumFreedom(datums).kept.join('');
  const p = key === 'BorC' ? kept : '';
  const line = (l) => ({ ...l, text: fill(l.text, p) });
  return {
    key,
    label: fill(c.label, p),
    controls: fill(c.controls, p),
    free: fill(c.free, p),
    note: fill(c.note, p),
    displayNote: c.displayNote ?? '',
    better: c.better.map(line),
    mc: [...(MC_COPY[modifier] ?? MC_COPY.RFS), MC_ZERO].map(line),
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One tagged line: [Rule]/[Practice] tag, text, and a small citation tag only when one is provided. */
export function lineHTML(l) {
  const tag = TAGS[l.type] ? `<span class="ex-tag ex-${l.type}">${TAGS[l.type]}</span>` : '';
  const cite = l.citation ? ` <span class="ex-cite">${esc(l.citation)}${l.clause ? ` ${esc(l.clause)}` : ''} · ${STANDARD}</span>` : '';
  return `<div class="ex-line ex-line-${l.type}">${tag}<span class="ex-text">${esc(l.text)}</span>${cite}</div>`;
}

export function explainHTML(ex, modifier = 'RFS') {
  const row = (name, text) => (text ? `<div class="ex-row"><b class="ex-h">${name}</b><span class="ex-text">${esc(text)}</span></div>` : '');
  return [
    row(UI_TEXT.controls, ex.controls),
    row(UI_TEXT.free, ex.free),
    ex.note ? `<div class="ex-note">${esc(ex.note)}</div>` : '',
    ex.displayNote ? `<div class="ex-display-note">${esc(ex.displayNote)}</div>` : '',
    `<div class="ex-sec"><b class="ex-h">${UI_TEXT.better}</b>${ex.better.map(lineHTML).join('')}</div>`,
    `<div class="ex-sec"><b class="ex-h">${UI_TEXT.mc}: ${modifier}</b>${ex.mc.map(lineHTML).join('')}</div>`,
    `<div class="ex-foot">${UI_TEXT.adviceOnly}</div>`,
  ].join('');
}
