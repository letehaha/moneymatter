import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { withoutSession } from '@tests/helpers/share';

describe('POST /client-logs', () => {
  it('accepts an event with context', async () => {
    const response = await helpers.recordClientLog({
      payload: {
        event: 'statement_import.file_rejected',
        level: 'warn',
        context: { reason: 'invalid_pdf', sizeBytes: 1024, headerHex: 'efbbbf25504446', mimeType: null },
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('accepts an event without context', async () => {
    const response = await helpers.recordClientLog({ payload: { event: 'some.event', level: 'info' } });

    expect(response.statusCode).toBe(200);
  });

  it.each([
    ['a missing event', { level: 'warn' }],
    ['a missing level', { event: 'some.event' }],
    ['an event with spaces and a newline', { event: 'Has Spaces\nand newline', level: 'warn' }],
    ['an event over 100 chars', { event: 'e'.repeat(101), level: 'warn' }],
    ['an unknown level', { event: 'some.event', level: 'fatal' }],
    ['a nested context value', { event: 'some.event', level: 'warn', context: { nested: { a: 1 } } }],
    ['a context value over 500 chars', { event: 'some.event', level: 'warn', context: { text: 'x'.repeat(501) } }],
    ['a context key over 50 chars', { event: 'some.event', level: 'warn', context: { ['k'.repeat(51)]: 1 } }],
    [
      'more than 20 context keys',
      {
        event: 'some.event',
        level: 'warn',
        context: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i])),
      },
    ],
  ])('rejects %s', async (_name, payload) => {
    const response = await helpers.recordClientLog({ payload });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('rejects an unauthenticated call', async () => {
    const response = await withoutSession(() =>
      helpers.recordClientLog({ payload: { event: 'some.event', level: 'info' } }),
    );

    expect(response.statusCode).toBe(ERROR_CODES.Unauthorized);
  });
});
