// Lesson 2 view settings and Sally's named presets (spec §6). Units: mm.
import { patternMove, oneHole, perp, ZERO } from './composite.js';

export const VIEW = Object.freeze({
  defaultMagnification: 24,
  minMagnification: 1,
  maxMagnification: 80,
  maxDeviation: 0.4, // drag range per endpoint / pattern shift, mm (Lesson 1)
  maxRotationDeg: 0.6, // pattern-rotation drag range (spec §3.7, Tim)
});

// State model: pattern { tx, ty, deg } (rigid move about (50, 30)) + per-hole local
// endpoint offsets [dxb, dyb, dxt, dyt]. Presets are given as that model; preset
// endpoints equal Sally's §6 table exactly (checked in tests).
const P = (id, label, pattern, local, note = '') => ({ id, label, pattern, local, note });
export const PRESETS = Object.freeze([
  P('P0-NOMINAL', 'P0 Nominal', { tx: 0, ty: 0, deg: 0 }, [ZERO, ZERO, ZERO, ZERO]),
  P('P1-AHA-SHIFT', 'P1 Pattern shifted 0.2', { tx: 0.12, ty: 0.16, deg: 0 }, [ZERO, ZERO, ZERO, ZERO], 'Off the datums by 0.20, perfect to each other.'),
  P('P2-AHA-ROTATE', 'P2 Pattern rotated 0.2°', { tx: 0, ty: 0, deg: 0.2 }, [ZERO, ZERO, ZERO, ZERO], 'Corners move 0.102. Rotation is free in the lower row.'),
  P('P3-PATTERN-OUT', 'P3 Pattern out (0.18, 0.24)', { tx: 0.18, ty: 0.24, deg: 0 }, [ZERO, ZERO, ZERO, ZERO], "Perfect spacing does not save a pattern that's too far from the datums."),
  P('P4-ONE-HOLE-OUT', 'P4 One hole off 0.2', { tx: 0, ty: 0, deg: 0 }, oneHole(perp([0.2, 0])), 'Well inside the big zone, but too far from its neighbours.'),
  P('P5-TILT-LEAN', 'P5 One hole leans 0.12', { tx: 0, ty: 0, deg: 0 }, oneHole([0, 0, 0.12, 0]), 'No shift or rotation fixes a lean, because the small zones stay ⟂ A.'),
]);
// Extra (not a spec preset): the Lesson 1 diagonal trap on the whole pattern, EC6.
export const EXTRA_PRESETS = Object.freeze([
  P('EC6-DIAGONAL', 'Diagonal shift (0.2, 0.2)', { tx: 0.2, ty: 0.2, deg: 0 }, [ZERO, ZERO, ZERO, ZERO], 'Each component ≤ 0.25, but radial 0.283: the diagonal trap again.'),
]);
void patternMove;
