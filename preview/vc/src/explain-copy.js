// Copy for the "Explain this setup" panel. Text: Sally (explain-box-final.md, 2026-10-23), used verbatim.
// Edit THIS file to change wording; nothing else holds copy. Pure data, no DOM, no logic.
//
// Per datum configuration: controls / free (one line each), an optional note, and
// `better`: lines of advice or rule, each with
//   type     'rule' | 'practice'   (Practice = advice only, never a verdict)
//   citation topic name (shown as a small tag only when non-empty; topics, no clause numbers)
//   clause   clause number (left blank on purpose: not verified against the licensed text)
// "{P}" in the B-only / C-only entry stands for the one kept datum letter (B or C).

export const STANDARD = 'ASME Y14.5-2018';
export const TAGS = { rule: 'Rule', practice: 'Practice' };
export const CITATION_TOPICS = ['datum reference frame', 'order of precedence', 'basic dimensions', 'material condition modifiers'];

const R = (text, citation = '') => ({ type: 'rule', text, citation, clause: '' });
const P = (text, citation = '') => ({ type: 'practice', text, citation, clause: '' });

/** Keys: ABC | AB | AC | A | BC | BorC | none (see configKey in explain.js). */
export const DATUM_COPY = {
  ABC: {
    label: 'A | B | C',
    controls: 'X and Y location, axis square to A.',
    free: 'Nothing.',
    note: '',
    better: [R('Each datum stops the motions its contact blocks.', 'datum reference frame, order of precedence'), P('None, this is the complete frame.')],
  },
  AB: {
    label: 'A | B (C dropped)',
    controls: 'Axis square to A, X location.',
    free: 'Sliding in Y.',
    note: '',
    better: [R('A direction with no datum has nothing locating it.', 'datum reference frame'), P('Add C unless Y is free on purpose.')],
  },
  AC: {
    label: 'A | C (B dropped)',
    controls: 'Axis square to A, Y location.',
    free: 'Sliding in X.',
    note: '',
    better: [R('A direction with no datum has nothing locating it.', 'datum reference frame'), P('Add B unless X is free on purpose.')],
  },
  A: {
    label: 'A only (B and C dropped)',
    controls: 'Axis direction only.',
    free: 'X and Y.',
    note: '',
    better: [
      R('With no location datums, the basic dimensions locate nothing.', 'basic dimensions'),
      P('Use perpendicularity to A: it says what is controlled, while position implies a location that is not.'),
    ],
  },
  BC: {
    label: 'B | C (A dropped)',
    controls: 'X and Y location, axis held parallel to B and C (vertical).',
    free: 'Z (not visible on a through hole).',
    note: '',
    better: [
      R('The implied 90 degree relationship holds the axis to the referenced datums.', 'datum reference frame, order of precedence'),
      P('List A first: the hole is square to A and A gives a stable seat.'),
    ],
  },
  BorC: {
    label: '{P} only',
    controls: 'Location across {P}, axis parallel to {P}.',
    free: "Sliding along {P} and tilting about {P}'s normal.",
    note: 'Simplified, this lesson keeps the zone vertical.',
    better: [P('Add A first.')],
  },
  none: {
    label: 'No datums',
    controls: 'Position is undefined: nothing to measure the basic dimensions from. Gray, no IN/OUT.',
    free: '',
    note: '',
    better: [P('Reference at least A, and B and C to locate.')],
  },
};

/** Material condition lines (same frame). The zero-tolerance rule shows with every one. */
export const MC_COPY = {
  RFS: [R('Tolerance fixed at stated value.', 'material condition modifiers')],
  MMC: [R('Bonus = size minus smallest hole.', 'material condition modifiers'), P('Use for clearance fits, protects assembly.')],
  LMC: [R('Bonus = largest hole minus size.', 'material condition modifiers'), P('Use to protect wall thickness.')],
};
export const MC_ZERO = R('Zero tolerance only at MMC/LMC.', 'material condition modifiers');

export const UI_TEXT = {
  title: 'Explain this setup',
  controls: 'Controls',
  free: 'Free',
  better: 'Better way',
  mc: 'Material condition',
  adviceOnly: 'Practice lines are advice only: they never change IN / OUT.',
};
