import { AI_PROVIDER, PLANS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { createAiConnection, errorMessage } from '@tests/helpers/user-settings';
import { VALID_ANTHROPIC_API_KEY, createAnthropicMock } from '@tests/mocks/anthropic/mock-api';

const STATEMENT_FILE_BASE64 = Buffer.from(
  ['date;description;amount', '2026-06-01;Grocery store;-42.10'].join('\n'),
  'utf-8',
).toString('base64');

const AI_CSV_REPLY = ['Testbanken,4321,2026-06-01,2026-06-30,SEK', '2026-06-01,Card purchase,LIDL,42.10,E,,95'].join(
  '\n',
);

// The mock answers with 100 input and 50 output tokens: $0.00035 a call at the mocked $1/$5 per million.

function enablePrimaryServerModel() {
  process.env.ANTHROPIC_API_KEY = VALID_ANTHROPIC_API_KEY;
  global.mswMockServer.use(createAnthropicMock({ rawText: AI_CSV_REPLY }));
}

const extract = () => helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

const getAllowance = async () => (await helpers.getAiFeaturesStatus({ raw: true })).aiAllowance;

describe('AI allowance', () => {
  useSelfHostWithoutServerAiKeys();

  describe('GET /user/settings/ai/features', () => {
    it('reports no allowance when no cap is set', async () => {
      expect(await getAllowance()).toBeNull();
    });

    it('reports an untouched trial allowance that resets at the start of next UTC month', async () => {
      process.env.AI_MONTHLY_CAP_USD_TRIAL = '1';
      const now = new Date();

      expect(await getAllowance()).toEqual({
        usedPercent: 0,
        state: 'ok',
        plan: 'trial',
        resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
      });
    });

    it('reads the Plus cap for a paid Plus user', async () => {
      await helpers.setUserBilling({ plan: PLANS.plus });
      process.env.AI_MONTHLY_CAP_USD_TRIAL = '1';

      expect(await getAllowance()).toBeNull();

      process.env.AI_MONTHLY_CAP_USD_PLUS = '5';

      expect(await getAllowance()).toMatchObject({ usedPercent: 0, state: 'ok', plan: 'plus' });
    });
  });

  describe('spend on the server model', () => {
    it('counts an extraction served by the server model', async () => {
      process.env.AI_MONTHLY_CAP_USD_TRIAL = '0.0007';
      enablePrimaryServerModel();

      const response = await extract();

      expect(response.statusCode).toBe(200);
      expect(await getAllowance()).toMatchObject({ usedPercent: 50, state: 'ok' });
    });

    it('takes the server model away once the cap is reached', async () => {
      process.env.AI_MONTHLY_CAP_USD_TRIAL = '0.000175';
      enablePrimaryServerModel();

      expect((await extract()).statusCode).toBe(200);

      const { features, aiAllowance } = await helpers.getAiFeaturesStatus({ raw: true });

      expect(aiAllowance).toMatchObject({ usedPercent: 100, state: 'reached' });
      for (const status of features) {
        expect(status).toMatchObject({ servedBy: null, serverModelName: null });
      }

      expect(errorMessage({ response: await extract() })).toMatch(/used the AI included in your plan/i);
    });

    it("still serves the user's own connection over the cap, without counting its calls", async () => {
      process.env.AI_MONTHLY_CAP_USD_TRIAL = '0';
      enablePrimaryServerModel();
      await createAiConnection({
        provider: AI_PROVIDER.anthropic,
        name: 'Own Claude',
        model: 'claude-haiku-4-5',
        apiKey: VALID_ANTHROPIC_API_KEY,
        raw: true,
      });

      expect(await getAllowance()).toMatchObject({ state: 'reached' });

      const result = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 }, raw: true });

      expect(result.transactions).toHaveLength(1);

      process.env.AI_MONTHLY_CAP_USD_TRIAL = '0.00035';

      expect(await getAllowance()).toMatchObject({ usedPercent: 0, state: 'ok' });
    });
  });
});
