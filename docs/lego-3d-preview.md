# Lego 3D Previewer — Implementation Work Order

**Status:** Implemented v1 · **Owner:** Lego team · **Target:** Production (web + Tauri desktop)
**Last updated:** 2026‑06‑17
**Parent:** [lego-set-builder.md](lego-set-builder.md) — this expands §9 into an implementation-ready spec. The 2D builder, tiling engine, presets, framing, and visible-face export already shipped; this adds the double-sided 3D preview in `LegoView`.

---

## 0. Goal

A real-time, double-sided 3D render of the assembled Lego wall: front face shows the front image, back face the back image, both "printed" on the vertical brick wall. Orbit to inspect; one tap flips front↔back. Lazy-loaded so Three.js never touches the initial bundle. Graceful fallback when WebGL is unavailable (reuse the existing `previewSrc` thumbnail).

**Key insight that simplifies everything:** the printed artwork is **one continuous image spread across the whole panel**, not a per-brick texture. So we render **one textured plane per face** (front image on +Z, back image on −Z) plus **instanced brick bodies** for thickness/edges/studs. This avoids per-instance UV shaders entirely and is trivially 60 fps.

**Orientation note (ties to the export bug we fixed):** in 3D you do **not** pre-mirror the back. The back plane faces −Z with the back image in *normal* orientation; orbiting the camera around shows it correctly. The flat-print mirror (`mirrorBrickForBack`) is a 2D-print-only concern — 3D's camera does the flip for free. Good cross-check that the imposition module belongs only to duplex export.

### v1 implementation notes

- Implemented with `three`, `@react-three/fiber`, and `@react-three/drei`, lazy-loaded behind the Lego 3D toggle.
- Chosen defaults: subtle studs only on exposed top brick surfaces in v1, `meshBasicMaterial`/`toneMapped:false` for printed faces, warm-white plastic brick bodies.
- `renderLegoFaceCanvas()` accepts the already-loaded image element from React and remains the shared pixel helper for texture generation.
- The 2D Konva canvas remains mounted offscreen in 3D mode so existing visible-face export keeps working.
- Browser smoke verified a nonblank 3D canvas, Front/Back flip, WebGL mount, and fallback path wiring. Pure geometry and texture-size helpers are covered by tests.

---

## 1. Dependencies & loading

- Add `three`, `@react-three/fiber`, `@react-three/drei` (regular deps).
- **Lazy-load** the entire 3D component with `React.lazy(() => import('./LegoPreview3D'))` + `<Suspense>`, mirroring how the app already defers MediaPipe/face-api/jsPDF. Nothing from `three` may be imported at module scope in any file that loads on app start — keep all of it inside `LegoPreview3D.tsx` and its children.
- **WebGL capability check** before mounting: try to create a `webgl2`/`webgl` context on a throwaway canvas; if it fails, render the fallback (static `previewSrc` of the current face + a small "3D not available" note). Build/export remain fully functional without WebGL.

---

## 2. Shared face renderer (DRY — build this first)

Both the 3D textures and (eventually) the export bitmap need "the framed image, clipped to the panel mask, as flat pixels." Today `LegoBuilderCanvas` does this in Konva and export goes through `stage.toDataURL`. Extract the canonical pixel truth into a pure helper:

```ts
// src/lego/faceRender.ts
renderLegoFaceCanvas(opts: {
  set: LegoSet;
  photo: LoadedPhoto | null;
  framing: ManualFrame | null;          // per-face manual override
  pxW: number; pxH: number;             // texture resolution (panel px)
  background: string; transparentBg: boolean;
  closeUp: boolean; closeUpTightness: number;
  seams?: { show: boolean; color: string; width: number };  // optional baked brick outlines
}): HTMLCanvasElement
```

Implementation = exactly what `LegoBuilderCanvas` already computes, on a plain 2D canvas:
1. fill background (unless transparent),
2. `computePhotoPlacement(photo, pxW, pxH, { closeUp, closeUpTightness })` (respect `framing` if present, same precedence as the 2D canvas),
3. clip to the mask (`set.cellMask` → rects, same `drawMask` logic),
4. draw the image at the placement,
5. optionally stroke brick footprints (so seams can be baked into the texture).

Texture resolution: `pxW = cols * CELL_TEX_PX`, where columns are stud columns and `CELL_TEX_PX ≈ 48` (matching the old physical density of 96 px per 2-stud coarse cell). Cap the long edge at ~2048 to bound GPU memory. This helper is **pure and unit-testable** and is the single source of pixel truth; a later refactor can route the export bitmap through it too (noted, not required here).

---

## 3. Scene structure (`src/components/LegoPreview3D.tsx`)

```
<Canvas frameloop="demand" shadows dpr={[1, 2]}>
  <PerspectiveCamera> + <OrbitControls> (drei, clamped)
  <Lighting>  hemisphere + key directional (shadow-casting) + ambient fill
  <PanelGroup>            // centered at origin, scaled so max(panelW,panelH)=PANEL_UNITS(=10)
     <BrickBodies/>       // InstancedMesh: one box per brick, plastic material on all faces
     <Studs/>             // InstancedMesh: cylinders on exposed top brick surfaces
     <FacePlane face="front"/>   // textured plane at +Z surface, front face texture
     <FacePlane face="back"/>    // textured plane at −Z surface, back face texture, rotated 180° about Y
  <ContactShadows/> (drei) for the product-render look
</Canvas>
```

### 3.1 Coordinate system
- Work in normalized wall space: panel width `W = cols` stud columns, height `H = rows * (BRICK_HEIGHT_MM / CELL_SIZE_MM)` (brick-course height), depth `D = 2` stud columns (a 2-stud-deep wall). Center the `PanelGroup` at origin: x ∈ [−W/2, W/2], y ∈ [−H/2, H/2] (flip row→y so row 0 is top), z ∈ [−D/2, D/2]. Then scale the whole group by `PANEL_UNITS / max(W, H)`.
- **Pure geometry helper** (`src/lego/preview3d.ts`, unit-tested):
  - `brickTransform(brick, W, H, D)` → `{ position:[x,y,z], scale:[sx,sy,sz] }` for a unit box. `footprint(brick)` gives the front-view occupied cells; width follows footprint columns, height follows brick courses, and depth is the wall thickness.
  - `studPositions(set)` → array of stud centers on exposed top surfaces only. Stud cylinders point upward (`+Y`), not out of the printed face.
  - `faceUV(set)` → UVs for the face plane mapping the panel rect to [0,1] (trivial full-quad; mask transparency comes from the texture's alpha, not UVs).

### 3.2 BrickBodies (InstancedMesh)
- One `BoxGeometry(1,1,1)`; instance count = `set.bricks.length`; per-instance matrix from `brickTransform`. Material: `meshStandardMaterial` plastic (configurable `brickColor`, default warm white #f4f1ea), slight roughness. Receives/casts shadow. This gives the visible **brick edges/seams in real geometry** — no need to bake seams into the texture (set `seams.show=false` for the 3D texture; the geometry shows them). A tiny per-brick inset gap (scale 0.98) reads as the seam between pieces.

### 3.3 Studs (InstancedMesh)
- `CylinderGeometry(studR, studR, studH)` where `studR = (STUD_DIAMETER_MM/2)/CELL_SIZE_MM`, `studH = STUD_HEIGHT_MM/CELL_SIZE_MM`, oriented +Y on the horizontal top surfaces of bricks. Count = exposed top-surface studs, not every masked cell; internal studs are hidden by the brick course above, matching a real wall. Plastic material, low contrast so it reads as Lego without fighting the photo. **v1: studs are geometry only; the printed image is NOT wrapped over stud tops**. "Studs sample the photo" is a deferred v1.1.

### 3.4 FacePlane (the printed artwork)
- A `PlaneGeometry(W, H)` at `z = ±(D/2 + ε)`; front faces +Z, back is rotated `π` about Y so it faces −Z and reads left-correct from behind.
- Material: `meshBasicMaterial` (unlit, so the photo colors are true) **or** `meshStandardMaterial` with low roughness if you want lighting on the print — pick `meshBasic` for v1 fidelity. `map = CanvasTexture(renderLegoFaceCanvas(face))`, `transparent: true` (mask alpha), `toneMapped: false` so colors match the 2D editor.
- The plane sits just in front of the vertical brick face. Studs are on the top surfaces, so the preview reads as a stacked Lego wall rather than a studded platform/baseplate.
- **Back plane = back image, normal orientation** (no mirror). The `rotation-y = π` is the only transform; the texture content is unmirrored.

### 3.5 Textures lifecycle
- Build each face `CanvasTexture` from `renderLegoFaceCanvas`; rebuild **only** when that face's `(photo, framing, background, transparentBg, closeUp, tightness, tiling)` changes — memoize on a hash of those. `texture.needsUpdate = true` on rebuild; `dispose()` the previous.
- Dispose all geometries/materials/textures on unmount. `InstancedMesh` rebuilt only when `set.bricks` identity changes.

---

## 4. Camera, controls, interaction
- `OrbitControls`: enable damping; clamp `minPolarAngle/maxPolarAngle` so the panel can't go fully edge-on or upside down; clamp zoom (`minDistance/maxDistance`). Disable pan (keep the panel centered) or allow gentle pan — default off.
- **Front/Back toggle** (reuse the existing `face` segmented control, or a dedicated one): tween the camera azimuth by `π` over ~500 ms (lerp the OrbitControls target azimuth; or animate camera position around the Y axis). Sync with `face` state so the 2D editor and 3D agree on which side is "current".
- `frameloop="demand"`: call `invalidate()` on control change, tween frames, and texture updates. No continuous RAF when idle (battery/perf, esp. Tauri).
- Optional gentle **auto-rotate** (drei OrbitControls `autoRotate`), default **off**, toggle in the panel.

---

## 5. Integration with LegoView
- Add `viewMode: '2d' | '3d'` state. Center area shows `LegoBuilderCanvas` (2D) or `<Suspense><LegoPreview3D/></Suspense>` (3D). A segmented **2D ⇄ 3D** toggle in the center toolbar.
- Replace the right-panel placeholder ([LegoView.tsx:306‑309](../src/views/LegoView.tsx)) with either the 2D/3D toggle hint or remove it; the `previewSrc` capture stays (feeds both the ExportModal preview and the WebGL fallback).
- Pass to `LegoPreview3D`: `set`, `frontPhoto`, `backPhoto`, `framingFront`/`framingBack` (the per-face `ManualFrame` — wire these into state if not already; today framing is applied via the editor — ensure both faces' frames are retained), `background`, `transparentBg`, `closeUp`, `closeUpTightness`, `face`, `onFaceChange`, `brickColor`.
- Editing still happens in 2D; switching to 3D shows the result. (No direct manipulation in 3D in v1.)

---

## 6. Tests
- **Pure (`preview3d.test.ts`, no WebGL):** `brickTransform` positions/scales for each brick kind+orientation (2×2, 2×3, 2×4 h, 2×4 v, and 1×2 where used) against hand-computed values; `studPositions(set)` only returns exposed top-surface studs; instance count would equal `set.bricks.length`; back-plane rotation = π (constant). Determinism.
- **`faceRender.test.ts`:** canvas dimensions = requested; transparent vs filled background; with no photo → background only; placement matches `computePhotoPlacement` (sample-pixel or spy). This helper is the one with real correctness risk — cover it well.
- **Smoke (component):** mount `LegoPreview3D` under a mocked R3F/WebGL (or `@react-three/test-renderer`); assert it builds `bricks.length` brick instances and two face planes, and disposes on unmount. WebGL-absent path renders the fallback `<img>`.
- **Manual QA:** each preset + heart, front=back image vs different images, transparent bg, flip animation, orbit clamps, Tauri macOS/Windows, WebGL-disabled fallback, large image texture-memory sanity.

---

## 7. Performance budget
| Item | Budget | Tactic |
|---|---|---|
| 3D mount (lazy chunk parse + first frame) | < 400 ms after toggle | lazy import; small scene |
| Build instances + textures | < 100 ms | instancing; textures memoized |
| Interaction | 60 fps | `frameloop="demand"`, 2 planes + 2 instanced meshes |
| Texture memory | bounded | cap face texture long edge ≤ 2048 |
| Initial app bundle | unchanged | three.js never in the startup graph |

---

## 8. Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| WebGL unavailable (old Tauri WebView/Linux) | low‑med | capability check + static `previewSrc` fallback; feature is preview-only, never blocks export |
| three.js bundle weight | med | lazy-loaded behind the 3D toggle only |
| Texture color mismatch vs 2D editor | med | `meshBasicMaterial` + `toneMapped:false`; same `renderLegoFaceCanvas` pixels as the editor |
| Masked (heart) plane shows rectangular artwork | low | texture alpha from mask; instanced bricks already only on masked cells → silhouettes match |
| Studs fighting the photo visually | low | v1 studs subtle/low-contrast; flat-top mapping |
| Memory leaks on repeated 2D⇄3D toggles | med | strict dispose on unmount; memoized textures keyed by content hash |

---

## 9. Open questions
1. **Studs in v1?** Render subtle studs (more "Lego"), or flat brick tops only (cleaner photo read)? Proposed: subtle studs, front only.
2. **Print material on the face:** unlit true-color (`meshBasic`, proposed) vs lit (`meshStandard`, more "physical" but shifts colors)?
3. **Flip UX:** animate a 180° camera tween (proposed) vs instant snap?
4. **Brick/edge color** default — warm white #f4f1ea, or match `background`?
5. **Marketing-grade later?** v1 is a clean instanced render; bevels/AO/env-map reflections are a v1.1 if customer-facing previews need more polish (parent §17 Q6).

---

### Definition of done
2D⇄3D toggle in Lego mode; both printed sides visible with correct images (back unmirrored, camera-flipped); orbit + flip at 60 fps; WebGL-less fallback works; three.js lazy-loaded (startup bundle unchanged); pure geometry + face-render tests green on web and both desktop targets; placeholder removed; parent doc §9 marked implemented with deviations noted.
