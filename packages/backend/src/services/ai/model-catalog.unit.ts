import { AI_PROVIDER } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { getModelProfile, parseModelsDevCatalog, toCatalogKey } from './model-catalog';

const mockHget = jest.fn<(key: string, field: string) => Promise<string | null>>();

jest.mock('@root/redis-client', () => ({
  redisClient: { hget: (key: string, field: string) => mockHget(key, field), exists: jest.fn() },
}));

describe('parseModelsDevCatalog', () => {
  it('keeps the providers connections use and reads price, limits, capabilities and name', () => {
    const catalog = parseModelsDevCatalog({
      raw: {
        google: {
          models: {
            'gemini-3.8-flash': {
              name: 'Gemini 3.8 Flash',
              cost: { input: 0.75, output: 3.75 },
              limit: { context: 1_048_576, output: 65_536 },
              modalities: { input: ['text', 'image', 'pdf'] },
              structured_output: true,
            },
            'gemma-4-31b-it': {
              name: 'Gemma 4 31B',
              cost: null,
              limit: { context: 262_144 },
              modalities: { input: ['text', 'image'] },
              structured_output: 'yes',
            },
            broken: 'not an object',
          },
        },
        openrouter: { models: { 'google/gemma-4-31b-it': { cost: { input: 0, output: 0 } } } },
        deepseek: { models: { 'deepseek-chat': { cost: { input: 1, output: 2 } } } },
        anthropic: 'malformed provider',
      },
    });

    expect(catalog).toEqual({
      'google/gemini-3.8-flash': {
        name: 'Gemini 3.8 Flash',
        contextWindow: 1_048_576,
        pricing: { inputPerMillion: 0.75, outputPerMillion: 3.75 },
        capabilities: { inputs: ['text', 'image', 'pdf'], maxOutputTokens: 65_536, structuredOutput: true },
      },
      'google/gemma-4-31b-it': {
        name: 'Gemma 4 31B',
        contextWindow: 262_144,
        pricing: null,
        capabilities: { inputs: ['text', 'image'], maxOutputTokens: null, structuredOutput: null },
      },
      'openrouter/google/gemma-4-31b-it': {
        name: 'google/gemma-4-31b-it',
        contextWindow: null,
        pricing: { inputPerMillion: 0, outputPerMillion: 0 },
        capabilities: null,
      },
    });
  });

  it('returns an empty catalog for a body that is not an object', () => {
    expect(parseModelsDevCatalog({ raw: null })).toEqual({});
  });
});

describe('toCatalogKey', () => {
  it('prices a native connection under its own provider', () => {
    expect(toCatalogKey({ provider: AI_PROVIDER.anthropic, model: 'claude-sonnet-5' })).toBe(
      'anthropic/claude-sonnet-5',
    );
  });

  it('prices a custom connection to OpenRouter under OpenRouter', () => {
    expect(
      toCatalogKey({
        provider: AI_PROVIDER.custom,
        model: 'openai/gpt-5.6-terra',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
    ).toBe('openrouter/openai/gpt-5.6-terra');
  });

  it.each([
    ['sonnet', 'anthropic/claude-sonnet-5-5'],
    ['fable', 'anthropic/claude-fable-5-1'],
    ['opus', 'anthropic/claude-opus-5-5'],
    ['claude-opus-5-5', 'anthropic/claude-opus-5-5'],
    ['a-model-typed-by-hand', 'anthropic/a-model-typed-by-hand'],
  ])('looks the Claude Code model %s up under Anthropic as %s', (model, key) => {
    expect(toCatalogKey({ provider: AI_PROVIDER.claudeCode, model })).toBe(key);
  });

  it.each([
    ['gpt-6-astra', 'openai/gpt-6-astra'],
    ['gpt-5.3-codex', 'openai/gpt-5.3-codex'],
    ['a-model-typed-by-hand', 'openai/a-model-typed-by-hand'],
  ])('looks the Codex model %s up under OpenAI as %s', (model, key) => {
    expect(toCatalogKey({ provider: AI_PROVIDER.codex, model })).toBe(key);
  });

  it('has no price for any other custom endpoint', () => {
    expect(
      toCatalogKey({ provider: AI_PROVIDER.custom, model: 'llama3.2', baseUrl: 'http://localhost:11434/v1' }),
    ).toBeNull();
  });
});

describe('getModelProfile', () => {
  const CACHED_PROFILE = {
    name: 'Claude Sonnet 5.5',
    contextWindow: 1_000_000,
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    capabilities: { inputs: ['text', 'image', 'pdf'], maxOutputTokens: 64_000, structuredOutput: true },
  };

  beforeEach(() => {
    mockHget.mockReset();
    mockHget.mockResolvedValue(JSON.stringify(CACHED_PROFILE));
  });

  it('keeps the catalog price of a native connection', async () => {
    expect(await getModelProfile({ provider: AI_PROVIDER.anthropic, model: 'claude-sonnet-5-5' })).toEqual(
      CACHED_PROFILE,
    );
  });

  it('forces a subscription model to no price while keeping its capabilities', async () => {
    const profile = await getModelProfile({ provider: AI_PROVIDER.claudeCode, model: 'sonnet' });

    expect(mockHget).toHaveBeenCalledWith(expect.any(String), 'anthropic/claude-sonnet-5-5');
    expect(profile).toEqual({ ...CACHED_PROFILE, pricing: null });
  });
});
