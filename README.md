# Render — 3D-printed ceramic cup

Lightweight, photorealistic WebGL showcase of a cup made on a clay 3D printer:
the surface keeps the visible extrusion layers of raw clay, while selected zones
carry a glossy fired glaze.

![Hero render](docs/hero.png)

The procedural model follows the same construction idea as the
[Constructor / Clay Cup Builder](https://github.com/atikiannnn-max/Pasted-Assets)
project (a parametric cup built from revolved contours with printable bead
layers). `Render` is a fresh, dependency-light implementation focused on one
thing: a beautiful studio render that stays smooth.

## Run locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

Only one runtime dependency is used: [`three`](https://www.npmjs.com/package/three).
A prebuilt copy of the current release is kept on the `gh-pages` branch for the
live preview.

## How the render is built

- The cup geometry is generated procedurally in millimeters: outer wall, hollow
  interior, rim cap and a soft-loop handle.
- Each wall is subdivided at sub-millimeter height so the printer's layer lines
  are real geometry, not just a texture trick. A tiny deterministic wobble
  per printed loop makes the clay look handmade.
- Glaze maps (color, roughness, clearcoat) are painted at runtime on a canvas:
  the dip line is organic, it drips, and the wiped rim/foot stay raw.
- Lighting is a PMREM studio environment plus a shadow-casting key light, with
  ACES tone mapping and capped device pixel ratio for smooth interaction.

## Controls

- Drag to orbit, scroll to zoom, double-click to reset.
- Switch glaze presets and cup parameters on the right.
- `Low / Medium / High` quality rebalances vertex density and texture size.
- `Download 4K snapshot` captures the current view.

## Structure

```
src/
  main.js            scene bootstrap + UI wiring
  cupGeometry.js     parametric printed-cup geometry
  ceramicTextures.js procedural color / roughness / clearcoat / normal maps
```
