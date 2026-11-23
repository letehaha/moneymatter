import { MAX_EXTERNAL_URL_LENGTH } from '@bt/shared/const/entity-external-url';
import { describe, expect, it } from 'vitest';

import {
  formatExternalUrlLabel,
  isHttpUrl,
  isHttpsUrl,
  normalizeExternalUrl,
  safeExternalUrl,
  splitTextLinks,
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

  const link = (text: string) => ({ text, isLink: true });
  const plain = (text: string) => ({ text, isLink: false });

  it.each([
    ['Order (see https://shop.example.com/o/1). Thanks', 'https://shop.example.com/o/1'],
    ['(see https://x.com/a.)', 'https://x.com/a'],
    ['((https://x.com/a))', 'https://x.com/a'],
    ['(https://x.com/a?)', 'https://x.com/a'],
    ['[https://x.com/a]', 'https://x.com/a'],
    ['«https://x.com/a»', 'https://x.com/a'],
    ['**https://x.com/a**', 'https://x.com/a'],
    ['https://x.com/a…', 'https://x.com/a'],
    ['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ['HTTPS://X.COM:8080/p?a=1&b=2.', 'HTTPS://X.COM:8080/p?a=1&b=2'],
  ])('links %s as %s', (text, href) => {
    expect(splitTextLinks({ text }).filter((part) => part.isLink)).toEqual([link(href)]);
  });

  it('keeps every character of the note across plain runs and links', () => {
    const text = 'https://a.com, then (https://b.com/x.) and http:// alone https://c.com';
    const parts = splitTextLinks({ text });

    expect(parts.map((part) => part.text).join('')).toBe(text);
    expect(parts).toEqual([
      link('https://a.com'),
      plain(', then ('),
      link('https://b.com/x'),
      plain('.) and http:// alone '),
      link('https://c.com'),
    ]);
  });

  it('never links non-http schemes or a bare scheme', () => {
    expect(splitTextLinks({ text: 'javascript:alert(1) http://. no link' })).toEqual([
      plain('javascript:alert(1) http://. no link'),
    ]);
    expect(splitTextLinks({ text: '' })).toEqual([]);
  });
});
