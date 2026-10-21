import { describe, expect, it } from '@jest/globals';

import { validateFileBuffer } from './file-validator';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64, 1)]);
const heif = ({ brand }: { brand: string }) =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`), Buffer.alloc(64, 1)]);

describe('validateFileBuffer', () => {
  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['WebP', WEBP, 'image/webp'],
  ])('reads %s by its bytes when images are allowed', (_name, buffer, mediaType) => {
    expect(validateFileBuffer({ buffer, allowImages: true })).toMatchObject({
      valid: true,
      fileType: 'image',
      imageMediaType: mediaType,
    });
  });

  it('refuses an image when images are not allowed', () => {
    expect(validateFileBuffer({ buffer: PNG })).toMatchObject({ valid: false, error: { code: 'UNSUPPORTED_TYPE' } });
  });

  it.each(['heic', 'heix', 'mif1'])('gives the HEIC-specific refusal (brand %s)', (brand) => {
    const result = validateFileBuffer({ buffer: heif({ brand }), allowImages: true });

    expect(result).toMatchObject({ valid: false, error: { code: 'UNSUPPORTED_TYPE' } });
    expect(!result.valid && result.error.message).toBe('statementParser.heicNotSupported');
  });

  it('gives the generic refusal for another binary type', () => {
    const result = validateFileBuffer({
      buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0)]),
      allowImages: true,
    });

    expect(!result.valid && result.error.message).not.toBe('statementParser.heicNotSupported');
  });
});
