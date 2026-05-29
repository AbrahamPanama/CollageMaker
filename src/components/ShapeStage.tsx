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
import { computePhotoPlacement } from '../photoFraming';

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
      <KonvaImage
        image={img}
        x={placement.x}
        y={placement.y}
        width={placement.w}
        height={placement.h}
      />
      {showDetections && placement.subjectBox && (
        <Rect
          x={placement.subjectBox.x}
          y={placement.subjectBox.y}
          width={placement.subjectBox.w}
          height={placement.subjectBox.h}
          stroke={placement.subjectBox.source === 'face' ? '#22c55e' : '#f59e0b'}
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
