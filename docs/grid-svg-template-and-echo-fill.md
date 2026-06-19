# Grid: SVG Template Family + Echo Fill (Zoom‑Out Backdrop) — Implementation Plan

**Status:** Approved plan — ready for implementation · **Owner:** Grid team · **Target:** Production (web + Tauri desktop)
**Last updated:** 2026‑06‑12
**Parent spec:** [grid-collage-v2.md](grid-collage-v2.md) — this document extends the v2 architecture (families, framing, tray, persistence). Read that first; shared infrastructure is referenced, not respecified.

---

## 0. Executive summary

Two features, one work order:

- **Feature A — SVG Template family (`svgTemplate`).** A third layout family beside Mosaic and Hero‑Center: the user loads an SVG whose **closed subpaths define the photo sections** (driving asset: a laser‑cut "PAPA" card — 4 letter‑shaped sections, one photo each). The template *is* the layout; no generation. Each section is a clipped photo cell with the standard auto/manual framing.
- **Feature B — Echo Fill.** Today framing can only zoom IN (`clampManualFrame` floors zoom at 1 = cover). Users sometimes need to zoom **out** to fit all subjects — which leaves the cell underfilled. Echo Fill replicates the user's manual design workflow automatically: an **enlarged copy of the same photo renders behind** the zoomed‑out foreground, filling the cell. Works in every family (rect cells, hero shapes, SVG sections); it is a framing‑layer feature, not family‑specific.

They're bundled because B is what makes A practical: odd‑shaped letter cells are exactly where cover‑cropping fails and zoom‑out + echo saves the result.

---

## 1. Feature A — SVG Template family

### 1.1 The driving asset (committed fixture)

`papa.svg` (CorelDRAW 2026 laser‑cut export). **First task: copy it into the repo at `src/gridLayout/__fixtures__/papa.svg`** — it currently lives on a NAS volume (`/Volumes/vacards-tn/…`) that may not be mounted on dev machines or CI.

Measured facts the parser must handle (all verified by inspection):

| Property | Value | Consequence |
|---|---|---|
| viewBox | `0 0 117463.7 48063.4` (aspect ≈ 2.444) | huge CorelDRAW coordinates — normalize everything to viewBox space; never assume px‑scale units |
| Geometry | **one compound `<path>`** containing **4 closed subpaths** (`M…z m…z m…z m…z`) | sections come from **subpath splitting**, not from separate elements (but separate `<path>` elements must also work) |
| Subpath file order | A (rightmost, with pennant detail) → P (leftmost) → P (3rd) → A (2nd) | **file order ≠ visual order** — cells must be re‑sorted (bbox `minX`, then `minY`) for photo assignment |
| Fill/stroke | `fill:none; stroke:black` (cut lines) | a fill‑less SVG still defines valid regions; ignore paint, use geometry only |
| Holes | these letters are solid silhouettes (no counters) | but the parser must classify holes generally — a "PAPÁ" or "DAD8" template will have counters |

### 1.2 Parsing pipeline (`src/gridLayout/svgTemplate.ts`, pure where possible)

Reuse before building: `userShapes.ts` already has DOMParser + parsererror checks, viewBox reading, `defs/clipPath/mask` exclusion, sanitization, and localStorage persistence patterns. `shape.ts` already has `parseShapePolyline` (DOM path → flattened polyline), `pointInPolygon`, `polygonArea`, `boundsFromPoints`, and `applyPolylinePath`. The new work is **subpath splitting and hole classification** — the rest is composition.

```
parseSvgTemplate(svgText, filename) → SvgTemplate | ParseError

1. DOMParser + parsererror check; read viewBox (fallback: width/height attrs). [reuse userShapes]
2. Collect all <path d> outside defs/clipPath/mask/pattern/symbol; also accept
   <rect>/<circle>/<ellipse>/<polygon> by converting to path data (cheap, finite cases).
3. SPLIT each path's `d` into closed subpaths: scan for M/m commands; each
   M…(Z|z| next M) segment is a candidate contour. Unclosed trailing segments
   with ≥ 3 points are auto-closed (laser files are sloppy); degenerate ones dropped.
4. Flatten each contour to a polyline in viewBox space (reuse the sampling
   approach of parseShapePolyline; ~200 points per contour is plenty).
5. CLASSIFY: sort contours by |polygonArea| descending. A contour whose
   representative interior point falls inside an already-accepted cell contour
   (pointInPolygon) becomes that cell's HOLE (even-odd semantics, one level —
   islands-in-holes are out of scope v1, documented). Otherwise it's a CELL.
6. FILTER: drop cells with area < 0.5% of viewBox area (specks, hairline scraps).
7. SORT cells visually: bbox minX, then minY. Assign stable ids `cell-0..n-1`.
8. VALIDATE: 1 ≤ cells ≤ MAX_GRID_PHOTOS(30), else typed ParseError
   ('noSections' | 'tooManySections' | 'unparseable').
```

Type (normalized to the unit square of the viewBox, like everything in the grid engine):

```ts
SvgTemplate = {
  id: string; name: string;                 // from filename, editable
  viewBox: ViewBox;                          // original, kept for export/stroke
  aspect: number;                            // viewBox.w / viewBox.h
  cells: SvgTemplateCell[];                  // visual order
  sourceSvg: string;                         // sanitized original text (stroke overlay + re-parse)
}
SvgTemplateCell = {
  id: string;
  outer: Point[];                            // normalized polyline
  holes: Point[][];
  bbox: Rect;                                // normalized
  mask: Uint8Array;                          // 16×16 occupancy (subject-coverage checks, same scheme as heroShapes)
}
```

### 1.3 Family behavior

- **The template is the layout.** `family: 'svgTemplate'` bypasses `generateLayouts` entirely; the variant strip shows the template's wireframe as the single "variant". **Shuffle re‑deals photo→cell assignment** (seeded rotation/permutation) instead of regenerating geometry — same button, sensible semantics.
- **Canvas aspect is locked to the template's aspect** (papa.svg ⇒ 2.444:1). The aspect picker is disabled with a tooltip ("Aspect follows the SVG template"); gutter is disabled (sections abut as drawn); corner radius is disabled. Background color remains (fills between/around letters).
- **Assignment:** photos map to cells in visual order; fewer photos than cells ⇒ trailing cells render as outlined placeholders (numbered); more photos ⇒ extras stay in the tray, badged "unplaced". All existing interactions carry over: cell click/select, swap DnD, ✎ frame editor, tray reorder (tray order = assignment order).
- **Numbered badges** on sections (1…N) so a physical‑card user can match prints to cut slots.
- **Stroke overlay (laser‑cut affordance):** optional "Show cut lines" toggle renders `sourceSvg`'s paths as a stroke layer on top (width/color controls, defaults from the file). Off by default for pure photo export; on = print‑and‑cut alignment aid. Konva `Path` with the original `d`, scaled viewBox→stage.
- **Template management:** "Upload SVG template" in the family's control row; recent templates persisted via the `userShapes.ts` localStorage pattern (new key `cm.grid.svgTemplates`, same sanitize‑on‑load discipline, cap ~12 with LRU eviction). papa.svg ships as a built‑in starter template.

### 1.4 Rendering & framing per section

- Cell clip = `applyPolylinePath(outer)` + holes with even‑odd (Konva `clipFunc` supports manual path winding; draw outer then holes, set `evenodd` via context fill rule in the clip function).
- Photo placement = `computePhotoPlacement(photo, bboxW, bboxH, …)` against the **cell bbox**, exactly like Hero‑Center does with shape bboxes. Subject‑coverage refinement: after placement, test the subject box against the cell `mask`; if the subject center lands in an empty mask region (e.g., the gap between a P's stem and bowl… or an A's pennant), nudge `cx/cy` toward the mask's centroid (single deterministic correction, then clamp). This is the same 16×16 mask mechanism specified for Hero‑Center occlusion — share the code.
- Manual framing: `FrameEditorModal` with `aspectRatio = bbox` aspect. v1 ships the plain rect editor (live canvas is truth); silhouette overlay in the editor remains the shared v1.1 nice‑to‑have.
- Export: unchanged raster path (clips scale analytically with pixelRatio). **v1.1 (flagged follow‑up, not v1):** "Export cut file" — photos as raster + cut lines as vector SVG/PDF for the laser workflow, reusing the jsPDF + contour infrastructure from Shape mode.

---

## 2. Feature B — Echo Fill (zoom‑out with auto backdrop)

### 2.1 The workflow being automated

User's manual process in design software: when a cover‑crop can't show all subjects, they (1) scale the photo **down** inside the frame until everyone fits, (2) duplicate the photo, (3) scale the copy up to cover the frame, (4) send it to back. Result: a "photo‑within‑photo" where the enlarged backdrop fills the dead space coherently (their reference shows a **plain, unblurred** backdrop). Echo Fill makes that one slider gesture.

### 2.2 Framing model change — the real engineering

Current hard assumptions to remove (all in `photoFraming.ts`):

1. `clampManualFrame` clamps `zoom` to `[1, MAX_MANUAL_ZOOM]` → introduce `MIN_MANUAL_ZOOM = 0.25` and clamp to `[MIN_MANUAL_ZOOM, MAX_MANUAL_ZOOM]`. Zoom semantics unchanged: `scale = coverScale × zoom`; `zoom < 1` now means **contain‑ish**.
2. `clampCenter` / `computePhotoPlacement`'s position clamps assume `imgSize ≥ frameSize` (`clamp(x, w−imgW, 0)` — min > max when the image is smaller, producing garbage). Generalize: when `imgSize < frameSize`, the valid range flips to `[0, w−imgW]` (image stays fully inside the frame). One shared helper, used by both placement and `constrainManualFrame`, so canvas gestures and the modal stay in lockstep (this invariant already has a mandated round‑trip test in the v2 plan — extend it below 1).
3. `getInitialManualFrame` is unchanged, but add **`getFitSubjectsFrame(photo): ManualFrame`** — computes the zoom that makes the full `SubjectBox` visible (`zoom = min(1, tightness‑free contain of the subject)`, centered on the subject). This powers a one‑click **"Fit subjects"** button — the user's actual goal, not "zoom out and fiddle".

`MAX_MANUAL_ZOOM` import note from the video review applies here too: all zoom bounds come from `photoFraming.ts` constants — no literals in components.

### 2.3 Echo render spec

When the foreground placement underfills its cell (image rect ⊉ cell rect, with a 0.5 px tolerance), the cell renders **two copies** of the same image inside one clip:

```
Layer order inside the cell clip:
  1. cell background color
  2. ECHO backdrop: same image, scale = coverScale × echoScale (echoScale default 1.0 ⇒ exact cover),
     centered on the SAME (cx, cy) as the foreground → the backdrop is a coherent
     "continuation" of the foreground, not a random crop. Optional blur + dim applied.
     listening = false (never intercepts gestures).
  3. FOREGROUND: the user's zoomed-out placement, drawn on top.
```

- **Defaults match the user's manual workflow: blur 0, dim 0** (plain enlarged copy). Options per photo: `blur 0–40 px`, `dim 0–60 %`, and a one‑tap "Soft" preset (blur 16, dim 25) for users who want the conventional look.
- **Blur implementation:** pre‑blur into a cached offscreen canvas **per (photo, blur)** — *not* Konva filters (Konva blur requires node caching and re‑caches on every drag frame; a pre‑baked bitmap keeps 60 fps and exports identically). Dim = a black rect at `opacity = dim` above the echo, below the foreground.
- **Foreground edge treatment:** optional thin outline / soft shadow on the foreground copy (default **off**, matching the reference). One boolean + reuse the existing stroke controls pattern.
- **Transparent‑PNG photos:** echo of a transparent image leaks the background through — acceptable; the cell background (layer 1) is the final fallback. Document, don't special‑case.

### 2.4 Data model & activation

```ts
// types.ts
EchoFill = { mode: 'auto' | 'off'; blur: number; dim: number; outline: boolean }
Photo (grid usage) gains: echo?: EchoFill        // default { mode:'auto', blur:0, dim:0, outline:false }
```

- **`auto` (default):** echo renders *only when* the placement underfills the cell — zooming back past cover makes it disappear. No mode juggling for the user; the wheel gesture transitions seamlessly from "crop tighter" through cover into "zoom out with echo".
- **`off`:** underfill shows the cell background instead (some designs want the matte look).
- Echo settings are **per photo** (travel with swaps, like `manualFrame`), edited in `FrameEditorModal` (new compact row: Fit subjects · echo blur · dim · Soft preset) and surfaced as a quick toggle on the selected cell.
- Persistence: included in the grid session snapshot per v2 §9 scope (settings yes; photo bytes still no).

### 2.5 Scope: every family

Echo Fill lives in the **cell renderer** (`GridCell` + the hero/SVG cell equivalents), keyed only on (placement, cellRect/clip). No engine or scoring involvement. Mosaic rect cells get it for free; Hero‑Center and SVG sections are where it shines (shaped clips made cover‑cropping fail in the first place).

---

## 3. UI deltas (consolidated)

- **Family control becomes three‑way:** `Mosaic | Hero center | SVG template` (extends v2 §6.3's segmented control).
- **SVG template active:** control row = template picker (built‑in papa + recents + Upload), "Show cut lines" toggle + stroke width/color, numbered‑badges toggle. Aspect/gutter/radius controls disabled with tooltips.
- **Frame editor additions (all families):** zoom slider range now 0.25–4 with a marked "cover" detent at 1; **Fit subjects** button; echo controls row (visible whenever zoom < cover or mode forced).
- **Canvas affordances:** underfilled cell without echo (`off`) shows a subtle hatch in empty areas while selected, so "why is there background here" is self‑explaining.
- Copy: zoom‑out hint under the editor slider — "Below 100 %, the photo's enlarged copy fills the background (Echo)."

## 4. Persistence deltas

`cm.grid.v2` snapshot adds: `family: 'svgTemplate'` option, `svgTemplateId`, stroke‑overlay settings. New `cm.grid.svgTemplates` store (sanitized, LRU ≤ 12). Echo defaults are global settings; per‑photo echo lives with session photos (not persisted across reload, same as manual frames — v2 §9 unchanged).

## 5. Tests

### 5.1 Parser (`svgTemplate.test.ts`, fixture‑driven, no DOM beyond DOMParser/jsdom)
- **papa.svg fixture:** parses to **exactly 4 cells**; visual order = P, A, P, A (assert bbox `minX` ascending); aspect ≈ 2.444 ± 0.01; zero holes; every cell mask non‑empty.
- Compound path vs. equivalent 4 separate `<path>` elements ⇒ identical cells (synthesized fixture).
- Hole classification: donut fixture (circle‑in‑circle) ⇒ 1 cell + 1 hole; letter "Á" style fixture with counter + accent ⇒ accent is its own cell, counter is a hole.
- Filters: speck < 0.5 % dropped; unclosed‑but‑closable contour accepted; empty/garbage SVG ⇒ typed errors.
- Determinism: parse twice ⇒ deep‑equal.

### 5.2 Framing math (`photoFraming.test.ts` extensions)
- `zoom = 0.25..1`: position clamps keep the image fully inside the frame (no inverted‑clamp NaN/garbage — regression for the §2.2 bug class); `zoom = 1` boundary identical to current behavior (no visual change for existing users).
- `getFitSubjectsFrame`: synthetic subjects at corners/edges ⇒ subject box fully visible at returned frame; no subject ⇒ contain‑whole‑image fallback.
- Round‑trip (mandated in v2): canvas gesture ↔ modal equality, extended across the zoom < 1 range.

### 5.3 Render/integration
- Underfill detection: cover placement ⇒ no echo node; zoom 0.8 ⇒ echo node present, scale = coverScale, centered on foreground (cx, cy); zoom back to 1 ⇒ echo node gone (auto mode).
- Echo blur uses the cached bitmap (assert no Konva filter on the node); export at 4× pixelRatio: echo/foreground placement ratio preserved (sample‑point check).
- SVG template end‑to‑end: load papa, drop 4 photos ⇒ assigned in visual order; 3 photos ⇒ 4th cell placeholder; 5 photos ⇒ 1 unplaced badge; swap between letter cells works; stroke overlay aligns with cells at 1× and 4×.

### 5.4 Goldens & QA
- Goldens: papa template × {4 portraits, mixed orientations} × stroke on/off; echo {plain, Soft} on a shaped cell.
- QA matrix additions: CorelDRAW/Illustrator/Inkscape exports (each emits different `d` styles), template with 30+ sections (error path), echo during live drag (fps), Tauri macOS + Windows.

## 6. Performance
- Parse once per template (idle ≤ 10 ms for papa‑class files); polylines and 16×16 masks cached on the template object.
- Echo: pre‑blurred bitmap cached per (photoId, blur); invalidate on photo replace. Two image nodes per echoed cell is negligible for ≤ 30 cells.
- No engine cost: `svgTemplate` skips generation entirely.

## 7. Phased delivery (continues the v2 phase numbering)

| Phase | Scope | Exit criteria |
|---|---|---|
| **8 — Echo Fill** | framing‑math generalization (§2.2), echo renderer + cached blur, Fit subjects, editor controls; all families' cell renderers | §5.2–§5.3 echo tests green; zoom=1 behavior byte‑identical for existing sessions |
| **9 — SVG Template family** | parser + fixture, family wiring (lock aspect, bypass engine), section renderer (clip + holes + badges + stroke overlay), template manager + persistence, shuffle‑as‑redeal | papa end‑to‑end flow green; parser suite green; goldens approved |
| **10 — Polish & ship** | QA matrix, a11y (template picker semantics, badge labels), copy, docs update | sign‑off; flag unchanged (`grid.v2`) |

Echo first (Phase 8) deliberately: it's self‑contained, de‑risks the framing‑math change early, and Phase 9's letter cells immediately benefit.

## 8. Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Wild real‑world SVGs (transforms on paths/groups, `use`, arcs) | high | flatten transforms during polyline sampling (DOM `getPointAtLength` approach in `parseShapePolyline` already resolves geometry); explicit unsupported‑feature errors beat silent misparse; QA matrix covers 3 vector editors |
| Zoom<1 regressions in existing cover‑only surfaces (Shape/Flipbook use the same `photoFraming.ts`) | med | those surfaces keep their own zoom floors at call sites (`Math.max(1, zoom)`) until they opt in; boundary test in §5.2 |
| Echo + blur memory (large photos × several blur values) | low | cache keyed per photo holds **one** blurred bitmap (latest blur), downscaled to ≤ 2× cell size |
| Even‑odd clip support in Konva clipFunc across browsers | low | clip via explicit winding (outer CW, holes CCW) + nonzero rule — equivalent and universally supported; verify in goldens |
| Hole misclassification on touching contours | med | containment test uses interior sample point, not bbox; donut/Á fixtures lock behavior |

## 9. Open questions
1. **Echo defaults:** plain (blur 0 — matches the user's manual workflow) confirmed as default? "Soft" preset values (16 px / 25 %) need a design pass.
2. **Echo zoom floor:** is 0.25 enough, or do extreme group shots need 0.15?
3. **Cut‑file export (v1.1):** raster+vector hybrid PDF, or separate photo‑PDF + cut‑SVG pair? (Laser workflows usually prefer the pair.)
4. **Built‑in template set:** ship only papa.svg, or commission MAMA/LOVE/2026 siblings for launch?
5. **Tray semantics with templates:** should tray reorder re‑deal assignments live (proposed: yes — tray order *is* assignment order, §1.3)?

---

### Definition of done
papa.svg loads as a built‑in template; 4 photos drop into P‑A‑P‑A in visual order with subject‑aware framing; any cell can zoom out below cover and the echo backdrop fills the letter coherently; Fit subjects works one‑click; cut‑line overlay aligns at export resolutions; all new tests + goldens green on web and both desktop targets; v2 doc's family architecture notes updated to three families.
