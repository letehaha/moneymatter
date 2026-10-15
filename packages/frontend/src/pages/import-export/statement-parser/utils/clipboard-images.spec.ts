import { describe, expect, it } from 'vitest';

import { extensionForImageType, imageFilesFromClipboardEvent, pastedImageFiles } from './clipboard-images';

const blobOf = ({ type }: { type: string }): Blob => new Blob([new Uint8Array([1, 2, 3])], { type });

const clipboardEventOf = ({ items }: { items: { kind: string; type: string; file: File | null }[] }): ClipboardEvent =>
  ({
    clipboardData: {
      items: items.map(({ kind, type, file }) => ({
        kind,
        type,
        getAsFile: () => file,
      })),
    },
  }) as unknown as ClipboardEvent;

describe('extensionForImageType', () => {
  it('maps the supported image types to their short extensions', () => {
    expect(extensionForImageType({ type: 'image/jpeg' })).toBe('jpg');
    expect(extensionForImageType({ type: 'image/png' })).toBe('png');
    expect(extensionForImageType({ type: 'image/webp' })).toBe('webp');
  });

  it('falls back to the mime subtype for other image types', () => {
    expect(extensionForImageType({ type: 'image/gif' })).toBe('gif');
  });
});

describe('pastedImageFiles', () => {
  it('names each blob uniquely with a matching extension and type', () => {
    const files = pastedImageFiles({
      blobs: [blobOf({ type: 'image/png' }), blobOf({ type: 'image/jpeg' })],
      now: 1700,
    });

    expect(files.map((file) => file.name)).toEqual(['pasted-image-1700.png', 'pasted-image-1700-2.jpg']);
    expect(files.map((file) => file.type)).toEqual(['image/png', 'image/jpeg']);
    expect(files.every((file) => file.lastModified === 1700)).toBe(true);
  });
});

describe('imageFilesFromClipboardEvent', () => {
  it('keeps only image file items', () => {
    const event = clipboardEventOf({
      items: [
        { kind: 'string', type: 'text/plain', file: null },
        {
          kind: 'file',
          type: 'application/pdf',
          file: new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }),
        },
        {
          kind: 'file',
          type: 'image/png',
          file: new File([new Uint8Array([1])], 'image.png', {
            type: 'image/png',
          }),
        },
      ],
    });

    const files = imageFilesFromClipboardEvent({ event });

    expect(files).toHaveLength(1);
    expect(files[0]!.name).toMatch(/^pasted-image-\d+\.png$/);
    expect(files[0]!.type).toBe('image/png');
  });

  it('returns nothing without clipboard data', () => {
    expect(imageFilesFromClipboardEvent({ event: {} as ClipboardEvent })).toEqual([]);
  });
});
