import { Money } from '@common/types/money';

import { OfxParseError } from './types';

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function parseOfxAmount({ value }: { value: string }): Money {
  const normalized = value.trim();
  if (!DECIMAL.test(normalized)) {
    throw new OfxParseError({ code: 'invalid-amount', key: 'ofxImport.errors.invalidAmount', params: { value } });
  }
  try {
    return Money.fromDecimal(normalized);
  } catch {
    throw new OfxParseError({ code: 'invalid-amount', key: 'ofxImport.errors.invalidAmount', params: { value } });
  }
}
