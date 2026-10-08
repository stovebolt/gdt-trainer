// Single source of truth for the part / drawing spec (v1, frozen by the
// domain expert). Units: millimetres. Frame: origin at the A/B/C datum
// intersection, +X from datum B, +Y from datum C, +Z up out of datum A.
export const SPEC = Object.freeze({
  units: 'mm',
  plate: Object.freeze({ x: 100, y: 60, z: 10 }), // 100 x 60 x 10
  hole: Object.freeze({
    nominal: 10.1,
    plusMinus: 0.1, // ⌀10.1 ±0.1 — label only in v1 (no size check, no MMC)
  }),
  basic: Object.freeze({ fromB: 35, fromC: 30 }), // BASIC dimensions
  truePosition: Object.freeze({ x: 35, y: 30 }),
  position: Object.freeze({
    tolerance: 0.25, // ⌀ — cylindrical zone diameter, RFS
    datums: Object.freeze(['A', 'B', 'C']),
  }),
});

// Shown next to every verdict: v1 does not check hole size.
export const SIZE_NOTE = 'Hole size assumed within ⌀10.0–10.2 (size not checked in this demo)';

// Display-only exaggeration of deviations and zone size (see ZONE.md §5).
export const VIEW = Object.freeze({
  defaultMagnification: 24,
  minMagnification: 1,
  maxMagnification: 80,
  maxDeviation: 0.4, // slider / drag limit for each endpoint offset, mm
});

// Named presets (offsets from true position, mm). The first two plus the
// boundary cases mirror the expert's required test cases.
export const PRESETS = Object.freeze([
  { id: 'centered', label: 'Centered (in)', bottom: { dx: 0, dy: 0 }, top: { dx: 0, dy: 0 } },
  { id: 'tilt-in', label: 'Tilted ±0.1000 (in)', bottom: { dx: -0.1, dy: 0 }, top: { dx: 0.1, dy: 0 } },
  { id: 'tilt-out', label: 'Tilted ±0.1300 (out)', bottom: { dx: -0.13, dy: 0 }, top: { dx: 0.13, dy: 0 } },
  { id: 'edge-in', label: 'Shifted 0.1250 (in, on boundary)', bottom: { dx: 0.125, dy: 0 }, top: { dx: 0.125, dy: 0 } },
  { id: 'edge-out', label: 'Shifted 0.1260 (out)', bottom: { dx: 0.126, dy: 0 }, top: { dx: 0.126, dy: 0 } },
  { id: 'diag-out', label: 'X 0.1000 + Y 0.1000 (out)', bottom: { dx: 0.1, dy: 0.1 }, top: { dx: 0.1, dy: 0.1 } },
]);
