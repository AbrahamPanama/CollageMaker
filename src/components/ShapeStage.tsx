import { forwardRef } from 'react';
import { Stage, Layer, Group, Rect, Image as KonvaImage, Line } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import type { Cell, Photo, Point } from '../types';

type Props = {
  width: number;          // logical width (cells are positioned in this space)
  height: number;
  scale?: number;         // visual zoom — Stage canvas grows to width*scale
  poly: Point[];
  cells: Cell[];
  photos: Photo[];
  assignments: number[];
  bgColor: string;
  bgTransparent: boolean;
  outlineColor: string;
  gap: number;
  showOutline: boolean;
  showDetections: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  contourLoops: Point[][];
  contourShow: boolean;
  contourThickness: number;
  contourColor: string;
};

const MAX_UPSCALE = 2; // cap rendered density to 2x natural pixels to avoid pixelation

const PLACEHOLDER_PALETTE = [
  '#fca5a5',
  '#fdba74',
  '#fcd34d',
  '#a7f3d0',
  '#67e8f9',
  '#93c5fd',
  '#c4b5fd',
  '#f9a8d4',
];

function PhotoCell({
  cell,
  photo,
  gap,
  idx,
  showDetections,
  closeUp,
  closeUpTightness,
}: {
  cell: Cell;
  photo: Photo | null;
  gap: number;
  idx: number;
  showDetections: boolean;
  closeUp: boolean;
  closeUpTightness: number;
}) {
  const [img] = useImage(photo?.src ?? '');
  const x = cell.x + gap / 2;
  const y = cell.y + gap / 2;
  const w = Math.max(1, cell.w - gap);
  const h = Math.max(1, cell.h - gap);

  if (!photo || !img) {
    return (
      <Rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={PLACEHOLDER_PALETTE[idx % PLACEHOLDER_PALETTE.length]}
      />
    );
  }

  // Cover-fit baseline
  const coverScale = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);

  // Auto close-up: zoom further so the detected subject fills `tightness` of the cell.
  // Capped at MAX_UPSCALE to avoid pixelation on low-res photos.
  let scale = coverScale;
  if (closeUp && photo.subject) {
    const subjPixW = Math.max(1, photo.subject.w * photo.naturalWidth);
    const subjPixH = Math.max(1, photo.subject.h * photo.naturalHeight);
    const closeupScale = Math.min(
      (w * closeUpTightness) / subjPixW,
      (h * closeUpTightness) / subjPixH
    );
    scale = Math.max(coverScale, Math.min(closeupScale, MAX_UPSCALE));
  }
  const imgW = photo.naturalWidth * scale;
  const imgH = photo.naturalHeight * scale;

  // Pan so the subject's center is at the cell's center (clamped to keep cell covered).
  const subject = photo.subject;
  const sx = subject ? subject.x + subject.w / 2 : 0.5;
  const sy = subject ? subject.y + subject.h / 2 : 0.5;
  let offsetX = w / 2 - sx * imgW;
  let offsetY = h / 2 - sy * imgH;
  offsetX = Math.max(w - imgW, Math.min(0, offsetX));
  offsetY = Math.max(h - imgH, Math.min(0, offsetY));

  // Compute subject box in cell-local coords for the debug overlay.
  const subjBox = subject
    ? {
        x: offsetX + subject.x * imgW,
        y: offsetY + subject.y * imgH,
        w: subject.w * imgW,
        h: subject.h * imgH,
        source: subject.source,
      }
    : null;

  return (
    <Group
      x={x}
      y={y}
      clipFunc={(ctx) => {
        ctx.rect(0, 0, w, h);
      }}
    >
      <KonvaImage image={img} x={offsetX} y={offsetY} width={imgW} height={imgH} />
      {showDetections && subjBox && (
        <Rect
          x={subjBox.x}
          y={subjBox.y}
          width={subjBox.w}
          height={subjBox.h}
          stroke={subjBox.source === 'face' ? '#22c55e' : '#f59e0b'}
          strokeWidth={1.5}
          listening={false}
        />
      )}
    </Group>
  );
}

export const ShapeStage = forwardRef<Konva.Stage, Props>(function ShapeStage(
  {
    width,
    height,
    scale = 1,
    poly,
    cells,
    photos,
    assignments,
    bgColor,
    bgTransparent,
    outlineColor,
    gap,
    showOutline,
    showDetections,
    closeUp,
    closeUpTightness,
    contourLoops,
    contourShow,
    contourThickness,
    contourColor,
  },
  ref
) {
  const flatPoints = poly.flatMap((p) => [p.x, p.y]);

  return (
    <Stage
      ref={ref}
      width={width * scale}
      height={height * scale}
      scaleX={scale}
      scaleY={scale}
    >
      <Layer>
        {!bgTransparent && <Rect width={width} height={height} fill={bgColor} />}
      </Layer>
      <Layer>
        {cells.map((cell, i) => {
          const photoIdx = assignments[i] ?? -1;
          const photo = photoIdx >= 0 ? photos[photoIdx] ?? null : null;
          return (
            <PhotoCell
              key={`${cell.x.toFixed(2)}-${cell.y.toFixed(2)}-${cell.w.toFixed(2)}`}
              cell={cell}
              photo={photo}
              gap={gap}
              idx={i}
              showDetections={showDetections}
              closeUp={closeUp}
              closeUpTightness={closeUpTightness}
            />
          );
        })}
      </Layer>
      {showOutline && (
        <Layer listening={false}>
          <Line
            points={flatPoints}
            stroke={outlineColor}
            strokeWidth={1.5}
            closed
          />
        </Layer>
      )}
      {contourShow && contourLoops.length > 0 && (
        <Layer listening={false}>
          {contourLoops.map((loop, i) => (
            <Line
              key={i}
              points={loop.flatMap((p) => [p.x, p.y])}
              stroke={contourColor}
              strokeWidth={contourThickness}
              closed
              lineJoin="miter"
              lineCap="butt"
            />
          ))}
        </Layer>
      )}
    </Stage>
  );
});
