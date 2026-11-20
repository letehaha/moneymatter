import { MAX_EXTERNAL_URL_LENGTH } from '@bt/shared/const/entity-external-url';
import { describe, expect, it } from 'vitest';

import {
  formatExternalUrlLabel,
  isHttpUrl,
  isHttpsUrl,
  normalizeExternalUrl,
  safeExternalUrl,
  validateOptionalExternalUrl,
} from './external-url';

describe('external-url', () => {
  it.each([
    ['https://example.com', true, true],
    ['HTTPS://example.com', true, true],
    ['http://example.com', true, false],
    ['javascript:alert(1)', false, false],
    ['not a url', false, false],
    ['', false, false],
  ])('%s → http %s, https %s', (value, http, https) => {
    expect(isHttpUrl(value)).toBe(http);
    expect(isHttpsUrl(value)).toBe(https);
  });

  it('normalizes blank inputs to null and trims valid strings', () => {
    expect(normalizeExternalUrl({ value: undefined })).toBeNull();
    expect(normalizeExternalUrl({ value: null })).toBeNull();
    expect(normalizeExternalUrl({ value: '   ' })).toBeNull();
    expect(normalizeExternalUrl({ value: '  https://example.com/a  ' })).toBe('https://example.com/a');
  });

  it('returns safe http(s) hrefs only', () => {
    expect(safeExternalUrl({ value: ' https://example.com ' })).toBe('https://example.com');
    expect(safeExternalUrl({ value: 'javascript:alert(1)' })).toBeNull();
    expect(safeExternalUrl({ value: '' })).toBeNull();
  });

  it('validates optional external URLs for scheme and max length', () => {
    expect(validateOptionalExternalUrl({ value: '' })).toBeNull();
    expect(validateOptionalExternalUrl({ value: '   ' })).toBeNull();
    expect(validateOptionalExternalUrl({ value: null })).toBeNull();
    expect(validateOptionalExternalUrl({ value: 'https://bank.example.com/portal' })).toBeNull();
    expect(validateOptionalExternalUrl({ value: 'ftp://bank.example.com' })).toBe('httpUrl');
    expect(validateOptionalExternalUrl({ value: 'not-a-url' })).toBe('httpUrl');

    const overMax = `https://example.com/${'a'.repeat(MAX_EXTERNAL_URL_LENGTH)}`;
    expect(validateOptionalExternalUrl({ value: overMax })).toBe('maxLength');
  });

  it('formats URL labels without trailing root slash', () => {
    expect(formatExternalUrlLabel({ value: 'https://www.chase.com/' })).toBe('www.chase.com');
    expect(formatExternalUrlLabel({ value: 'https://www.chase.com/account/1?tab=main' })).toBe(
      'www.chase.com/account/1?tab=main',
    );
  });
});
