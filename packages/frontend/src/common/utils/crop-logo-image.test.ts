import { LOGO_IMAGE_MAX_BYTES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogoImageTooLargeError, LogoImageUnreadableError, cropLogoImage } from './crop-logo-image';

const makeBlob = ({ type, size = 16 }: { type: string; size?: number }) => new Blob([new Uint8Array(size)], { type });

const stubEncoder = (encode: (type: string) => Blob | null) => {
  const toBlob = vi.fn(function (this: HTMLCanvasElement, callback: BlobCallback, type?: string) {
    callback(encode(type ?? 'image/png'));
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob);
  return toBlob;
};

const file = makeBlob({ type: 'image/png' });

describe('cropLogoImage', () => {
  let bitmap: { width: number; height: number; close: () => void };
  let context: { drawImage: ReturnType<typeof vi.fn>; fillRect: ReturnType<typeof vi.fn> } & Partial<
    Pick<CanvasRenderingContext2D, 'fillStyle' | 'globalCompositeOperation'>
  >;

  beforeEach(() => {
    bitmap = { width: 400, height: 300, close: vi.fn() };
    context = { drawImage: vi.fn(), fillRect: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes as WebP when the browser supports it', async () => {
    const toBlob = stubEncoder((type) => makeBlob({ type }));

    const dataUrl = await cropLogoImage({ file });

    expect(dataUrl.startsWith('data:image/webp;base64,')).toBe(true);
    expect(toBlob).toHaveBeenCalledTimes(1);
    expect(context.fillRect).not.toHaveBeenCalled();
  });

  it('draws the center square of the image scaled to the logo size', async () => {
    stubEncoder((type) => makeBlob({ type }));

    await cropLogoImage({ file });

    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 50, 0, 300, 300, 0, 0, 200, 200);
  });

  it('falls back to JPEG when WebP encoding yields nothing', async () => {
    stubEncoder((type) => (type === 'image/webp' ? null : makeBlob({ type })));

    const dataUrl = await cropLogoImage({ file });

    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('fills transparent pixels white before encoding JPEG', async () => {
    const toBlob = stubEncoder((type) => (type === 'image/webp' ? null : makeBlob({ type })));

    await cropLogoImage({ file });

    expect(toBlob.mock.calls[1]?.[1]).toBe('image/jpeg');
    expect(context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(toBlob.mock.invocationCallOrder[1]!);

    expect(context.globalCompositeOperation).toBe('destination-over');
    expect(context.fillStyle).toBe('#ffffff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 200, 200);
  });

  it('rejects a crop that is still over the size cap', async () => {
    stubEncoder((type) => makeBlob({ type, size: LOGO_IMAGE_MAX_BYTES + 1 }));

    await expect(cropLogoImage({ file })).rejects.toBeInstanceOf(LogoImageTooLargeError);
  });

  it('rejects a file the browser cannot decode', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new DOMException('bad image', 'InvalidStateError');
      }),
    );

    await expect(cropLogoImage({ file })).rejects.toBeInstanceOf(LogoImageUnreadableError);
  });
});
