import { STATEMENT_IMAGE_MAX_BYTES } from '@bt/shared/types';

/** An area cap rather than only an edge cap, so a long scrolling screenshot stays legible. */
const MAX_IMAGE_PIXELS = 4_000_000;
/** Anthropic rejects an image with a side over 8000px. */
const MAX_IMAGE_EDGE_PX = 7500;
const JPEG_QUALITY = 0.85;

/** Factor (at most 1) that brings the image within the pixel and edge caps. */
export function imageScale({ width, height }: { width: number; height: number }): number {
  return Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / (width * height)), MAX_IMAGE_EDGE_PX / Math.max(width, height));
}

/**
 * Shrinks an image the AI provider would reject into a JPEG. Decoding happens here rather
 * than on the server, where a corrupt file can crash the native decoder. Throws when the
 * browser can't decode the file.
 */
export async function fitImageForUpload({ file }: { file: File }): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    if (!width || !height) throw new Error('Image has no pixels');

    const scale = imageScale({ width, height });
    if (scale === 1 && file.size <= STATEMENT_IMAGE_MAX_BYTES) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    // JPEG has no alpha channel; unfilled transparent pixels would turn black behind dark text.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Image could not be encoded');

    return new File([blob], file.name, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
