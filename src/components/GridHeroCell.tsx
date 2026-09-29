import { Group, Image as KonvaImage, Rect, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import { getHeroShape } from '../gridLayout/heroShapes';
import type { HeroShapeId, Rect as GridRect } from '../gridLayout/types';
import type { LoadedPhoto } from '../photoIngest';
import type { ManualFrame } from '../types';
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
  photo: LoadedPhoto | null;
  rect: GridRect;
  shapeId: HeroShapeId;
  selected: boolean;
  showUi: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  ringWidth: number;
  background: string;
  onSelect: (photoId: string) => void;
  onEdit: (photoId: string) => void;
  onManualFrameChange: (photoId: string, frame: ManualFrame) => void;
  onDropPhoto: (photoId: string, stagePoint: { x: number; y: number }) => void;
};

export function GridHeroCell({
  photo,
  rect,
  shapeId,
  selected,
  showUi,
  closeUp,
  closeUpTightness,
  ringWidth,
  background,
  onSelect,
  onEdit,
  onManualFrameChange,
  onDropPhoto,
}: Props) {
  const [image] = useImage(photo?.src ?? '');
  const echo = normalizeEchoFill(photo?.echo);
  const echoImage = useBlurredEchoImage(image, echo.blur);
  const shape = getHeroShape(shapeId);

  if (!photo) return null;

  const adjustedPhoto = adjustHeroSubject(photo, shape.subjectBias);
  const placement = computePhotoPlacement(adjustedPhoto, rect.w, rect.h, {
    closeUp,
    closeUpTightness: closeUpTightness * shape.safeInset,
  });
  const echoPlacement =
    image && echo.mode === 'auto' && placementUnderfills(placement, rect.w, rect.h)
      ? computeEchoPlacement(adjustedPhoto, rect.w, rect.h, placement)
      : null;
  const badge = photo.manualFrame ? 'manual hero' : 'hero';
  const strokeWidth = Math.max(0, Math.min(Math.min(rect.w, rect.h) * 0.1, ringWidth));

  return (
    <Group
      x={rect.x}
      y={rect.y}
      clipFunc={(ctx) => drawHeroPath(ctx, shapeId, 0, 0, rect.w, rect.h)}
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
      <Rect width={rect.w} height={rect.h} fill={background} />
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

      <Shape
        listening={false}
        sceneFunc={(ctx, shapeNode) => {
          drawHeroPath(ctx, shapeId, strokeWidth / 2, strokeWidth / 2, rect.w - strokeWidth, rect.h - strokeWidth);
          ctx.fillStrokeShape(shapeNode);
        }}
        stroke={background}
        strokeWidth={strokeWidth}
      />

      {showUi && (
        <>
          <Shape
            listening={false}
            sceneFunc={(ctx, shapeNode) => {
              drawHeroPath(ctx, shapeId, 1.5, 1.5, rect.w - 3, rect.h - 3);
              ctx.fillStrokeShape(shapeNode);
            }}
            stroke={selected ? '#1fe08a' : 'rgba(255,255,255,.8)'}
            strokeWidth={selected ? 3 : 1.5}
          />
          <Text
            x={Math.max(8, rect.w * 0.16)}
            y={Math.max(8, rect.h * 0.08)}
            text={badge}
            fontSize={11}
            fontStyle="700"
            fontFamily="Inter, Arial, sans-serif"
            fill="#fff"
            shadowColor="#000"
            shadowBlur={4}
            shadowOpacity={0.9}
            listening={false}
          />
        </>
      )}
    </Group>
  );
}

export function drawHeroPath(
  ctx: Konva.Context,
  shapeId: HeroShapeId,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const sx = width / 100;
  const sy = height / 100;
  const px = (value: number) => x + value * sx;
  const py = (value: number) => y + value * sy;

  ctx.beginPath();
  switch (shapeId) {
    case 'heart':
      ctx.moveTo(px(50), py(88));
      ctx.bezierCurveTo(px(50), py(88), px(14), py(64), px(14), py(38));
      ctx.bezierCurveTo(px(14), py(24), px(24), py(14), px(36), py(14));
      ctx.bezierCurveTo(px(44), py(14), px(48), py(18), px(50), py(22));
      ctx.bezierCurveTo(px(52), py(18), px(56), py(14), px(64), py(14));
      ctx.bezierCurveTo(px(76), py(14), px(86), py(24), px(86), py(38));
      ctx.bezierCurveTo(px(86), py(64), px(50), py(88), px(50), py(88));
      break;
    case 'triangle':
      ctx.moveTo(px(50), py(6));
      ctx.lineTo(px(94), py(90));
      ctx.lineTo(px(6), py(90));
      break;
    case 'diamond':
      ctx.moveTo(px(50), py(4));
      ctx.lineTo(px(96), py(50));
      ctx.lineTo(px(50), py(96));
      ctx.lineTo(px(4), py(50));
      break;
    case 'hexagon':
      ctx.moveTo(px(50), py(4));
      ctx.lineTo(px(92), py(28));
      ctx.lineTo(px(92), py(72));
      ctx.lineTo(px(50), py(96));
      ctx.lineTo(px(8), py(72));
      ctx.lineTo(px(8), py(28));
      break;
    case 'circle':
    default:
      ctx.moveTo(px(50), py(4));
      ctx.bezierCurveTo(px(75.4), py(4), px(96), py(24.6), px(96), py(50));
      ctx.bezierCurveTo(px(96), py(75.4), px(75.4), py(96), px(50), py(96));
      ctx.bezierCurveTo(px(24.6), py(96), px(4), py(75.4), px(4), py(50));
      ctx.bezierCurveTo(px(4), py(24.6), px(24.6), py(4), px(50), py(4));
      break;
  }
  ctx.closePath();
}

function adjustHeroSubject(photo: LoadedPhoto, subjectBias: number): LoadedPhoto {
  if (photo.manualFrame || !photo.subject || subjectBias === 0) return photo;
  const y = clamp(photo.subject.y + subjectBias, 0, 1 - photo.subject.h);
  return { ...photo, subject: { ...photo.subject, y } };
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

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
