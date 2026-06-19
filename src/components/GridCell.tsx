import { Group, Image as KonvaImage, Rect, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import type { GridCell as GridCellModel, Rect as GridRect, SvgCellClip } from '../gridLayout/types';
import type { LoadedPhoto } from '../photoIngest';
import type { ManualFrame, Point } from '../types';
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

type Props = {
  cell: GridCellModel;
  rect: GridRect;
  photo: LoadedPhoto | null;
  selected: boolean;
  showUi: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  cornerRadius: number;
  background: string;
  showLabel?: boolean;
  onSelect: (photoId: string) => void;
  onEdit: (photoId: string) => void;
  onManualFrameChange: (photoId: string, frame: ManualFrame) => void;
  onDropPhoto: (photoId: string, stagePoint: { x: number; y: number }) => void;
};

export function GridCell({
  cell,
  rect,
  photo,
  selected,
  showUi,
  closeUp,
  closeUpTightness,
  cornerRadius,
  background,
  showLabel = false,
  onSelect,
  onEdit,
  onManualFrameChange,
  onDropPhoto,
}: Props) {
  const [image] = useImage(photo?.src ?? '');
  const echo = normalizeEchoFill(photo?.echo);
  const echoImage = useBlurredEchoImage(image, echo.blur);
  const radius = Math.min(cornerRadius, rect.w / 2, rect.h / 2);
  const hasShapeClip = Boolean(cell.clip);

  if (!photo) {
    return (
      <Group
        x={rect.x}
        y={rect.y}
        clipFunc={(ctx) => drawCellClip(ctx, cell.clip, rect.w, rect.h, radius)}
      >
        <Rect width={rect.w} height={rect.h} fill="#171719" />
        <Shape
          listening={false}
          sceneFunc={(ctx, shapeNode) => {
            drawCellClip(ctx, cell.clip, rect.w, rect.h, radius);
            ctx.fillStrokeShape(shapeNode);
          }}
          stroke="#555"
          strokeWidth={1.25}
          dash={[6, 4]}
        />
        {cell.label && (
          <Text
            x={0}
            y={0}
            width={rect.w}
            height={rect.h}
            align="center"
            verticalAlign="middle"
            text={cell.label}
            fontSize={Math.max(14, Math.min(24, rect.w * 0.16))}
            fontFamily="Inter, Arial, sans-serif"
            fill="#8b8b8d"
            listening={false}
          />
        )}
      </Group>
    );
  }

  const placement = computePhotoPlacement(photo, rect.w, rect.h, { closeUp, closeUpTightness });
  const echoPlacement =
    image && echo.mode === 'auto' && placementUnderfills(placement, rect.w, rect.h)
      ? computeEchoPlacement(photo, rect.w, rect.h, placement)
      : null;
  const badge = photo.manualFrame ? 'manual' : photo.subject?.source ?? 'auto';

  return (
    <Group
      x={rect.x}
      y={rect.y}
      clipFunc={(ctx) => drawCellClip(ctx, cell.clip, rect.w, rect.h, radius)}
      onClick={() => onSelect(photo.id)}
      onTap={() => onSelect(photo.id)}
      onDblClick={() => onEdit(photo.id)}
      onDblTap={() => onEdit(photo.id)}
      onWheel={(event) => {
        event.evt.preventDefault();
        const frame = frameFromPlacement(photo, rect.w, rect.h, placement);
        const factor = event.evt.deltaY > 0 ? 0.94 : 1.06;
        onManualFrameChange(
          photo.id,
          constrainManualFrame(
            { ...frame, zoom: Math.max(MIN_MANUAL_ZOOM, Math.min(MAX_MANUAL_ZOOM, frame.zoom * factor)) },
            photo,
            rect.w,
            rect.h
          )
        );
      }}
    >
      <Rect width={rect.w} height={rect.h} fill={background} cornerRadius={hasShapeClip ? 0 : radius} />
      {image ? (
        <>
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
                <Rect width={rect.w} height={rect.h} fill="#000" opacity={echo.dim / 100} listening={false} />
              )}
            </>
          )}
          <KonvaImage
            image={image}
            x={placement.x}
            y={placement.y}
            width={placement.w}
            height={placement.h}
            draggable
            stroke={echo.outline && echoPlacement ? 'rgba(255,255,255,.72)' : undefined}
            strokeWidth={echo.outline && echoPlacement ? 1 : 0}
            shadowColor={echo.outline && echoPlacement ? '#000' : undefined}
            shadowBlur={echo.outline && echoPlacement ? 4 : 0}
            shadowOpacity={echo.outline && echoPlacement ? 0.35 : 0}
            onDragMove={(event) => {
              const nextFrame = constrainManualFrame(
                {
                  cx: (rect.w / 2 - event.target.x()) / Math.max(1, placement.w),
                  cy: (rect.h / 2 - event.target.y()) / Math.max(1, placement.h),
                  zoom: frameFromPlacement(photo, rect.w, rect.h, placement).zoom,
                },
                photo,
                rect.w,
                rect.h
              );
              onManualFrameChange(photo.id, nextFrame);
              const nextPlacement = computePhotoPlacement(
                { ...photo, manualFrame: nextFrame },
                rect.w,
                rect.h,
                { closeUp: false, closeUpTightness }
              );
              event.target.position({ x: nextPlacement.x, y: nextPlacement.y });
            }}
            onDragEnd={(event) => {
              const stage = event.target.getStage();
              const pointer = stage?.getPointerPosition();
              if (pointer) onDropPhoto(photo.id, pointer);
            }}
          />
        </>
      ) : (
        <Rect width={rect.w} height={rect.h} fill="#2b2b2d" />
      )}

      {(showUi || showLabel) && (
        <>
          {showUi && (
            hasShapeClip ? (
              <Shape
                listening={false}
                sceneFunc={(ctx, shapeNode) => {
                  drawCellClip(ctx, cell.clip, rect.w, rect.h, radius);
                  ctx.fillStrokeShape(shapeNode);
                }}
                stroke={selected ? '#1fe08a' : 'rgba(255,255,255,.55)'}
                strokeWidth={selected ? 3 : 1}
              />
            ) : (
              <Rect
                width={rect.w}
                height={rect.h}
                stroke={selected ? '#1fe08a' : 'rgba(255,255,255,.45)'}
                strokeWidth={selected ? 3 : 1}
                cornerRadius={radius}
                listening={false}
              />
            )
          )}
          {showUi && (
            <Text
              x={6}
              y={6}
              text={badge}
              fontSize={10}
              fontFamily="Inter, Arial, sans-serif"
              fill="#fff"
              shadowColor="#000"
              shadowBlur={3}
              shadowOpacity={0.8}
              listening={false}
            />
          )}
          {(showUi || showLabel) && (
            <Text
              x={Math.max(6, rect.w - 32)}
              y={Math.max(6, rect.h - 20)}
              width={26}
              text={cell.label ?? cell.photoId.slice(-2).toUpperCase()}
              align="right"
              fontSize={10}
              fontFamily="Inter, Arial, sans-serif"
              fill="#fff"
              shadowColor="#000"
              shadowBlur={3}
              shadowOpacity={0.8}
              listening={false}
            />
          )}
        </>
      )}
    </Group>
  );
}

function frameFromPlacement(
  photo: LoadedPhoto,
  frameW: number,
  frameH: number,
  placement: { x: number; y: number; w: number; h: number; zoom: number }
) {
  if (photo.manualFrame) return constrainManualFrame(photo.manualFrame, photo, frameW, frameH);
  return constrainManualFrame(
    {
      cx: (frameW / 2 - placement.x) / Math.max(1, placement.w),
      cy: (frameH / 2 - placement.y) / Math.max(1, placement.h),
      zoom: placement.zoom,
    },
    photo,
    frameW,
    frameH
  );
}

function drawCellClip(
  ctx: Konva.Context,
  clip: SvgCellClip | undefined,
  width: number,
  height: number,
  radius: number
) {
  if (!clip) {
    roundedRect(ctx, 0, 0, width, height, radius);
    return;
  }

  ctx.beginPath();
  drawScaledPolyline(ctx, clip.outer, width, height);
  const outerArea = signedArea(clip.outer);
  for (const hole of clip.holes) {
    const shouldReverse = Math.sign(signedArea(hole)) === Math.sign(outerArea);
    drawScaledPolyline(ctx, shouldReverse ? hole.slice().reverse() : hole, width, height);
  }
}

function drawScaledPolyline(ctx: Konva.Context, points: Point[], width: number, height: number) {
  if (points.length === 0) return;
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (let index = 1; index < points.length; index++) {
    ctx.lineTo(points[index].x * width, points[index].y * height);
  }
  ctx.closePath();
}

function signedArea(points: Point[]) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const next = (index + 1) % points.length;
    area += points[index].x * points[next].y - points[next].x * points[index].y;
  }
  return area / 2;
}

function roundedRect(
  ctx: Konva.Context,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  if (radius <= 0) {
    ctx.rect(x, y, width, height);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
