const MAX_DEVICE_LABEL_CODE_POINTS = 100;

/**
 * Cleans a device label a client sent: whitespace runs become one space, control characters go,
 * and the result is capped at 100 code points. `null` when nothing is left.
 */
export const sanitizeDeviceLabel = ({ label }: { label: string | null | undefined }): string | null => {
  if (!label) return null;

  const cleaned = label
    .replace(/\s+/gu, ' ')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  const capped = Array.from(cleaned).slice(0, MAX_DEVICE_LABEL_CODE_POINTS).join('').trimEnd();

  return capped || null;
};
