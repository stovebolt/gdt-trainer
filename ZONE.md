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

**Display: metric, at most 3 decimals, never contradicting the verdict.**
*This supersedes the earlier 4-decimal rule, per Will (2026-10-15).*
The part is metric (mm). Values are shown with at most 3 decimals, with
trailing zeros dropped and the leading zero kept: `0.25`, `0.4`, `10.15`,
`0.247`, `10`. `src/format.js` rounds conservatively:
- the **reported position** and r (measured values) round **up**;
- the **allowed tolerance**, the r limit and the **bonus** round **down**;
- a **passing** value is capped at the displayed limit, so it shows ≤ limit;
- a **failing** value always shows **strictly above** the displayed limit.
  Rounding up already guarantees this, and it is also enforced explicitly
  (limit + 0.001), so a fail can never display as equal to or under the
  limit and no extra digit is ever needed.

For example, r = 0.1251 and r = 0.12503 both show `0.126 > 0.125 ✘`,
r = 0.125 shows `0.125 ≤ 0.125 ✔`, and 2r = 0.2461 shows `⌀0.247`. Float noise
of up to 1e-9 mm is ignored, so 0.13 never becomes 0.131. The margin is
computed from the displayed numbers, so it always adds up on screen.
Formatting never changes a verdict: only `tolerance.js` decides IN/OUT,
with its 1e-9 slack. `tests/format.test.js` covers this, including a sweep
across the boundary for the limits 0.25, 0.4, 0.45, 0.12 and an off-grid
0.2505. Inputs (offsets, size, stated) step in 0.001 mm.
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
   shows it: *"Hole size ⌀10.1 ✔ within ⌀10–10.2"* (or *"✘ outside"*).
5. The boundary is inclusive (r = 0.125 is IN). There is no measurement
   uncertainty in v1.

## 7. Domain expert decisions (resolved 2026-10-08)

The expert signed off on the math in §2–§4 and answered the v1 open questions:

| # | Question | Decision |
|---|---|---|
| 1 | Which axis is evaluated? | The axis of the **unrelated actual mating envelope** (RFS). **Keep tilt** in the trainer. ✅ *Confirmed by Will (accuracy review, 2026-10-08).* |
| 2 | Boundary inclusivity | **Boundary counts as IN** (r = 0.1250 passes). **No measurement uncertainty** in v1. |
| 3 | Display rounding | ~~4 decimals~~ **Superseded 2026-10-15 (Will): metric, at most 3 decimals, trailing zeros dropped**, with conservative rounding (§4). |
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
| 1 | A slider sets the actual hole size from ⌀9.95 to ⌀10.25. Outside ⌀10.00–10.20 the verdict is **REJECT: size**, whatever the axis position | `sizeOk = 10.00 ≤ size ≤ 10.20` (inclusive, 1e-9 slack). The verdict checks size **before** position, so a perfect axis is still rejected. The number box steps in 0.001 mm; the slider steps in 0.01 |
| 2 | RFS: allowed = stated (⌀0.25) | `bonus = 0`, `allowed = stated`, at every size |
| 3 | MMC: bonus = actual − 10.00, allowed = stated + bonus (max ⌀0.45 at ⌀10.20) | `bonus = clamp(size − 10.00, 0, 10.20 − 10.00)`, **floored** (math to 0.0001 mm, display to 0.001 mm) so it is never overstated. `allowed = stated + bonus` |
| 4 | Zone radius = allowed / 2, live. IN/OUT compares the reported position (2r) with allowed | The cylinder, the inset circle, the 3D zone label and every "vs" column use `allowed`. Position = 2·max(r_bottom, r_top) ≤ allowed, which is the same as both endpoints having r ≤ allowed/2 (boundary inclusive) |
| 5 | Readout: "stated ⌀0.25 + bonus ⌀0.0xx = allowed ⌀0.xxx", with the bonus hidden at RFS | MMC: `stated ⌀0.25 + bonus ⌀0.15 = allowed ⌀0.4`. RFS: `stated ⌀0.25 = allowed ⌀0.25 (RFS: no bonus)`. Metric display, ≤ 3 decimals; bonus and allowed round down |
| 6 | At MMC, a "virtual condition" label | **VC = 10.00 − stated**: ⌀9.75 at the default. It updates when the stated tolerance is edited and **never** changes with hole size. Shown in the panel and under the FCF in the drawing, at MMC only |
| a | RFS/MMC toggle and an editable stated tolerance (default 0.25) | The MMC math uses the stated value. The Ⓜ symbol (drawn as an SVG, so no missing-glyph risk) appears in the panel FCF, the phone FCF chip and the 3D drawing FCF, at MMC only |
| b | A stated ⌀0 is valid at MMC (all tolerance from bonus) and invalid at RFS | The math marks ⌀0 at RFS as `INVALID_TOL` (never accepted). The UI **blocks** it: typing 0 at RFS is refused and reverted, and switching to RFS while the stated value is 0 is refused. Both show the reason line (Sally's wording, updated 2026-10-15 to name LMC too) *"⌀0 is only meaningful at MMC or LMC, where bonus supplies the tolerance."* |
| c | On REJECT: size, the readout shows "bonus n/a", with no bonus amount | `bonus = null` (n/a) when the size is outside the limits, so `allowed` falls back to the stated value (for information only). MMC readout: `stated ⌀0.25 + bonus n/a (size rejected)` |
| d | On REJECT: size, the zone and handles are neutral gray, with the position number kept | The zone, actual axis and its label, TOP/BOTTOM handles, endpoint rows and inset all turn neutral gray (#64748b), with no ✔/✘. The reported position (rounded up) stays in the readout, marked "(info)", and the handle tags show r "(size rejected)" |

### Verdict order

1. stated ⌀0 at RFS → **INVALID** (the UI never lets you reach this state)
2. size outside ⌀10.00–10.20 → **REJECT: size**
3. position 2r ≤ allowed → **IN TOLERANCE**, otherwise **OUT OF TOLERANCE**

### Worked edges (stated ⌀0.25, all unit-tested)

| Actual hole | Size | RFS allowed | MMC bonus | MMC allowed | VC (MMC) |
|---|---|---|---|---|---|
| ⌀9.95 (slider min) | REJECT: size | — | n/a | (0.25) | ⌀9.75 |
| ⌀9.9999 | REJECT: size | — | n/a | (0.25) | ⌀9.75 |
| ⌀10 (MMC) | OK | 0.25 | 0 | **0.25** | ⌀9.75 |
| ⌀10.15 | OK | 0.25 | 0.15 | **0.4** | ⌀9.75 |
| ⌀10.2 (LMC) | OK | 0.25 | 0.2 | **0.45** | ⌀9.75 |
| ⌀10.2001 | REJECT: size | — | n/a | (0.25) | ⌀9.75 |
| ⌀10.25 (slider max) | REJECT: size | — | n/a | (0.25) | ⌀9.75 |

Values in brackets fall back to the stated value and are for information
only; the size reject overrides them. More tested cases: the boundaries are
inclusive (at ⌀10.2 a 2r of 0.45 is IN and 0.4502 is OUT; at ⌀10 r = 0.125
is IN). Stated 0.3 gives VC ⌀9.7. A stated ⌀0 at MMC with ⌀10.12 allows
0.12. A stated ⌀0 at RFS is INVALID (blocked in the UI). ⌀10.1234 gives a
bonus that shows as 0.123 and an allowed tolerance that shows as 0.373
(both rounded down).

### Resolved (2026-10-15)

- ✅ **Decimals** (Will): metric, at most 3 decimals, trailing zeros dropped,
  with conservative rounding (§4). Supersedes the 4-decimal rule.
- ✅ **⌀0 at RFS** (Sally): it stays blocked, with the reason line *"⌀0 is only
  meaningful at MMC, where bonus supplies the tolerance."* (rule b).
- ✅ **Oversize or undersize hole** (Sally): the readout shows "bonus n/a", with
  no amount (rule c).
- ✅ **Colours on REJECT: size** (Sally): neutral gray, with the position number
  kept for information (rule d).

## 9. LMC (least material condition), Sally's rules

The modifier control is a three-way segmented switch, **RFS | MMC | LMC**,
defaulting to RFS. Each segment is at least 40 px on phones. The FCF (panel,
phone chip and 3D drawing) shows Ⓛ at LMC. Tests: `tests/lmc.test.js`.

| # | Rule | Implementation |
|---|---|---|
| 1 | bonus = 10.20 − actual size | `bonus = clamp(10.20 − size, 0, 10.20 − 10.00)`, **floored** like the MMC bonus |
| 2 | allowed = stated + bonus: 0.25 at ⌀10.20, 0.45 at ⌀10.00 | Same `allowed` path as MMC, so the zone, inset and labels all follow it |
| 3 | A fixed label "LMC virtual condition ⌀(10.20 + stated)", ⌀10.45 at the default | `virtualCondition = lmc + stated`. It follows the stated value and **never** changes with size. Shown in the panel and under the drawing FCF |
| 4 | Size reject, ⌀0 handling and gray zone work as at MMC, and the bonus rounds down | REJECT: size gives bonus n/a, a gray zone and the position kept. A stated ⌀0 is valid at LMC (and MMC) and blocked at RFS |
| 5 | A fixed label "LMC resultant condition ⌀X", X = 10.00 − (stated + 0.20), i.e. MMC size minus the allowed tolerance at MMC size: ⌀9.55 at the default | `resultantCondition = mmc − (stated + (lmc − mmc))`, **rounded up** because it is a minimum boundary (math to 0.0001 mm, display to 0.001 mm). Shown beside the LMC virtual condition, in the panel and under the drawing FCF, **at LMC only** (its space is reserved at RFS/MMC so the panel does not jump). It follows the stated value (0.1 → ⌀9.7, 0 → ⌀9.8) and never changes with size |
| — | Teaching line | *"MMC protects assembly, LMC protects material."* appears in small italics under the VC line at MMC and LMC, and is hidden at RFS |

### Sally's spot-check table (stated ⌀0.25; unit-tested and browser-checked)

| Actual hole | RFS allowed | MMC allowed | LMC allowed |
|---|---|---|---|
| ⌀10.00 | 0.25 | 0.25 | 0.45 |
| ⌀10.10 | 0.25 | 0.35 | 0.35 |
| ⌀10.20 | 0.25 | 0.45 | 0.25 |

At the default tolerance, the VC labels read **⌀9.75 at MMC** and **⌀10.45 at LMC**, and the LMC resultant condition reads **⌀9.55**.
They stay unchanged while the size slider moves from ⌀10.00 to ⌀10.22 (checked
in the panel and in the drawing). LMC ⌀10.05 gives bonus 0.15 and allowed 0.4.

## 10. Lock in tolerance (Will; spec revised by Sally and Gleeb)

A **"Lock in tolerance"** toggle, off by default, sits beside the stated
tolerance (at least 40 px on phones). The math is pure, in `src/tolerance.js`
(`lockDrag`, `shrinkCausedOut`). Tests: `tests/lock.test.js`. Browser checks:
`scripts/screenshots.mjs` (mouse) and `scripts/mobile-check.mjs` (touch, 8 devices).

| Rule | Implementation |
|---|---|
| Applies only to **user drags and tilts** (3D handles, inset dots, offset/tilt controls). **Presets are not clamped** | `setAxis(patch, { user: true })` goes through `lockDrag`; presets call `setAxis` without it |
| Each endpoint is clamped **separately** to radial offset ≤ allowed/2 − ε (ε = 1e-6 mm), using the **current** allowed (bonus included) | Radial scale toward true position (direction kept), then truncated toward zero onto the 0.001 mm grid, which only shrinks r. Tilting edge-to-edge works (e.g. top +0.124, bottom −0.124 at ⌀0.25). The zone is convex, so the whole axis stays inside |
| **No automatic re-clamp** when the zone shrinks (size, mode or stated) | The axis stays where it is. If it ends up outside, the verdict is a normal **OUT** (red) |
| Note *"zone shrank: less bonus at this size"* | Shown only when the lock was on during the shrink **and** the shrink caused the OUT: the axis is IN at the pre-shrink allowed and OUT now (`shrinkCausedOut`). A preset or turning the lock off clears it; it hides once the axis is back IN or the zone grows back |
| Outside + locked: a drag may only **reduce** the radial offset | A step that would increase r is **projected** onto the disc of the current r (direction of the pointer kept), not rejected. Sideways or tangential drags slide around and creep inward, so the handle never sticks. Once inside, the normal clamp applies |
| Size reject while locked | The position clamp still applies; the verdict stays **REJECT: size** with the gray zone |
| Display | A locked axis at the edge shows e.g. "position ⌀0.45 ≤ ⌀0.45" (true value 0.4492). The pass display is capped at the shown limit (§4), so it never reads above the limit |

## 11. Views, Lock tilt and the 2D trap (branch `views`)

### View controls

A compact row in the 3D view: **Top Z · Front Y · Side X · 3D**, plus an
**Ortho/Persp** switch, which shows the current projection. On phones and touch
screens every button is at least 40 px. The row sits under the verdict badge,
and the callouts and handle tags are kept clear of it.

| Button | Camera |
|---|---|
| Top (Z) | Ortho, looking down −Z; screen right = +X, up = +Y |
| Front (Y) | Ortho, looking along +Y; screen right = +X, up = +Z |
| Side (X) | Ortho, looking along −X (from +X); screen right = +Y, up = +Z |
| 3D | The default perspective orbit (on phones, the default hole close-up) |
| Ortho/Persp | Switches the projection and keeps the pose and apparent size |

- A view button **snaps smoothly** (≈0.4 s eased) and switches to ortho. Orbiting
  afterwards clears the highlighted view. Pure math: `src/views.js`
  (`viewPose`, `dragPlane`, `dragDelta`, `effectiveDistance`).
- **Dragging in every view** (`dragPlane`):
  - Looking mostly down (top view and the 3D orbit): the drag happens in the
    horizontal plane through the grabbed handle, so it moves the endpoint in X/Y.
  - Front and side views: the drag happens in a vertical plane facing the camera.
    Only the visible in-plane horizontal axis moves (X in front view, Y in side
    view); screen-vertical motion, which is Z, is ignored.
- **Labels in ortho**:
  - Handle tags sit to the left of their handle. In top view, where both
    handles coincide, they are stacked below-left.
  - Callouts that meet on screen are stacked.
  - Everything stays below the badge and view row and above the bottom HUD.
  - On phones the part is centred in the free band.

### Lock tilt (Sally)

Off by default; the toggle reads **"Lock tilt"**.

- **Turning it on never moves the axis.** It freezes the current tilt
  (top − bottom) exactly, whether the axis is tilted or perpendicular.
  The original idea, snapping both ends to their midpoint offset, was dropped:
  a lock never moves the axis by itself.
- While on, every user drag or offset edit **translates both ends by the same
  delta** (`translateAxis`):
  - A one-end drag moves both ends by that end's delta.
  - A two-end request uses the mean delta, so its tilt part is dropped.
- **Presets are not affected.** A preset may set a new tilt, which the lock then
  freezes.
- **Both locks on:** the delta is projected onto the set of moves that keep each
  end inside the zone. An end that is already outside may only come inward.
  - Whichever end would leave first limits the move, and both ends move by the
    clamped delta.
  - Sideways drags slide along the boundary and never stick.
  - Example: tilt ±0.1 at ⌀0.25 dragged +0.2 in X moves +0.024 (TOP reaches 0.124).
- **Lessons:**
  - JS API: `gdt.setTiltLock(bool)`, `gdt.setLock(bool)`, `gdt.setView('top'|'front'|'side'|'3d')`,
    `gdt.setProjection('ortho'|'persp')`.
  - URL params: `?tiltlock=1&lock=1&view=top`.

### Lock badges

While a lock is on, a small teal badge shows it in the 3D view: **"Tilt
locked"** and/or **"Tolerance locked"**, each only while its lock is on. They
are stacked next to the view row (to its right on desktop, left of it on
phones). The callouts and handle tags treat the badges as part of the
badge/view-row band, so nothing overlaps them.

They are **display-only**, not tap-to-unlock. Turning a lock off by accident
mid-lesson would silently change behaviour, and a tappable badge would need a
40 px touch target, which would no longer be small. The toggles in the panel
remain the one place to change a lock.

### Diagonal (2D trap), Sally's preset

The axis is offset 0.10 in X and 0.10 in Y with no tilt. r = √(0.1² + 0.1²) =
0.1414, so position ⌀0.283 > ⌀0.25: **OUT** at RFS. Each single-axis offset
(0.10) is inside the ±0.125 band that front and side views show, so the part
looks fine in 2D; only the round zone (top view) shows why it fails. While the
axis sits on this preset, the panel shows *"Inside the band in front and side
views, but outside the round zone."*

Tests: `tests/views.test.js` (view poses, drag planes and mapping, tilt lock,
both locks, the 2D trap). Browser checks: `scripts/screenshots.mjs` (mouse) and
`scripts/mobile-check.mjs` (touch, 8 devices).

## 12. Datum references: A, B, C toggles (branch `datum-suppress`, preview only; for Sally)

Sally's rules, as implemented. Each datum reference can be switched off in the
panel ("Datum references in the FCF"; all on by default). B locates the zone in
X (35 from B) and C locates it in Y (30 from C); A is the plane the zone is
perpendicular to.

| Kept | FCF shows | Zone | What is measured |
|---|---|---|---|
| A B C | ⌀0.25 A B C | fixed at true position (35, 30) | r from true position (unchanged) |
| A B (C dropped) | A B | **slides in Y** | r from the slid centre; X is still held |
| A C (B dropped) | A C | **slides in X** | r from the slid centre; Y is still held |
| A (B, C dropped) | A | **slides in X and Y**, stays ⟂ A | "⌀ (acts like perpendicularity to A)" = lateral spread of the endpoints |
| B C (A dropped alone) | B C | no change | same numbers; the on-screen note says "Dropping A alone changes nothing visible here." |
| none | (no datum cells) | **floats free** | nothing to judge: neutral verdict, "No datum reference: position is undefined" |

Other combinations follow the same two rules (B off frees X, C off frees Y; A
off is only a note unless B and C are also off).

### The slid zone is the best-fit zone

When the zone is free along an axis, the verdict uses the **smallest cylinder
that contains the axis**. Concretely, the zone centre `c` along the freed
axes is chosen to minimise the larger of the two endpoint distances, which is
unique (a closed form, `fitZone` in `src/tolerance.js`):

- one freed axis: the centre where the two endpoints are equally far away, or
  at one endpoint when that is already tighter (it has the larger offset along
  the held axis);
- both freed: the centre is the midpoint of the two endpoints, so
  r = ½·|top − bottom| and position ⌀ = 2r = the lateral spread.

r is measured **from that centre** for both endpoints, so the usual rule still
holds: IN only if both endpoints have r ≤ allowed/2 (boundary inclusive).
Position ⌀ = 2 × the larger r, rounded the same conservative way as before
(measured values and the position round up, allowed/bonus/limits round down,
a failing value never displays ≤ its limit). Dropping a reference **never makes
a part worse**: ⌀(fewer datums) ≤ ⌀(all datums) for every axis (unit-tested).

### What the screen shows

- FCF in the panel, the phone chip and the 3D drawing lose the dropped cells.
  Dropped datum labels and planes are dimmed in the 3D drawing.
- The ◆ best-fit zone centre marker (display only, see rulings).
- A magenta badge in the 3D view (for example "C dropped: zone slides in Y"),
  a one-line "zone slides in Y · centre dy +0.200" in the panel, and, for A only
  or no datums, a one-line teaching note.
- The freed directions as a translucent magenta slab and arrows in 3D, top,
  front and side views. (Viewed end-on, a slide along the view direction can only
  appear as the slab's end face. That is inherent to a 2D projection.)
- The panel inset re-centres on the slid zone so the rings stay r-from-zone-centre,
  with a band along the freed axes and a "true position" cross.
- The table's dx / dy columns are offsets from the slid centre (the rule note says
  where the centre is).
- NO DATUMS ("No datum reference: position is undefined") is neutral gray, never green or red; the r and 2r cells show "—"
  because nothing is being compared.

### Locks

- **Lock in tolerance:** an endpoint may go anywhere the zone could slide to.
  The freed axis has no wall; the held axis does. Closed-form projection,
  so a sideways drag slides along the wall and never sticks (A only: each end
  may be at most ⌀allowed from the other, a perpendicularity wall). Dragging
  the slide handle (or the inset axis line) translates both ends by the same delta.
  With all three dropped nothing is locked (nothing to hold).
- **Lock tilt:** translating along a freed axis is not limited; the held axis is
  clamped as before. Turning it on still never moves the axis.
- Restoring a datum while **Lock in tolerance** is on never moves the axis: if
  the less free zone then leaves it OUT, the panel notes "datum restored: zone less
  free, axis unmoved" (same pattern as the size-shrink note).
- RFS / MMC / LMC bonus applies to the slid zone unchanged (allowed ⌀ does not
  depend on the datums).

### Sally's rulings (applied in this build)

1. **A dropped with B and C kept: no change.** Confirmed, nothing visible changes;
   the on-screen note stays.
2. **Wording.**
   - All three dropped: the verdict stays neutral gray (no IN or OUT) with the
     text **"No datum reference: position is undefined"**. It shows in the panel
     detail line and in the 3D badge. The status slot keeps the short
     label "NO DATUMS" so the panel layout is unchanged (panel-stable fit checked).
   - A only (B and C dropped): the readout is labelled
     **"⌀ (acts like perpendicularity to A)"** instead of "position ⌀"
     (panel label and the 3D badge: "perpendicularity to A ⌀…").
3. **Best-fit centre stays automatic**, and is now **drawn**: a small magenta
   diamond ◆ on the top and bottom faces of the zone with a dashed centreline
   (3D, top, front and side views), and a ◆ in the panel inset. The marker is display-only
   and never changes the verdict. The learner does not place the zone.
4. **Large slides stay in view.**
   - **Auto-reframe:** after a change settles (and after a view snap), if the zone
     centre or an axis endpoint would sit outside a free region of the 3D view
     (clear of the badge, view row, ×N label and the callout side), the camera pans,
     and only if the box is still too big dollies out. It never rotates, never runs mid-drag,
     and gives up after 3 passes. The math is the pure `reframePlan` in `src/framing.js`.
   - **Phones cap the exaggeration at ×40** (other screens keep ×80). The slider
     maximum and the state follow.
   - The **×N label** ("Zone & deviations drawn ×N") stays visible at every N
     above ×1, inside the 3D view and clear of other labels (checked at ×2, ×24, ×40).
   - **Reset camera** stays the manual fallback: it returns to the overview and
     auto-reframe does not fight it until the axis changes again.

### Current behaviour with A dropped and only B or only C kept (read-only analysis, not changed)

Sally's point: with only B (or only C) kept, rotation about that plane's normal is
free, so the zone could tilt. **The build does not do that.** Exactly what it does today:

| Kept | Zone orientation | Freedoms | Verdict logic |
|---|---|---|---|
| B only (A, C dropped) | always vertical (parallel to Z, as with A) | slides in **Y** only (C dropped); X is held by B | best-fit centre `cy` along Y, r from that centre for both endpoints |
| C only (A, B dropped) | always vertical | slides in **X** only (B dropped); Y is held by C | best-fit centre `cx` along X |

Dropping A changes nothing here (`aDropped` only drives a note, and the note is
suppressed whenever B or C is also dropped). So an axis tilted in the free
direction is still judged against a straight vertical cylinder: for B only, bottom
(0.05, −0.20) and top (0.05, +0.20) give r = √(0.20² + 0.05²) = 0.206, position
⌀0.412 > ⌀0.25: **OUT** (the Y tilt counts). The zone and lock walls are the same as
for "C dropped" / "B dropped" with A kept.

**What tilt would involve** (not implemented): with only B kept the zone may rotate
about B's normal (X), so it can swing in the Y–Z plane and slide in Y; it stays fixed
only in X. The best-fit line then passes through both endpoints' Y values for free, so
only the X offsets matter: r = max(|dx_bottom|, |dx_top|) (for the example above ⌀0.1, IN).
Symmetrically, C only: only the Y offsets matter. Doing it means:
(1) a new fit in `fitZone` (a tilt flag on the free axis, closed form);
(2) lock clamps (`lockDragFree`, `translateAxisFree`) wall only the held axis, with no
spread wall on the free one;
(3) an oblique zone drawn in 3D and the views (a tilted cylinder), plus the inset showing
a band, not a circle;
(4) the A-only note and table rewording, and tests for the new freedom table.
It also changes what "dropping A" means (today: nothing), so it needs Sally's sign-off first.

Tests: `tests/datums.test.js` (freedom table for all 8 combinations, best-fit
closed form against brute force, every rule, bonus and rounding edges, lock and
tilt-lock fuzz with each freedom, "dropping never worsens"). Browser checks:
`scripts/screenshots.mjs` (mouse) and `scripts/mobile-check.mjs` (touch), plus
the datum states in `scripts/panel-stable.mjs`.
