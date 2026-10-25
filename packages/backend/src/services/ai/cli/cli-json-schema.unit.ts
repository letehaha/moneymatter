import type { JSONSchema7 } from '@ai-sdk/provider';
import { describe, expect, it } from '@jest/globals';

import { closeObjectSchemas, stripSchemaFormats } from './cli-json-schema';

const schema: JSONSchema7 = {
  type: 'object',
  properties: {
    date: { type: 'string', format: 'date' },
    format: { type: 'string' },
    lines: {
      type: 'array',
      items: { type: 'object', properties: { at: { type: 'string', format: 'date-time' } } },
    },
    pick: { anyOf: [{ type: 'string', format: 'uri' }, { type: 'null' }] },
  },
};

describe('stripSchemaFormats', () => {
  it('removes format keywords everywhere but keeps a property named format', () => {
    const result = stripSchemaFormats({ schema });

    expect(JSON.stringify(result)).not.toContain('"format":"');
    expect(result.properties).toHaveProperty('format', { type: 'string' });
  });
});

describe('closeObjectSchemas', () => {
  it('sets additionalProperties false on every object, nested ones included', () => {
    const result = closeObjectSchemas({ schema });
    const lines = (result.properties!.lines as JSONSchema7).items as JSONSchema7;

    expect(result.additionalProperties).toBe(false);
    expect(lines.additionalProperties).toBe(false);
    expect((result.properties!.date as JSONSchema7).additionalProperties).toBeUndefined();
  });
});
