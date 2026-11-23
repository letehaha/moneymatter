import { MAX_EXTERNAL_URL_LENGTH } from '@bt/shared/const/entity-external-url';

const protocolOf = (value: string) => {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
};

// Render guard for user-supplied links: only the API validates the scheme, and
// restored backups bypass it, so a `javascript:` value must never reach an href.
export const isHttpUrl = (value: string) => /^https?:$/i.test(protocolOf(value) ?? '');

export const isHttpsUrl = (value: string) => protocolOf(value) === 'https:';

export const normalizeExternalUrl = ({ value }: { value: string | null | undefined }): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const safeExternalUrl = ({ value }: { value: string | null | undefined }): string | null => {
  const normalized = normalizeExternalUrl({ value });
  return normalized && isHttpUrl(normalized) ? normalized : null;
};

type ExternalUrlValidationError = 'maxLength' | 'httpUrl' | null;

export const validateOptionalExternalUrl = ({
  value,
}: {
  value: string | null | undefined;
}): ExternalUrlValidationError => {
  const normalized = normalizeExternalUrl({ value });
  if (normalized === null) return null;
  if (normalized.length > MAX_EXTERNAL_URL_LENGTH) return 'maxLength';
  if (!isHttpUrl(normalized)) return 'httpUrl';
  return null;
};

/** Expects a URL that already passed `safeExternalUrl`. */
export const formatExternalUrlLabel = ({ value }: { value: string }): string => {
  const url = new URL(value);
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.host}${path}${url.search}`;
};

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'"*\]}»”’…]$/;
const endsWithUnbalancedParen = (url: string) => url.endsWith(')') && url.split(')').length > url.split('(').length;

type TextPart = { text: string; isLink: boolean };

/** Splits text into plain runs and http(s) links; closing punctuation and unbalanced `)` stay outside the link. */
export const splitTextLinks = ({ text }: { text: string }): TextPart[] => {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    let url = match[0];
    while (TRAILING_PUNCTUATION.test(url) || endsWithUnbalancedParen(url)) url = url.slice(0, -1);
    if (!isHttpUrl(url)) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index), isLink: false });
    parts.push({ text: url, isLink: true });
    last = match.index + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), isLink: false });
  return parts;
};
