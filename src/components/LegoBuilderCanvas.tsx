import { forwardRef, useMemo } from 'react';
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import type { LoadedPhoto } from '../photoIngest';
import {
  MAX_MANUAL_ZOOM,
  MIN_MANUAL_ZOOM,
  computeEchoPlacement,
  computePhotoPlacement,
  constrainManualFrame,
  normalizeEchoFill,
  placementUnderfills,
} from '../photoFraming';
import { useBlurredEchoImage } from './echoImage';
import { footprint } from '../lego/tiling';
import type { Brick, Face, LegoSet } from '../lego/types';
import type { ManualFrame } from '../types';

type Props = {
  set: LegoSet;
  face: Face;
  photo: LoadedPhoto | null;
  width: number;
  height: number;
  background: string;
  transparentBg: boolean;
  showGuides: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  /** When provided, the whole-set image can be dragged / wheel-zoomed to reposition it. */
  onManualFrameChange?: (frame: ManualFrame) => void;
};

export const LegoBuilderCanvas = forwardRef<Konva.Stage, Props>(function LegoBuilderCanvas(
  {
    set,
    face,
    photo,
    width,
    height,
    background,
    transparentBg,
    showGuides,
    closeUp,
    closeUpTightness,
    onManualFrameChange,
  },
  ref
) {
  const [image] = useImage(photo?.src ?? '');
  const cellW = width / set.cols;
  const cellH = height / set.rows;
  const placement = useMemo(
    () => (photo ? computePhotoPlacement(photo, width, height, { closeUp, closeUpTightness }) : null),
    [closeUp, closeUpTightness, height, photo, width]
  );

  const echo = normalizeEchoFill(photo?.echo);
  const echoImage = useBlurredEchoImage(image, echo.blur);
  const echoPlacement =
    photo && image && placement && echo.mode === 'auto' && placementUnderfills(placement, width, height)
      ? computeEchoPlacement(photo, width, height, placement)
      : null;

  const interactive = Boolean(onManualFrameChange && photo && image && placement);

  return (
    <Stage ref={ref} width={width} height={height}>
      <Layer>
        {!transparentBg && <Rect width={width} height={height} fill={background} />}
        <Group
          clipFunc={(ctx) => drawMask(ctx, set, cellW, cellH)}
          onWheel={
            interactive && placement
              ? (event) => {
                  event.evt.preventDefault();
                  const factor = event.evt.deltaY > 0 ? 0.94 : 1.06;
                  const zoom = Math.max(
                    MIN_MANUAL_ZOOM,
                    Math.min(MAX_MANUAL_ZOOM, placement.zoom * factor)
                  );
                  onManualFrameChange?.(
                    constrainManualFrame(
                      { cx: placement.cx, cy: placement.cy, zoom },
                      photo!,
                      width,
                      height
                    )
                  );
                }
              : undefined
          }
        >
          {!image && <Rect width={width} height={height} fill="#202024" />}
          {image && placement && echoPlacement && echoImage && (
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
                <Rect width={width} height={height} fill="#000" opacity={echo.dim / 100} listening={false} />
              )}
            </>
          )}
          {image && placement ? (
            <KonvaImage
              image={image}
              x={placement.x}
              y={placement.y}
              width={placement.w}
              height={placement.h}
              stroke={echo.outline && echoPlacement ? 'rgba(255,255,255,.72)' : undefined}
              strokeWidth={echo.outline && echoPlacement ? 1 : 0}
              shadowColor={echo.outline && echoPlacement ? '#000' : undefined}
              shadowBlur={echo.outline && echoPlacement ? 4 : 0}
              shadowOpacity={echo.outline && echoPlacement ? 0.35 : 0}
              draggable={interactive}
              listening={interactive}
              onDragMove={
                interactive
                  ? (event) => {
                      const frame = constrainManualFrame(
                        {
                          cx: (width / 2 - event.target.x()) / Math.max(1, placement.w),
                          cy: (height / 2 - event.target.y()) / Math.max(1, placement.h),
                          zoom: placement.zoom,
                        },
                        photo!,
                        width,
                        height
                      );
                      onManualFrameChange?.(frame);
                      const next = computePhotoPlacement(
                        { ...photo!, manualFrame: frame },
                        width,
                        height,
                        { closeUp: false, closeUpTightness }
                      );
                      event.target.position({ x: next.x, y: next.y });
                    }
                  : undefined
              }
            />
          ) : (
            <Text
              width={width}
              height={height}
              align="center"
              verticalAlign="middle"
              text={`${face === 'front' ? 'Front' : 'Back'} image`}
              fontSize={Math.max(18, Math.min(34, width * 0.06))}
              fontFamily="Inter, Arial, sans-serif"
              fill="#777"
              listening={false}
            />
          )}
        </Group>

        {showGuides && (
          <>
            {set.bricks.map((brick) => (
              <BrickOutline key={brick.id} brick={brick} cellW={cellW} cellH={cellH} />
            ))}
            <Rect width={width} height={height} stroke="#050505" strokeWidth={2} listening={false} />
          </>
        )}
      </Layer>
    </Stage>
  );
});

function BrickOutline({ brick, cellW, cellH }: { brick: Brick; cellW: number; cellH: number }) {
  const cells = footprint(brick);
  const minCol = Math.min(...cells.map((cell) => cell.col));
  const minRow = Math.min(...cells.map((cell) => cell.row));
  const maxCol = Math.max(...cells.map((cell) => cell.col));
  const maxRow = Math.max(...cells.map((cell) => cell.row));
  const x = minCol * cellW;
  const y = minRow * cellH;
  const w = (maxCol - minCol + 1) * cellW;
  const h = (maxRow - minRow + 1) * cellH;
  const label = brick.kind === '2x4' && brick.orientation === 'v' ? '2x4 V' : brick.kind;

  return (
    <Group listening={false}>
      <Rect x={x} y={y} width={w} height={h} stroke="#050505" strokeWidth={1.2} />
      {Math.min(w, h) > 28 && (
        <Text
          x={x}
          y={y + h - 17}
          width={w}
          text={label}
          align="center"
          fontSize={10}
          fontFamily="DM Mono, monospace"
          fill="rgba(255,255,255,.72)"
          shadowColor="#000"
          shadowBlur={3}
          listening={false}
        />
      )}
    </Group>
  );
}

function drawMask(
  ctx: { beginPath(): void; rect(x: number, y: number, w: number, h: number): void },
  set: LegoSet,
  cellW: number,
  cellH: number
) {
  ctx.beginPath();
  for (let row = 0; row < set.rows; row++) {
    for (let col = 0; col < set.cols; col++) {
      if (!set.cellMask[row * set.cols + col]) continue;
      ctx.rect(col * cellW, row * cellH, cellW, cellH);
    }
  }
}
