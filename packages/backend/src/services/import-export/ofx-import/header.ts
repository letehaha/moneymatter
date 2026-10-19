import { OfxParseError, type OfxHeader } from './types';

const HEADER_LIMIT_BYTES = 8 * 1024;
const SGML_REQUIRED_FIELDS = ['OFXHEADER', 'DATA', 'VERSION', 'ENCODING', 'CHARSET', 'COMPRESSION'] as const;
const XML_REQUIRED_FIELDS = ['OFXHEADER', 'VERSION', 'SECURITY', 'OLDFILEUID', 'NEWFILEUID'] as const;

export function parseOfxHeader({ bytes }: { bytes: Buffer }): { bodyOffset: number; header: OfxHeader } {
  if (bytes.length === 0) {
    throw new OfxParseError({ code: 'empty-file', key: 'ofxImport.errors.emptyFile' });
  }

  // The UTF-8 BOM must be dropped at the byte level: a Latin-1 decode turns it
  // into "\u00EF\u00BB\u00BF", which would then corrupt the first header key.
  const bomLength = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  // Latin-1 maps every byte to the same code point. That makes it safe for this
  // bootstrap pass: we can find the ASCII header without decoding the body with
  // a charset that the header has not told us yet.
  const prefix = bytes.subarray(bomLength, Math.min(bytes.length, HEADER_LIMIT_BYTES)).toString('latin1');
  const separator = /\r?\n\r?\n/.exec(prefix);
  const processingInstructionStart = prefix.search(/<\?OFX\s/i);
  const processingInstructionEnd =
    processingInstructionStart >= 0 ? prefix.indexOf('?>', processingInstructionStart) : -1;
  const values = new Map<string, string>();
  let bodyOffset = bomLength;
  // Detect the XML processing instruction before the SGML blank-line separator.
  // OFX2 permits blank lines around its declarations, which must not make it
  // enter the OFX1 header branch.
  const isXmlHeader = processingInstructionStart >= 0;
  if (isXmlHeader) {
    if (processingInstructionEnd < 0) {
      throw new OfxParseError({ code: 'invalid-header', key: 'ofxImport.errors.xmlDeclarationIncomplete' });
    }
    const instruction = prefix.slice(processingInstructionStart + 5, processingInstructionEnd);
    const attributePattern = /([A-Z]+)\s*=\s*(["'])(.*?)\2/gi;
    for (const match of instruction.matchAll(attributePattern)) {
      values.set(match[1]!.toUpperCase(), match[3]!.trim());
    }
  } else if (separator) {
    for (const line of prefix.slice(0, separator.index).split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon < 1) continue;
      values.set(line.slice(0, colon).trim().toUpperCase(), line.slice(colon + 1).trim());
    }
    bodyOffset = bomLength + separator.index + separator[0].length;
  } else {
    throw new OfxParseError({ code: 'invalid-header', key: 'ofxImport.errors.headerMissing' });
  }

  for (const field of isXmlHeader ? XML_REQUIRED_FIELDS : SGML_REQUIRED_FIELDS) {
    if (!values.get(field)) {
      throw new OfxParseError({
        code: 'invalid-header',
        key: 'ofxImport.errors.headerFieldMissing',
        params: { field },
      });
    }
  }

  const headerVersion = values.get('OFXHEADER')!;
  const version = values.get('VERSION')!;
  if (!/^\d{3}$/.test(headerVersion) || !/^\d{3}$/.test(version)) {
    throw new OfxParseError({ code: 'unsupported-version', key: 'ofxImport.errors.invalidVersion' });
  }
  if (!isXmlHeader) {
    const data = values.get('DATA')!.toUpperCase();
    const compression = values.get('COMPRESSION')!.toUpperCase();
    if (data !== 'OFXSGML') {
      throw new OfxParseError({ code: 'unsupported-data', key: 'ofxImport.errors.unsupportedData', params: { data } });
    }
    if (compression !== 'NONE') {
      throw new OfxParseError({ code: 'compressed-file', key: 'ofxImport.errors.compressedFile' });
    }
  }

  const xmlEncoding = /^\s*<\?xml[^>]*\bencoding\s*=\s*(["'])(.*?)\1/i.exec(prefix)?.[2] ?? 'UTF-8';

  return {
    bodyOffset,
    header: {
      charset: isXmlHeader ? xmlEncoding : values.get('CHARSET')!,
      compression: 'NONE',
      data: isXmlHeader ? 'OFXXML' : 'OFXSGML',
      encoding: isXmlHeader ? xmlEncoding : values.get('ENCODING')!,
      headerVersion,
      version,
    },
  };
}
