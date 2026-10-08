# How the position tolerance zone is generated and checked

This document is for the GD&T domain expert. It says exactly what the viewer
computes, so the math can be checked against the drawing intent. All IN/OUT
decisions come from `src/tolerance.js`, which is pure JavaScript with unit
tests in `tests/tolerance.test.js`. The 3D scene only displays that result.

## 1. Spec implemented (v1, frozen)

- **Units:** millimetres.
- **Part:** plate 100 (X) × 60 (Y) × 10 (Z).
- **Datum reference frame:** primary **A** = bottom face (z = 0), secondary
  **B** = left edge (x = 0), tertiary **C** = front edge (y = 0). The origin is
  at the A/B/C intersection, X runs from B, Y from C, and **+Z points up out of A**.
- **Feature:** through hole ⌀10.1 ±0.1. The size is shown as a label only.
  There is no size check in v1.
- **Location:** **BASIC 35** from B and **BASIC 30** from C, so the
  **true position (TP) = (35, 30)**.
- **Feature control frame:** `⌖ | ⌀0.25 | A | B | C`, regardless of feature
  size (RFS). **No MMC and no bonus tolerance in v1.**
- **Zone:** a fixed cylinder of diameter **⌀0.25** (radius 0.125). Its axis is
  the TP axis: through (35, 30) and **perpendicular to A**. It runs from
  **z = 0 to z = 10**, the full length (thickness) of the feature.

## 2. How the zone is generated

| Property | Value | Where it comes from |
|---|---|---|
| Shape | right circular cylinder | the ⌀ symbol in the FCF makes the zone cylindrical |
| Axis | the line x = 35, y = 30 (parallel to Z) | basic dimensions from B and C; perpendicular to primary datum A |
| Diameter | 0.25 | the tolerance value in the FCF |
| Length | z = 0 … 10 | the zone covers the full length of the feature (plate thickness) |
| Size or position change with the hole? | no | RFS, so the zone is fixed |

In code, the zone is `{ truePosition: {x:35, y:30}, tolerance: 0.25 }` plus
the thickness `10` (`src/config.js` → `SPEC`). In the scene it is drawn by
`buildZone()` in `src/viewer/scene.js` as a translucent cylinder with bold
end circles at z = 0 and z = 10.

These are the general principles from ASME Y14.5-2018 that this follows (in
general terms, with no clause citations):
1. Basic dimensions define the exact theoretical (true) position relative to the datum reference frame.
2. A diameter symbol before a position tolerance makes the zone cylindrical, with diameter equal to the tolerance value.
3. The zone is located at true position and oriented by the datum reference frame. Here that means perpendicular to primary datum A.
4. The zone extends through the full length of the feature unless something else is specified, such as a projected tolerance zone.
5. The feature's axis must lie entirely within the zone.

## 3. The actual axis model

The actual hole axis is modelled as a **straight line**. The state stores the
two points where that line crosses the zone's end planes:

- **bottom endpoint** `B = (35 + dxB, 30 + dyB)` at z = 0
- **top endpoint** `T = (35 + dxT, 30 + dyT)` at z = 10

Moving both endpoints by the same amount is a pure lateral shift. Moving them
differently tilts the axis, with tilt angle `atan(|T − B| / 10)`. The function
`crossingsAtZ(p, q, 0, 10)` gives these crossings for any non-horizontal 3D
line, so a measured axis in another form (for example a point plus a
direction) can be converted to B and T the same way.

## 4. The IN/OUT check (endpoint test)

For each endpoint E ∈ {B, T}:

```
dx = E.x − 35          dy = E.y − 30
r  = sqrt(dx² + dy²)                    radial offset from the TP axis (mm)
2r                                      the same value as a positional DIAMETER (mm)
endpoint PASS  ⇔  r ≤ 0.125   (equivalently 2r ≤ 0.25)     boundary inclusive
```

Overall:

```
IN   ⇔  r_B ≤ 0.125  AND  r_T ≤ 0.125
position (reported) = 2 × max(r_B, r_T)          ← a DIAMETER, compared to ⌀0.25
margin              = 0.25 − position             (> 0 inside, < 0 outside)
```

**Why checking only the two endpoints is enough.** The zone is a cylinder
(convex), and its axis is parallel to Z, so each z-slice is the same disc of
radius 0.125 centred on TP. The actual axis is a straight segment, so at any
height z its offset from TP is a linear interpolation between the bottom and
top offsets. Distance from TP is a convex function of that offset, so on the
segment it is largest at one of the two ends. If both ends are inside, every
point between them is inside. If either end is outside, part of the axis is
outside. **Checking only the midpoint (or the average location) would be
wrong.** The required test "Tilted ±0.13" shows this: the midpoint sits
exactly at TP, but both ends are 0.13 out, so the result is OUT.

**Reported value is a diameter.** Position tolerances are stated as
diameters, so the viewer reports the **positional deviation as 2r**, never r.
The panel shows both, for each endpoint, so nobody mixes them up:
`r vs 0.125` and `2r vs ⌀0.25`, plus a PASS/FAIL mark. The headline value is
labelled "Position (reported as a diameter = 2r, not a radius)".

**Boundary and numerics.** An endpoint exactly on the boundary (r = 0.125)
counts as **IN**. Comparisons use a slack of `1e-9` mm to absorb
floating-point rounding (for example, dx = dy = 0.125·√½ gives r =
0.12500000000000003). That slack is about 10⁶ times smaller than any
measurable difference.

**Display: 4 decimals, never contradicting the verdict.** Every measured or
limit value is shown to 0.0001 mm (limits appear as `0.1250` and `⌀0.2500`).
Plain rounding could show an OUT value as the limit (r = 0.12503 → "0.1250").
So `src/format.js` rounds values that are compared against a limit **toward
their verdict**:
- PASS: round to the nearest 0.0001, capped at the limit
- FAIL: round to the nearest 0.0001, but never below limit + 0.0001 (only
  values within 0.00005 above the limit get bumped)

This means r = 0.1251 shows `0.1251 > 0.1250 ✘` and r = 0.12503 also shows
`0.1251 ✘`. The margin is computed from the displayed numbers, so it always
adds up on screen. Formatting never changes a verdict. Only `tolerance.js`
decides IN/OUT (with its 1e-9 slack). `tests/format.test.js` covers this,
including a sweep of 4,001 values across the boundary and the slack band.
Drawing callouts (FCF ⌀0.25, BASIC 35 / 30, ⌀10.1 ±0.1, plate 100 × 60 × 10)
keep their drawing notation.

### Required test cases (all in `tests/tolerance.test.js`, all passing)

| Case | Bottom (z=0) | Top (z=10) | r_B, r_T | Position ⌀ | Result |
|---|---|---|---|---|---|
| Centered | (35, 30) | (35, 30) | 0, 0 | 0.000 | IN |
| Tilted ±0.10, midpoint at TP | dx −0.10 | dx +0.10 | 0.10, 0.10 | 0.200 | IN |
| Tilted ±0.13, midpoint at TP | dx −0.13 | dx +0.13 | 0.13, 0.13 | 0.260 | **OUT** |
| Exactly on boundary | r = 0.125 (along +X, −Y and 135°) | same | 0.125 | 0.250 | IN |
| Just outside | dx +0.126 | dx +0.126 | 0.126 | 0.252 | OUT |
| Reported value | several mixed cases | | | = 2 × max(r_B, r_T) | |

Additional tests: the 3-4-5 check of the 2√(dx²+dy²) formula; dx = dy = 0.10
(each under 0.125, but combined r = 0.141 → OUT); one end in and one end out
→ OUT; `crossingsAtZ` on a general line; tilt angle; every UI preset; and
invalid-input rejection.

## 5. Display exaggeration (visual only)

A radius of 0.125 mm can't be seen on a 100 mm plate, so the 3D view
multiplies every **deviation-related** length by a factor M (default **×24**,
slider 1–80). It scales about the TP axis:

```
drawn endpoint     = TP + M × (actual endpoint − TP)
drawn zone radius  = M × 0.125
```

Both use the same M, so a point on the real boundary is drawn exactly on the
drawn boundary, and what you see inside or outside matches the computed
result (tested in `tests/exaggeration.test.js`). **Not scaled:** plate size,
hole diameter (⌀10.1), Z, basic dimensions. Scaling Z or the hole would
distort the geometry. So the drawn tilt angle is exaggerated too (by about M
for small angles), while the real tilt is printed in the readout. The IN/OUT
math always uses real, unscaled millimetres. The amber badge in the 3D view
always shows the current factor. The **top-view inset** in the side panel is
an un-exaggerated view in real mm, a pure 2D plot of the ⌀0.25 disc and the
two crossing points.

## 6. Assumptions

1. The evaluated axis is the axis of the **unrelated actual mating
   envelope** (RFS), modelled as a straight line. It is given (it comes from
   the sliders or drag, not from a simulated measurement). Tilt is allowed.
2. The datum features are perfect planes, and the DRF is exactly the
   modelled frame. There is no datum shift and no datum feature simulation.
3. The zone length equals the feature length (10 mm), with no projected zone.
4. RFS: the zone size does not depend on the hole size. The hole size is not
   checked in v1. The UI says so next to every verdict: *"Hole size assumed
   within ⌀10.0–10.2 (size not checked in this demo)"*.
5. The boundary is inclusive (r = 0.125 is IN). There is no measurement
   uncertainty in v1.

## 7. Domain expert decisions (resolved 2026-10-08)

The expert signed off on the math in §2–§4 and answered the v1 open questions:

| # | Question | Decision |
|---|---|---|
| 1 | Which axis is evaluated? | The axis of the **unrelated actual mating envelope** (RFS). **Keep tilt** in the trainer. ✅ *Confirmed by Will (accuracy review, 2026-10-08).* |
| 2 | Boundary inclusivity | **Boundary counts as IN** (r = 0.1250 passes). **No measurement uncertainty** in v1. |
| 3 | Display rounding | **4 decimals** (0.0001 mm) everywhere numbers appear. Implemented with verdict-consistent rounding (§4). |
| 4 | Zone length for a through hole | **Plain plate thickness** (z = 0 … 10). No chamfers or counterbores. |
| 5 | Exaggeration presentation | **Keep the uniform, labelled magnification** (§5). |
| 6 | Backlog order | 1. **MMC / bonus tolerance**, 2. **datum shift**, 3. **projected tolerance zone** (parked). |

### Still open

- ~~Will to confirm the unrelated-actual-mating-envelope interpretation (#1)~~ Confirmed 2026-10-08.
  against the standard. If that changes, only the wording here and in the UI
  changes. The v1 math (an ideal straight axis given directly) does not
  depend on which envelope defines the axis.
