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
- **Feature:** through hole ⌀10.1 ±0.1 (limits ⌀10.00–10.20). Since the
  MMC build, the actual size is set with a slider and **checked** (§8).
- **Location:** **BASIC 35** from B and **BASIC 30** from C, so the
  **true position (TP) = (35, 30)**.
- **Feature control frame:** `⌖ | ⌀0.25 | A | B | C`, regardless of feature
  size (RFS) by default. The MMC build adds an RFS/MMC toggle,
  `⌖ | ⌀0.25 Ⓜ | A | B | C`, and an editable stated tolerance (§8).
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
| Size or position change with the hole? | RFS: no. MMC: the diameter grows with the bonus (§8) | RFS fixes the zone; at MMC the zone diameter is the **allowed** tolerance |

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
always shows the current factor. The zone cylinder carries its own label,
*"position zone ⌀0.25 (shown ×N, not a pin)"*, where N is the live factor
("shown ×1, true size" at ×1). The bold line is labelled *"hole's actual
axis"*. Testers had mistaken the translucent zone for a gage pin. The
**top-view inset** in the side panel is
an un-exaggerated view in real mm, a pure 2D plot of the ⌀0.25 disc and the
two crossing points.

## 6. Assumptions

1. The evaluated axis is the axis of the **unrelated actual mating
   envelope** (RFS), modelled as a straight line. It is given (it comes from
   the sliders or drag, not from a simulated measurement). Tilt is allowed.
2. The datum features are perfect planes, and the DRF is exactly the
   modelled frame. There is no datum shift and no datum feature simulation.
3. The zone length equals the feature length (10 mm), with no projected zone.
4. RFS: the zone size does not depend on the hole size. Since the MMC build
   the hole size **is** checked (§8), and the note next to every verdict
   shows it: *"Hole size ⌀10.1000 ✔ within ⌀10.00–10.20"* (or *"✘ outside"*).
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

## 8. MMC and bonus tolerance (branch `mmc-bonus`, for Sally to verify)

These are Sally's rules as implemented. The math is pure and lives in
`src/tolerance.js` (`allowedTolerance`, `evaluatePart`). The tests are in
`tests/mmc.test.js`. Default inputs: stated ⌀0.25, hole MMC ⌀10.00 (the
smallest hole), hole LMC ⌀10.20 (the largest).

| # | Rule | Implementation |
|---|---|---|
| 1 | A slider sets the actual hole size from ⌀9.95 to ⌀10.25. Outside ⌀10.00–10.20 the verdict is **REJECT: size**, whatever the axis position | `sizeOk = 10.00 ≤ size ≤ 10.20` (inclusive, 1e-9 slack). The verdict checks size **before** position, so a perfect axis is still rejected. The number box accepts 0.0001 mm steps; the slider moves in 0.01 steps |
| 2 | RFS: allowed = stated (⌀0.25) | `bonus = 0`, `allowed = stated`, at every size |
| 3 | MMC: bonus = actual − 10.00, allowed = stated + bonus (max ⌀0.45 at ⌀10.20) | `bonus = clamp(size − 10.00, 0, 10.20 − 10.00)`, **floored** to 0.0001 mm so it is never overstated. `allowed = stated + bonus` |
| 4 | Zone radius = allowed / 2, live. IN/OUT compares the reported position (2r) with allowed | The cylinder, the inset circle, the 3D zone label and every "vs" column use `allowed`. Position = 2·max(r_bottom, r_top) ≤ allowed, which is the same as both endpoints having r ≤ allowed/2 (boundary inclusive) |
| 5 | Readout: "stated ⌀0.25 + bonus ⌀0.0xx = allowed ⌀0.xxx", with the bonus hidden at RFS | MMC: `stated ⌀0.2500 + bonus ⌀0.1500 = allowed ⌀0.4000`. RFS: `stated ⌀0.2500 = allowed ⌀0.2500 (RFS: no bonus)`. Values have 4 decimals, as everywhere else in the app (see open question a) |
| 6 | At MMC, a "virtual condition" label | **VC = 10.00 − stated**: ⌀9.75 at the default. It updates when the stated tolerance is edited and **never** changes with hole size. Shown in the panel and under the FCF in the drawing, at MMC only |
| a | RFS/MMC toggle and an editable stated tolerance (default 0.25) | The MMC math uses the stated value. The Ⓜ symbol (drawn as an SVG, so no missing-glyph risk) appears in the panel FCF, the phone FCF chip and the 3D drawing FCF, at MMC only |
| b | A stated ⌀0 is valid at MMC (all tolerance from bonus) and invalid at RFS | The math marks ⌀0 at RFS as `INVALID_TOL` (never accepted). The UI **blocks** it: typing 0 at RFS is refused and reverted, and switching to RFS while the stated value is 0 is refused, both with a message |

### Verdict order

1. stated ⌀0 at RFS → **INVALID** (the UI never lets you reach this state)
2. size outside ⌀10.00–10.20 → **REJECT: size**
3. position 2r ≤ allowed → **IN TOLERANCE**, otherwise **OUT OF TOLERANCE**

### Worked edges (stated ⌀0.25, all unit-tested)

| Actual hole | Size | RFS allowed | MMC bonus | MMC allowed | VC (MMC) |
|---|---|---|---|---|---|
| ⌀9.95 (slider min) | REJECT: size | — | 0 | (0.25) | ⌀9.75 |
| ⌀9.9999 | REJECT: size | — | 0 | (0.25) | ⌀9.75 |
| ⌀10.00 (MMC) | OK | 0.25 | 0.00 | **0.25** | ⌀9.75 |
| ⌀10.15 | OK | 0.25 | 0.15 | **0.40** | ⌀9.75 |
| ⌀10.20 (LMC) | OK | 0.25 | 0.20 | **0.45** | ⌀9.75 |
| ⌀10.2001 | REJECT: size | — | (0.20, capped) | (0.45) | ⌀9.75 |
| ⌀10.25 (slider max) | REJECT: size | — | (0.20, capped) | (0.45) | ⌀9.75 |

Values in brackets are shown for information only; a size reject overrides them.
More tested cases: the boundaries are inclusive (at ⌀10.20 a 2r of 0.45 is IN
and 0.4502 is OUT; at ⌀10.00 r = 0.125 is IN). Stated 0.30 gives VC ⌀9.70.
A stated ⌀0 at MMC with ⌀10.12 allows 0.12. A stated ⌀0 at RFS is INVALID.
⌀10.12345 gives a bonus of 0.1234 (floored).

### Open questions for Sally

- a. **Decimals:** the readout uses 4 decimals (⌀0.1500), matching the
  frozen 4-decimal rule. The rule's template reads "⌀0.0xx / ⌀0.xxx". Should
  it be 3 decimals?
- b. **Oversize hole at MMC:** the bonus is capped at 0.20 for display. Should
  a rejected size show no bonus at all?
- c. **⌀0 at RFS:** it is blocked in the UI rather than shown as a REJECT
  state. Is that acceptable?
