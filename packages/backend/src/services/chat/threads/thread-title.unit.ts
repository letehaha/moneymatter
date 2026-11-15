import { CHAT_THREAD_TITLE_MAX_CHARS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { deriveThreadTitle, sanitizeModelThreadTitle } from './thread-title';

describe('deriveThreadTitle', () => {
  it('uses the message text with its whitespace collapsed', () => {
    expect(deriveThreadTitle({ text: '  Where did   my money\n go in September?  ', attachmentNames: [] })).toBe(
      'Where did my money go in September?',
    );
  });

  it('cuts a long message at the title limit and marks the cut', () => {
    const title = deriveThreadTitle({ text: 'word '.repeat(100), attachmentNames: [] });

    expect([...title]).toHaveLength(CHAT_THREAD_TITLE_MAX_CHARS);
    expect(title.endsWith('…')).toBe(true);
  });

  it('does not split a character that takes two code units', () => {
    const title = deriveThreadTitle({ text: '😀'.repeat(300), attachmentNames: [] });

    expect([...title]).toHaveLength(CHAT_THREAD_TITLE_MAX_CHARS);
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('falls back to the first attachment name, without its extension, when there is no text', () => {
    expect(deriveThreadTitle({ text: '   ', attachmentNames: ['october-statement.pdf', 'receipt.png'] })).toBe(
      'october-statement',
    );
  });

  it.each([
    'image.png',
    'Screenshot 2026-10-19 at 11.02.33.png',
    'IMG_4821.jpg',
    'photo.jpeg',
    'Pasted image.png',
    '1729339200.png',
  ])('leaves a thread whose only content is the generic image %s untitled, for the model to name', (fileName) => {
    expect(deriveThreadTitle({ text: '', attachmentNames: [fileName] })).toBe('');
  });

  it('keeps a file name that says something, and the text of a message, over an empty title', () => {
    expect(deriveThreadTitle({ text: '', attachmentNames: ['october-statement.pdf'] })).toBe('october-statement');
    expect(deriveThreadTitle({ text: 'What is this?', attachmentNames: ['image.png'] })).toBe('What is this?');
  });

  it('leaves the title empty when there is nothing to name it from', () => {
    expect(deriveThreadTitle({ text: '', attachmentNames: [] })).toBe('');
  });
});

describe('sanitizeModelThreadTitle', () => {
  it('trims, collapses whitespace and strips quotes around the title', () => {
    expect(sanitizeModelThreadTitle({ title: '  "Coffee   spending\n in September"  ' })).toBe(
      'Coffee spending in September',
    );
  });

  it('strips control characters, markdown and angle brackets', () => {
    const title = sanitizeModelThreadTitle({ title: '# **Budget** `check` <b>now</b>\u0000\u0007' })!;

    expect(title).toBe('Budget check bnow/b');
    expect(title).not.toMatch(/[*#`<>]/);
    expect([...title].some((character) => character.charCodeAt(0) < 32)).toBe(false);
  });

  it('cuts a long title at the title limit with an ellipsis', () => {
    const title = sanitizeModelThreadTitle({ title: 'word '.repeat(100) })!;

    expect([...title]).toHaveLength(CHAT_THREAD_TITLE_MAX_CHARS);
    expect(title.endsWith('…')).toBe(true);
  });

  it('keeps letters of any script and emoji', () => {
    expect(sanitizeModelThreadTitle({ title: 'Витрати на каву ☕' })).toBe('Витрати на каву ☕');
  });

  it.each(['', '   ', '"" ', '***', '\u0000'])('refuses %j, which names nothing', (title) => {
    expect(sanitizeModelThreadTitle({ title })).toBeNull();
  });
});
