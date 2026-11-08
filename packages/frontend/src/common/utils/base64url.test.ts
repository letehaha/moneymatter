import { describe, expect, it } from 'vitest';

import { arrayBufferToBase64Url, urlBase64ToUint8Array } from './base64url';

describe('base64url', () => {
  it('round-trips bytes that use the - and _ alphabet', () => {
    // 0xfb 0xff 0xfe encodes to "+//+" in standard base64, so "-__-" in base64url.
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe]);

    expect(arrayBufferToBase64Url({ buffer: bytes })).toBe('-__-');
    expect([...urlBase64ToUint8Array({ value: '-__-' })]).toEqual([...bytes]);
  });

  it.each([1, 2, 3, 4, 5, 64, 65])('round-trips %i bytes without padding characters', (length) => {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);
    const encoded = arrayBufferToBase64Url({ buffer: bytes });

    expect(encoded).not.toContain('=');
    expect([...urlBase64ToUint8Array({ value: encoded })]).toEqual([...bytes]);
  });

  it('adds the missing padding before decoding', () => {
    // "Zm9v" = "foo", "Zm8" (unpadded "Zm8=") = "fo", "Zg" (unpadded "Zg==") = "f"
    expect(new TextDecoder().decode(urlBase64ToUint8Array({ value: 'Zm9v' }))).toBe('foo');
    expect(new TextDecoder().decode(urlBase64ToUint8Array({ value: 'Zm8' }))).toBe('fo');
    expect(new TextDecoder().decode(urlBase64ToUint8Array({ value: 'Zg' }))).toBe('f');
  });

  it('encodes an ArrayBuffer and a typed-array view of a larger buffer alike', () => {
    const backing = new Uint8Array([9, 1, 2, 3, 9]).buffer;
    const view = new Uint8Array(backing, 1, 3);

    expect(arrayBufferToBase64Url({ buffer: view })).toBe(
      arrayBufferToBase64Url({ buffer: new Uint8Array([1, 2, 3]).buffer }),
    );
  });

  it('decodes a 65-byte VAPID public key', () => {
    const key = arrayBufferToBase64Url({ buffer: Uint8Array.from({ length: 65 }, (_, index) => index) });

    expect(key).toHaveLength(87);
    expect(urlBase64ToUint8Array({ value: key })).toHaveLength(65);
  });
});
