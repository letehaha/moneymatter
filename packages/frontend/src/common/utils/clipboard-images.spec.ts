import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acceptListsImages,
  extensionForImageType,
  imageFilesFromClipboardEvent,
  isEditableTarget,
  pastedImageFiles,
  readClipboardImages,
} from './clipboard-images';

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

describe('acceptListsImages', () => {
  it('is true when any entry is an image mime type', () => {
    expect(acceptListsImages({ accept: 'application/pdf, image/png' })).toBe(true);
    expect(acceptListsImages({ accept: 'image/*' })).toBe(true);
  });

  it('is false without an image mime type', () => {
    expect(acceptListsImages({ accept: '.csv,text/csv' })).toBe(false);
    expect(acceptListsImages({})).toBe(false);
  });
});

describe('isEditableTarget', () => {
  it('matches form fields and contenteditable elements', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isEditableTarget({ target: document.createElement(tag) })).toBe(true);
    }
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isEditableTarget({ target: editable })).toBe(true);
  });

  it('ignores other elements and non-elements', () => {
    expect(isEditableTarget({ target: document.createElement('div') })).toBe(false);
    expect(isEditableTarget({ target: document })).toBe(false);
    expect(isEditableTarget({ target: null })).toBe(false);
  });
});

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

describe('readClipboardImages', () => {
  const stubClipboardRead = ({ read }: { read: () => Promise<unknown[]> }) =>
    vi.stubGlobal('navigator', { clipboard: { read } });

  const clipboardItemOf = ({ types }: { types: string[] }) => ({
    types,
    getType: vi.fn(async (type: string) => blobOf({ type })),
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the image type of each item and skips items without one', async () => {
    const mixed = clipboardItemOf({ types: ['text/html', 'image/png'] });
    const textOnly = clipboardItemOf({ types: ['text/plain'] });
    stubClipboardRead({ read: async () => [mixed, textOnly] });

    const files = await readClipboardImages();

    expect(mixed.getType).toHaveBeenCalledWith('image/png');
    expect(textOnly.getType).not.toHaveBeenCalled();
    expect(files.map((file) => file.type)).toEqual(['image/png']);
  });

  it('propagates a denied clipboard read', async () => {
    stubClipboardRead({ read: () => Promise.reject(new Error('denied')) });

    await expect(readClipboardImages()).rejects.toThrow('denied');
  });
});
