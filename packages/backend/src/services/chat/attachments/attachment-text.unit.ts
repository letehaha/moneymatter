import { CHAT_ATTACHMENT_EXCERPT_CHARS, CHAT_ATTACHMENT_TEXT_MAX_CHARS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { buildAttachmentExcerpt, capAttachmentText, isAttachmentTextTruncated } from './attachment-text';

describe('capAttachmentText', () => {
  it('keeps text that fits', () => {
    expect(capAttachmentText({ text: 'short' })).toBe('short');
  });

  it('cuts text to the limit', () => {
    const capped = capAttachmentText({ text: 'a'.repeat(CHAT_ATTACHMENT_TEXT_MAX_CHARS + 500) });

    expect(capped).toHaveLength(CHAT_ATTACHMENT_TEXT_MAX_CHARS);
  });

  it('never leaves half of an emoji at the cut', () => {
    const text = `${'a'.repeat(CHAT_ATTACHMENT_TEXT_MAX_CHARS - 1)}😀 and more`;

    const capped = capAttachmentText({ text });

    expect(capped).toHaveLength(CHAT_ATTACHMENT_TEXT_MAX_CHARS);
    const last = capped.charCodeAt(capped.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });
});

describe('isAttachmentTextTruncated', () => {
  it('is true only for text that reached the limit', () => {
    expect(isAttachmentTextTruncated({ text: 'a'.repeat(CHAT_ATTACHMENT_TEXT_MAX_CHARS) })).toBe(true);
    expect(isAttachmentTextTruncated({ text: 'a'.repeat(CHAT_ATTACHMENT_TEXT_MAX_CHARS - 1) })).toBe(false);
    expect(isAttachmentTextTruncated({ text: null })).toBe(false);
  });

  it('agrees with what capAttachmentText produced for text cut at an emoji', () => {
    const capped = capAttachmentText({ text: `${'a'.repeat(CHAT_ATTACHMENT_TEXT_MAX_CHARS - 1)}😀 and more` });

    expect(isAttachmentTextTruncated({ text: capped })).toBe(true);
  });
});

describe('buildAttachmentExcerpt', () => {
  it('is null without text', () => {
    expect(buildAttachmentExcerpt({ text: null })).toBeNull();
  });

  it('collapses whitespace and keeps the start', () => {
    expect(buildAttachmentExcerpt({ text: '  date,amount\n\n2026-10-01,  5  ' })).toBe('date,amount 2026-10-01, 5');
  });

  it('keeps whole characters when it cuts', () => {
    const excerpt = buildAttachmentExcerpt({ text: '😀'.repeat(CHAT_ATTACHMENT_EXCERPT_CHARS + 50) })!;

    expect(Array.from(excerpt)).toHaveLength(CHAT_ATTACHMENT_EXCERPT_CHARS);
  });
});
