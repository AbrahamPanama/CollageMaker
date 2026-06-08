# Rotary Flipbook Mechanics Contract

This document is the source of truth for the rotary flipbook logic. The purpose is to prevent the implementation from drifting back into booklet imposition, full-panel duplex pages, or two independent track models.

## Current Conclusion

The correct physical unit is one **duplex half-blade**.

Each blade is a half-height piece. Its front face is an upper image half. Its back face is the next image's lower half.

```text
blade i front = A(i)
blade i back  = D(i+1)
```

When `blade i` folds down, its back side is revealed as the bottom half of the next image. Then `blade i+1` supplies the next top half.

This means:

```text
stable image k = blade k front A(k) + blade k-1 back D(k)
```

The wraparound blade maps the last image back to the first image.

```text
blade N front = A(N)
blade N back  = D(1)
```

## Terminology

- `A`: the above/top half of an image.
- `D`: the down/bottom half of an image.
- `blade`: one physical half-height double-sided piece mounted on the rotary hub.
- `front`: the side initially seen as a top half.
- `back`: the side printed behind the front, revealed after that blade folds down.
- `N`: number of images/frames in the loop.

## Four-Image Truth Table

For four images, the physical blade map is:

| Blade | Printed Front | Printed Back | What Happens After Fold |
| --- | --- | --- | --- |
| `B01` | `01A` | `02D` | `01A` folds down, reveals `02D` |
| `B02` | `02A` | `03D` | `02A` folds down, reveals `03D` |
| `B03` | `03A` | `04D` | `03A` folds down, reveals `04D` |
| `B04` | `04A` | `01D` | `04A` folds down, reveals `01D` |

The visible images are reconstructed as:

| Visible Image | Top Half | Bottom Half |
| --- | --- | --- |
| `01` | `B01 front = 01A` | `B04 back = 01D` |
| `02` | `B02 front = 02A` | `B01 back = 02D` |
| `03` | `B03 front = 03A` | `B02 back = 03D` |
| `04` | `B04 front = 04A` | `B03 back = 04D` |

## Sixteen-Image Pattern

For sixteen images:

```text
B01 = 01A / 02D
B02 = 02A / 03D
B03 = 03A / 04D
...
B15 = 15A / 16D
B16 = 16A / 01D
```

The total physical blade count is `N`, not `2N`.

For a 16-image loop, the physical blade count is 16 duplex half-blades.

## Mechanical Sequence

A stable image and the following transition work like this:

```text
stable image 01:
top    = B01 front = 01A
bottom = B16 back  = 01D

transition:
B01 folds down
B01 front 01A leaves the top
B01 back 02D is revealed at the bottom
B02 front 02A arrives as the next top

stable image 02:
top    = B02 front = 02A
bottom = B01 back  = 02D
```

Important: the mechanism preview must not show a full image, full panel, or both halves flipping together. It should show the currently active blade folding down and revealing its back side.

## Print Orientation

The blade fold changes the orientation of the back artwork when it is revealed. The app currently assumes:

```text
printed back side orientation = vertical flip
fold reveal transform         = vertical flip
final revealed orientation    = upright
```

This is why the app preview vertically flips back artwork while keeping the blade contour fixed.

If the back artwork is printed upright, the simulator should fail validation because after the fold the bottom half will be revealed upside down.

This must be verified with a one-blade physical print test. If the physical test proves a different orientation, update the print orientation setting, but do not change the blade ordering rule `A(i) / D(i+1)`.

## Print Layout Registration

The print layout should place each blade as one duplex unit:

```text
front page slot: blade i front = A(i)
back page slot:  blade i back  = D(i+1)
```

The back page must be mirrored or rotated only for duplex registration so that the back lands behind the same physical blade slot.

The current app supports these registration modes:

- Long-edge: row mirror.
- Short-edge: column mirror.
- Rotate 180.
- Flatbed template: no duplex mirroring. `B01-B` stays in the same template position as `B01-F`, `B02-B` stays in the same template position as `B02-F`, and so on.

Partial rows must be padded before mirroring. Do not reverse a short row directly, because it shifts backs under the wrong front slots.

## Page Size And Bleed

Page size is print media metadata. The app should support common presets such as Letter, A4, Legal, Tabloid, and A3, plus manual custom width/height values.

All page dimensions are stored in millimeters. Inch-based presets are converted to millimeters:

```text
Letter  = 215.9 x 279.4 mm
Legal   = 215.9 x 355.6 mm
Tabloid = 279.4 x 431.8 mm
```

The page-size input UI may display and accept either millimeters or inches, but that unit selector applies only to the media dimensions. Bleed remains a millimeter-based production setting. Manual page-size edits are draft values until the user applies them; typing in the boxes should not immediately resize the print layout.

Bleed is separate from page size and blade trim. The image fill may extend beyond the blade contour by the configured bleed amount, but the black blade contour remains the trim/cut line.

```text
trim/cut geometry = original blade SVG contour
image fill        = blade contour plus bleed
default bleed     = 1 mm
maximum bleed     = 2 mm
```

The blade size is fixed by the physical blade SVG. Changing the paper/media size must never scale a blade to fill the page. Instead, the app computes how many fixed blade footprints fit on the selected media:

```text
blade trim size  = 88.575 x 42.551 mm
slot footprint   = blade trim + bleed on all sides
page media       = selected paper size in mm
layout capacity  = fixed slots that fit inside the page
```

For example, selecting a larger page may increase columns, rows, and blades per print page. Increasing bleed may reduce the number of blades that fit. The blade itself remains the same physical size in both cases.

Do not export the bleed preview boundary as a red contour. The red outline used in earlier sketches was only explanatory.

Correct approach:

```text
1. Compute a fixed physical slot footprint from blade trim size plus bleed.
2. Compute columns and rows from the selected media size.
3. Center the fixed slot grid on the page.
4. Lay out front slots in that fixed grid.
5. Pad incomplete rows with empty slots.
6. If using a duplex workflow, apply the chosen mirror/rotation transform to back slot positions.
7. If using flatbed template mode, keep back slot positions unchanged.
8. Place each blade back in the resolved slot.
9. Reconstruct physical blades from the printed slots to validate.
```

## Validation Rule

The validation must reconstruct the flipbook from the **imposed print output**, not from the source model.

The old invalid validation was:

```text
model says B01 front = 01A
model says B16 back = 01D
therefore image 01 passes
```

That is tautological and proves nothing.

The correct validation is:

```text
1. Build the front print slots.
2. Build the back print slots after duplex mirroring and row padding.
3. For flatbed template mode, keep every back slot in the same position as its matching front slot.
4. Reconstruct each physical blade from its actual printed front/back slot.
5. Apply the fold reveal orientation transform to the printed back.
6. Reconstruct stable frame k:
   top    = printed blade k front
   bottom = printed blade k-1 back after fold
7. Pass only if:
   top.frame == k
   top.half == A
   bottom.frame == k
   bottom.half == D
   bottom orientation is upright
   front/back registration lands behind the same physical blade
```

The simulator should fail if any of these are wrong.

## Known Wrong Models

Do not reintroduce these:

- **Nested book imposition:** pairs early fronts with late backs like booklet pages. This caused `02A` to have unrelated backs such as `07A`.
- **Full-height transition face:** treats `A(i) / D(i+1)` as one visible sheet. The mechanism has a seam and a half-blade fold.
- **Two independent printed tracks:** treats top blades and bottom blades as separate physical pieces. The correct model is one duplex half-blade: front `A(i)`, back `D(i+1)`.
- **Full-image preview flip:** shows both halves advancing together. The preview must show one blade folding down and revealing its back.
- **Source-model-only validation:** always passes and does not test printed layout.
- **Unpadded partial-row mirror:** misregisters back slots when a row is incomplete.

## Simulator Reference

The current simulator is:

```text
simulations/rotary-flipbook-layout-simulator.html
```

It should remain aligned with this document:

- `B01 = 01A / 02D`
- `image 02 = B02 front 02A + B01 back 02D`
- `N images = N physical duplex half-blades`
- default back art orientation = vertical flip
- validation reconstructs from imposed print slots

## Physical Test Gate

Before rebuilding app code from this logic, run a one-blade physical test:

```text
Blade front: 01A
Blade back:  02D, printed with the simulator's selected back orientation
```

Cut it, mount it on the hub, and fold it down.

Expected result:

```text
02D is revealed as a readable upright bottom half.
```

Then mount the next blade:

```text
Blade front: 02A
Blade back:  03D
```

Expected stable image:

```text
top    = 02A
bottom = 02D
```

Only after that test passes should the app implementation generate production print files.
