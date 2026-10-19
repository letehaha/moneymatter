import { decode as decodeBuffer } from 'iconv-lite';

import { parseOfxHeader } from './header';
import { OFX_MAX_FILE_BYTES, OfxParseError, type OfxDecodedFile } from './types';

type SupportedEncoding = BufferEncoding | 'windows-1252';

function resolveEncoding({ charset, encoding }: { charset: string; encoding: string }): SupportedEncoding {
  const normalizedEncoding = encoding.replace(/[-_]/g, '').toUpperCase();
  const normalizedCharset = charset.replace(/[-_]/g, '').toUpperCase();

  if (normalizedEncoding === 'UTF8' || normalizedCharset === 'UTF8' || normalizedCharset === '65001') return 'utf8';
  if (normalizedCharset === '1252' || normalizedCharset === 'WINDOWS1252') return 'windows-1252';
  if (normalizedCharset === '88591' || normalizedCharset === 'ISO88591') return 'latin1';
  if (normalizedEncoding === 'USASCII' && ['NONE', 'ASCII', 'USASCII'].includes(normalizedCharset)) return 'latin1';

  throw new OfxParseError({
    code: 'unsupported-encoding',
    key: 'ofxImport.errors.unsupportedEncoding',
    params: { encoding, charset },
  });
}

export function decodeOfxFile({ bytes }: { bytes: Buffer }): OfxDecodedFile {
  if (bytes.length > OFX_MAX_FILE_BYTES) {
    throw new OfxParseError({ code: 'file-too-large', key: 'ofxImport.errors.fileTooLarge' });
  }

  const { bodyOffset, header } = parseOfxHeader({ bytes });
  const encoding = resolveEncoding({ charset: header.charset, encoding: header.encoding });
  const bodyBytes = bytes.subarray(bodyOffset);
  // `ofx-js` accepts a string, not bytes. Decode here only after the byte-safe
  // header pass has told us which charset the financial institution used.
  const body = encoding === 'windows-1252' ? decodeBuffer(bodyBytes, encoding) : bodyBytes.toString(encoding);
  if (!body.trim()) throw new OfxParseError({ code: 'empty-body', key: 'ofxImport.errors.emptyBody' });

  return { body, formatVersion: Number(header.version) >= 200 ? '2.x' : '1.x' };
}
