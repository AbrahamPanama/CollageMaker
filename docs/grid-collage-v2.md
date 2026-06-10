# Grid Collage v2 — Auto‑Generated Layouts, Subject‑Aware Framing, Production Feature Set

**Status:** Approved plan — ready for implementation · **Owner:** Grid team · **Target:** Production (web + Tauri desktop)
**Last updated:** 2026‑06‑09
**Audience:** the implementing engineer. This document is the contract: module boundaries, algorithms, data model, UX, tests, and rollout are specified here. No code in this doc — signatures are contracts, not implementations.

---

## 0. Executive summary

Replace the current fixed‑template grid (`LAYOUTS[6]`, slot‑click‑to‑upload, no framing intelligence) with a **generative layout engine**: the user loads photos, the app **computes mosaic templates from the photos themselves** (count + aspect ratios + detected subjects), adapts them live to the **chosen canvas aspect**, and frames every cell automatically on its subject — with the same manual override system used everywhere else in the app.

Three pillars:

1. **Layout engine (the centerpiece).** A pure, deterministic, seedable generator built on **aspect‑aware binary partition trees**. Photos in → scored layout candidates out. No fixed templates anywhere.
2. **Unified photo model.** Grid migrates from its private `PhotoState {src,x,y,scale}` to the app‑wide `Photo {id,src,naturalWidth,naturalHeight,subject,manualFrame}` so `detectSubject()`, `computePhotoPlacement()`, and `FrameEditorModal` work in grid identically to Shape and Flipbook modes.
3. **Production UX.** Batch ingestion with a photo tray, generated‑variant strip ("templates" become live candidates), shuffle, cell swap via drag, hero pinning, gutter/corner/background controls, expanded + custom aspect ratios, persistence, polished export.

Everything reuses existing app machinery where it exists; the only genuinely new subsystem is the layout engine, which is pure math and fully unit‑testable.

---

## 1. Current state (what we're replacing) — read this before coding

| Area | Today | Problem |
|---|---|---|
| Templates | 6 hardcoded `Layout`s in `src/layouts.ts` | Fixed slot counts; doesn't react to the photos |
| Photo model | `PhotoState {src,x,y,scale}` keyed by slot index (`Record<number, PhotoState\|null>`) | Incompatible with `Photo`/`SubjectBox`/`ManualFrame`; no detection; framing is raw pan/zoom only |
| Ingestion | One file per slot via hidden input; `FileReader` → dataURL | No batch, no drag‑drop, no tray, no reorder |
| Layout change | `handleLayoutChange` **wipes all photos** | Destructive; unacceptable |
| Aspects | 1:1, 4:5, 9:16 | Too few; no landscape, no custom |
| Framing | Manual wheel‑zoom + drag in `PhotoSlot` | No subject detection, no auto close‑up, no frame editor, state in pixels (not portable across resize/export sizes) |
| Persistence | None | Settings lost per session |
| Export | PNG/JPG via stage `toDataURL` + `downloadExport` | Fine — keep; ensure framing survives pixelRatio scaling |

Files to be replaced or heavily reworked: `src/layouts.ts` (deleted), `src/views/GridCollage.tsx`, `src/components/CollageStage.tsx`, `src/components/PhotoSlot.tsx`, `src/components/LayoutPicker.tsx` (deleted). `src/utils.ts` slot math is superseded by the engine's gutter‑aware rect computation (keep `coverScale` if still referenced elsewhere).

Existing machinery to **reuse, not rebuild**: `detectSubject()` (`smartFrame.ts` — accepts image/canvas/bitmap, returns normalized `SubjectBox`), `computePhotoPlacement()` / `constrainManualFrame` / `MAX_MANUAL_ZOOM` (`photoFraming.ts`), `FrameEditorModal` (takes `photo`, `aspectRatio`, `closeUpTightness`, `onSave(photoId, frame)`), `downloadExport` (`export.ts`, Tauri‑aware), `settingsStore.ts` (snapshot/profile persistence patterns), `ExportModal`.

---

## 2. Goals & non‑goals

### 2.1 Goals
1. **Generative templates:** layouts derive from the loaded photos (count, aspects, subjects). Adding/removing a photo re‑generates; user tweaks survive where possible.
2. **Aspect adaptation:** switching canvas aspect re‑solves the same layout structure — photos re‑accommodate, nothing is wiped.
3. **Auto framing:** every cell auto‑frames on its photo's subject (faces first, smartcrop fallback), with a global Auto close‑up toggle + tightness, identical semantics to Shape mode.
4. **Manual framing:** per‑cell override via `FrameEditorModal` *and* direct on‑canvas pan/wheel‑zoom — both write the same `ManualFrame`, so they're interchangeable and survive aspect/layout changes.
5. **Variant choice:** show the top‑K scored layout candidates as a strip; **Shuffle** generates a new batch from a new seed. Deterministic: same photos + seed ⇒ same layouts.
6. **Production UX:** batch upload, drag‑drop, photo tray with reorder/remove, cell‑to‑cell photo swap, hero pin, gutter/corner‑radius/background controls, expanded + custom aspect list, persistence, a11y, graceful edge cases.
7. **Performance:** layout generation < 50 ms for ≤ 30 photos; 60 fps canvas interaction; detection lazy and cached per photo.

### 2.2 Non‑goals (v1)
- Freeform/overlapping collage (non‑grid), rotation of cells, polaroid/scrapbook styles.
- Text/sticker layers in grid mode (Shape mode owns text).
- Undo/redo stack (design data model to permit later; out of scope now).
- IndexedDB image persistence across sessions (settings persist; image bytes do not — see §9).
- Server anything. Fully on‑device, as the rest of the app.

---

## 3. The layout engine (centerpiece)

### 3.1 Model: aspect‑aware binary partition tree

A layout is a **full binary tree** with one leaf per photo. Each internal node splits its rectangle either **H** (children side‑by‑side) or **V** (children stacked). Aspect ratio is defined as `a = w/h` throughout.

Aspect composition laws (the math the whole engine rests on):

```
H node (side-by-side, same height):   a_node = a_left + a_right
V node (stacked, same width):         1/a_node = 1/a_top + 1/a_bottom
```

Split fractions when laying out top‑down:

```
H node:  w_left / w_node = a_left / (a_left + a_right)
V node:  h_top  / h_node = a_bottom / (a_top + a_bottom)        // derived from 1/a law
```

**Procedure:** assign each leaf its photo's native aspect (clamped, §3.6), compute every node's *natural aspect* bottom‑up via the laws above, then **force the root rect to the target canvas** and lay out top‑down using the natural fractions. Each leaf's resulting aspect deviates from its photo's natural aspect by a factor that the scorer bounds; that residual deviation is exactly what the cover‑crop absorbs — and because cropping is **subject‑aware** (§5), bounded crops are visually safe.

Why this model: it generates exactly the look in the reference mosaics (mixed cell sizes, clean shared gutters), it adapts to any canvas aspect by *re‑solving fractions without changing the tree*, it is trivially seedable/deterministic, and it is pure math — fully unit‑testable with no DOM.

### 3.2 Candidate generation

`generateLayouts(photoMetas, targetAspect, options, seed) → ScoredLayout[]`

- **photoMetas:** `{ id, aspect, hasFace, subjectArea, heroPinned }[]` — the engine never touches pixels.
- For **N ≤ 8**: sample broadly — random balanced/unbalanced tree shapes × orientation assignments × leaf permutations (seeded PRNG, e.g. mulberry32). Budget ~200–400 candidates.
- For **N ≤ 30**: stochastic search — start from K random trees, hill‑climb with local moves: *swap two leaves*, *flip a node's orientation*, *rotate a subtree*. Accept improving moves; a few annealing steps to escape local minima. Hard time budget **50 ms** (early‑exit on budget, return best‑so‑far).
- Output: **top‑K (default 8) distinct** layouts by score, deduplicated by cell‑rect signature (rounded to 1e‑3).
- Determinism: identical `(photoMetas order, targetAspect, options, seed)` ⇒ identical output. **Shuffle** = new seed. Seed is persisted (§9) so a reloaded session shows the same variants.

### 3.3 Scoring function

`score(layout) = Σ wᵢ · penaltyᵢ` (lower is better). All penalties normalized to ~[0,1]:

| Penalty | Definition | Default weight |
|---|---|---|
| **aspectFit** | mean over leaves of `\|log(a_cell / a_photo)\|`, after root forcing | 1.0 |
| **subjectSafety** | per leaf: fraction of the photo's `SubjectBox` that falls outside the cell's cover‑crop window at the auto‑framing position; 0 if subject fully visible | 1.4 (highest — never cut faces) |
| **areaBalance** | deviation of cell‑area distribution from a target spread (we *want* hierarchy: largest cell 2–4× smallest, not 20×): penalize `max/min > 5` and `max/min < 1.3` | 0.6 |
| **heroBoost** | hero‑pinned photo not in the largest cell → penalty proportional to rank distance | 0.8 |
| **faceWeighting** | photos with faces should rank above the median cell area; penalty per violation | 0.4 |
| **minCell** | any cell smaller (post‑gutter) than `MIN_CELL_FRACTION` (default 0.06 of canvas min dimension) → heavy penalty | 2.0 (effectively a constraint) |
| **adjacencyVariety** | fraction of internal edges whose two cells have area ratio within 10% (monotony) | 0.2 |

Weights are constants in one place (`gridLayout/scoring.ts`) — tune during Phase 2 review with the design goldens (§11.3).

### 3.4 Stability across edits (assignment churn)

When the photo set changes (add/remove/reorder) or Shuffle is pressed, naive regeneration rearranges everything — disorienting. Requirements:

- **Photo identity matters, not slot index.** Cells reference `photoId`.
- After regeneration, choose the candidate→photo assignment that **minimizes total displacement** vs. the previous layout: greedy match of each photo to the candidate cell with highest IoU against its previous cell (Hungarian is overkill at N ≤ 30; document the greedy order: largest previous cell first).
- A photo whose cell the user **locked** (🔒 on a cell) keeps a cell with IoU ≥ 0.5 if any candidate provides one; candidates violating locks get a large score penalty rather than hard rejection (so the strip still fills if locks are unsatisfiable).
- `ManualFrame` lives on the **photo**, not the cell, so a photo carries its manual crop with it through any relayout. (Manual frames are center+zoom relative to the cell aspect; when the cell aspect changes > 15%, show a subtle "re‑check crop" badge on that cell rather than silently discarding the manual frame — `constrainManualFrame` already clamps safely.)

### 3.5 Aspect‑ratio changes

Tree structure is aspect‑independent. On canvas aspect change: keep the selected tree, recompute natural fractions bottom‑up, force the new root rect, re‑lay out. **Never** regenerate candidates on aspect change alone (photos must visibly "re‑accommodate", not reshuffle). Re‑scoring may reorder the *variant strip*, but the selected layout persists until the user picks another or shuffles.

### 3.6 Degenerate inputs (engine‑level rules)

- **Aspect clamp:** leaf aspects clamp to `[1/3, 3]` for tree math (a 10:1 panorama would otherwise starve siblings). The *photo* still cover‑crops inside its cell; the clamp only bounds the cell shape. Panoramas therefore appear as wide-ish cells, cropped subject‑aware.
- **N = 1:** single full‑bleed cell (degenerate tree). N = 2: the two orientations are the only shapes; strip shows both plus fraction variants.
- **N = 0:** engine returns `[]`; UI shows empty state.
- **Cap N at 30** (`MAX_GRID_PHOTOS`); ingestion beyond the cap is rejected with a toast ("Grid supports up to 30 photos").
- **Identical/duplicate photos:** allowed, no special handling.
- Gutters (§6.2) are applied **after** solving, by insetting cell rects; `minCell` is evaluated post‑gutter.

### 3.7 Module layout & contracts

New pure modules (no React, no DOM — Node‑testable):

```
src/gridLayout/
  types.ts        // PhotoMeta, LayoutTree, GridCell {id, rect, photoId}, ScoredLayout, GenOptions
  tree.ts         // build/compose/solve: naturalAspect(tree), layoutTree(tree, rootRect) → cells
  generate.ts     // generateLayouts(metas, targetAspect, options, seed) → ScoredLayout[]
  scoring.ts      // score(layout, metas, options) → {total, breakdown}
  stability.ts    // matchAssignments(prevCells, nextLayouts, locks) → assigned ScoredLayout[]
  rng.ts          // mulberry32(seed); the ONLY randomness source in the engine
```

All rects normalized `[0,1]²`; pixel conversion happens only at render/export. `GenOptions = { topK, gutterFraction, minCellFraction, weights?, locks? }`.

---

## 4. Unified photo model & ingestion

### 4.1 Migration

Grid adopts the app‑wide `Photo` type. Grid‑level state:

```
GridState = {
  photos: GridPhoto[]            // GridPhoto = Photo & { name: string }
  selectedLayoutId: string | null
  seed: number
  lockedPhotoIds: Set<string>
  heroPhotoId: string | null
  aspect: AspectChoice           // preset id or {custom: {w,h}}
  gutter: number                 // 0..40 px at base stage scale (persisted as fraction)
  cornerRadius: number           // 0..32 px
  background: string             // hex
  closeUp: boolean               // auto close-up on subjects
  closeUpTightness: number       // 0.4..0.95, default 0.75 (same as Shape mode)
}
```

`PhotoState`, the per‑slot `Record<number,…>`, and pixel‑space pan/zoom are **deleted**. There is no slot index anywhere in v2 state.

### 4.2 Shared ingestion helper (de‑duplication refactor)

`FlipbookMaker` has a private `loadPhoto(file): Promise<FlipbookPhoto>` (decode → `detectSubject` → `Photo`). **Extract it** to `src/photoIngest.ts` as `loadPhoto(file: File): Promise<(Photo & {name: string}) | null>` and reuse from Flipbook *and* Grid (Shape mode migration optional, later). One implementation of: file→objectURL/dataURL, image decode, detection with progress, id generation.

Grid ingestion behaviors:
- Multi‑file input + folder‑drop tolerant drag‑drop on both the tray and the empty canvas; filter `image/*`; sequential detection with the existing `analyzing {done,total}` progress pattern.
- Detection results cached on the `Photo` (as today); re‑detection never runs twice for the same photo.
- EXIF orientation: browsers honor it at decode (`image-orientation` default); no extra work, but add a QA item (§11.4).

---

## 5. Framing system (auto + manual)

### 5.1 Auto framing (per cell)

Rendering a cell = `computePhotoPlacement(photo, cellW, cellH, { closeUp, closeUpTightness })` — exactly the Shape‑mode call. It already handles: cover scaling, subject‑centered close‑up with `MAX_AUTO_UPSCALE`, manual‑frame override precedence, and clamping. **No new placement math.** The grid renderer draws `KonvaImage` at the returned `{x,y,w,h}` inside a clipped cell group (rounded clip when `cornerRadius > 0`).

### 5.2 Manual framing — two surfaces, one source of truth

Both write `photo.manualFrame: ManualFrame {cx, cy, zoom}` via the same update path:

1. **FrameEditorModal** (existing): opened from a cell's ✎ affordance or double‑click. Pass `aspectRatio = cellRect.w/cellRect.h × (stageW/stageH)` (the cell's *pixel* aspect), `closeUpTightness` from settings. The modal must **seed from `photo.manualFrame` when present** — this is the same gap found in the video feature review (FrameEditorModal currently re‑inits from `getInitialManualFrame` and ignores an existing manual frame). Fix it once in the modal; both Grid and Video benefit. Add `onReset` → clears `manualFrame`, returning the cell to auto.
2. **Direct canvas gestures:** drag pans, wheel zooms — but unlike the old `PhotoSlot`, gestures **convert to `ManualFrame` updates** (`cx, cy` from pan offset relative to image size; `zoom` relative to cover scale; clamp via `constrainManualFrame` / `MAX_MANUAL_ZOOM`). This makes gestures resolution‑independent (export at any pixelRatio renders identically) and means the modal and the canvas always agree.

Per‑cell badge (small dot, like Flipbook's `tile-manual`/`tile-face` classes) indicating framing source: face/smartcrop/manual.

### 5.3 Subject data → engine feedback loop

`photoMetas` passed to the engine include `hasFace` and `subjectArea` so the scorer can (a) keep subjects uncut (`subjectSafety`) and (b) bias faces to larger cells (`faceWeighting`). When detection finishes *after* layouts were generated (async ingest), re‑run `generateLayouts` once with the enriched metas, preserving the seed — deterministic, no churn for the user (cells keep assignments via §3.4).

---

## 6. Canvas, style controls, and aspect system

### 6.1 Aspect ratios

Replace the 3 presets with: **1:1, 4:5, 3:4, 2:3, 9:16, 16:9, 3:2, 4:3, A4 (1:√2) portrait + landscape**, plus **Custom** (W×H numeric fields, 0.2 ≤ a ≤ 5 validated). Persist the choice. Stage sizing keeps the `MAX_STAGE_DIM = 600` fit logic but generalized for any aspect (cap *both* dimensions).

### 6.2 Style controls (toolbar)

- **Gutter:** 0–40 px (stored as a fraction of canvas min‑dimension so export scales correctly). Applied by insetting each cell rect; outer margin equals gutter (uniform look, like the reference image). The old edge‑aware `computeSlotRect` half/full inset logic is replaced by: inset every internal edge by `gutter/2`, every canvas edge by `gutter` — same visual result, computed in the engine's pixel‑mapping step.
- **Corner radius:** 0–32 px per cell (rounded clip path).
- **Background:** color swatch (gutter color); default app dark; full‑canvas fill behind cells.
- **Auto close‑up:** toggle + tightness slider (0.4–0.95), global, same copy as Shape mode.
- **Shuffle:** new seed → new candidate batch → variant strip refreshes; selected layout replaced by new rank‑1 *only if* the user hadn't explicitly picked a variant this session (otherwise keep selection, flash the strip).

### 6.3 Variant strip (replaces LayoutPicker)

Top‑K candidates rendered as mini wireframe SVGs (reuse the current picker's rect‑preview pattern, but generated from `ScoredLayout.cells`). Selected variant highlighted; click switches instantly (assignments via §3.4 stability matching; photos never reload). Keyboard navigable (roving tabindex, arrow keys).

### 6.4 Cell interactions

- Click cell → select (ring highlight); `Esc` deselects.
- Double‑click / ✎ → FrameEditorModal.
- **Drag photo onto another cell → swap** the two photos (assignments swap; manual frames travel with their photos). Visual drop highlight, same pattern as Flipbook's tray reorder.
- Right‑side mini‑actions on selection: Edit frame · Hero pin · Lock cell · Remove photo.
- Removing a photo triggers regeneration at N−1 (stability matching keeps the rest still).

---

## 7. Component & file plan

| File | Action | Contents |
|---|---|---|
| `src/gridLayout/*` | **new** | pure engine (§3.7) |
| `src/photoIngest.ts` | **new (extracted)** | shared `loadPhoto` (§4.2); Flipbook refactored to import it |
| `src/views/GridCollage.tsx` | **rewrite** | state (§4.1), engine orchestration, toolbar, tray, variant strip, export wiring |
| `src/components/GridStage.tsx` | **new** (replaces `CollageStage`) | Konva stage; renders `GridCell[]` + photos via `computePhotoPlacement`; selection, gestures, swap DnD |
| `src/components/GridCell.tsx` | **new** (replaces `PhotoSlot`) | one clipped cell: image, rounded clip, badges, gesture→ManualFrame |
| `src/components/GridTray.tsx` | **new** | batch upload, thumbnails, reorder, remove, hero/lock indicators, progress |
| `src/components/VariantStrip.tsx` | **new** | top‑K wireframes (§6.3) |
| `src/layouts.ts`, `src/components/LayoutPicker.tsx` | **delete** | superseded |
| `src/components/PhotoSlot.tsx`, `src/components/CollageStage.tsx` | **delete** after Phase 3 | superseded |
| `src/components/FrameEditorModal.tsx` | **patch** | seed from existing `photo.manualFrame` (§5.2) — shared fix |
| `src/utils.ts` | **prune** | remove `computeSlotRect`/`clampPhotoPos` when last reference dies; keep `coverScale` if used elsewhere |
| `src/index.css` | extend | `cm-grid-*` v2 styles; remove dead v1 selectors |

Export path unchanged: stage `toDataURL` with `pixelRatio = exportWidth/stageW` → `downloadExport`. Because all placement math is normalized (placements derive from cell dims, manual frames are normalized), pixelRatio scaling is automatically correct — add an export‑fidelity test (§11.2).

---

## 8. UX flows (acceptance‑level)

1. **First load:** empty state with a big dropzone ("Drop photos — the layout builds itself"). Dropping 7 photos → progress ("Analyzing 3/7") → canvas shows rank‑1 layout, strip shows 8 variants, faces framed, hero = largest face photo by default (no pin).
2. **Aspect switch 1:1 → 9:16:** same tree re‑solved; cells morph (animate rect transitions ~180 ms); no photo reload, no reshuffle; manual frames preserved.
3. **Add 2 more photos:** regeneration at N=9; existing photos keep approximate positions (stability matching); new photos appear in new cells; toast if cap exceeded.
4. **Manual crop:** double‑click a cell → editor opens **pre‑seeded with the current manual frame if one exists**; save → cell updates; badge turns manual; switching variants keeps the crop with the photo.
5. **Swap:** drag photo from a big cell onto a small one → photos swap cells; each re‑frames automatically (or by its own manual frame).
6. **Shuffle:** strip refreshes with 8 new candidates; selection behavior per §6.2.
7. **Export:** modal preview matches canvas exactly; PNG/JPG at chosen resolution; saved via native dialog on desktop.
8. **Reload (desktop/web):** settings, aspect, seed, gutter/radius/background, closeUp restored; photos must be re‑added (v1 persistence scope), with an empty‑state hint "Your style settings were restored."

---

## 9. Persistence

Follow `settingsStore.ts` patterns (versioned localStorage snapshot, `mergeSettings` for forward compatibility):

- **Persist:** aspect choice, gutter, corner radius, background, closeUp + tightness, last seed, top‑K size. Key: `cm.grid.v2`.
- **Do not persist:** image bytes, photos, manual frames (they reference photo ids that don't survive reload). Rationale: localStorage quotas make dataURL persistence a footgun; IndexedDB image persistence is an explicit v2 follow‑up (note it in code TODO + this doc).
- Profiles: grid settings join the existing profile snapshot shape if trivially compatible; otherwise defer (open question §13).

---

## 10. Performance budgets & tactics

| Operation | Budget | Tactic |
|---|---|---|
| `generateLayouts`, N=30 | < 50 ms | pure math; early‑exit time budget; no allocation in hot loop beyond candidates |
| Variant strip render | < 16 ms | SVG wireframes (no images) |
| Aspect change re‑solve | < 5 ms | fractions only, single tree |
| Cell drag/zoom | 60 fps | gesture writes throttled (rAF) ManualFrame updates; Konva node updates only for the active cell |
| Ingest 30 photos | detection dominated | sequential `detectSubject` with progress (matches app pattern); thumbnails decoded at ≤ 512 px for tray |
| Memory | tray thumbs ≤ 512 px; full images only as Konva images (browser cache) | revoke object URLs on photo removal (same discipline as video feature) |

If `generateLayouts` ever exceeds budget on low‑end hardware, it is **pure** — moving it to a worker is a drop‑in change. Don't build the worker in v1; note the seam.

---

## 11. Testing strategy

### 11.1 Engine unit tests (`src/gridLayout/*.test.ts`, vitest, no DOM)
- **Coverage/partition invariants** (property tests across seeds): cells tile the unit rect exactly — no overlap, no gaps (Σ areas = 1 ± 1e‑6 pre‑gutter; pairwise intersection = 0).
- **Gutter exactness:** post‑inset, neighboring cell gaps = gutter, canvas margins = gutter.
- **Aspect laws:** `naturalAspect` of composed trees matches the H/V formulas; top‑down layout reproduces leaf aspects when root = natural aspect.
- **Determinism:** same inputs+seed ⇒ deep‑equal output; different seeds ⇒ different rank‑1 (statistically).
- **Aspect re‑solve stability:** same tree, two target aspects ⇒ same tree topology, cells morph, assignment unchanged.
- **Scoring:** subjectSafety = 0 when subject fits; minCell violations dominate; hero lands in largest cell for crafted metas.
- **Stability matching:** add/remove one photo ⇒ ≥ 70% of remaining photos keep IoU ≥ 0.3 with previous cells (regression threshold).
- **Clamps & degenerates:** N=0/1/2, panorama clamp, 30‑cap.

### 11.2 Integration
- Render `GridStage` with fixture photos (jsdom + Konva or Playwright component): placement equals `computePhotoPlacement` output; manual gesture writes a `ManualFrame` that `FrameEditorModal` then displays (round‑trip equality); export at 2× pixelRatio yields pixel‑equivalent framing (sample‑point comparison).
- FrameEditorModal seeding fix: open with existing `manualFrame` ⇒ editor shows it (this is a regression test for the shared bug).

### 11.3 Design goldens
- For 5 fixed seeds × {4, 7, 12, 24} photos × {1:1, 4:5, 16:9}: snapshot the variant‑strip SVGs. Reviewed once by eye, then locked as snapshots — catches scoring‑weight regressions.

### 11.4 Manual QA matrix
Orientation mix (all portrait / all landscape / mixed / panorama), faces vs. no faces, duplicates, 1/2/29/30/31 photos, aspect switching mid‑edit, swap + lock + hero combinations, export 1×–4×, EXIF‑rotated phone photos, web (Chrome/Safari) + Tauri macOS/Windows.

---

## 12. Accessibility
- Variant strip: `role="listbox"`, arrow‑key navigation, `aria-selected`.
- Cells: focusable (`tabIndex`), Enter = select, `e` = edit frame, arrow keys nudge manual pan when selected (writes ManualFrame), `Esc` deselect — document in a tooltip.
- Tray: list semantics, reorder via keyboard (Cmd/Ctrl+arrows) optional v1.1; remove buttons labeled with photo name.
- All toolbar controls labeled; sliders with `aria-valuetext` (e.g., "Gutter 12 pixels").
- Color is never the sole indicator (badges have shapes/tooltips); focus rings on dark theme ≥ 3:1.

---

## 13. Open questions (resolve before/during Phase 1)
1. **Profiles integration:** do grid settings join the existing Shape‑mode profile system now, or stay session‑only until profiles get a per‑mode namespace? (Recommend: defer, separate key.)
2. **Variant count K:** 8 proposed. Confirm with design after first goldens.
3. **Hero default:** auto‑pin the largest‑face photo, or no default hero? (Proposed: face‑weighting only, no auto‑pin.)
4. **Cell animation:** rect morph on aspect/variant change — ship in v1 or polish phase? (Proposed: v1, it sells the "re‑accommodate" story; trivially done via Konva tweens.)
5. **`closeUpTightness` shared with Shape mode's setting or grid‑local?** (Proposed: grid‑local, same default 0.75.)

---

## 14. Phased delivery plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Foundations** | Extract `photoIngest.loadPhoto`; patch `FrameEditorModal` manual‑frame seeding; add `gridLayout/` scaffolding + types | Flipbook unaffected (tests green); modal regression test passes |
| **1 — Engine** | `tree.ts`, `generate.ts`, `scoring.ts`, `stability.ts`, `rng.ts` + full unit suite (§11.1) | all engine tests green; 50 ms budget met at N=30 (CI perf assertion) |
| **2 — Render** | `GridStage`/`GridCell` on generated layouts; gutter/radius/background; aspect system + custom; variant strip; basic select | visual goldens approved; aspect morphing works |
| **3 — Framing** | auto close‑up wiring; gestures→ManualFrame; FrameEditorModal integration; badges | round‑trip framing tests green; old PhotoSlot/CollageStage deleted |
| **4 — Tray & interactions** | batch ingest, tray, swap DnD, hero, lock, remove, shuffle, stability matching live | UX flows 1–6 (§8) demoable end‑to‑end |
| **5 — Production polish** | persistence, export fidelity test, perf pass, a11y pass, QA matrix, copy | all §8 flows + QA matrix pass on web + both desktops |
| **6 — Ship** | flag removal, docs update, changelog | sign‑off |

Each phase lands as its own PR against `main`, behind a `grid.v2` feature flag until Phase 6 (the old grid remains the fallback until Phase 3 completes, then v2 becomes default‑on under the flag).

---

## 15. Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Scoring weights produce ugly layouts for edge mixes (all panoramas, 29 squares) | med | goldens + weight constants in one file + QA matrix axes target exactly these |
| Stability matching feels "jumpy" on add/remove | med | regression threshold test (§11.1); tune IoU matching before Phase 4 exit |
| Konva perf with 30 clipped, rounded, draggable cells | low | only active cell listens to drag; static layer for non‑selected cells; measured in Phase 2 |
| Gesture→ManualFrame math diverges from modal math | med | single shared conversion helper in `photoFraming.ts`; round‑trip test is mandatory |
| Scope creep toward freeform collage | med | §2.2 non‑goals; freeform is a different product surface |

---

### Definition of done
All §2.1 goals demonstrable; §8 flows pass on web + Tauri macOS/Windows; engine + integration + golden tests green in CI; budgets (§10) met; no fixed template code remains; this document updated to "Implemented" with deviations noted.
