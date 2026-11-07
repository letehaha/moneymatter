import { describe, expect, it } from '@jest/globals';

import { classifySendResult, type SendResultKind } from './classify-send-result';

describe('classifySendResult', () => {
  it.each<[number, SendResultKind]>([
    [200, 'ok'],
    [201, 'ok'],
    [202, 'ok'],
    [404, 'gone'],
    [410, 'gone'],
    [400, 'rejected'],
    [401, 'instance'],
    [403, 'instance'],
    [413, 'instance'],
    [429, 'retry'],
    [500, 'retry'],
    [502, 'retry'],
    [503, 'retry'],
  ])('maps status %i to %s', (statusCode, expected) => {
    expect(classifySendResult({ statusCode })).toBe(expected);
  });

  it('reads the status from a thrown WebPushError-like error', () => {
    expect(
      classifySendResult({ error: Object.assign(new Error('Received unexpected response code'), { statusCode: 410 }) }),
    ).toBe('gone');
    expect(classifySendResult({ error: Object.assign(new Error('boom'), { statusCode: 403 }) })).toBe('instance');
  });

  it('prefers an explicit status over the one on the error', () => {
    expect(classifySendResult({ statusCode: 201, error: Object.assign(new Error('x'), { statusCode: 500 }) })).toBe(
      'ok',
    );
  });

  it.each(['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'])('retries on network error %s', (code) => {
    expect(classifySendResult({ error: Object.assign(new Error(code), { code }) })).toBe('retry');
  });

  it('retries an error without a status, a non-error value and no input at all', () => {
    expect(classifySendResult({ error: new Error('socket hang up') })).toBe('retry');
    expect(classifySendResult({ error: 'weird' })).toBe('retry');
    expect(classifySendResult({})).toBe('retry');
  });

  it('retries an unexpected status instead of dropping the delivery', () => {
    expect(classifySendResult({ statusCode: 418 })).toBe('retry');
    expect(classifySendResult({ statusCode: 301 })).toBe('retry');
  });
});
