import { forwardRef, useMemo } from 'react';
import { Layer, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import type { GridCell as GridCellModel, Rect as GridRect } from '../gridLayout/types';
import type { LoadedPhoto } from '../photoIngest';
import type { ManualFrame } from '../types';
import { GridCell } from './GridCell';

type Props = {
  cells: GridCellModel[];
  photos: LoadedPhoto[];
  width: number;
  height: number;
  gutter: number;
  cornerRadius: number;
  background: string;
  selectedPhotoId: string | null;
  showUi: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  onSelectPhoto: (photoId: string) => void;
  onEditPhoto: (photoId: string) => void;
  onManualFrameChange: (photoId: string, frame: ManualFrame) => void;
  onSwapPhotos: (sourcePhotoId: string, targetPhotoId: string) => void;
};

export const GridStage = forwardRef<Konva.Stage, Props>(function GridStage(
  {
    cells,
    photos,
    width,
    height,
    gutter,
    cornerRadius,
    background,
    selectedPhotoId,
    showUi,
    closeUp,
    closeUpTightness,
    onSelectPhoto,
    onEditPhoto,
    onManualFrameChange,
    onSwapPhotos,
  },
  ref
) {
  const photoById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const pixelCells = useMemo(
    () => cells.map((cell) => ({ cell, rect: cellToPixelRect(cell, width, height, gutter) })),
    [cells, gutter, height, width]
  );

  return (
    <Stage ref={ref} width={width} height={height}>
      <Layer>
        <Rect width={width} height={height} fill={background} />
        {pixelCells.map(({ cell, rect }) => (
          <GridCell
            key={`${cell.id}-${cell.rect.x}-${cell.rect.y}`}
            cell={cell}
            rect={rect}
            photo={photoById.get(cell.photoId) ?? null}
            selected={cell.photoId === selectedPhotoId}
            showUi={showUi}
            closeUp={closeUp}
            closeUpTightness={closeUpTightness}
            cornerRadius={cornerRadius}
            background={background}
            onSelect={onSelectPhoto}
            onEdit={onEditPhoto}
            onManualFrameChange={onManualFrameChange}
            onDropPhoto={(sourcePhotoId, point) => {
              const target = pixelCells.find(({ rect: candidate }) => pointInRect(point, candidate));
              if (target && target.cell.photoId !== sourcePhotoId) {
                onSwapPhotos(sourcePhotoId, target.cell.photoId);
              }
            }}
          />
        ))}
      </Layer>
    </Stage>
  );
});

export function cellToPixelRect(
  cell: GridCellModel,
  width: number,
  height: number,
  gutter: number
): GridRect {
  const x = cell.rect.x * width;
  const y = cell.rect.y * height;
  const w = cell.rect.w * width;
  const h = cell.rect.h * height;
  const eps = 0.0001;
  const left = cell.rect.x <= eps ? gutter : gutter / 2;
  const top = cell.rect.y <= eps ? gutter : gutter / 2;
  const right = cell.rect.x + cell.rect.w >= 1 - eps ? gutter : gutter / 2;
  const bottom = cell.rect.y + cell.rect.h >= 1 - eps ? gutter : gutter / 2;
  return {
    x: x + left,
    y: y + top,
    w: Math.max(1, w - left - right),
    h: Math.max(1, h - top - bottom),
  };
}

function pointInRect(point: { x: number; y: number }, rect: GridRect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}
