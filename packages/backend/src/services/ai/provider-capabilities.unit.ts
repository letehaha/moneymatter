import { AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { providerTakesPdfFileParts } from './provider-capabilities';

describe('providerTakesPdfFileParts', () => {
  it.each<[AI_PROVIDER, boolean]>([
    [AI_PROVIDER.openai, true],
    [AI_PROVIDER.anthropic, true],
    [AI_PROVIDER.google, true],
    [AI_PROVIDER.custom, false],
    [AI_PROVIDER.claudeCode, false],
    [AI_PROVIDER.codex, false],
  ])('%s -> %s', (provider, expected) => {
    expect(providerTakesPdfFileParts({ provider })).toBe(expected);
  });
});
