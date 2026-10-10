import { describe, expect, it } from 'vitest';

import { MAX_FILE_SIZE, validateStatementFile } from './file-validation';

const fileOf = ({ bytes, name }: { bytes: number[]; name: string }): File => new File([new Uint8Array(bytes)], name);

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];

describe('validateStatementFile', () => {
  it('accepts a PDF, a PKCS#7 signed PDF and a text CSV', async () => {
    expect(await validateStatementFile({ file: fileOf({ bytes: PDF_HEADER, name: 'a.pdf' }) })).toEqual({
      valid: true,
    });
    expect(await validateStatementFile({ file: fileOf({ bytes: [0x30, 0x82, 0x01], name: 'signed.pdf' }) })).toEqual({
      valid: true,
    });
    expect(await validateStatementFile({ file: new File(['date,amount\n2026-01-01,1'], 'a.csv') })).toEqual({
      valid: true,
    });
  });

  it('accepts a PDF whose header sits within the first 1024 bytes', async () => {
    const bom = fileOf({ bytes: [0xef, 0xbb, 0xbf, 0x0d, 0x0a, ...PDF_HEADER], name: 'bom.pdf' });
    const lastSlot = fileOf({ bytes: [...Array<number>(1020).fill(0x20), ...PDF_HEADER], name: 'padded.pdf' });

    expect(await validateStatementFile({ file: bom })).toEqual({ valid: true });
    expect(await validateStatementFile({ file: lastSlot })).toEqual({ valid: true });
  });

  it('rejects a .pdf with no %PDF header in the first 1024 bytes and reports its leading bytes', async () => {
    const png = fileOf({ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], name: 'image.pdf' });
    const tooDeep = fileOf({ bytes: [...Array<number>(1021).fill(0x20), ...PDF_HEADER], name: 'deep.pdf' });

    expect(await validateStatementFile({ file: png })).toMatchObject({
      valid: false,
      reason: 'invalid_pdf',
      headerHex: '89504e470d0a1a0a',
    });
    expect(await validateStatementFile({ file: tooDeep })).toMatchObject({
      valid: false,
      reason: 'invalid_pdf',
      headerHex: '20'.repeat(16),
    });
  });

  it('rejects an empty .pdf with an empty header', async () => {
    const result = await validateStatementFile({ file: fileOf({ bytes: [], name: 'empty.pdf' }) });

    expect(result).toMatchObject({ valid: false, reason: 'invalid_pdf', headerHex: '' });
  });

  it('rejects a binary .csv', async () => {
    const result = await validateStatementFile({ file: fileOf({ bytes: [0x00, 0x01, 0x02, 0xff], name: 'a.csv' }) });

    expect(result).toMatchObject({ valid: false, reason: 'invalid_text', headerHex: '000102ff' });
  });

  it('rejects an unsupported extension and an oversized file without reading content', async () => {
    expect(await validateStatementFile({ file: fileOf({ bytes: PDF_HEADER, name: 'a.exe' }) })).toMatchObject({
      valid: false,
      reason: 'unsupported_extension',
    });

    const big = fileOf({ bytes: PDF_HEADER, name: 'big.pdf' });
    Object.defineProperty(big, 'size', { value: MAX_FILE_SIZE + 1 });

    expect(await validateStatementFile({ file: big })).toMatchObject({ valid: false, reason: 'too_large' });
  });
});
