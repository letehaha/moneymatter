import { AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { formatConnectionModelName } from './connection-model-options';

describe('formatConnectionModelName', () => {
  it('names a model the provider serves as the provider names it', () => {
    expect(formatConnectionModelName({ provider: AI_PROVIDER.openai, model: 'gpt-4.1' })).toBe('gpt-4.1');
  });

  it('names a subscription model by its curated label', () => {
    const label = formatConnectionModelName({ provider: AI_PROVIDER.claudeCode, model: 'haiku' });

    expect(label).not.toBe('');
    expect(label).toContain('haiku');
  });
});
