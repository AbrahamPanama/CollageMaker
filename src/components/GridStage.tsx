import { forwardRef, useMemo } from 'react';
import { Layer, Path, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import type { GridCell as GridCellModel, HeroOverlay, Rect as GridRect } from '../gridLayout/types';
import type { ViewBox } from '../types';
import type { LoadedPhoto } from '../photoIngest';
import type { ManualFrame } from '../types';
import { GridCell } from './GridCell';
import { GridHeroCell } from './GridHeroCell';

type Props = {
  cells: GridCellModel[];
  heroOverlay?: HeroOverlay;
  photos: LoadedPhoto[];
  width: number;
  height: number;
  gutter: number;
  cornerRadius: number;
  ringWidth: number;
  background: string;
  bgTransparent?: boolean;
  svgOverlay?: SvgOverlay;
  showCellLabels?: boolean;
  selectedPhotoId: string | null;
  showUi: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  onSelectPhoto: (photoId: string) => void;
  onEditPhoto: (photoId: string) => void;
  onManualFrameChange: (photoId: string, frame: ManualFrame) => void;
  onSwapPhotos: (sourcePhotoId: string, targetPhotoId: string) => void;
  onPromoteHero: (photoId: string) => void;
};

export type SvgOverlay = {
  paths: string[];
  viewBox: ViewBox;
  stroke: string;
  strokeWidth: number;
};

export const GridStage = forwardRef<Konva.Stage, Props>(function GridStage(
  {
    cells,
    heroOverlay,
    photos,
    width,
    height,
    gutter,
    cornerRadius,
    ringWidth,
    background,
    bgTransparent = false,
    svgOverlay,
    showCellLabels = false,
    selectedPhotoId,
    showUi,
    closeUp,
    closeUpTightness,
    onSelectPhoto,
    onEditPhoto,
    onManualFrameChange,
    onSwapPhotos,
    onPromoteHero,
  },
  ref
) {
  const photoById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const pixelCells = useMemo(
    () => cells.map((cell) => ({ cell, rect: cellToPixelRect(cell, width, height, gutter) })),
    [cells, gutter, height, width]
  );
  const heroRect = useMemo(
    () => heroOverlay ? rectToPixelRect(heroOverlay.rect, width, height) : null,
    [height, heroOverlay, width]
  );
  const heroPhoto = heroOverlay ? photoById.get(heroOverlay.photoId) ?? null : null;

  return (
    <Stage ref={ref} width={width} height={height}>
      <Layer>
        {!bgTransparent && <Rect width={width} height={height} fill={background} />}
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
            showLabel={showCellLabels}
            onSelect={onSelectPhoto}
            onEdit={onEditPhoto}
            onManualFrameChange={onManualFrameChange}
            onDropPhoto={(sourcePhotoId, point) => {
              if (heroRect && pointInRect(point, heroRect) && heroOverlay?.photoId !== sourcePhotoId) {
                onPromoteHero(sourcePhotoId);
                return;
              }
              const target = pixelCells.find(({ rect: candidate }) => pointInRect(point, candidate));
              if (target && target.cell.photoId !== sourcePhotoId) {
                onSwapPhotos(sourcePhotoId, target.cell.photoId);
              }
            }}
          />
        ))}
        {heroOverlay && heroRect && (
          <GridHeroCell
            photo={heroPhoto}
            rect={heroRect}
            shapeId={heroOverlay.shapeId}
            selected={heroOverlay.photoId === selectedPhotoId}
            showUi={showUi}
            closeUp={closeUp}
            closeUpTightness={closeUpTightness}
            ringWidth={ringWidth}
            background={background}
            onSelect={onSelectPhoto}
            onEdit={onEditPhoto}
            onManualFrameChange={onManualFrameChange}
            onDropPhoto={(sourcePhotoId, point) => {
              const target = pixelCells.find(({ rect: candidate }) => pointInRect(point, candidate));
              if (target && target.cell.photoId !== sourcePhotoId) {
                onPromoteHero(target.cell.photoId);
              }
            }}
          />
        )}
        {svgOverlay && svgOverlay.paths.map((path, index) => {
          const scaleX = width / svgOverlay.viewBox.w;
          const scaleY = height / svgOverlay.viewBox.h;
          return (
            <Path
              key={`${index}-${path.slice(0, 24)}`}
              data={path}
              x={-svgOverlay.viewBox.x * scaleX}
              y={-svgOverlay.viewBox.y * scaleY}
              scaleX={scaleX}
              scaleY={scaleY}
              stroke={svgOverlay.stroke}
              strokeWidth={svgOverlay.strokeWidth}
              fillEnabled={false}
              listening={false}
            />
          );
        })}
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

function rectToPixelRect(rect: GridRect, width: number, height: number): GridRect {
  return {
    x: rect.x * width,
    y: rect.y * height,
    w: rect.w * width,
    h: rect.h * height,
  };
}

function pointInRect(point: { x: number; y: number }, rect: GridRect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}
