# Lego — Manual Repositioning + Gaussian Echo Zoom — Implementation Assessment

**Status:** Proposed · **Owner:** Lego team · **Target:** Production (web + Tauri desktop)
**Last updated:** 2026‑06‑18
**Parent:** [lego-set-builder.md](lego-set-builder.md), [lego-3d-preview.md](lego-3d-preview.md). Echo prior art: [grid-svg-template-and-echo-fill.md](grid-svg-template-and-echo-fill.md) §2.

---

## 0. Summary — most of this already exists

Both features are **~80% built already** in shared modules; the work is **wiring them into Lego's two render surfaces** plus one genuinely new detail (blur resolution consistency).

What already exists and is reusable as‑is:

| Capability | Where | State |
|---|---|---|
| Manual frame model (`ManualFrame {cx,cy,zoom}`) + clamps (`MIN_MANUAL_ZOOM=0.25`, `MAX_MANUAL_ZOOM=4`) | `photoFraming.ts` | ✅ |
| Frame editor with **drag‑reposition, zoom slider to 0.25×, "Fit subjects", echo blur/dim/outline controls, live blurred echo preview** | `FrameEditorModal.tsx` (`onSave`, `onReset`, `onEchoChange`, `getFitSubjectsFrame`) | ✅ |
| Echo math: `placementUnderfills`, `computeEchoPlacement`, `EchoFill` type on `Photo`, `normalizeEchoFill` (blur 0–40, dim 0–60, outline) | `photoFraming.ts` / `types.ts` | ✅ |
| **Gaussian‑blurred echo bitmap** (cached) | `echoImage.ts` `useBlurredEchoImage(image, blur)` | ✅ |
| Reference composition (blurred echo behind → dim → foreground, clipped) | `GridCell.tsx` | ✅ pattern to copy |
| Lego per‑face manual frame persistence via modal (`handleSaveManualFrame` sets `photo.manualFrame`) | `LegoView.tsx` | ✅ already wired |

What's **missing for Lego** (the actual scope of this work):

1. **On‑canvas** repositioning in the 2D Lego builder (drag‑pan + wheel‑zoom). The modal works; the canvas itself has no gestures (`LegoBuilderCanvas.tsx` only has brick‑select `onClick`).
2. **Echo rendering in the 2D Lego builder** (`LegoBuilderCanvas.tsx` draws only the foreground photo, no echo).
3. **Echo baking in the 3D texture** (`faceRender.ts renderLegoFaceCanvas` draws only the foreground; the 3D preview + any texture‑based output have no echo).
4. **Persisting `echo`** from the modal in Lego (`LegoView` passes `onSave`/`onReset` but not `onEchoChange`).
5. **Lego echo default = blur ON** (grid's `DEFAULT_ECHO_FILL` has `blur:0`; the user wants the echoed copy gaussian‑blurred by default).
6. **Blur resolution consistency** across the modal preview, the 2D Konva stage, the 3D texture, and export — the one real new problem (§3).

---

## 1. Feature A — Manual repositioning

> **Scope: whole‑set, per face — NOT per brick.** Unlike Grid (one photo per cell), Lego has **a single image per face** spread across the entire panel and clipped to the silhouette. "Reposition" means pan/zoom that **one** image behind the mask; the bricks never carry individual photos or individual frames. There is exactly **one `manualFrame` per face** (front, back). No per‑brick framing, selection‑to‑edit, or per‑brick gestures.

### A0. Remove the "brick tools" entirely (product decision)
Split / merge / rotate per‑brick editing is **not useful** — the presets already define the tiling, and users only ever want to reposition the photo. So:

- **Delete the brick‑tools UI**: the split/merge/rotate controls (`LegoBrickTools.tsx`), the brick‑selection state (`selectedBrickId`), and the click‑to‑select interaction on `BrickOutline` in `LegoBuilderCanvas.tsx`.
- The **brick grid becomes a passive, non‑interactive overlay** — purely the cut/seam lines drawn on top of the photo (and the labels can stay or go; they're production aids, not editing affordances).
- **Keep the pure engine functions** (`splitBrick` / `mergeBricks` / `rotateBrick` in `tiling.ts`) and their tests — they're harmless, tested, and may back a future advanced mode. Just don't surface them.
- Net effect: the only manual interaction in Lego mode is **framing** (move + zoom of the whole‑set image), matching how the rest of the app behaves.

### A1. Two reposition surfaces — main canvas **and** sidebar (preferred)
"The same way as the rest of the app" = direct **drag‑to‑pan + wheel‑to‑zoom**, plus the existing frame editor. We offer both, with the sidebar as the primary per the user's preference:

- **Sidebar inline framing widget (preferred).** Replace the modal‑launching **"Frame"** button in the IMAGES row with an **inline, interactive mini‑preview** in the sidebar's FRAMING section, per selected face: a small live render of the framed face that you **drag to pan** and **zoom** (wheel + a zoom slider), writing the face's `manualFrame` live. This is essentially `FrameEditorModal`'s interaction docked into the sidebar instead of a modal — no popup, immediate feedback, and it sits right under the Front/Back image rows. The `FrameEditorModal` can be retired for Lego (or kept as an optional "expand" affordance), but the brick tools and the standalone modal are no longer the primary path.
- **Main canvas (also).** The big panel image is *also* directly draggable + wheel‑zoomable (§A2), so users can reposition right where they see the result. Both surfaces write the same per‑face `manualFrame`.
- Both already flow to the 3D preview and export automatically (single source of truth: `photo.manualFrame`).

### A2. On‑canvas pan + zoom (new) — borrow `GridCell`'s gesture math, apply to the whole panel
Add gestures to the **single panel image** in `LegoBuilderCanvas.tsx` (one drag/zoom moves the entire set's image, the same way the modal already does):

- **Drag** anywhere on the panel → update the active face's `manualFrame.cx/cy` from the pan offset relative to image size (same conversion `GridCell` uses, but the target is the one panel image, not a cell), clamped by `constrainManualFrame`.
- **Wheel** over the canvas → multiply `manualFrame.zoom` by a factor, clamped to `[MIN_MANUAL_ZOOM, MAX_MANUAL_ZOOM]`.
- Writes go up to `LegoView` via a new `onManualFrameChange(face, frame)` callback that updates the active face's photo (reuse the existing `handleSaveManualFrame` path, just driven from the canvas instead of the modal). **One frame per face**, never per brick.
- **Coordinate space:** gestures operate in panel/stage space against the full‑panel image; it's clipped to the heart mask, so panning reveals different regions through the silhouette. The brick grid is irrelevant to framing — it's only the cut/seam overlay on top.
- The 3D preview needs no gesture work — it reads the resulting `manualFrame` from the same photo automatically (one source of truth).

### A3. "Fit subjects" (cheap add)
`getFitSubjectsFrame(photo, w, h)` already exists and is in the modal. Surface a one‑tap **Fit subjects** action in the Lego framing panel too (it's the real intent behind zooming out). Sets `manualFrame` to the zoom that makes the whole `SubjectBox` visible (zoom ≤ 1 → triggers echo, see Feature B).

---

## 2. Feature B — Echo zoom (gaussian blurred)

Behaviour: when a face's framing **underfills** the panel (`placementUnderfills` — i.e. `zoom < cover`, which the user reaches via wheel‑out, the slider, or Fit subjects), render an **enlarged copy of the same image, gaussian‑blurred, behind the foreground**, filling the panel; optional dim; optional foreground outline. `mode:'auto'` shows/hides it automatically; `mode:'off'` falls back to the background color.

### B1. Data + defaults
- `echo: EchoFill` already lives on `Photo` (so `LoadedPhoto` carries it, per face). No model change.
- **New Lego default with blur on.** Define a Lego echo default (e.g. `{ mode:'auto', blur:16, dim:0, outline:false }`) applied when a Lego photo is loaded (or as the `normalizeEchoFill` fallback in the Lego path). This is the only behavioural difference from grid, and it's exactly the user's ask.

### B2. 2D builder (`LegoBuilderCanvas.tsx`, Konva) — copy `GridCell`
Inside the existing mask‑clipped `<Group>`, before the foreground `KonvaImage`:
1. compute `echoPlacement = computeEchoPlacement(photo, width, height, placement)` when `echo.mode==='auto' && placementUnderfills(placement, width, height)`;
2. draw the **blurred** enlarged copy at `echoPlacement` (blur per §3), `listening={false}`;
3. if `echo.dim>0`, a black `Rect` at `opacity=dim/100`;
4. then the foreground `KonvaImage` (optional outline stroke/shadow when `echo.outline`).
All clipped to the **heart mask** (the existing `clipFunc`), not a rectangle. Because the visible‑face export goes through this same Konva stage, **export picks up the echo for free**.

### B3. 3D texture (`faceRender.ts renderLegoFaceCanvas`) — bake the echo
This path is a plain 2D canvas (no React/Konva), so it can't use the `useBlurredEchoImage` hook — bake inline, inside the existing mask clip, in this order:
1. (if not transparent) background fill within the mask — already there;
2. if underfill + `mode:'auto'`: set `ctx.filter = 'blur(<px>)'`, `drawImage(image, echoPlacement…)`, reset `ctx.filter='none'`;
3. if `dim>0`: `fillRect` black at `globalAlpha=dim/100`;
4. foreground `drawImage(image, placement…)` (current code).
Reuse `computePhotoPlacement` + `computeEchoPlacement` so the geometry is identical to the 2D path. `ctx.filter='blur()'` is the same gaussian as the modal/echoImage.

### B4. Wire persistence in `LegoView`
Pass `onEchoChange` to `FrameEditorModal` and persist `photo.echo` on the active face (sibling of `handleSaveManualFrame`). Without this, echo edits in the modal are lost for Lego.

---

## 3. The one real new problem — blur consistency across surfaces

`echo.blur` is a single number, but it's currently applied in **different coordinate spaces** on each surface, so the same value looks different:

| Surface | How blur is applied today | Space |
|---|---|---|
| Modal preview | CSS `filter: blur(${blur}px)` on the placed element | **output** (display px) |
| Grid 2D canvas | `useBlurredEchoImage` blurs the **natural‑res** image, then scales | **source** (varies with image size) |
| 3D texture (to build) | `ctx.filter='blur()'` then drawImage | depends where we put it |
| Export | scales with DPI | depends |

Source‑space blur scales with the image's pixel size and the draw scale → a 4000px photo and a 800px photo get visibly different blur for the same `blur` value, and the 2D editor won't match the 3D texture or export.

**Recommendation (do this for Lego, optionally backport to grid):** define echo blur in **output space** and apply it **after** scaling, with a single conversion so all surfaces agree:

- Treat `echo.blur` (0–40) as output‑px at the **2D editor reference resolution** (the Konva stage).
- Provide one helper, e.g. `echoBlurPx(blur, surfaceScale)`, where `surfaceScale = surfacePanelPx / editorPanelPx`. Then:
  - **2D Konva:** blur in output space — prefer Konva's `blur` filter on the cached echo node (output px), or pre‑blur a canvas rendered at the echo's *output* size, not source size.
  - **3D texture:** `ctx.filter='blur(' + echoBlurPx(blur, texturePanelPx/editorPanelPx) + 'px)'` before drawing the enlarged copy at output size.
  - **Export:** `echoBlurPx(blur, exportPanelPx/editorPanelPx)` so the blur scales with DPI and matches the on‑screen ratio.
- Net effect: the blur reads identically in the editor, the 3D preview, and the printed/exported output, regardless of source photo resolution.

This is the only part that needs care; everything else is reuse.

---

## 4. UI / controls
- **Editor modal:** already complete (drag, zoom 0.25–4, Fit subjects, echo blur/dim/outline, blurred preview) — just wire `onEchoChange` from Lego.
- **Lego framing panel:** add a **Fit subjects** button and a compact **echo** row (blur slider + dim + on/off), mirroring the modal, for quick access without opening it. Default blur on.
- **Zoom affordance copy:** a hint under the zoom control — "Below 100% the photo's blurred copy fills the background (echo)."
- Echo + manual frame are **per face** (front/back), travelling with each photo (both live on `Photo`).

## 5. Edge cases
- **Transparent PNG photo** echo: blurred copy may show the background through; the mask‑clipped panel background (when not transparent) is the fallback — document, don't special‑case.
- **`transparentBg` + echo:** if the user wants a transparent panel, echo still fills behind the foreground within the mask (echo is content, not background) — keep them independent.
- **No photo / zoom ≥ cover:** no echo (auto), exactly as `placementUnderfills` dictates.
- **Very low zoom (0.25):** large empty area → echo essential; blur hides the upscaling of the enlarged copy.
- **3D back face:** echo bakes into the back texture identically; no mirror needed (camera handles it).
- **Blur perf in 3D bake:** `ctx.filter` blur on a ≤2048px texture rebuilds only when photo/frame/echo change (already memoized) → fine.

## 6. Tests
- **Pure (extend `photoFraming.test.ts` / new `echoBlur.test.ts`):** `echoBlurPx(blur, scale)` conversion; `computeEchoPlacement` already covered; underfill thresholds at `zoom = 1 ± ε`.
- **`faceRender` echo bake (`faceRender.test.ts`):** with an underfilling frame, the canvas applies a blur filter and draws the echo layer before the foreground (spy on ctx.filter / drawImage call order); with `zoom ≥ cover`, no echo layer.
- **2D composition (component):** underfill → echo `KonvaImage` present behind foreground, both clipped to mask; zoom back → echo gone.
- **Manual gesture round‑trip:** canvas drag/wheel writes a `manualFrame` that the modal then displays unchanged (parity test).
- **Export parity:** exported visible face at 2× shows the echo with blur scaled to match the editor (sample‑point check).

## 7. Files to touch
| File | Change |
|---|---|
| `src/components/LegoBrickTools.tsx` | **delete** (brick split/merge/rotate UI removed) |
| `src/components/LegoBuilderCanvas.tsx` | remove brick selection/click; brick grid becomes a passive overlay; add drag/wheel → `onManualFrameChange` on the panel image; render blurred echo + dim before foreground, clipped to mask |
| `src/components/LegoFramingWidget.tsx` | **new** — inline sidebar framing mini‑preview (drag‑pan + zoom slider/wheel + Fit subjects + echo blur/dim), per selected face |
| `src/views/LegoView.tsx` | drop `selectedBrickId` + brick‑tools wiring; new `onManualFrameChange` per face; mount the sidebar framing widget; persist `echo` (`onEchoChange`); Lego echo default (blur on) |
| `src/lego/faceRender.ts` | bake echo (blurred enlarged copy → dim → foreground) inside the mask clip |
| `src/photoFraming.ts` (or new `echoBlur.ts`) | `echoBlurPx(blur, scale)` output‑space conversion helper |
| `src/components/echoImage.ts` | (optional) output‑space variant so 2D Konva matches the bake |
| `*.test.ts` | per §6 |

No new dependencies. `FrameEditorModal`, `photoFraming` echo math, and `EchoFill`/`Photo` model are reused unchanged.

## 8. Risks & open questions
| Item | Note |
|---|---|
| Blur space mismatch (modal vs canvas vs 3D vs export) | the core risk; §3 standardizes on output space — mandatory or the preview lies about the print |
| Grid currently mixes blur spaces | Lego fix can be backported to grid for consistency (out of scope unless desired) |
| Konva blur filter requires node `cache()` | re‑cache only on echo/photo change to keep 60 fps; or pre‑blur an output‑size canvas |
| Default blur value | proposed **16** — confirm against a test print/preview; is dim wanted by default (proposed 0)? |
| Should echo show in the **2D builder** or only 3D/export? | proposed: everywhere (WYSIWYG); confirm |

---

### Definition of done
On a Lego face you can drag/zoom the photo on‑canvas and in the modal (same result); zooming below cover fills the panel with a **gaussian‑blurred** enlarged copy that looks identical in the 2D editor, the 3D preview, and the exported/printed face; echo + manual frame persist per face; other modes untouched; new pure/bake/composition tests green on web and both desktops.
