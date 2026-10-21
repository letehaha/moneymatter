import { AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { parseModelsDevCatalog, toCatalogKey } from './model-catalog';

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
              tool_call: true,
            },
            'gemma-4-31b-it': {
              name: 'Gemma 4 31B',
              cost: null,
              limit: { context: 262_144 },
              modalities: { input: ['text', 'image'] },
              structured_output: 'yes',
              tool_call: 'yes',
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
        capabilities: {
          inputs: ['text', 'image', 'pdf'],
          maxOutputTokens: 65_536,
          structuredOutput: true,
          toolCalling: true,
        },
      },
      'google/gemma-4-31b-it': {
        name: 'Gemma 4 31B',
        contextWindow: 262_144,
        pricing: null,
        capabilities: { inputs: ['text', 'image'], maxOutputTokens: null, structuredOutput: null, toolCalling: null },
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

  it('has no price for any other custom endpoint', () => {
    expect(
      toCatalogKey({ provider: AI_PROVIDER.custom, model: 'llama3.2', baseUrl: 'http://localhost:11434/v1' }),
    ).toBeNull();
  });
});
