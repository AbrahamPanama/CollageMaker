# Video → Animation Frames — Technical Design & Implementation Plan

**Status:** Implemented v1 · **Owner:** Flipbook team · **Target:** Production (Collage Maker, web + Tauri desktop)
**Last updated:** 2026‑06‑09

---

## 0. Executive summary

Let a user import a **short video clip**, trim it to **≤ 6 seconds of motion**, automatically (or manually) **frame it on the subject**, and extract **exactly as many still frames as the flipbook has blades**. Those frames become the flipbook's animation frames and flow through the existing print/imposition pipeline unchanged.

The feature is deliberately built on top of what already exists:

- **Frames are just `Photo`s.** The extractor's only job is to produce `Photo[]` that the existing `FlipbookMaker` already knows how to consume.
- **Subject framing already exists** (`detectSubject()` in `smartFrame.ts`, the `SubjectBox`/`ManualFrame` model, and the `FrameEditorModal` cropper).
- **Decode needs no new dependency** in the common case: the WebView's own `<video>` element + `<canvas>` covers H.264/MP4 (the dominant phone/camera format) on web **and** in the Tauri desktop WebView.

Everything genuinely new is small and well-bounded: a trim/decode sampler, a temporal framing layer with three auto modes, a baking step, and one import modal.

---

## 1. Goals & non‑goals

### 1.1 Goals
1. Import a video via drag‑drop, file picker, or (desktop) native open dialog.
2. **Trim** to an in/out window, hard‑capped at **6.0 s**.
3. **Auto‑frame on the subject** in three selectable modes: **Locked (motion envelope)**, **Follow (smoothed)**, **Per‑frame tight**.
4. Support **portrait and landscape** source clips, producing a **fixed output aspect** (the flipbook frame aspect).
5. **Manual framing** override: a single static pan/zoom crop applied to the whole clip.
6. Extract **exactly `N = blade count` frames** (the flipbook's `frameCount`, range **4–32**), evenly sampled across the trim window. Re‑sample automatically when the blade count changes.
7. Run **fully on‑device**, no uploads, in both the web build and the Tauri desktop build.
8. Ship with predictable performance (≤ ~2 s end‑to‑end for a typical clip) and graceful failure.

### 1.2 Non‑goals (v1)
- Frame‑accurate editing / scrubbing to exact source frame numbers.
- Keyframed manual framing (animated crop). Single static crop only in v1.
- Mixing uploaded photos **and** a video in the same flipbook. A video import owns the frame set.
- Audio, filters, color grading, stabilization.
- Server‑side transcoding.

---

## 2. Glossary

| Term | Meaning |
|------|---------|
| **Clip** | The user's source video `File`. |
| **Trim window** | `[inSec, outSec]`, `outSec − inSec ≤ 6 s`. The portion sampled. |
| **N** | Number of frames to extract = flipbook `frameCount` = blade count (4–32). |
| **Blade** | One physical flipbook leaf. `buildFlipbookBlades(frameCount)` ⇒ blades = frames = `frameCount`. |
| **Subject box** | `SubjectBox {x,y,w,h, source}` from `detectSubject()` — face or smartcrop region, in source pixels. |
| **Crop rect** | The rectangle (source pixels) drawn into the output canvas for one frame, already at the **target aspect**. |
| **Target aspect** | `A` = the flipbook frame's width/height ratio (derived from blade geometry; see §6.4). |
| **Baked frame** | An output‑resolution, target‑aspect image with framing applied to the pixels → becomes a `Photo`. |
| **Effective fps** | `N / (outSec − inSec)` — temporal density of the extracted animation. |

---

## 3. User experience

### 3.1 Primary flow
1. In **Flipbook** mode, the source panel gains an **"Import video"** action beside the existing photo dropzone.
2. Clicking it opens the **Video Import modal**.
3. The user picks/drops a clip → preview appears with a scrubber and **trim handles**.
4. The modal shows: **blades** (bound to the flipbook's `frameCount`, adjustable here too), **effective fps**, and a **smoothness hint**.
5. The user chooses an **auto‑frame mode** (Locked / Follow / Per‑frame) or toggles **Manual crop** (opens the crop editor on a representative frame).
6. A **live thumbnail strip** shows the N framed frames; a progress bar runs during detection.
7. **"Use these frames"** commits the `Photo[]` to the flipbook; the modal closes.
8. Back in the flipbook, dragging the **blade slider** re‑samples the same clip to the new N automatically.

### 3.2 States the UI must represent
- *Empty* (no clip), *decoding metadata*, *ready/preview*, *detecting* (progress), *framing done*, *error* (unsupported codec, decode failure, no subject), *committing*.

### 3.3 Copy & guidance
- Trim hint: "Up to 6 seconds of motion."
- Smoothness hint when `effectiveFps < 8`: "Low frame rate — add blades or shorten the trim for smoother motion."
- No‑subject notice: "No subject detected on some frames — using the clip's center. Try Manual crop."

---

## 4. High‑level architecture

```
                         ┌──────────────────────────────────────────────┐
  File (clip)            │              VideoImportModal                 │
  ──────────────►        │  preview · trim · mode · manual · strip       │
                         └───────────────┬──────────────────────────────┘
                                         │ VideoSource { file, in, out, mode, manualFrame, aspect }
                                         ▼
        ┌────────────────────────────────────────────────────────────────────┐
        │                         video pipeline                              │
        │                                                                     │
        │   sampler.ts ──► RawFrame[]  (decode <video>+canvas, even sample)   │
        │       │                                                             │
        │       ▼                                                             │
        │   framing.ts ─► CropRect[]   (1 detection pass → mode reducer)      │
        │       │            ▲                                                │
        │       │            └── detectSubject() / smartFrame.ts (reused)     │
        │       ▼                                                             │
        │   bake.ts ────► Photo[]      (draw crop into fixed‑aspect canvas)   │
        └───────────────────────┬─────────────────────────────────────────────┘
                                 │ Photo[] (exactly N = frameCount)
                                 ▼
                         FlipbookMaker.setPhotos(...)  ──►  existing print/imposition
```

**Key invariant:** the extracted frame set is a **pure function** of `(VideoSource, N, targetAspect)`. Changing the blade count re‑derives it; nothing is one‑shot.

---

## 5. Data model

New module `src/video/types.ts`:

```ts
// Source of truth retained by FlipbookMaker after import. Re-derives frames on change.
export type VideoSource = {
  id: string;
  file: File;                 // retained for re-decode; never uploaded
  durationSec: number;        // from loadedmetadata
  srcWidth: number;           // displayed (rotation-applied) dimensions
  srcHeight: number;
  rotation: 0 | 90 | 180 | 270;
  inSec: number;              // trim start
  outSec: number;             // trim end, outSec - inSec <= MAX_CLIP_SECONDS
  mode: AutoFrameMode;        // 'locked' | 'follow' | 'perFrame'
  manualFrame: ManualFrame | null;  // when set, overrides auto framing
  targetAspect: number;       // = flipbook frame aspect (w/h)
};

export type AutoFrameMode = 'locked' | 'follow' | 'perFrame';

// A decoded still at a timestamp, kept at detection+bake resolution.
export type RawFrame = {
  index: number;
  tSec: number;
  bitmap: ImageBitmap | HTMLCanvasElement; // source pixels (display-oriented)
  width: number;
  height: number;
};

// A subject box per frame (null = none detected), in source pixels.
export type FrameSubject = SubjectBox | null;

// Final crop rectangle for a frame, already at targetAspect, clamped to bounds.
export type CropRect = { x: number; y: number; w: number; h: number };

export type ExtractionResult = {
  photos: Photo[];            // exactly N, baked
  subjects: FrameSubject[];   // cached for instant mode switches
  effectiveFps: number;
  warnings: ExtractionWarning[];
};

export type ExtractionWarning =
  | { kind: 'lowFps'; effectiveFps: number }
  | { kind: 'noSubject'; frameIndices: number[] }
  | { kind: 'upsampled'; sourceFrames: number; requested: number }
  | { kind: 'codecFallback'; engine: 'ffmpeg-wasm' };
```

Constants (`src/video/constants.ts`):

```ts
export const MAX_CLIP_SECONDS = 6;
export const DECODE_LONG_EDGE_PX = 1080;   // bake/working resolution (long edge)
export const DETECT_LONG_EDGE_PX = 512;    // downscaled copy for detection
export const SMOOTH_FPS_HINT = 8;          // below → smoothness warning
export const ENVELOPE_PADDING = 0.12;      // 12% padding around subject(s)
export const FOLLOW_SMOOTHING = 0.35;      // EMA alpha for follow mode
export const MAX_DECODE_FRAMES = 32;       // == flipbook MAX_FRAMES; decode once, subsample for N
```

`Photo`, `SubjectBox`, `ManualFrame` are the **existing** types in `src/types.ts` — unchanged.

---

## 6. Algorithms (the core)

### 6.1 Even sampling — blade‑count driven
Given trim `[in, out]` and `N = frameCount`:

```
duration   = out - in
fps_eff    = N / duration
t(i)       = in + (i + 0.5) * duration / N      for i in 0..N-1   (mid-cell sampling)
```

Mid‑cell sampling (`i + 0.5`) avoids biasing toward the first/last source frame and gives symmetric coverage.

**Decode‑once optimization.** Because `N ≤ MAX_DECODE_FRAMES (32)`, we decode `MAX_DECODE_FRAMES` evenly‑spaced frames across the window **once**, cache them, and **subsample** by nearest timestamp for any chosen `N`. Result: dragging the blade slider never triggers a re‑seek; it only re‑subsamples cached frames + re‑runs the (cheap) framing reducers. (If exactness matters more than speed, a re‑seek path is available; 32 seeks is still < 1 s.)

### 6.2 Decode & seek (`sampler.ts`)
Pure WebView decode, no dependencies:

1. `const url = URL.createObjectURL(file)`; create a detached `<video>`:
   `video.preload='auto'; video.muted=true; video.playsInline=true; video.src=url`.
2. Await `loadedmetadata` → read `duration`, `videoWidth`, `videoHeight`. Derive `rotation` (see §6.6).
3. For each target `t(k)` (k over `MAX_DECODE_FRAMES`):
   - `video.currentTime = t(k)`; await the `seeked` event (or `requestVideoFrameCallback` when available for tighter frame readiness).
   - `ctx.drawImage(video, 0, 0, outW, outH)` into an offscreen canvas sized to `DECODE_LONG_EDGE_PX` (preserving aspect). Snapshot to `ImageBitmap` (`createImageBitmap`) or keep the canvas.
4. `URL.revokeObjectURL(url)`; release the `<video>`.

**Robustness:**
- Wrap each seek in a timeout (e.g., 3 s). On timeout/`video.error`, abort to the **codec fallback** (§9.2).
- Detect "blank decode" (all‑black/empty) by sampling a few pixels of the first frame; if blank, fall back.
- Sequential decoding (one seek in flight) keeps memory flat and is reliable across WebViews.

### 6.3 Subject detection pass (`framing.ts`)
- Reuse `detectSubject()` but feed it the **downscaled detection canvas** (`DETECT_LONG_EDGE_PX`). This requires a **small refactor** (§7.1): allow `detectSubject` to accept `HTMLImageElement | HTMLCanvasElement | ImageBitmap` (MediaPipe `FaceDetector.detect`, face‑api, and smartcrop all accept canvas sources).
- Detect on **all decoded frames** (≤ 32). Cache `FrameSubject[]`. Boxes are scaled back into **source pixels**.
- **Null handling:** forward‑fill, then backward‑fill, nulls (a momentary miss inherits its neighbor's box). If *every* frame is null, fall back to a centered crop and emit `noSubject`.
- Detection runs once; switching modes/aspect reuses the cached boxes (instant).

### 6.4 Target aspect
`A = flipbookFrameWidth / flipbookFrameHeight`, computed from blade geometry in `src/flipbook/blade.ts` (`FLIPBOOK_BLADE_VIEWBOX`: a frame is two blades tall ⇒ `A = w / (2·bladeH)` ≈ 1.04, near‑square). `A` is **passed in**, never hardcoded, so it tracks any future card‑shape change.

### 6.5 Mode reducers — boxes → crop rects
Helper `aspectFit(rect, A, srcW, srcH, pad)`:
1. Expand `rect` by `pad` (e.g., `ENVELOPE_PADDING`).
2. Grow the shorter side until `rect.w / rect.h == A` (centered on `rect`'s center).
3. If it exceeds source bounds, scale down to fit; then clamp the center so the rect stays inside `[0,0,srcW,srcH]`.
4. Return the clamped `CropRect`.

| Mode | Reducer |
|------|---------|
| **Locked** | `env = unionAll(boxes)`; `crop = aspectFit(env, …)`; **same rect for every frame** → still camera, subject animates inside. |
| **Per‑frame** | `crop_i = aspectFit(box_i, …)` independently → max zoom, background may jump. |
| **Follow** | Smooth the box **centers** with an EMA (`FOLLOW_SMOOTHING`) or critically‑damped filter → path `c_i`; pick a steady size = `aspectFit(env)`'s size (constant zoom); `crop_i = aspectFit(rect(c_i, size), …)` → camera glides with the subject. |
| **Manual** (override) | Map `ManualFrame {cx,cy,zoom}` → a rect at aspect `A` (reuse `computePhotoPlacement` math); **same rect for every frame**; detection ignored. |

All reducers output rects already at aspect `A` and clamped — so **portrait↔landscape "just works"**: a wide envelope from a landscape clip is fit to a near‑square output; a tall portrait subject likewise.

### 6.6 Rotation metadata
Phone clips often carry a rotation flag. Strategy:
- Trust `videoWidth/videoHeight` as **display** dimensions (most WebViews already apply rotation to `drawImage`).
- Defensive check: if a clip declares rotation but `drawImage` output looks unrotated (heuristic: declared rotation ≠ 0 but aspect matches unrotated), apply a canvas transform before bake. Covered by the QA matrix (§13) with real portrait clips on each platform.

### 6.7 Baking (`bake.ts`)
For each frame `i`:
1. Create output canvas `outW × outH` at aspect `A`, long edge = `DECODE_LONG_EDGE_PX`.
2. `ctx.drawImage(rawFrame, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH)` (+ rotation transform if needed).
3. `canvas.toBlob(..., 'image/jpeg', 0.9)` → `URL.createObjectURL(blob)` (smaller than PNG; frames are photographic). Keep blob URLs; revoke on replacement/unmount.
4. Build `Photo { id, src: blobUrl, naturalWidth: outW, naturalHeight: outH, subject: null, manualFrame: undefined }`.

**Why bake (vs. live framing):** with three modes + manual + a fixed aspect, baking the crop into the pixels makes the result deterministic and decoupled from the renderer's auto‑zoom. Downstream, the flipbook treats these as ordinary full‑frame photos. Re‑framing = re‑derive (cheap, cached).

---

## 7. Integration with the existing app

### 7.1 Reused / lightly‑extended code
| Existing | Use | Change |
|----------|-----|--------|
| `smartFrame.ts › detectSubject(img)` | per‑frame subject | **Extend** signature to accept `HTMLImageElement \| HTMLCanvasElement \| ImageBitmap` (internal detectors already support canvas). Backward compatible. |
| `types.ts › Photo / SubjectBox / ManualFrame` | data model | none |
| `photoFraming.ts › computePhotoPlacement / getInitialManualFrame / constrainManualFrame` | manual‑crop math | reuse for the manual rect mapping |
| `components/FrameEditorModal.tsx` | manual crop UI | reuse on a representative frame (it takes `{photo, aspectRatio, onSave(photoId, frame)}`) |
| `views/FlipbookMaker.tsx` | host | add `videoSource` state + re‑sample effect (below) |
| `export.ts › isTauri()` | platform branch | reuse for native open dialog |

### 7.2 FlipbookMaker wiring
- Add state: `const [videoSource, setVideoSource] = useState<VideoSource | null>(null)`.
- Add a memoized cache of decoded frames + detection boxes keyed by `videoSource.id + trim`.
- Add an **effect** that recomputes the frame set whenever `videoSource` **or** `frameCount` changes:

```
effect([videoSource, frameCount]):
  if !videoSource: return
  result = await deriveFrames(videoSource, frameCount, targetAspect, cache)
  setPhotos(result.photos)        // exactly N
  setWarnings(result.warnings)
```

- Importing a video **replaces** the photo set and disables repeat‑fill (the video owns all N frames). Clearing the video restores normal photo behavior.
- `frameCount` stays bounded **4–32** (`MIN_FRAMES`/`MAX_FRAMES`); a video import clamps `N` into that range.
- The existing `analyzing` progress state (`{done,total}`) is reused for the detection/bake progress.

### 7.3 New files
```
src/video/constants.ts
src/video/types.ts
src/video/sampler.ts        // decode + even sampling (+ ffmpeg-wasm fallback adapter)
src/video/framing.ts        // detection pass + mode reducers + aspectFit
src/video/bake.ts           // crop → Photo
src/video/deriveFrames.ts   // orchestrator: VideoSource × N → ExtractionResult (cached)
src/video/*.test.ts         // unit tests for pure functions
src/components/VideoImportModal.tsx
```

---

## 8. Platform: web vs. Tauri desktop

| Concern | Web | Tauri desktop |
|---------|-----|---------------|
| File input / drag‑drop (`File`) | ✅ | ✅ (WebView) |
| `<video>`+canvas decode | ✅ (Chromium/WebKit) | ✅ (WKWebView macOS / WebView2 Win) |
| Native "open file" dialog | n/a | optional via existing `@tauri-apps/plugin-dialog`; read bytes via `plugin-fs` → wrap in `File`/`Blob` |
| Codec coverage | H.264/VP9/AV1 broad | H.264/HEVC on Apple; **WebKitGTK (Linux) lacks H.264** → fallback path matters |
| ffmpeg.wasm fallback | heavy (~25 MB, lazy) | acceptable lazy; or future native sidecar |

No new Tauri capabilities are required for the drag‑drop / file‑input path (we get a `File` directly, same as today's image ingestion). The native open‑dialog path reuses the already‑added `dialog`/`fs` plugins.

---

## 9. Error handling & edge cases

### 9.1 Enumerated cases
| Case | Detection | Handling |
|------|-----------|----------|
| Unsupported codec | `video.error` / blank decode / metadata never fires (timeout) | Try **ffmpeg.wasm fallback**; if that fails, surface "This video format isn't supported — try an MP4 (H.264)." |
| Seek hangs | per‑seek timeout | Abort frame → fallback engine |
| No subject anywhere | all boxes null | Centered crop + `noSubject` warning; suggest Manual |
| Trim > 6 s | UI clamp | Handles can't exceed 6 s; programmatic clamp as backstop |
| Trim shorter than N source frames | `floor(duration·srcFps) < N` | Nearest‑timestamp sampling (repeats allowed) + `upsampled` warning |
| Huge file (e.g., 4K/60) | size/dimension check | Decode to `DECODE_LONG_EDGE_PX` only; never hold full‑res; warn if file > ~500 MB |
| Rotated portrait clip | rotation flag | §6.6 |
| User changes blades mid‑derive | derive is async | Cancel in‑flight derive (AbortController), keep latest request only |
| Modal closed mid‑process | unmount | Abort, revoke object URLs, release `<video>` |
| Memory pressure | — | Sequential decode, `ImageBitmap.close()` after bake, revoke blob URLs on replace |

### 9.2 Codec fallback (ffmpeg.wasm)
- **Lazy‑loaded** only when WebView decode fails (matches the app's existing dynamic‑`import()` pattern for MediaPipe/face‑api/jsPDF).
- Run `-ss in -t duration -vf fps=… -frames:v MAX_DECODE_FRAMES out_%03d.jpg`, read outputs into canvases, then continue the normal framing/bake path.
- Note the web bundle/COOP‑COEP implications (single‑thread build avoids cross‑origin‑isolation headers; slower but dependency‑light). Treated as a **fallback**, not the default — gated behind a capability check.

---

## 10. Performance & resource budget

Target for a typical 1080p H.264 clip, N = 16, on a mid‑range laptop:

| Stage | Budget | Notes |
|-------|--------|-------|
| Metadata load | < 150 ms | `loadedmetadata` |
| Decode 32 frames | 0.4–1.2 s | sequential seeks; one‑time per clip+trim |
| Detection (32 × MediaPipe @512px) | 0.3–1.0 s | downscaled; cached |
| Framing reducers | < 5 ms | pure math |
| Bake N frames | 50–150 ms | JPEG encode |
| **Mode/aspect change** | **< 20 ms** | reducers + re‑bake only (no decode/detect) |
| **Blade‑count change** | **< 60 ms** | subsample cache + re‑bake |

Memory ceiling: ≤ ~32 × (1080‑long‑edge bitmap) decoded + ≤ N baked blobs; bitmaps closed after bake. No full‑resolution buffers retained.

---

## 11. Privacy & security
- **100% on‑device.** No frame, clip, or detection result leaves the machine. No network calls in the pipeline.
- Object/blob URLs are **revoked** on replacement and unmount; `ImageBitmap`s are `close()`d.
- No content‑bearing telemetry (see §12).
- Tauri: only the already‑granted `dialog:allow-save` / `fs:allow-write-file` (+ a read for native‑open) capabilities; nothing broadened.
- Models (MediaPipe/face‑api) are bundled locally already; no model fetch at runtime.

---

## 12. Telemetry (optional, privacy‑safe)
If/when analytics exist, log **counts and timings only**, never content:
`video_import_started`, `decode_engine` (`webview`|`ffmpeg`), `frames_extracted` (N), `mode`, `effective_fps_bucket`, `derive_ms`, `fallback_used`, `error_kind`. No filenames, no pixels, no boxes.

---

## 13. Testing strategy

### 13.1 Unit (vitest, pure functions — no DOM)
- `sampler`: `sampleTimestamps(in,out,N)` → mid‑cell correctness, monotonic, within bounds; subsample 32→N nearest mapping.
- `framing`: `aspectFit` (aspect exactness, clamping, bounds); `unionAll`; EMA follow path; null fill (forward/backward; all‑null → centered).
- `deriveFrames`: with mocked decode + mocked `detectSubject`, assert N outputs, warnings (`lowFps`, `noSubject`, `upsampled`), and that mode/aspect changes don't re‑invoke decode/detect.
- Determinism: same inputs → identical crop rects.

### 13.2 Integration (jsdom / Playwright component)
- A tiny fixture MP4 (1–2 s, a face) committed under `src/video/__fixtures__/`. Drive the modal: import → trim → mode switches → commit; assert `Photo[]` length == N and blob URLs valid.

### 13.3 Manual QA matrix
| Axis | Values |
|------|--------|
| Codec/container | H.264/MP4, HEVC/MP4, VP9/WebM, AV1/MP4 |
| Orientation | landscape, portrait (rotated), square |
| Duration | 0.8 s, 3 s, 6 s, 12 s (must clamp) |
| Subject | single face, multiple faces, moving subject, no face (object) |
| Blades | 4, 16, 32; change slider after import (re‑sample) |
| Mode | locked, follow, per‑frame, manual |
| Platform | web (Chrome, Safari), Tauri macOS (WKWebView), Tauri Windows (WebView2) |

Acceptance: every cell either produces correct N framed frames or fails gracefully with the right message (esp. HEVC on Linux → fallback or clear error).

---

## 14. Accessibility
- Modal: focus trap, `Esc` to close, restore focus to the trigger.
- Trim handles: keyboard‑operable (arrow keys nudge, `Shift` = larger step), ARIA slider roles with value text in seconds.
- Mode selector: radio‑group semantics; visible focus ring.
- Progress: `aria-live` polite announcements ("Analyzing 12 of 16 frames").
- Respect `prefers-reduced-motion` for the preview's animated strip.
- Color is never the only signal for the smoothness warning (icon + text).

---

## 15. Rollout plan

| Phase | Deliverable | Exit criteria |
|-------|-------------|---------------|
| **0 — Prep** | Extend `detectSubject` to accept canvas/bitmap; add `video/constants.ts`, `video/types.ts` | existing photo flow unaffected; unit shim test |
| **1 — Decode** | `sampler.ts` (+ even sampling, decode‑once cache) | extracts 32 frames from fixture on all 3 platforms; unit tests green |
| **2 — Framing** | `framing.ts` (detection pass + 3 reducers + aspectFit + null fill) | deterministic crops; mode switch < 20 ms; unit tests green |
| **3 — Bake + wire** | `bake.ts`, `deriveFrames.ts`, FlipbookMaker `videoSource` + re‑sample effect | blade slider re‑samples live; frames render in flipbook |
| **4 — UI** | `VideoImportModal` (preview, trim, mode, manual crop, strip, progress) | full primary flow behind a feature flag |
| **5 — Hardening** | ffmpeg.wasm fallback, rotation, error messages, AbortController, QA matrix, a11y | QA matrix passes; perf budget met |
| **6 — GA** | remove flag, docs, changelog | sign‑off |

Phases 0–4 are implemented in the Flipbook section without a feature flag: video decode, cached sampling, temporal framing, baking, modal UI, and frame-count re-sampling are live in the app. Phase 5 remains the hardening track: fixture-driven browser integration tests, codec fallback, deeper rotation QA, and broader platform coverage.

### 15.1 Implemented v1 files
- `src/video/constants.ts`, `types.ts`, `sampler.ts`, `framing.ts`, `bake.ts`, `deriveFrames.ts`
- `src/components/VideoImportModal.tsx`
- `src/views/FlipbookMaker.tsx`
- `src/smartFrame.ts`
- `src-tauri/tauri.conf.json` (`media-src 'self' blob:` for desktop preview playback)
- `src/video/sampler.test.ts`, `src/video/framing.test.ts`

---

## 16. Risks & mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Codec gaps (HEVC/Linux WebKitGTK) | med | med | ffmpeg.wasm fallback; clear "use MP4" message |
| Detection too slow on low‑end | low‑med | med | downscale to 512px, MediaPipe fast path, detect ≤ 32 frames, cache |
| Seek imprecision | low | low | even time‑sampling tolerates it; `requestVideoFrameCallback` when present |
| Memory on 4K/60 | med | med | decode to working res only; close bitmaps; sequential |
| ffmpeg.wasm bundle weight (web) | med | med | lazy‑load only on fallback; single‑thread build |
| Rotated portrait mishandling | med | med | QA matrix on real devices; defensive transform |
| Scope creep (keyframed manual, mixed media) | med | med | explicit v1 non‑goals |

---

## 17. Open questions (resolve during Phase 0–1)
1. **Output working resolution** — `1080` long edge proposed; confirm vs. flipbook print DPI needs (could derive from card size × export DPI).
2. **Frame format** — JPEG q0.9 (smaller) vs PNG (lossless). Proposed JPEG; revisit if print quality demands PNG.
3. **ffmpeg.wasm in web build** — accept the lazy fallback weight, or restrict the fallback to the desktop build (where a native sidecar is a future option)?
4. **Replace vs. append** on import — v1 replaces the frame set; confirm no near‑term need to mix uploaded photos with video frames.
5. **Manual crop surface** — reuse `FrameEditorModal` as‑is, or a thin video‑specific wrapper (scrub to choose the representative frame)?

---

## 18. Appendix — public API sketch (contracts, not implementations)

```ts
// sampler.ts
export function sampleTimestamps(inSec: number, outSec: number, count: number): number[];
export async function decodeFrames(
  file: File, inSec: number, outSec: number, count: number, longEdgePx: number,
  signal?: AbortSignal
): Promise<RawFrame[]>;                         // throws DecodeUnsupportedError → triggers fallback

// framing.ts
export async function detectFrameSubjects(frames: RawFrame[], signal?: AbortSignal): Promise<FrameSubject[]>;
export function aspectFit(rect: CropRect, aspect: number, srcW: number, srcH: number, pad: number): CropRect;
export function computeCropRects(
  subjects: FrameSubject[], mode: AutoFrameMode, manual: ManualFrame | null,
  aspect: number, srcW: number, srcH: number
): CropRect[];

// bake.ts
export function bakeFrame(frame: RawFrame, crop: CropRect, outW: number, outH: number, rotation: number): Photo;

// deriveFrames.ts  (orchestrator, cached)
export async function deriveFrames(
  source: VideoSource, n: number, targetAspect: number, cache: FrameCache, signal?: AbortSignal
): Promise<ExtractionResult>;

// smartFrame.ts  (extended signature — backward compatible)
export async function detectSubject(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap
): Promise<SubjectBox | null>;
```

---

### Definition of done
- All five goals (§1.1) demonstrably working across the QA matrix (§13.3).
- Perf budget (§10) met; mode/blade changes feel instant.
- Fully on‑device; no network; URLs/bitmaps released.
- Unit + integration tests green; feature flag removed; changelog + this doc updated.
