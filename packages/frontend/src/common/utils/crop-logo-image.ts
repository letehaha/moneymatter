import { LOGO_IMAGE_MAX_BYTES } from '@bt/shared/types';

const LOGO_IMAGE_SIZE = 200;
const LOSSY_QUALITY = 0.85;

export class LogoImageUnreadableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Logo image could not be decoded', options);
    this.name = 'LogoImageUnreadableError';
  }
}

export class LogoImageTooLargeError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Logo image exceeds the size limit after cropping', options);
    this.name = 'LogoImageTooLargeError';
  }
}

class LogoImageCanvasUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('2D canvas context is unavailable', options);
    this.name = 'LogoImageCanvasUnavailableError';
  }
}

const canvasToBlob = ({ canvas, type, quality }: { canvas: HTMLCanvasElement; type: string; quality?: number }) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

const encodeAs = async ({ canvas, type, quality }: { canvas: HTMLCanvasElement; type: string; quality?: number }) => {
  const blob = await canvasToBlob({ canvas, type, quality });
  return blob?.type === type ? blob : null;
};

// JPEG has no alpha channel and encodes transparent pixels as black.
const fillTransparentWhite = ({ canvas }: { canvas: HTMLCanvasElement }) => {
  const context = canvas.getContext('2d');
  if (!context) throw new LogoImageCanvasUnavailableError();
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
};

const blobToDataUrl = ({ blob }: { blob: Blob }) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Center-crops an image to a square, scales it to the logo size and returns it as a data URL. */
export async function cropLogoImage({ file }: { file: Blob }): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new LogoImageUnreadableError({ cause: error });
  }

  const canvas = document.createElement('canvas');
  canvas.width = LOGO_IMAGE_SIZE;
  canvas.height = LOGO_IMAGE_SIZE;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new LogoImageCanvasUnavailableError();
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      LOGO_IMAGE_SIZE,
      LOGO_IMAGE_SIZE,
    );
  } finally {
    bitmap.close();
  }

  // Safari cannot encode WebP; JPEG keeps a photo under the cap where PNG would not.
  let blob = await encodeAs({ canvas, type: 'image/webp', quality: LOSSY_QUALITY });
  if (!blob) {
    fillTransparentWhite({ canvas });
    blob =
      (await encodeAs({ canvas, type: 'image/jpeg', quality: LOSSY_QUALITY })) ??
      (await encodeAs({ canvas, type: 'image/png' }));
  }
  if (!blob) throw new LogoImageCanvasUnavailableError();
  if (blob.size > LOGO_IMAGE_MAX_BYTES) throw new LogoImageTooLargeError();

  return blobToDataUrl({ blob });
}
