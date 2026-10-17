// Single source of truth for the part / drawing spec (v1, frozen by the
// domain expert). Units: millimetres. Frame: origin at the A/B/C datum
// intersection, +X from datum B, +Y from datum C, +Z up out of datum A.
export const SPEC = Object.freeze({
  units: 'mm',
  plate: Object.freeze({ x: 100, y: 60, z: 10 }), // 100 x 60 x 10
  hole: Object.freeze({
    nominal: 10.1,
    plusMinus: 0.1, // ⌀10.1 ±0.1
    mmc: 10.0, // hole MMC = smallest size
    lmc: 10.2, // hole LMC = largest size
    sizeSlider: Object.freeze({ min: 9.95, max: 10.25, step: 0.01, default: 10.1 }),
  }),
  basic: Object.freeze({ fromB: 35, fromC: 30 }), // BASIC dimensions
  truePosition: Object.freeze({ x: 35, y: 30 }),
  position: Object.freeze({
    tolerance: 0.25, // ⌀ stated (default; editable in the UI), cylindrical zone
    modifier: 'RFS', // default material condition; 'MMC' adds bonus
    datums: Object.freeze(['A', 'B', 'C']),
  }),
});


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
  { id: 'tilt-in', label: 'Tilted ±0.1 (in)', bottom: { dx: -0.1, dy: 0 }, top: { dx: 0.1, dy: 0 } },
  { id: 'tilt-out', label: 'Tilted ±0.13 (out)', bottom: { dx: -0.13, dy: 0 }, top: { dx: 0.13, dy: 0 } },
  { id: 'edge-in', label: 'Shifted 0.125 (in, on boundary)', bottom: { dx: 0.125, dy: 0 }, top: { dx: 0.125, dy: 0 } },
  { id: 'edge-out', label: 'Shifted 0.126 (out)', bottom: { dx: 0.126, dy: 0 }, top: { dx: 0.126, dy: 0 } },
  // Sally's "2D trap": 0.10 in X and 0.10 in Y, no tilt -> r = 0.1414, position ⌀0.283 > ⌀0.25 (OUT at RFS)
  { id: 'diag-out', label: 'Diagonal (2D trap)', bottom: { dx: 0.1, dy: 0.1 }, top: { dx: 0.1, dy: 0.1 }, note: 'Inside the band in front and side views, but outside the round zone.' },
]);
