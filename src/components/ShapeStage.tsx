import { forwardRef } from 'react';
import {
  Stage,
  Layer,
  Group,
  Rect,
  Image as KonvaImage,
  Line,
  Path,
} from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import type { Cell, Photo, Point } from '../types';
import {
  computeEchoPlacement,
  computePhotoPlacement,
  normalizeEchoFill,
  placementUnderfills,
} from '../photoFraming';
import { useBlurredEchoImage } from './echoImage';

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
  contourPath: string;
  contourShow: boolean;
  contourThickness: number;
  contourColor: string;
  onEditPhoto?: (photoId: string) => void;
};

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
  onEditPhoto,
}: {
  cell: Cell;
  photo: Photo | null;
  gap: number;
  idx: number;
  showDetections: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  onEditPhoto?: (photoId: string) => void;
}) {
  const [img] = useImage(photo?.src ?? '');
  const echo = normalizeEchoFill(photo?.echo);
  const echoImage = useBlurredEchoImage(img, echo.blur);
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

  const placement = computePhotoPlacement(photo, w, h, {
    closeUp,
    closeUpTightness,
  });
  const echoPlacement =
    echo.mode === 'auto' && placementUnderfills(placement, w, h)
      ? computeEchoPlacement(photo, w, h, placement)
      : null;

  return (
    <Group
      x={x}
      y={y}
      clipFunc={(ctx) => {
        ctx.rect(0, 0, w, h);
      }}
      onClick={() => onEditPhoto?.(photo.id)}
      onTap={() => onEditPhoto?.(photo.id)}
      onMouseEnter={(e) => {
        if (onEditPhoto) e.target.getStage()?.container().style.setProperty('cursor', 'pointer');
      }}
      onMouseLeave={(e) => {
        e.target.getStage()?.container().style.removeProperty('cursor');
      }}
    >
      {echoPlacement && echoImage && (
        <>
          <KonvaImage
            image={echoImage}
            x={echoPlacement.x}
            y={echoPlacement.y}
            width={echoPlacement.w}
            height={echoPlacement.h}
            listening={false}
          />
          {echo.dim > 0 && (
            <Rect width={w} height={h} fill="#000" opacity={echo.dim / 100} listening={false} />
          )}
        </>
      )}
      <KonvaImage
        image={img}
        x={placement.x}
        y={placement.y}
        width={placement.w}
        height={placement.h}
        stroke={echo.outline && echoPlacement ? 'rgba(255,255,255,.72)' : undefined}
        strokeWidth={echo.outline && echoPlacement ? 1 : 0}
        shadowColor={echo.outline && echoPlacement ? '#000' : undefined}
        shadowBlur={echo.outline && echoPlacement ? 4 : 0}
        shadowOpacity={echo.outline && echoPlacement ? 0.35 : 0}
      />
      {showDetections && placement.subjectBox && (
        <Rect
          x={placement.subjectBox.x}
          y={placement.subjectBox.y}
          width={placement.subjectBox.w}
          height={placement.subjectBox.h}
          stroke={
            placement.subjectBox.source === 'face' || placement.subjectBox.source === 'hybrid'
              ? '#22c55e'
              : placement.subjectBox.source === 'person'
                ? '#38bdf8'
                : '#f59e0b'
          }
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
    contourPath,
    contourShow,
    contourThickness,
    contourColor,
    onEditPhoto,
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
              onEditPhoto={onEditPhoto}
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
      {contourShow && contourPath && (
        <Layer listening={false}>
          <Path
            data={contourPath}
            stroke={contourColor}
            strokeWidth={contourThickness}
            fillEnabled={false}
            lineJoin="miter"
            lineCap="butt"
          />
        </Layer>
      )}
    </Stage>
  );
});
