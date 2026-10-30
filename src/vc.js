// Virtual condition (VC) view (Sally). Pure math, no Three.js, no DOM.
//
// MMC: the VC is a perfect pin ⌀(MMC − stated), e.g. ⌀9.75. The hole wall may not
//      cross it: at each axis end, r + VC/2 <= d/2, i.e. r <= (d − VC)/2.
// LMC: the VC is a boundary ⌀(LMC + stated), e.g. ⌀10.45, the hole must stay inside:
//      r + d/2 <= VC/2, i.e. r <= (VC − d)/2. (Resultant ⌀(MMC − stated − (LMC − MMC)), ghost only.)
// RFS: no VC (the view is disabled).
// The VC centre is the true position, or the zone's best-fit centre when datums are dropped.
// Its size follows stated tolerance + modifier only, never the current hole size.
// Inside the size limits (d − VC)/2 = allowed/2 (MMC) and (VC − d)/2 = allowed/2 (LMC), so the
// VC view and the bonus-zone view can never disagree on IN / OUT. The boundary counts as IN.
import { allowedTolerance, EPS } from './tolerance.js';

export const VC_RFS_NOTE = 'Virtual condition applies at MMC or LMC.';

const floor3 = (v) => Math.floor(v * 1e3 + 1e-6) / 1e3;
const round3 = (v) => Math.round(v * 1e3) / 1e3;

/** VC size for a modifier (null at RFS). */
export function vcSize({ stated, modifier, mmc, lmc }) {
  if (modifier === 'MMC') return { kind: 'pin', vc: round3(mmc - stated), resultant: null };
  if (modifier === 'LMC') return { kind: 'boundary', vc: round3(lmc + stated), resultant: round3(mmc - (stated + (lmc - mmc))) };
  return null;
}

/** Lock radius per axis end: how far the axis may sit from the VC centre before the wall touches the VC. */
export function vcLockRadius({ stated, modifier, size, mmc, lmc }) {
  const s = vcSize({ stated, modifier, mmc, lmc });
  if (!s) return null;
  return s.kind === 'pin' ? (size - s.vc) / 2 : (s.vc - size) / 2;
}

/**
 * Full VC readout. rBottom / rTop: axis-end distances from the VC centre (same as the zone centre).
 * clearance (radial, mm) = lockRadius − r at each end; the smallest one is the leftover tolerance
 * (radial; ⌀ leftover = 2 × clearance). inside = both clearances >= 0 (boundary is IN).
 */
export function vcState({ stated, modifier, size, mmc, lmc, rBottom, rTop }) {
  const s = vcSize({ stated, modifier, mmc, lmc });
  if (!s) return { applies: false, note: VC_RFS_NOTE };
  const R = vcLockRadius({ stated, modifier, size, mmc, lmc });
  const cb = R - rBottom, ct = R - rTop;
  const min = Math.min(cb, ct);
  return {
    applies: true, ...s, lockRadius: R,
    clearance: { bottom: cb, top: ct, min },
    // conservative display: a clearance never shows larger than it is
    clearanceShown: floor3(min),
    leftoverDiameterShown: floor3(2 * min),
    inside: min >= -EPS,
    sizeOk: allowedTolerance({ stated, modifier, actualSize: size, mmc, lmc }).sizeOk,
  };
}

/**
 * Display exaggeration for the VC view: the wall-to-VC gap and the axis offsets are both drawn ×m,
 * so the picture touches exactly when the math does. The VC is drawn at true size; the wall at
 * VC/2 ± gap·m. m is capped so an LMC wall can't shrink below `minWall` (mm) over the whole size range.
 */
export function vcMagnification({ magnification, stated, modifier, mmc, lmc, sizeMin, sizeMax, minWall = 1.5, maxWall = 22 }) {
  const s = vcSize({ stated, modifier, mmc, lmc });
  if (!s) return magnification;
  const gapMax = s.kind === 'pin' ? (sizeMax - s.vc) / 2 : (s.vc - sizeMin) / 2;
  if (gapMax <= 0) return magnification;
  const cap = s.kind === 'pin' ? (maxWall - s.vc / 2) / gapMax : (s.vc / 2 - minWall) / gapMax;
  return Math.max(1, Math.min(magnification, Math.floor(cap)));
}

/** Drawn hole-wall radius in the VC view (VC at true size, gap ×m). */
export function vcWallRadius({ vc, kind, lockRadius, m }) {
  return kind === 'pin' ? vc / 2 + lockRadius * m : vc / 2 - lockRadius * m;
}
