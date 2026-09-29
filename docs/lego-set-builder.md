# Lego Set Builder — Technical Design & Implementation Plan

**Status:** Proposed · **Owner:** Lego team · **Target:** Production (Collage Maker, web + Tauri desktop)
**Last updated:** 2026‑06‑17
**Audience:** the implementing engineer. Contracts, algorithms, data model, UX, tests, rollout are specified here. No code — signatures are contracts.

---

## 0. Executive summary

A **fourth top‑level mode** (`Shape · Grid · Flipbook · Lego`) for designing **custom double‑sided Lego photo walls**: a vertical assembly of Lego bricks tiling a shape (rectangular "portrait" presets of 33 / 42 / 52 pieces, plus a heart SKU), printed on **both vertical faces** from **exactly two images** (front + back). Three deliverables:

1. **Builder** — a 2D editor on a brick grid: pick a preset shape, the app tiles it with bricks, the user drops two photos and frames them; bricks can be edited (split/merge/rotate).
2. **3D previewer** — a real-time double-sided 3D render of the assembled wall with both images "printed" on the front/back faces; orbit + flip to inspect front and back.
3. **Print export** — **bitmap** (the composited image per side) **+ vector** (brick/cut outlines + panel outline + duplex registration), front and back, as the existing export pipeline produces today for the SVG‑template grid.

The feature reuses the app's photo model, subject detection, framing editor, and bitmap+vector export wholesale. The only genuinely new subsystems are the **brick‑tiling engine** (pure math) and the **3D preview** (new dependency: Three.js via react‑three‑fiber, lazy‑loaded).

---

## 1. The unit model — the idea that makes everything tractable

The front-view wall grid uses one horizontal unit per **stud column × 1 brick course high**. This is the resolution needed for physical heart SKUs that include `2×3` and narrow `1×2` filler pieces. So the entire design lives on a stud-column wall grid, and:

```
1×2 brick front  ≡  1 stud column
2×2 brick front  ≡  2 stud columns
2×3 brick front  ≡  3 stud columns
2×4 brick front  ≡  4 stud columns
```

A Lego panel is therefore a **brick-footprint tiling of a stud-column region**. This reframing drives the builder, the presets, the piece count, the 3D mesh, and the export, all from one normalized structure. Everything downstream works in **stud-column space**; physical millimeters and pixels are derived only at render/export.

**Physical constants (one module, `lego/units.ts`):**

| Quantity | Value | Notes |
|---|---|---|
| Stud pitch `P` | 8.0 mm | LEGO System standard |
| Wall column | 8 × 9.6 mm | 1 stud wide × 1 brick course high |
| `2×4` brick front | 32 × 9.6 mm | four horizontal stud columns |
| `2×3` brick front | 24 × 9.6 mm | three horizontal stud columns |
| `2×2` brick front | 16 × 9.6 mm | two horizontal stud columns |
| `1×2` brick front | 8 × 9.6 mm | narrow one-stud filler face |
| Brick depth | 16 mm | 2 studs deep |
| Brick height | 9.6 mm | one wall course; plate = 3.2 mm (config) |
| Stud Ø / height | 4.8 / 1.8 mm | 3D detail only |
| Print DPI default | 300 | export resolution basis |

All of these are **parameters**, not literals scattered in code — the catalog may change.

---

## 2. Goals & non‑goals

### 2.1 Goals
1. Preset shapes: **rectangular portraits at 33, 42, 52 pieces**, plus **heart** sets (piece count derived from the tiling).
2. A builder that tiles the shape with SKU-specific brick footprints and lets the user **split / merge / rotate** compatible bricks and see a live piece count + bill of materials.
3. **Exactly two images** per set (front, back); each framed with the existing auto/manual subject framing; mapped across the panel and split per brick.
4. **3D previewer**: orbit, flip front↔back, images shown on vertical faces, realistic exposed top studs, lighting.
5. **Export**: per‑side **bitmap** + **vector**, plus a combined **duplex print PDF** (front page + back page, registered for flip) — reusing `downloadExport`/`ExportHooks`.
6. Fully **on‑device**, web + Tauri desktop; 3D lazy‑loaded so it never bloats the initial bundle.
7. Deterministic, testable tiling; persisted settings.

### 2.2 Non‑goals (v1)
- True LEGO color/part sourcing, brick‑inventory ordering, or LDraw/Stud.io export.
- Non‑flat builds, multi‑layer/3D sculptures, overhangs.
- Arbitrary user‑uploaded outline shapes (heart + rectangles only in v1; the SVG‑template parser from the grid is the v2 hook — §11).
- More than two images, animation, or per‑brick independent photos.
- Physics, snapping simulation, or printing the brick **sides** (only the printed face matters).

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **Cell** | A 2×2‑stud block; the atomic grid unit. |
| **Brick** | A placed piece: `2x4`, `2x3`, `2x2`, or `1x2`, with a footprint in stud-column space. |
| **Panel / Set** | The full tiled assembly (a `LegoSet`). |
| **Face** | `front` or `back` — the two printed sides. |
| **Piece count** | Number of bricks = the product SKU dimension the user cares about. |
| **Footprint** | The set of cells a brick occupies. |
| **Print sheet** | One face's bitmap + vector, sized to physical mm at export DPI. |

---

## 4. Architecture

```
        ┌─────────────────────────────────────────────────────────────┐
        │                        LegoView (mode)                       │
        │  presets · builder canvas · 2 photo slots · 3D toggle · export│
        └───────────────┬───────────────────────────┬─────────────────┘
                        │ LegoSet (cells, bricks)     │ images: {front, back}: Photo
                        ▼                              ▼
   ┌──────────────────────────┐        ┌────────────────────────────────┐
   │  lego/ (pure engine)     │        │  framing (REUSED)               │
   │  units · shapes · tiling │        │  detectSubject / computePhoto‑  │
   │  → LegoSet               │        │  Placement / FrameEditorModal   │
   └─────────┬────────────────┘        └────────────────────────────────┘
             │ LegoSet
   ┌─────────┴───────────┬──────────────────────────┐
   ▼                     ▼                          ▼
 BuilderCanvas      LegoPreview3D            legoExport
 (Konva 2D)         (react-three-fiber,      (bitmap per face +
                     lazy)                    vector hooks → downloadExport)
```

**Key invariant:** the `LegoSet` (cell region + brick tiling) is the single source of truth. The 2D builder, the 3D preview, and all exports are **pure projections** of `(LegoSet, frontImage, backImage, framing)`. Changing a brick re‑projects everything; nothing is duplicated state.

---

## 5. Data model (`src/lego/types.ts`)

```ts
export type BrickKind = '1x2' | '2x2' | '2x3' | '2x4';
export type Orientation = 'h' | 'v';        // v is mainly an edit affordance for 2x4
export type Face = 'front' | 'back';

export type Cell = { col: number; row: number };          // stud-column coords

export type Brick = {
  id: string;
  kind: BrickKind;
  orientation: Orientation;
  cell: Cell;            // top-left cell of the footprint
  // footprint derived from kind + orientation; h widths are 1, 2, 3, or 4 stud columns
};

export type LegoShape = {
  id: string;            // 'rect-33' | 'rect-42' | 'rect-52' | 'heart' | ...
  name: string;
  cols: number; rows: number;                 // stud-column bounds
  cellMask: boolean[];   // row-major, true = cell is inside the shape
};

export type LegoSet = {
  shapeId: string;
  cols: number; rows: number;
  cellMask: boolean[];
  bricks: Brick[];       // a valid tiling: covers every masked cell exactly once
  pieceCount: number;    // = bricks.length (derived, cached)
};

export type LegoImages = {
  front: GridPhoto | null;   // GridPhoto = Photo & { name } — reuse app type
  back: GridPhoto | null;
};

export type LegoFraming = {                    // per face, independent
  front: ManualFrame | null;
  back: ManualFrame | null;
};
```

Normalized everywhere: cell coords are integers; the panel's pixel/mm size is `cols·CELL × rows·CELL`. Bricks reference cells, never pixels.

---

## 6. The tiling engine (`src/lego/tiling.ts`, pure, Node‑testable)

### 6.1 Shape → cell mask
- **Rectangles:** `cols × rows` all‑true mask, chosen so the natural domino‑max tiling yields the target piece count (see 6.4).
- **Heart (and future outlines):** rasterize the shape path onto the cell grid using **`pointInPolygon`** (already in `shape.ts`) at each cell center; reuse `library.ts` heart geometry. A cell is "in" if its center is inside the outline. Then **snap to even tileability** (6.3).

### 6.2 Tiling algorithm (mask → bricks)
A domino/monomino tiling that **maximizes 2×4 usage** (fewer, sturdier pieces — the product preference) and is deterministic:

```
1. Greedy domino pass (deterministic scan order: row-major, prefer horizontal
   then vertical): place a 2x4 wherever two adjacent masked cells are both free.
2. Maximal-matching refinement: the leftover free cells form a graph (cells =
   nodes, adjacency = edges); run a deterministic augmenting-path matching to
   convert stray 2x2s into 2x4s where a swap reduces piece count. (Optional in
   v1 if greedy already hits targets; spec'd for quality.)
3. Remaining unmatched cells → 2x2 bricks (monominoes).
4. Output bricks; pieceCount = dominoes + monominoes.
```

Determinism: identical mask ⇒ identical tiling. No RNG in the engine.

### 6.3 Even‑tileability (hearts/odd shapes)
A region is domino‑tileable only under parity/connectivity conditions; with monominoes allowed, **any** masked region tiles, but we want *few* monominoes (mono = a visible "small square" — fine occasionally, ugly in bulk). Rule: after rasterizing, **report** the monomino count; if it exceeds a threshold (e.g., > 15 % of pieces) surface a hint to nudge the heart size. We do **not** silently delete cells. (A checkerboard‑imbalance metric predicts unavoidable monominoes and feeds the hint.)

### 6.4 Presets (`src/lego/shapes.ts`)
Authored `LegoShape`s whose default tiling yields the named counts. Worked examples:

| Preset | Stud-column grid | Default tiling | Pieces |
|---|---|---|---|
| `rect-33` | 10×11 | 22 `2×4` + 11 edge `2×2` | **33** |
| `rect-42` | 12×12 | 30 `2×4` + 12 edge `2×2` | **42** |
| `rect-52` | 14×13 | 39 `2×4` + 13 edge `2×2` | **52** |
| `heart` | 15×9 masked physical SKU | 29 `2×3` + 4 `1×2` | **33** |

(Exact cols×rows finalized in Phase 1 against the real product dimensions — the table is the contract for *how* the count is reached: portrait aspect, domino‑maximal.) Presets are data; adding one is a new entry, no engine change.

### 6.5 Manual edits (builder ops, all pure transforms on `LegoSet`)
- **Split** a 2×4 → two 2×2 (always valid).
- **Merge** two adjacent 2×2 → a 2×4 (valid iff both exist and are adjacent in line).
- **Rotate** a 2×4 (h↔v) — valid iff the rotated footprint stays masked & unoccupied; otherwise rejected with a shake.
- Every op returns a new valid `LegoSet` or a typed rejection. Invariant enforced after each op: *every masked cell covered exactly once; no brick outside the mask.* A `validateTiling(set)` guard backs the test suite and dev‑mode asserts.

---

## 7. Images & framing (REUSED, not rebuilt)

- Two photo slots (front, back). Each runs the shared `loadPhoto` (decode + `detectSubject`).
- The framing target is the **panel bounding box** (`cols·CELL × rows·CELL` at preview scale). `computePhotoPlacement(photo, panelW, panelH, { closeUp, closeUpTightness })` gives the cover/subject‑aware placement; `FrameEditorModal` (with `aspectRatio = cols/rows`) provides manual override per face. Same model as Grid/Shape.
- **Per‑brick sampling:** each brick's printed face = the sub‑rectangle of the framed image covering that brick's footprint. In 2D this is implicit (we draw the whole framed image, clipped to the panel, with brick outlines on top). In 3D and export, each brick samples its footprint region as a texture/crop.
- **Heart / masked panels:** the image is clipped to the union of brick footprints (the mask), exactly like a shape collage clip. Outside‑mask area is transparent/background.
- **Echo‑fill / zoom‑out** (if the grid's Echo Fill shipped): reuse it here for free — letter/heart panels are exactly where zoom‑out helps.

---

## 8. Front/back duplex — the alignment problem (reuse the Flipbook lesson)

The panel is one physical object; **front shows image A, flipping it left‑right shows image B**. Therefore:

- Front and back share the **same brick tiling** (same physical bricks).
- The back print must be **horizontally mirrored** so brick boundaries register after the flip (long‑edge flip = mirror in X), identical to the flipbook's duplex imposition. `Face='back'` ⇒ mirror the layout in X for both the bitmap draw and the vector outline; the **image content itself is not mirrored** (image B reads correctly on the back), only the *positions* are mirrored for registration.
- Export offers **front‑only**, **back‑only**, and **combined duplex PDF** (page 1 front, page 2 back‑mirrored), with cut/registration marks — the flipbook's print module is the template.

This is the one piece of genuinely fiddly geometry; it is **isolated in `lego/imposition.ts`** with its own unit tests (a brick at front‑(c,r) lands at back‑(cols‑1‑c, r) etc.), so a test catches a flip error before it reaches a customer's misprinted set.

---

## 9. 3D previewer (`src/components/LegoPreview3D.tsx`)

### 9.1 Technology choice
- **New dependency: `three` + `@react-three/fiber` + `@react-three/drei`.** Justification: hand‑rolling WebGL or faking 3D with CSS transforms for a double‑sided studded panel is more code and worse than r3f, which is the React‑idiomatic standard. Bundle weight (~150 KB gz for three core) is mitigated by **lazy `import()`** behind the 3D toggle — the same pattern the app already uses for MediaPipe/face‑api/jsPDF. The 2D builder and export work with 3D never loaded.
- Tauri/web identical (WebGL in both WebViews; verify WebGL availability with a capability check + graceful fallback to a static front/back image pair).

### 9.2 Scene
- **Geometry:** one `InstancedMesh` of brick boxes (instances = bricks, scaled per kind/orientation) for the bodies; a second `InstancedMesh` of stud cylinders (count = Σ studs) for realism. Instancing keeps ≤ 52 bricks (≤ ~400 studs) trivially 60 fps.
- **Texturing:** front faces sample image A, back faces sample image B. Two `CanvasTexture`s built once from the framed images (the same canvases the builder/export use). Each brick's top‑face UVs map to its footprint sub‑rect of the panel texture. **Studs are modeled as geometry; the photo maps to the flat top face** (studs cast subtle shadow) — v1 does *not* wrap the image over stud tops (documented; a "studs sampled" mode is a v1.1 nice‑to‑have).
- **Controls:** `OrbitControls` (drei), clamped so the user can't lose the panel; a **Flip** button tweens the camera 180° to the back; a **Front/Back** segmented toggle. Soft studio lighting + ground shadow for the "product render" look.
- **Sides/edges:** brick sides use a neutral plastic material (configurable color, default warm white) — only the printed face carries the photo, matching the product.

### 9.3 Performance & lifecycle
- Textures rebuilt only when an image or its framing changes (memoized on a framing hash); brick instance buffer rebuilt only when the tiling changes.
- Dispose geometries/materials/textures on unmount; pause the render loop when the 3D panel isn't visible (`frameloop="demand"`, invalidate on interaction).

---

## 10. Export (`src/lego/legoExport.ts`, reuses `export.ts`)

Per face → **bitmap + vector**, exactly the SVG‑template grid pattern (`ExportHooks { svgExtras, pdfOverlay }`):

- **Bitmap:** the framed image clipped to the panel mask, drawn to a canvas sized `cols·CELL_mm × rows·CELL_mm` at export DPI (300 default). Back face mirrored in X (§8).
- **Vector overlay:** panel outline + **per‑brick rectangles** (the cut/seam lines) + optional stud circles + corner **registration marks** for duplex alignment. Emitted as `svgExtras` (true vector `<rect>`/`<path>`) for SVG and via `pdfOverlay` (jsPDF strokes) for PDF — both already wired in `export.ts`.
- **Formats:** PNG/JPG (bitmap only), SVG (bitmap `<image>` + vector), PDF (single face), and **Duplex PDF** (front + back‑mirrored pages with cut + registration marks). A **Bill of Materials** footer on the PDF (count by brick kind, panel mm size) for production.
- **Transparent background** option (PNG/SVG/PDF) for masked shapes (heart) — reuse the grid/shape transparency path.
- Physical sizing is exact because everything derives from `units.ts` mm — the print comes out the right size for real bricks.

---

## 11. UI / UX (`src/views/LegoView.tsx`)

- **Mode tab:** add `'lego'` to `Mode` in `App.tsx` and the `Header.tsx` tablist (`Shape · Grid · Flipbook · Lego`).
- **Left panel:** preset picker (33 / 42 / 52 / Heart with mini brick‑wireframe thumbnails), live **piece count + BOM**, brick‑edit tools (split / merge / rotate — context actions on a selected brick), shape‑size nudge (for heart, with the monomino hint from §6.3).
- **Center:** **Builder canvas** (Konva): renders the framed front (or back) image clipped to the panel, brick seam lines on top, selectable bricks; a **Front/Back** toggle switches which image+framing is shown/edited. **2D ⇄ 3D** toggle swaps the center for `LegoPreview3D`.
- **Right panel:** two photo slots (Front image, Back image) with the standard add/drop + auto close‑up + tightness + ✎ frame editor; background color / transparency; export button → `ExportModal` (formats incl. **Duplex PDF**).
- **States:** empty (pick a preset) · tiling · ready · framing · 3D‑loading · exporting · error (WebGL unavailable → static preview fallback).
- **Persistence:** preset, brick edits (as a tiling diff), background, framing, 3D vs 2D — via the `settingsStore.ts` snapshot pattern (key `cm.lego.v1`); image bytes not persisted (consistent with other modes).
- **Accessibility:** preset list as radiogroup; bricks focusable with keyboard split/merge/rotate (`s`/`m`/`r`); 3D has a "describe view" live region and the static fallback is fully usable without WebGL.

---

## 12. File plan

```
src/lego/
  units.ts          // physical constants (mm, DPI) — single source
  types.ts          // §5
  shapes.ts         // preset LegoShapes (rect-33/42/52, heart) + mask rasterizer
  tiling.ts         // mask → bricks; split/merge/rotate; validateTiling (§6)
  imposition.ts     // front/back duplex mirror math (§8)
  legoExport.ts     // bitmap + vector hooks per face; duplex PDF (§10)
  *.test.ts         // tiling, imposition, shapes, export-geometry
src/components/
  LegoBuilderCanvas.tsx   // Konva 2D editor
  LegoPreview3D.tsx       // react-three-fiber (lazy)
  LegoBrickTools.tsx      // split/merge/rotate UI
src/views/
  LegoView.tsx
```
Reused unchanged: `photoIngest.loadPhoto`, `smartFrame.detectSubject`, `photoFraming.*`, `FrameEditorModal`, `export.ts` (`downloadExport`, `ExportHooks`), `ExportModal`, `shape.ts` (`pointInPolygon`), `shapes/library.ts` (heart), `settingsStore.ts`. Edited: `App.tsx`, `Header.tsx`, `index.css`. New deps: `three`, `@react-three/fiber`, `@react-three/drei` (lazy‑loaded).

---

## 13. Testing

### 13.1 Engine unit tests (vitest, no DOM)
- **Tiling validity (property tests):** for every preset and a range of heart sizes — every masked cell covered exactly once, no brick outside mask, no overlaps (`validateTiling` ⇒ true).
- **Piece counts:** `rect-33/42/52` produce exactly 33/42/52 bricks at default tiling; heart count is stable & deterministic per size.
- **Domino maximization:** greedy+matching yields ≤ a known monomino bound for each preset.
- **Edits:** split→merge round‑trips to an equivalent set; rotate rejects out‑of‑mask/occupied; every op preserves the invariant.
- **Imposition:** front cell (c,r) ↔ back cell (cols‑1‑c, r) for all bricks; registration marks symmetric; double‑mirror = identity.
- **Determinism:** same shape ⇒ deep‑equal tiling.

### 13.2 Integration
- Build a preset, drop two fixture photos, assert: builder renders N seam rectangles = pieceCount; front/back toggle swaps texture; export bitmap dimensions = `cols·CELL_mm × rows·CELL_mm` at DPI; SVG export contains one `<rect>` per brick; duplex PDF has 2 pages and back page geometry is the X‑mirror of front (sample‑point check).
- 3D smoke test (jsdom/headless‑gl or mock): scene builds `pieceCount` brick instances + correct stud count; disposes on unmount; WebGL‑absent path renders the static fallback.

### 13.3 Goldens & QA matrix
- Goldens: each preset's builder wireframe + a 3D front/back still per preset (locked after design review).
- QA: 33/42/52/heart × {portrait photos, group photos} × {front=back image, different images} × transparent on/off × export each format × duplex print **physically test‑printed and flipped to confirm registration** × web (Chrome/Safari) + Tauri macOS/Windows × WebGL‑disabled fallback.

---

## 14. Performance budgets
| Op | Budget | Tactic |
|---|---|---|
| Tile a preset (≤ 91 cells for 52-piece wall) | < 10 ms | fixed SKU layout or greedy fallback, pure |
| Brick edit re‑project | < 5 ms | local transform, no full retile |
| 3D build/instance | < 100 ms | InstancedMesh, textures memoized |
| 3D interaction | 60 fps | instancing, `frameloop="demand"` |
| Export bitmap (300 DPI, ~52 bricks) | < 300 ms | single canvas draw + clip |
| Initial bundle | unaffected | three.js lazy‑loaded behind 3D toggle |

---

## 15. Rollout

| Phase | Scope | Exit |
|---|---|---|
| **0 — Foundations** | `units.ts`, `types.ts`, mode tab scaffold (empty LegoView behind `lego.v1` flag) | app builds; other modes untouched |
| **1 — Tiling engine** | `shapes.ts` (rect presets + heart raster), `tiling.ts`, `validateTiling`, full unit suite (§13.1) | presets hit 33/42/52 exactly; heart tiles; tests green |
| **2 — Builder 2D** | `LegoBuilderCanvas`, brick select + split/merge/rotate, two photo slots + framing reuse, front/back toggle, piece count/BOM | build + frame a set end‑to‑end in 2D |
| **3 — Export** | `imposition.ts`, `legoExport.ts`, bitmap+vector+duplex PDF, transparency, BOM footer | imposition tests green; **physical test print registers** |
| **4 — 3D preview** | `LegoPreview3D` (lazy three/r3f), instanced bricks+studs, front/back textures, orbit/flip, WebGL fallback | 60 fps preview; fallback works |
| **5 — Polish & ship** | persistence, a11y, QA matrix, copy, perf pass | QA matrix passes; flag removed |

Each phase is a PR behind the `lego.v1` flag; export (Phase 3) is the production‑critical gate and must include a real printed‑and‑flipped registration check before GA.

---

## 16. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Front/back misregistration → wasted physical prints | med | **high** | isolated `imposition.ts` + unit tests + mandatory physical test print in Phase 3 |
| Heart layout drifts from physical SKU | med | med | authored `HEART_LAYOUT` plus tests that forbid non-heart brick kinds |
| three.js bundle / perf on low‑end or no‑WebGL | low‑med | med | lazy load; instancing; static front/back fallback |
| Piece‑count presets don't match real product dimensions | med | med | Phase 1 finalizes cols×rows against actual SKUs before building UI on top |
| Stud‑vs‑flat texture mismatch vs real printed product | low | low | v1 = flat‑top mapping (matches how panels are actually printed); "studs sampled" deferred |
| Scope creep → full LEGO CAD | med | med | §2.2 non‑goals; this is a photo‑panel product, not Stud.io |

---

## 17. Open questions
1. **Exact preset dimensions:** confirm the real cols×rows (and portrait aspect) for the 33/42/52 SKUs so default tilings hit the counts — needed before Phase 1.
2. **Print model:** is each brick printed as an individual tile/sticker (cut apart along the vector), or is one sheet printed and laminated then split? Affects whether per‑brick bleed/registration marks are needed between bricks vs only at the panel edge.
3. **Back‑side flip axis:** is the physical flip left‑right (mirror X, assumed) or top‑bottom (mirror Y)? Determines the imposition mirror axis — must match how the product is actually turned over.
4. **Studs in print:** does the printed image need to account for stud bumps (printed before assembly, flat) or are panels printed assembled? (Assumed flat pre‑assembly → flat texture.)
5. **Heart set sizing:** is heart a single fixed size (one SKU) or a size slider? (Affects whether monomino tuning is a one‑time design or a runtime hint.)
6. **3D fidelity bar:** is a clean instanced‑brick render enough, or is a marketing‑grade render (bevels, AO, env map) expected for customer‑facing previews?

---

### Definition of done
The four presets build and tile to the right piece counts; two images frame onto front/back with subject‑aware framing; the 3D previewer shows both printed sides at 60 fps with a WebGL‑less fallback; bitmap + vector + duplex‑PDF export at correct physical size, and a **physically printed set registers front‑to‑back**; engine + integration + golden tests green on web and both desktop targets; `lego.v1` flag removed; this doc updated to "Implemented" with deviations noted.
