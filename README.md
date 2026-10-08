# GD&T Interactive Trainer: 3D viewer (v1: position of a hole)

An interactive Three.js scene that shows a **cylindrical position tolerance
zone** for a through hole. You can slide and tilt the hole's axis and see right
away whether the **whole axis** stays inside the zone. Clarity comes first:
flat colors, bold outlines, simple primitives.

| Item | Value (v1, frozen) |
|---|---|
| Plate | 100 (X) × 60 (Y) × 10 (Z) mm |
| Datums | A = bottom face (z=0), B = left edge (x=0), C = front edge (y=0); origin at A∩B∩C, +Z up out of A |
| Hole | ⌀10.1 ±0.1 THRU (size is shown as a label only) |
| Location | BASIC 35 from B, BASIC 30 from C, so true position = (35, 30) |
| FCF | ⌖ ⌀0.25 \| A \| B \| C (RFS; no MMC/bonus in v1) |

How the zone is built and how IN/OUT is decided: see **[ZONE.md](ZONE.md)**.

## Run

```bash
cd /workspace/gdt-viewer
npm install        # optional: only needed to refresh vendor/ from node_modules
npm start          # serves on http://localhost:8123/  (PORT=xxxx npm start to change)
```

Then open <http://localhost:8123/>. Three.js r169 is vendored in `vendor/three/`
(copied by `npm run vendor`, which also runs on `postinstall`), so the app works
**offline** with no build step: plain ES modules plus an import map.

## Test

```bash
npm test                 # node --test tests/   (pure math, no browser)
npm run screenshots      # headless Chrome via playwright-core; server must be running
```

`npm run screenshots` loads the page and fails on any console error or warning.
It checks IN/OUT for several states, drives a real pointer drag in the 3D view
and in the top-view inset, and writes `screenshots/in.png`, `out.png`,
`tilt_in.png`, `tilt_out.png`, `tilt_out_closeup.png`,
`boundary_0.1251.png` and `labels.png`. It also checks the zone/axis/inset
labels (including the live ×N as the slider moves) and that r = 0.1251 and r = 0.12503 both read
`0.1251` with FAIL, that r = 0.1250 reads PASS, and that the size note is
visible next to both verdicts. It uses the system
Chrome at `/usr/bin/google-chrome` (override with `CHROME=/path`).

## Using it

- **3D view.** Drag the **TOP** sphere to move where the axis crosses z = 10,
  and the **BOTTOM** sphere for z = 0. Either one tilts the axis. Drag the white
  **slide** sphere to shift both together. Elsewhere, left-drag orbits,
  right-drag pans, and the wheel zooms. The handles draw on top of everything,
  so you can grab them through the plate.
- **Top-view inset (side panel).** Shows the real ⌀0.25 zone circle and the
  two endpoint crossings **B** and **T** in true millimetres, with no
  exaggeration. You can drag B, T or the axis line here too.
- **Sliders and number boxes.** Set the top and bottom dx/dy precisely
  (±0.4000 mm, 0.0001 steps).
- **Presets:** Centered (in), Tilted ±0.1000 (in), Tilted ±0.1300 (out),
  Shifted 0.1250 (in, on boundary), Shifted 0.1260 (out), X 0.1000 + Y 0.1000 (out).
- **Readout.** For each endpoint it shows dx, dy, r vs 0.125, 2r vs ⌀0.25 and
  PASS/FAIL. The overall **position = 2 × (worst endpoint r)** is reported as
  a **diameter** and compared to ⌀0.2500. Next to the verdict (in the side
  panel and the top-left badge) is the note *"Hole size assumed within
  ⌀10.0–10.2 (size not checked in this demo)"*.
- **4 decimals everywhere** a measured or limit value appears (0.0001 mm).
  Values compared against a limit are rounded *toward their verdict*
  (`src/format.js`), so the display can never contradict PASS/FAIL. For
  example, r = 0.12503 is OUT and shows as `0.1251`, not `0.1250`. Drawing
  callouts (FCF ⌀0.25, BASIC 35 / 30, ⌀10.1 ±0.1, plate size) keep their
  drawing notation.
- **Exaggeration slider** (default ×24). This is display only; see ZONE.md §5.
  The amber badge in the 3D view always shows the current factor.
- **Labels in the 3D view.** The translucent cylinder is labelled *"position
  zone ⌀0.25 (shown ×N, not a pin)"*. N updates live with the slider, and at
  ×1 it reads "shown ×1, true size". This is there because testers mistook the
  zone for a gage pin. The bold line is labelled *"hole's actual axis"*. The
  inset labels its circle *"⌀0.25 position zone"*.
- **X-ray plate** makes the plate translucent so you can see the axis inside
  the bore. **Zoom to hole** is a close-up camera preset.
- Console hook for checking by hand: `gdt.setAxis({top:{dx:0.1,dy:0}, bottom:{dx:-0.1,dy:0}})`,
  `gdt.applyPreset('tilt-out')`, `gdt.result()`.

## Phones and tablets

The layout adapts to the screen with CSS only:
- **Portrait phones and tablets** (and windows narrower than 700 px) stack the
  3D view on top (48% of the height) with the scrolling panel below.
- **Landscape phones** keep the panel beside the view at about 46% of the width.
- **Small 3D views** get a compact verdict badge (the size note is still shown)
  and move the ×N badge to the bottom-left.
- **Touch controls** are sized for fingers (≥ 40 px buttons, taller sliders).

Touch input:
- one finger drags a handle; on empty canvas it orbits
- two fingers pinch-zoom and pan, even when one finger starts on a handle (the
  handle drag is cancelled and the axis restored)
- handles and inset dots grab within about 28 px / 22 px of a finger

`npm run mobile` (`scripts/mobile-check.mjs`) runs these checks with
Playwright device emulation (iPhone 13/14, Pixel 7, iPad, portrait and
landscape) against `URL` (defaults to the public site) and writes screenshots
to `screenshots/mobile/`.

## File layout

```
gdt-viewer/
├── index.html              import map + layout shell
├── styles.css              bold flat styling, FCF / basic-dim boxes
├── src/
│   ├── config.js           SPEC (part/drawing constants), VIEW limits, PRESETS
│   ├── tolerance.js        PURE math: endpoint crossings, r, 2r, IN/OUT (no Three.js)
│   ├── exaggeration.js     PURE display scaling (real mm <-> drawn units)
│   ├── format.js           PURE 4-decimal, verdict-consistent number formatting
│   ├── viewer/
│   │   ├── primitives.js   thick lines (Line2), labels (CSS2D), disposal
│   │   └── scene.js        renderer/camera/controls, datums, dims, FCF, plate+hole, zone, axis, handles
│   ├── interaction.js      3D pointer drag of TOP / BOTTOM / slide handles
│   ├── ui.js               side panel: readout table, inset SVG, presets, sliders
│   └── main.js             state -> evaluatePosition() -> scene + UI; window.gdt hook
├── tests/
│   ├── tolerance.test.js   includes the expert's required cases
│   ├── exaggeration.test.js
│   └── format.test.js      just-over-limit never displays as the limit; boundary sweep
├── scripts/
│   ├── serve.mjs           dependency-free static server (npm start)
│   ├── vendor.mjs          copies the needed three.js files to vendor/
│   ├── screenshots.mjs     headless browser verification + screenshots (desktop)
│   └── mobile-check.mjs    device-emulation layout/touch checks (npm run mobile)
├── vendor/three/           three@0.169.0 (build + OrbitControls, Line2, CSS2DRenderer)
├── screenshots/            in.png, out.png, tilt_in.png, tilt_out.png, tilt_out_closeup.png, boundary_0.1251.png, labels.png
├── README.md
└── ZONE.md                 zone generation + in/out check, for the GD&T domain expert
```

Data flow: `state {bottom:{dx,dy}, top:{dx,dy}, magnification, xray}` goes
through `evaluatePosition()` (real mm), and then to `viewer.update()` and
`ui.render()`. Only `tolerance.js` decides IN/OUT. The scene and UI just
display its result.

## Known limitations (v1)

- The hole is modelled as an ideal cylinder with a straight axis. There is no
  form error, no size variation, no actual-mating-envelope fitting (see
  ZONE.md, open questions).
- Hole size ⌀10.1 ±0.1 is a label only. There is no size check and no MMC
  bonus (out of scope for v1).
- If the top and bottom endpoints coincide in the inset, grabbing that spot
  moves **T** (top). Use the 3D **slide** handle or the sliders to shift both.
- A 3D drag happens in the horizontal plane through the grabbed handle. When
  the camera looks almost edge-on to that plane, the drag gets very sensitive.
  Orbit to a higher angle, or use the inset or sliders.
- Each endpoint offset is limited to ±0.4 mm per axis, which keeps the
  exaggerated hole inside the plate.
