import { forwardRef } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import type Konva from 'konva';
import type { Layout, PhotoState } from '../types';
import { PhotoSlot } from './PhotoSlot';

type Props = {
  layout: Layout;
  photos: (PhotoState | null)[];
  width: number;
  height: number;
  borderWidth: number;
  borderColor: string;
  bgColor: string;
  onPhotoChange: (idx: number, photo: PhotoState) => void;
  onPickPhoto: (idx: number) => void;
};

export const CollageStage = forwardRef<Konva.Stage, Props>(function CollageStage(
  {
    layout,
    photos,
    width,
    height,
    borderWidth,
    borderColor,
    bgColor,
    onPhotoChange,
    onPickPhoto,
  },
  ref
) {
  return (
    <Stage ref={ref} width={width} height={height}>
      <Layer>
        <Rect width={width} height={height} fill={borderColor} />
        {layout.slots.map((slot, idx) => (
          <PhotoSlot
            key={`${layout.id}-${idx}`}
            slot={slot}
            photo={photos[idx] ?? null}
            stageW={width}
            stageH={height}
            borderWidth={borderWidth}
            bgColor={bgColor}
            onPhotoChange={(p) => onPhotoChange(idx, p)}
            onPickPhoto={() => onPickPhoto(idx)}
          />
        ))}
      </Layer>
    </Stage>
  );
});
