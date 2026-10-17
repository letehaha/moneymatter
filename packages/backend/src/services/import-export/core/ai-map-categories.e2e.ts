import { AI_FEATURE, API_ERROR_CODES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Users from '@models/users.model';
import { FALLBACK_SERVER_MODELS } from '@services/ai/resolution-ladder';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import type { ErrorResponse } from '@tests/helpers/common';
import { clearMockSession, registerMockSession } from '@tests/mocks/better-auth';
import {
  GEMINI_API_URL,
  VALID_GEMINI_API_KEY,
  createGeminiMock,
  rejectIfWrongModel,
} from '@tests/mocks/gemini/mock-api';
import { HttpResponse, http } from 'msw';

const EXPECTED_MODEL = FALLBACK_SERVER_MODELS[AI_FEATURE.categorization].model;

/** Collects every `text` field of the Gemini request body (system + user parts). */
function extractPromptText(body: unknown): string {
  const texts: string[] = [];
  JSON.stringify(body, (key, value) => {
    if (key === 'text' && typeof value === 'string') texts.push(value);
    return value;
  });
  return texts.join('\n');
}

/** Gemini mock that builds its answer from the prompt it actually received. */
function createMappingGeminiMock({ respond }: { respond: (prompt: string) => string }) {
  return http.post(GEMINI_API_URL, async ({ request }) => {
    const modelMismatch = rejectIfWrongModel({ request, expectedModel: EXPECTED_MODEL });
    if (modelMismatch) return modelMismatch;
    const prompt = extractPromptText(await request.json());
    return HttpResponse.json({
      candidates: [{ content: { parts: [{ text: respond(prompt) }], role: 'model' }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
    });
  });
}

describe('POST /import/ai-map-categories', () => {
  describe('with a working AI provider', () => {
    let originalGeminiApiKey: string | undefined;

    beforeEach(() => {
      originalGeminiApiKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
    });

    afterEach(() => {
      if (originalGeminiApiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = originalGeminiApiKey;
      }
    });

    it('maps sources to the categories the AI picked and returns null for "none"', async () => {
      const categories = await helpers.getCategoriesList();
      const target = categories.find((category) => category.name === 'Food & Drinks') ?? categories[0]!;

      global.mswMockServer.use(
        createMappingGeminiMock({
          respond: (prompt) => {
            // The prompt aliases category ids; recover the alias of our target by name.
            const aliasMatch = new RegExp(`^(c\\d+)\\|[^|]*\\|${target.name}$`, 'm').exec(prompt);
            return `s1:${aliasMatch?.[1] ?? 'none'}\ns2:none`;
          },
        }),
      );

      const { mappings } = await helpers.aiMapImportCategories({
        payload: { sourceCategories: ['Продукти', 'Totally Unmatchable Source'] },
        raw: true,
      });

      expect(mappings['Продукти']).toBe(target.id);
      expect(mappings['Totally Unmatchable Source']).toBeNull();
    });

    it('serves cached verdicts for a repeated identical request without a second AI call', async () => {
      const categories = await helpers.getCategoriesList();
      const target = categories.find((category) => category.name === 'Food & Drinks') ?? categories[0]!;

      global.mswMockServer.use(
        createMappingGeminiMock({
          respond: (prompt) => {
            const aliasMatch = new RegExp(`^(c\\d+)\\|[^|]*\\|${target.name}$`, 'm').exec(prompt);
            return `s1:${aliasMatch?.[1] ?? 'none'}`;
          },
        }),
      );

      const first = await helpers.aiMapImportCategories({ payload: { sourceCategories: ['Продукти'] }, raw: true });
      expect(first.mappings['Продукти']).toBe(target.id);

      // Any live call would now answer garbage; only the cache can reproduce the match.
      global.mswMockServer.use(createMappingGeminiMock({ respond: () => 'nonsense' }));

      const second = await helpers.aiMapImportCategories({ payload: { sourceCategories: ['Продукти'] }, raw: true });
      expect(second.mappings['Продукти']).toBe(target.id);

      // A different source list is a different cache key and must consult the AI
      // again — proven by the live call failing on the garbage mock.
      const third = await helpers.aiMapImportCategories({
        payload: { sourceCategories: ['Продукти', 'Taxi'] },
      });
      expect(third.statusCode).toBe(422);
    });

    it('rejects when the AI answer contains no parseable verdict lines', async () => {
      global.mswMockServer.use(createMappingGeminiMock({ respond: () => 'I cannot help with that.' }));

      const response = await helpers.aiMapImportCategories({
        payload: { sourceCategories: ['Bakery', 'Taxi'] },
      });

      expect(response.statusCode).toBe(422);
    });

    it('maps a hallucinated category alias to null instead of trusting it', async () => {
      global.mswMockServer.use(createMappingGeminiMock({ respond: () => 's1:c9999\ns2:none' }));

      const { mappings } = await helpers.aiMapImportCategories({
        payload: { sourceCategories: ['Bakery', 'Taxi'] },
        raw: true,
      });

      expect(mappings).toEqual({ Bakery: null, Taxi: null });
    });

    it('rejects a truncated AI response instead of returning partial verdicts', async () => {
      global.mswMockServer.use(createGeminiMock({ rawText: 's1:c1', finishReason: 'MAX_TOKENS' }));

      const response = await helpers.aiMapImportCategories({
        payload: { sourceCategories: ['Bakery'] },
      });

      expect(response.statusCode).toBe(422);
    });

    it('rejects an empty source list', async () => {
      const response = await helpers.aiMapImportCategories({
        payload: { sourceCategories: [] },
      });

      expect(response.statusCode).toBe(422);
    });
  });

  describe('without any AI configured', () => {
    useSelfHostWithoutServerAiKeys();

    it('answers with a configuration error', async () => {
      const response = await helpers.aiMapImportCategories({
        payload: { sourceCategories: ['Groceries'] },
      });

      expect(response.statusCode).toBe(422);
    });
  });
});

describe('POST /import/ai-map-categories in demo mode', () => {
  it('refuses a demo session before any AI call', async () => {
    const demo = await helpers.makeAuthRequest({ method: 'post', url: '/demo' });
    expect(demo.statusCode).toBe(200);

    const cookies = helpers.extractCookies(demo);
    const sessionToken = cookies.match(/bt_auth\.session_token=([^;]+)/)?.[1];
    const demoUser = await Users.findByPk(demo.body.response.user.id);
    registerMockSession(sessionToken!, { id: demoUser!.authUserId, email: `demo-${demoUser!.id}@demo.local` });

    try {
      const res = await helpers.asUser({
        cookies,
        fn: () => helpers.aiMapImportCategories({ payload: { sourceCategories: ['Groceries'] } }),
      });

      expect(res.statusCode).toBe(403);
      expect((res.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.forbidden);
    } finally {
      clearMockSession(sessionToken!);
    }
  }, 120_000);
});
