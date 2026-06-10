import { Group, Image as KonvaImage, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import type { GridCell as GridCellModel, Rect as GridRect } from '../gridLayout/types';
import type { LoadedPhoto } from '../photoIngest';
import type { ManualFrame } from '../types';
import {
  MAX_MANUAL_ZOOM,
  computePhotoPlacement,
  constrainManualFrame,
} from '../photoFraming';

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
  onSelect,
  onEdit,
  onManualFrameChange,
  onDropPhoto,
}: Props) {
  const [image] = useImage(photo?.src ?? '');
  const radius = Math.min(cornerRadius, rect.w / 2, rect.h / 2);

  if (!photo) {
    return (
      <Group x={rect.x} y={rect.y}>
        <Rect width={rect.w} height={rect.h} fill="#171719" stroke="#444" dash={[6, 4]} />
      </Group>
    );
  }

  const placement = computePhotoPlacement(photo, rect.w, rect.h, { closeUp, closeUpTightness });
  const badge = photo.manualFrame ? 'manual' : photo.subject?.source ?? 'auto';

  return (
    <Group
      x={rect.x}
      y={rect.y}
      clipFunc={(ctx) => {
        roundedRect(ctx, 0, 0, rect.w, rect.h, radius);
      }}
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
            { ...frame, zoom: Math.max(1, Math.min(MAX_MANUAL_ZOOM, frame.zoom * factor)) },
            photo,
            rect.w,
            rect.h
          )
        );
      }}
    >
      <Rect width={rect.w} height={rect.h} fill={background} cornerRadius={radius} />
      {image ? (
        <KonvaImage
          image={image}
          x={placement.x}
          y={placement.y}
          width={placement.w}
          height={placement.h}
          draggable
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
      ) : (
        <Rect width={rect.w} height={rect.h} fill="#2b2b2d" />
      )}

      {showUi && (
        <>
          <Rect
            width={rect.w}
            height={rect.h}
            stroke={selected ? '#1fe08a' : 'rgba(255,255,255,.45)'}
            strokeWidth={selected ? 3 : 1}
            cornerRadius={radius}
            listening={false}
          />
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
          <Text
            x={Math.max(6, rect.w - 26)}
            y={Math.max(6, rect.h - 20)}
            width={20}
            text={cell.photoId.slice(-2).toUpperCase()}
            align="right"
            fontSize={10}
            fontFamily="Inter, Arial, sans-serif"
            fill="#fff"
            shadowColor="#000"
            shadowBlur={3}
            shadowOpacity={0.8}
            listening={false}
          />
        </>
      )}
    </Group>
  );
}

function frameFromPlacement(
  photo: LoadedPhoto,
  frameW: number,
  frameH: number,
  placement: { x: number; y: number; w: number; h: number; scale: number }
) {
  if (photo.manualFrame) return constrainManualFrame(photo.manualFrame, photo, frameW, frameH);
  const coverScale = Math.max(frameW / photo.naturalWidth, frameH / photo.naturalHeight);
  return constrainManualFrame(
    {
      cx: (frameW / 2 - placement.x) / Math.max(1, placement.w),
      cy: (frameH / 2 - placement.y) / Math.max(1, placement.h),
      zoom: Math.max(1, placement.scale / Math.max(0.0001, coverScale)),
    },
    photo,
    frameW,
    frameH
  );
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
