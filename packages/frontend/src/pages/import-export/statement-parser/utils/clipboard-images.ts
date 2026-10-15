const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const isImageType = ({ type }: { type: string }): boolean => type.startsWith('image/');

export function extensionForImageType({ type }: { type: string }): string {
  return EXTENSION_BY_TYPE[type] ?? type.slice('image/'.length);
}

export function pastedImageFiles({ blobs, now = Date.now() }: { blobs: Blob[]; now?: number }): File[] {
  return blobs.map((blob, index) => {
    const suffix = index ? `-${index + 1}` : '';
    const name = `pasted-image-${now}${suffix}.${extensionForImageType({ type: blob.type })}`;
    return new File([blob], name, { type: blob.type, lastModified: now });
  });
}

export function imageFilesFromClipboardEvent({ event }: { event: ClipboardEvent }): File[] {
  const blobs = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file' && isImageType({ type: item.type }))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  return pastedImageFiles({ blobs });
}

/** Throws when the browser denies clipboard access or has no `clipboard.read`. */
export async function readClipboardImages(): Promise<File[]> {
  const blobs: Blob[] = [];
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((candidate) => isImageType({ type: candidate }));
    if (type) blobs.push(await item.getType(type));
  }
  return pastedImageFiles({ blobs });
}
