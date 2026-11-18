import { Money } from '@common/types/money';

import { OfxParseError } from './types';

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function parseOfxAmount({ value }: { value: string }): Money {
  let normalized = value.trim();
  // The OFX spec allows a comma as the decimal mark; big.js accepts neither it nor a leading "+"
  // "1,000" stays invalid: OFX has no thousands separator, and reading it as 1.000 would be silently wrong
  if (/^[+-]?\d*,(\d{1,2}|\d{4,})$/.test(normalized)) {
    normalized = normalized.replace(',', '.');
  }
  if (!DECIMAL.test(normalized)) {
    throw new OfxParseError({ code: 'invalid-amount', key: 'ofxImport.errors.invalidAmount', params: { value } });
  }
  try {
    return Money.fromDecimal(normalized.replace(/^\+/, ''));
  } catch {
    throw new OfxParseError({ code: 'invalid-amount', key: 'ofxImport.errors.invalidAmount', params: { value } });
  }
}
