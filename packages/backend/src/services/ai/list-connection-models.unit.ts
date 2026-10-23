import { AI_PROVIDER, CLI_AI_MODELS } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { listConnectionModels, readGeminiModelIds } from './list-connection-models';

jest.mock('@js/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('readGeminiModelIds', () => {
  it('keeps only models that can generate content, without the models/ prefix', () => {
    const body = {
      models: [
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/no-methods' },
        { supportedGenerationMethods: ['generateContent'] },
      ],
    };

    expect(readGeminiModelIds({ body })).toEqual(['gemini-3.8-flash']);
  });

  it.each([null, 'text', { models: 'nope' }, {}])('returns nothing for %p', (body) => {
    expect(readGeminiModelIds({ body })).toEqual([]);
  });
});

describe('listConnectionModels', () => {
  let fetchBeforeTest: typeof globalThis.fetch;
  let requests: { url: string; headers: Headers }[];

  beforeEach(() => {
    fetchBeforeTest = globalThis.fetch;
    requests = [];
  });

  afterEach(() => {
    globalThis.fetch = fetchBeforeTest;
  });

  function stubFetch({ body }: { body: unknown }): void {
    globalThis.fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
  }

  it('lists OpenAI ids sorted and deduped, with a bearer key', async () => {
    stubFetch({ body: { data: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-5.4-nano' }, { id: 'gpt-5.4-nano' }] } });

    expect(await listConnectionModels({ provider: AI_PROVIDER.openai, apiKey: 'sk-test' })).toEqual([
      'gpt-5.4-nano',
      'gpt-5.6-terra',
    ]);
    expect(requests[0]!.url).toBe('https://api.openai.com/v1/models');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer sk-test');
  });

  it('asks Anthropic with its own key and version headers', async () => {
    stubFetch({ body: { data: [{ id: 'claude-sonnet-5' }] } });

    expect(await listConnectionModels({ provider: AI_PROVIDER.anthropic, apiKey: 'sk-ant' })).toEqual([
      'claude-sonnet-5',
    ]);
    expect(requests[0]!.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(requests[0]!.headers.get('x-api-key')).toBe('sk-ant');
    expect(requests[0]!.headers.get('anthropic-version')).toBe('2023-06-01');
  });

  it.each([AI_PROVIDER.claudeCode, AI_PROVIDER.codex] as const)(
    'lists the curated %s models in curated order without a network call',
    async (provider) => {
      stubFetch({ body: { data: [{ id: 'never-requested' }] } });

      const models = await listConnectionModels({ provider, apiKey: null });

      expect(models).toEqual(CLI_AI_MODELS[provider].map((model) => model.id));
      expect(models[0]).toBe(CLI_AI_MODELS[provider].find((model) => model.isDefault)!.id);
      expect(requests).toEqual([]);
    },
  );

  it('lists one id per Claude Code model, as CLI aliases', async () => {
    expect(await listConnectionModels({ provider: AI_PROVIDER.claudeCode, apiKey: null })).toEqual([
      'sonnet',
      'opus',
      'haiku',
      'fable',
    ]);
  });

  it.each([AI_PROVIDER.claudeCode, AI_PROVIDER.codex] as const)('lists no %s model twice', async (provider) => {
    const models = await listConnectionModels({ provider, apiKey: null });

    expect(new Set(models).size).toBe(models.length);
  });

  it('asks Gemini with the x-goog-api-key header', async () => {
    stubFetch({
      body: { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] },
    });

    expect(await listConnectionModels({ provider: AI_PROVIDER.google, apiKey: 'gm-key' })).toEqual([
      'gemini-3.8-flash',
    ]);
    expect(requests[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
    expect(requests[0]!.headers.get('x-goog-api-key')).toBe('gm-key');
  });
});
