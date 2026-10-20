import { describe, expect, it } from '@jest/globals';

import { compactJsonText } from './result-text';

describe('compactJsonText', () => {
  it('drops the indentation of a pretty-printed result and keeps its content', () => {
    const data = { transactions: [{ id: 'a', amount: 12.5, tags: [] }], count: 1 };
    const pretty = JSON.stringify(data, null, 2);

    const compact = compactJsonText({ text: pretty });

    expect(compact).toBe(JSON.stringify(data));
    expect(compact.length).toBeLessThan(pretty.length);
    expect(JSON.parse(compact)).toEqual(data);
  });

  it('leaves text that is not JSON as it is', () => {
    expect(compactJsonText({ text: 'No transactions found.' })).toBe('No transactions found.');
    expect(compactJsonText({ text: '{"a": 1}\n{"b": 2}' })).toBe('{"a": 1}\n{"b": 2}');
  });

  it('leaves a bare number or string as it is', () => {
    expect(compactJsonText({ text: '42' })).toBe('42');
  });
});
