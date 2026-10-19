import { parseStrict } from 'ofx-js';

import { OfxParseError, type OfxFormatVersion } from './types';

export type OfxNode = Record<string, unknown>;

function validateMarkupBounds({ body, formatVersion }: { body: string; formatVersion: OfxFormatVersion }): void {
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(body)) {
    throw new OfxParseError({ code: 'prohibited-declaration', key: 'ofxImport.errors.prohibitedDeclaration' });
  }

  // Only OFX 2.x (XML) closes every tag, so tag matching is only meaningful
  // there. OFX 1.x leaf tags are unclosed by design and cannot be depth-tracked.
  if (formatVersion !== '2.x') return;

  let position = 0;
  const xmlStack: string[] = [];
  while (position < body.length) {
    const open = body.indexOf('<', position);
    if (open < 0) break;
    const close = body.indexOf('>', open + 1);
    if (close < 0) throw new OfxParseError({ code: 'malformed-markup', key: 'ofxImport.errors.markupIncomplete' });
    const token = body.slice(open + 1, close).trim();
    if (token.startsWith('/')) {
      const name = token.slice(1).trim().split(/\s/, 1)[0];
      if (xmlStack.pop() !== name) {
        throw new OfxParseError({ code: 'malformed-markup', key: 'ofxImport.errors.tagsMismatch' });
      }
    } else if (token && !token.startsWith('?') && !token.startsWith('!') && !token.endsWith('/')) {
      xmlStack.push(token.split(/\s/, 1)[0]!);
    }
    position = close + 1;
  }
  if (xmlStack.length > 0) {
    throw new OfxParseError({ code: 'malformed-markup', key: 'ofxImport.errors.unclosedTags' });
  }
}

export function parseOfxSyntax({ body, formatVersion }: { body: string; formatVersion: OfxFormatVersion }): OfxNode {
  validateMarkupBounds({ body, formatVersion });
  try {
    const parsed = parseStrict(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || !('OFX' in parsed)) {
      throw new OfxParseError({ code: 'missing-root', key: 'ofxImport.errors.missingRoot' });
    }
    return parsed as OfxNode;
  } catch (error) {
    if (error instanceof OfxParseError) throw error;
    throw new OfxParseError({ code: 'malformed-ofx', key: 'ofxImport.errors.malformedOfx' });
  }
}
