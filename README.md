# Collage Maker

Vexel-style photo mosaics in any vector shape. Drop in photos, pick a shape (or upload your own SVG), and the app packs them into a tight mosaic with faces auto-centered. Everything runs locally in the browser — your photos are never uploaded.

## Features

- **Quadtree packing** — bigger photos in the interior, smaller along curves; cell count auto-fits to your photo count
- **Smart framing** — MediaPipe BlazeFace + face-api.js (SSD MobileNet) run in tandem; smartcrop saliency as fallback
- **Auto close-up** — zooms in past cover-fit so detected subjects fill a configurable portion of each cell
- **Built-in shape library** — circle, square, rounded, triangle, diamond, hexagon, octagon, pill, heart
- **User shapes** — upload any single-path SVG, persisted to `localStorage`
- **Export** — PNG / JPG / PDF / SVG at Web 1080² / HD 1920² / Print 3600² / Poster 7200² / Custom resolutions, with optional transparent background

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run test         # unit tests for pure packing/layout helpers
npm run typecheck    # TypeScript only
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
npm run tauri:build  # produces .dmg / .exe / .AppImage under src-tauri/target/release/bundle/
```

The bundle is fully offline — face-detection models, MediaPipe WASM, and all 10 display fonts are baked into the binary. No network connection is needed at runtime.

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

**CI builds for all platforms**: `.github/workflows/release.yml` is set up to build macOS (Intel + ARM), Windows, and Linux when you push a `v*` tag. Outputs are uploaded as workflow artifacts and attached to a draft GitHub Release.

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

- **Rendering** — [Konva](https://konvajs.org/) on canvas. Cells are positioned by a quadtree algorithm that subdivides only where the shape boundary cuts a cell, so interior cells stay large.
- **Face detection** — MediaPipe's BlazeFace short-range model (~200 KB) for fast close-range faces, plus face-api.js SSD MobileNet (~6 MB) for distant faces. Both lazy-loaded on first photo upload.
- **Shape parsing** — `getTotalLength()` + `getPointAtLength()` sample SVG paths into polylines (~600 points). Cell classification uses segment-vs-cell-edge intersection tests.
- **Photo assignment** — Greedy farthest-point: for each cell (visited in seeded shuffle order), pick the photo whose existing placements are farthest from this cell. Same-photo instances stay spread apart.

## Tech

Vite · React 18 · TypeScript · Konva · MediaPipe Tasks Vision · face-api.js · smartcrop

## Privacy

All image processing runs locally in your browser. Face-detection models, MediaPipe WASM, and fonts are served from this app's bundled static assets under `public/`; no photos or detection results are uploaded anywhere.
