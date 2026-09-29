# Collage Maker

Photo collages, flipbooks and brick mosaics, with subject-aware framing. Drop in photos (or a short video), pick a mode, and the app lays them out with faces and people automatically kept in frame. Everything runs locally, in the browser or as a desktop app. Your photos are never uploaded.

## Modes

- **Shape** — Vexel-style mosaics in any vector shape. A quadtree packs bigger photos into the interior and smaller ones along curves; cell count auto-fits your photo count. Pick from the built-in library (circle, square, rounded, triangle, diamond, hexagon, octagon, pill, heart) or upload any single-path SVG (saved to `localStorage`).
- **Grid** — auto-generated grid layouts scored for balance and subject placement, with variants to shuffle through. Layouts stay stable as photos are added or removed. Supports hero shapes, SVG templates that define the grid sections, and a photo tray for arranging photos.
- **Flipbook** — a printable **rotary flipbook** built on duplex half-blades. Import frames from photos or from a short video clip (trimmed to ≤ 6 s, one frame per blade, auto-framed in *Locked*, *Follow* or *Per-frame tight* mode). Exports a duplex print PDF with vector cut contours, or TIFF sheets bundled in a ZIP.
- **Lego** — tile photos onto brick layouts and check the result in an interactive, double-sided 3D preview before exporting.

## Shared features

- **Subject-aware framing** — MediaPipe BlazeFace and face-api.js (SSD MobileNet) find faces; a MediaPipe EfficientDet-Lite0 detector finds people, so crops keep the whole person rather than just the face. smartcrop saliency is the fallback when nothing is detected.
- **Auto close-up** — zooms in past cover-fit so detected subjects fill a configurable portion of each cell.
- **Manual framing** — pan and zoom any photo (0.25×–4×) in the frame editor.
- **Echo fill** — when a photo is zoomed out past its cell, the empty space is filled with a blurred, dimmed copy of the same photo.
- **Export** — PNG / JPG / TIFF / PDF / SVG at Web 1080² / HD 1920² / Print 3600² / Poster 7200² / Custom resolutions, with optional transparent background. The formats offered depend on the mode. On desktop, exports go through a native Save dialog.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run test         # unit tests (Vitest) for the pure layout, framing and export helpers
npm run typecheck    # TypeScript only
npm run verify       # tests + typecheck + production build
```

## Build & deploy as a web app

```bash
npm run build        # writes static files to dist/
npm run preview      # serve dist/ locally to verify
```

The build is a pure static site. Deploy `dist/` to any static host.

## Build as a standalone desktop app (Tauri)

The app can also be packaged as a native macOS / Windows / Linux binary using [Tauri 2](https://tauri.app/).

**Prerequisites:** Rust toolchain (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`) plus your platform's build tools (Xcode CLI on macOS, MSVC on Windows, `build-essential` + webkit2gtk on Linux).

```bash
npm run tauri:dev    # native window with hot reload
npm run tauri:build  # produces installers under src-tauri/target/release/bundle/
```

The bundle is fully offline — the face and person detection models, MediaPipe WASM, and the display fonts are baked into the binary. No network connection is needed at runtime.

### Cross-platform builds

**Universal macOS binary** (Intel + Apple Silicon):
```bash
npm run tauri:build -- --target universal-apple-darwin
```

**Windows from macOS / Linux** (via `cargo-xwin`):
```bash
cargo install --locked cargo-xwin
rustup target add x86_64-pc-windows-msvc
npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc
```

First run downloads the MSVC SDK headers (~3 GB, one-time, cached at `~/.cache/cargo-xwin`). Output goes to `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe` (the NSIS installer) and `.../msi/*.msi`.

**CI builds for all platforms**: `.github/workflows/release.yml` builds macOS (Intel + ARM), Windows (`.exe` + `.msi`), and Linux (`.AppImage`, `.deb`, `.rpm`) when you push a `v*` tag. Outputs are uploaded as workflow artifacts and attached to a draft GitHub Release, which you then publish.

**Releasing:** bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (then `npm install` and `cargo check` to refresh the lockfiles), merge to `main`, and push a `vX.Y.Z` tag.

### Vercel

```bash
npx vercel --prod
```

Or connect the repo at vercel.com — `vercel.json` is included.

### Netlify

```bash
npx netlify deploy --prod --dir=dist
```

Or connect the repo — `netlify.toml` is included.

### Cloudflare Pages / S3 / GitHub Pages / any static host

Upload the contents of `dist/` after `npm run build`. No backend required.

## Architecture

Each mode is a view in `src/views/` backed by pure, unit-tested logic modules:

| Mode | View | Logic |
|---|---|---|
| Shape | `ShapeCollage.tsx` | `shapeCollage.ts`, `shape.ts`, `contour.ts`, `userShapes.ts` |
| Grid | `GridCollage.tsx` | `gridLayout/` (tree generation, scoring, stability, hero shapes, SVG templates) |
| Flipbook | `FlipbookMaker.tsx` | `flipbook/` (blade geometry, imposition, print export), `video/` (trim, sampling, temporal framing) |
| Lego | `LegoView.tsx` | `lego/` (tiling, imposition, face rendering, 3D preview) |

- **Rendering** — [Konva](https://konvajs.org/) on canvas for the 2D editors; three.js via react-three-fiber for the Lego 3D preview.
- **Shape packing** — SVG paths are sampled into polylines (~600 points) with `getTotalLength()` / `getPointAtLength()`. A quadtree subdivides only where the shape boundary cuts a cell, so interior cells stay large. Cells are ranked by size, and photos are assigned greedily so that repeats of the same photo stay spread apart.
- **Subject detection** (`smartFrame.ts`, `subjectDetection.ts`) — BlazeFace short-range (~200 KB) for close faces, face-api.js SSD MobileNet (~6 MB) for distant faces, and EfficientDet-Lite0 (~4.5 MB) for people. Faces are matched to person boxes; a face with no detected body gets an estimated one. The result is a `SubjectBox` with source `face`, `person`, `hybrid` or `smartcrop`. All models are lazy-loaded on first photo upload.
- **Framing** (`photoFraming.ts`) — computes cover-fit, auto close-up and manual placements, plus the echo-fill backdrop (blurred by `canvasBlur.ts`).
- **Export** (`export.ts`) — raster, PDF (jsPDF), SVG and a built-in TIFF encoder; multi-file exports are zipped with fflate. On desktop, files are written through the Tauri dialog and fs plugins.

Design specs for the larger features live in [`docs/`](docs/). [`docs/flipbook-mechanics.md`](docs/flipbook-mechanics.md) is the source of truth for the flipbook's physical model.

## Tech

Vite · React 18 · TypeScript · Konva · three.js / react-three-fiber · MediaPipe Tasks Vision · face-api.js · smartcrop · jsPDF · fflate · Tauri 2 · Vitest

## Privacy

All image and video processing runs locally in your browser or the desktop app. Detection models, MediaPipe WASM, and fonts are served from this app's bundled static assets under `public/`; no photos, videos, or detection results are uploaded anywhere.
