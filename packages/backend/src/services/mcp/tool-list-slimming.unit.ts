import { describe, expect, it } from '@jest/globals';

import { slimToolListSchema } from './tool-list-slimming';

const UUID_PATTERN = '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$';

// zod's `datetime()` accepts a UTC time only (ending in Z); the pattern is the one place a client can read that.
const UTC_DATE_TIME_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z)$';

describe('slimToolListSchema', () => {
  it('drops the pattern next to a uuid or date format, keeps the format, and keeps a date-time pattern', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', pattern: UUID_PATTERN, description: 'Account id' },
        day: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        at: { type: 'string', format: 'date-time', pattern: UTC_DATE_TIME_PATTERN },
      },
    };

    expect(slimToolListSchema({ schema })).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Account id' },
        day: { type: 'string', format: 'date' },
        at: { type: 'string', format: 'date-time', pattern: UTC_DATE_TIME_PATTERN },
      },
    });
  });

  it('reaches into arrays, unions and nested objects', () => {
    const uuid = { type: 'string', format: 'uuid', pattern: UUID_PATTERN };
    const schema = {
      type: 'object',
      properties: {
        ids: { type: 'array', items: uuid },
        either: { anyOf: [uuid, { type: 'null' }] },
        nested: { type: 'object', properties: { id: uuid } },
      },
    };

    expect(JSON.stringify(slimToolListSchema({ schema }))).not.toContain('pattern');
  });

  it('keeps a pattern that has no format, and a property that is itself called pattern', () => {
    const schema = {
      type: 'object',
      properties: {
        color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        pattern: { type: 'string', format: 'uuid', pattern: UUID_PATTERN },
      },
    };

    expect(slimToolListSchema({ schema })).toEqual({
      type: 'object',
      properties: {
        color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        pattern: { type: 'string', format: 'uuid' },
      },
    });
  });

  it('does not change its input', () => {
    const schema = { type: 'string', format: 'uuid', pattern: UUID_PATTERN };

    slimToolListSchema({ schema });

    expect(schema.pattern).toBe(UUID_PATTERN);
  });
});
