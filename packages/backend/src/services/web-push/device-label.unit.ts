import { describe, expect, it } from '@jest/globals';

import { sanitizeDeviceLabel } from './device-label';

describe('sanitizeDeviceLabel', () => {
  it('trims the label', () => {
    expect(sanitizeDeviceLabel({ label: '  Safari on macOS  ' })).toBe('Safari on macOS');
  });

  it('collapses runs of whitespace, newlines and tabs into one space', () => {
    expect(sanitizeDeviceLabel({ label: 'Chrome \t on\n\n  Windows' })).toBe('Chrome on Windows');
  });

  it('strips control characters', () => {
    expect(sanitizeDeviceLabel({ label: 'Fire\u0000fox\u0007 on\u001b Linux\u007f' })).toBe('Firefox on Linux');
  });

  it('keeps non-ASCII text and emoji', () => {
    expect(sanitizeDeviceLabel({ label: 'Телефон Юрія 📱' })).toBe('Телефон Юрія 📱');
  });

  it('caps at 100 characters without splitting an emoji', () => {
    const result = sanitizeDeviceLabel({ label: '📱'.repeat(150) })!;
    expect(Array.from(result)).toHaveLength(100);
    expect(result).toBe('📱'.repeat(100));

    expect(sanitizeDeviceLabel({ label: 'a'.repeat(150) })).toBe('a'.repeat(100));
  });

  it('does not leave trailing whitespace after the cap', () => {
    expect(sanitizeDeviceLabel({ label: `${'a'.repeat(99)} bbb` })).toBe('a'.repeat(99));
  });

  it.each([null, undefined, '', '   ', '\n\t', '\u0000\u0001'])('returns null for %j', (label) => {
    expect(sanitizeDeviceLabel({ label })).toBeNull();
  });
});
