import { Group, Rect, Image as KonvaImage, Text } from 'react-konva';
import useImage from 'use-image';
import type { LayoutSlot, PhotoState } from '../types';
import { clampPhotoPos, computeSlotRect, coverScale } from '../utils';

type Props = {
  slot: LayoutSlot;
  photo: PhotoState | null;
  stageW: number;
  stageH: number;
  borderWidth: number;
  bgColor: string;
  onPhotoChange: (photo: PhotoState) => void;
  onPickPhoto: () => void;
};

export function PhotoSlot({
  slot,
  photo,
  stageW,
  stageH,
  borderWidth,
  bgColor,
  onPhotoChange,
  onPickPhoto,
}: Props) {
  const rect = computeSlotRect(slot, stageW, stageH, borderWidth);
  const [img] = useImage(photo?.src ?? '');

  if (!photo || !img) {
    return (
      <Group
        x={rect.x}
        y={rect.y}
        onClick={onPickPhoto}
        onTap={onPickPhoto}
      >
        <Rect
          width={rect.w}
          height={rect.h}
          fill="#e8e8e8"
          stroke="#bbb"
          strokeWidth={1}
          dash={[6, 4]}
        />
        <Text
          text="+"
          fontSize={56}
          fill="#aaa"
          width={rect.w}
          height={rect.h}
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>
    );
  }

  const minScale = coverScale(photo.naturalWidth, photo.naturalHeight, rect.w, rect.h);
  const maxScale = minScale * 5;
  const effectiveScale = Math.min(maxScale, Math.max(minScale, photo.scale));
  const effectivePos = clampPhotoPos(
    photo.x,
    photo.y,
    effectiveScale,
    photo.naturalWidth,
    photo.naturalHeight,
    rect.w,
    rect.h
  );

  return (
    <Group
      x={rect.x}
      y={rect.y}
      clipFunc={(ctx) => {
        ctx.rect(0, 0, rect.w, rect.h);
      }}
      onDblClick={onPickPhoto}
      onDblTap={onPickPhoto}
      onWheel={(e) => {
        e.evt.preventDefault();
        const factor = e.evt.deltaY > 0 ? 0.94 : 1.06;
        const newScale = Math.max(minScale, Math.min(maxScale, effectiveScale * factor));
        const cx = rect.w / 2;
        const cy = rect.h / 2;
        const imgCx = (cx - effectivePos.x) / effectiveScale;
        const imgCy = (cy - effectivePos.y) / effectiveScale;
        const rawX = cx - imgCx * newScale;
        const rawY = cy - imgCy * newScale;
        const clamped = clampPhotoPos(
          rawX,
          rawY,
          newScale,
          photo.naturalWidth,
          photo.naturalHeight,
          rect.w,
          rect.h
        );
        onPhotoChange({ ...photo, x: clamped.x, y: clamped.y, scale: newScale });
      }}
    >
      <Rect width={rect.w} height={rect.h} fill={bgColor} />
      <KonvaImage
        image={img}
        x={effectivePos.x}
        y={effectivePos.y}
        width={photo.naturalWidth * effectiveScale}
        height={photo.naturalHeight * effectiveScale}
        draggable
        dragBoundFunc={(pos) => {
          const imgW = photo.naturalWidth * effectiveScale;
          const imgH = photo.naturalHeight * effectiveScale;
          return {
            x: Math.max(rect.x + rect.w - imgW, Math.min(rect.x, pos.x)),
            y: Math.max(rect.y + rect.h - imgH, Math.min(rect.y, pos.y)),
          };
        }}
        onDragMove={(e) => {
          onPhotoChange({
            ...photo,
            x: e.target.x() - rect.x,
            y: e.target.y() - rect.y,
            scale: effectiveScale,
          });
        }}
      />
    </Group>
  );
}
