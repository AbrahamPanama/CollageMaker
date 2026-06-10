import { detectSubject } from './smartFrame';
import type { Photo } from './types';

export type LoadedPhoto = Photo & { name: string };

export async function loadPhoto(file: File): Promise<LoadedPhoto | null> {
  const src = await readFile(file);
  const image = await loadImage(src);
  if (!image) return null;
  const subject = await detectSubject(image);
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    src,
    name: file.name,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    subject,
  };
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
