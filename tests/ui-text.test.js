import { test } from 'node:test';
import assert from 'node:assert/strict';
// ui.js touches the DOM only inside createUI(), so its constants import cleanly in node.
import { ZERO_REASON, STATUS, sizeNote } from '../src/ui.js';

test("refusing ⌀0 at RFS shows Sally's reason line", () => {
  assert.equal(ZERO_REASON, '⌀0 is only meaningful at MMC or LMC, where bonus supplies the tolerance.');
});

test('status strings and metric size note', () => {
  assert.equal(STATUS.REJECT_SIZE, 'REJECT: size');
  assert.equal(sizeNote({ sizeOk: true, actualSize: 10.15 }), 'Hole size ⌀10.15 ✔ within ⌀10–10.2');
  assert.equal(sizeNote({ sizeOk: false, actualSize: 10.22 }), 'Hole size ⌀10.22 ✘ outside ⌀10–10.2');
});
