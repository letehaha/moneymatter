import { AI_FEATURE, AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { PNG_1X1_BASE64 } from '@tests/fixtures/statement-parser-fixtures';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import {
  createAiConnection,
  createFirstConnection,
  errorMessage,
  getTestUserId,
  readStoredConnections,
  setAiFeatureConfig,
} from '@tests/helpers/user-settings';
import { VALID_ANTHROPIC_API_KEY } from '@tests/mocks/anthropic/mock-api';
import { CUSTOM_ENDPOINT_MODEL, getCustomEndpointOfflineMock } from '@tests/mocks/openai-compatible/mock-api';

const CUSTOM_MODEL_ID = `custom/${CUSTOM_ENDPOINT_MODEL}`;

const CATALOG_MODEL = 'claude-haiku-4-5';

const TRADES_CSV = [
  'date,symbol,side,quantity,price',
  '2026-06-01,AAPL,buy,10,187.35',
  '2026-06-02,MSFT,buy,4,412.80',
  '2026-06-03,AAPL,sell,5,191.02',
].join('\n');

function tradesBase64(): string {
  return Buffer.from(TRADES_CSV, 'utf-8').toString('base64');
}

describe('Investment transactions parser cost estimation', () => {
  useSelfHostWithoutServerAiKeys();

  it('estimates against the custom model the feature is configured with', async () => {
    const connection = await createFirstConnection();
    await setAiFeatureConfig({
      feature: AI_FEATURE.investmentTransactionsParsing,
      connectionId: connection.id,
      raw: true,
    });

    const estimate = await helpers.investmentImportEstimateCost({
      payload: { fileBase64: tradesBase64() },
      raw: true,
    });

    expect(estimate.modelId).toBe(CUSTOM_MODEL_ID);
    expect(estimate.modelName).toBe(CUSTOM_ENDPOINT_MODEL);
    expect(estimate.usingUserKey).toBe(true);
    expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedOutputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedCostUsd).toBeNull();
  });

  it('rejects an image, which only the bank statement importer reads', async () => {
    await createFirstConnection();
    const response = await helpers.investmentImportEstimateCost({ payload: { fileBase64: PNG_1X1_BASE64 } });

    expect(response.statusCode).not.toBe(200);
    expect(errorMessage({ response })).toMatch(/unsupported file type/i);
  });

  it('prices a native connection running a catalog model from the catalog', async () => {
    await createAiConnection({
      provider: AI_PROVIDER.anthropic,
      name: 'Claude fast',
      model: CATALOG_MODEL,
      apiKey: VALID_ANTHROPIC_API_KEY,
      raw: true,
    });

    const estimate = await helpers.investmentImportEstimateCost({
      payload: { fileBase64: tradesBase64() },
      raw: true,
    });

    expect(estimate.modelId).toBe(`${AI_PROVIDER.anthropic}/${CATALOG_MODEL}`);
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
  });
});

const BROKER_EXPORT_BASE64 = Buffer.from('Broker export\nBTC 0.05 @ 42000 USD on 2024-01-15', 'utf-8').toString(
  'base64',
);

describe('Investment transactions AI extraction against a dead endpoint', () => {
  useSelfHostWithoutServerAiKeys();

  it('names the endpoint and flags it when the server is gone', async () => {
    const userId = await getTestUserId();
    await createFirstConnection();
    const portfolio = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: 'AI import' }),
      raw: true,
    });
    global.mswMockServer.use(getCustomEndpointOfflineMock());

    const response = await helpers.investmentImportExtract({
      payload: { fileBase64: BROKER_EXPORT_BASE64, defaultPortfolioId: portfolio.id },
    });

    expect(errorMessage({ response })).toMatch(/did not respond/i);
    expect(errorMessage({ response })).not.toContain(CUSTOM_ENDPOINT_MODEL);

    const [stored] = await readStoredConnections({ userId });
    expect(stored?.status).toBe('invalid');
    expect(stored?.lastError).toMatch(/did not respond/i);
  });
});
