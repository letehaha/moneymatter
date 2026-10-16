import { AI_PROVIDER } from '@bt/shared/types';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { aiCallGuards } from './ai-call-guards';

const MINUTE_MS = 60 * 1000;

describe('aiCallGuards', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([AI_PROVIDER.claudeCode, AI_PROVIDER.codex])(
    'gives %s a 30-minute queue-plus-run ceiling and no SDK retries',
    (provider) => {
      const timeout = jest.spyOn(AbortSignal, 'timeout');

      const { abortSignal, maxRetries } = aiCallGuards({ provider });

      expect(maxRetries).toBe(0);
      expect(timeout).toHaveBeenCalledWith(30 * MINUTE_MS);
      expect(abortSignal.aborted).toBe(false);
    },
  );

  it('keeps the SDK retries for native providers and none for custom endpoints', () => {
    expect(aiCallGuards({ provider: AI_PROVIDER.anthropic }).maxRetries).toBe(2);
    expect(aiCallGuards({ provider: AI_PROVIDER.custom }).maxRetries).toBe(0);
  });

  it('keeps the existing ceilings for custom and native providers', () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');

    aiCallGuards({ provider: AI_PROVIDER.custom });
    aiCallGuards({ provider: AI_PROVIDER.openai });

    expect(timeout).toHaveBeenNthCalledWith(1, 5 * MINUTE_MS);
    expect(timeout).toHaveBeenNthCalledWith(2, 10 * MINUTE_MS);
  });
});
