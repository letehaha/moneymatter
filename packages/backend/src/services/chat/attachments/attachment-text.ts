import { CHAT_ATTACHMENT_EXCERPT_CHARS, CHAT_ATTACHMENT_TEXT_MAX_CHARS } from '@bt/shared/types';

const isHighSurrogate = ({ code }: { code: number }): boolean => code >= 0xd800 && code <= 0xdbff;

/**
 * Cuts extracted text to `CHAT_ATTACHMENT_TEXT_MAX_CHARS`. The result is exactly that long when
 * anything was cut (a cut through the middle of an emoji swaps its first half for U+FFFD), which is
 * what `isAttachmentTextTruncated` relies on.
 */
export const capAttachmentText = ({ text }: { text: string }): string => {
  if (text.length <= CHAT_ATTACHMENT_TEXT_MAX_CHARS) return text;

  const cut = text.slice(0, CHAT_ATTACHMENT_TEXT_MAX_CHARS);
  return isHighSurrogate({ code: cut.charCodeAt(cut.length - 1) }) ? `${cut.slice(0, -1)}�` : cut;
};

/**
 * Whether stored text was cut. No column records it: stored text is never longer than the limit, so
 * text that reached it was either cut or is exactly that long, and both are worth a notice.
 */
export const isAttachmentTextTruncated = ({ text }: { text: string | null }): boolean =>
  text !== null && text.length >= CHAT_ATTACHMENT_TEXT_MAX_CHARS;

/** The start of the text on one line, for the composer and for later turns that see a reference only. */
export const buildAttachmentExcerpt = ({ text }: { text: string | null }): string | null => {
  if (!text) return null;

  // A whitespace-only start still has to give way to the text after it, so look past it.
  const head = text
    .slice(0, CHAT_ATTACHMENT_EXCERPT_CHARS * 4 + 200)
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(head).slice(0, CHAT_ATTACHMENT_EXCERPT_CHARS).join('');
};
