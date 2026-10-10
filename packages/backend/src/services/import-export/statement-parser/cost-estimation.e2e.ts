import type { StatementFileType, StatementTextExtractionFailure } from '@bt/shared/types';
import { AI_FEATURE, AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import {
  ENCRYPTED_STATEMENT_PASSWORD,
  STATEMENT_PDF_FIXTURES,
  readStatementPdfFixture,
} from '@tests/fixtures/statement-parser-fixtures';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { createAiConnection, createFirstConnection, setAiFeatureConfig } from '@tests/helpers/user-settings';
import { VALID_GEMINI_API_KEY, createGeminiMock } from '@tests/mocks/gemini/mock-api';
import { modelsDevUnavailableMock } from '@tests/mocks/models-dev/mock-api';
import { CUSTOM_ENDPOINT_MODEL } from '@tests/mocks/openai-compatible/mock-api';

// The estimate makes no AI call, so every case here is decided by the model resolution ladder.

const CUSTOM_MODEL_ID = `custom/${CUSTOM_ENDPOINT_MODEL}`;

const CATALOG_MODEL = 'gemini-3.8-flash';

/** Catalog model priced at 0/0, a known free price that must never read as unknown. */
const FREE_CATALOG_MODEL = 'gemma-4-31b-it';

/** The save-time probe dials the model, so the Gemini mock has to accept it. */
async function createGeminiConnection({ model }: { model: string }) {
  global.mswMockServer.use(createGeminiMock({ expectedModel: model }));

  return createAiConnection({
    provider: AI_PROVIDER.google,
    name: model,
    model,
    apiKey: VALID_GEMINI_API_KEY,
    raw: true,
  });
}

const STATEMENT_CSV = [
  'date;description;amount',
  '2026-06-01;Grocery store;-42.10',
  '2026-06-02;Salary;2500.00',
  '2026-06-03;Coffee;-4.50',
].join('\n');

function statementBase64(): string {
  return Buffer.from(STATEMENT_CSV, 'utf-8').toString('base64');
}

function pdfFixtureBase64({ file }: { file: string }): string {
  return readStatementPdfFixture({ file }).toString('base64');
}

/** Shape the endpoint answers 200 with when no text could be read from the file. */
interface EstimateFailureResponse {
  success: false;
  textExtraction: StatementTextExtractionFailure;
  fileType: StatementFileType;
  suggestion: string;
}

async function estimateFailure({ file, password }: { file: string; password?: string }) {
  const response = await helpers.statementEstimateCost({
    payload: { fileBase64: pdfFixtureBase64({ file }), password },
  });

  expect(response.statusCode).toBe(200);

  return response.body.response as unknown as EstimateFailureResponse;
}

describe('Statement parser cost estimation', () => {
  useSelfHostWithoutServerAiKeys();

  it('estimates against the custom model the feature is configured with', async () => {
    const connection = await createFirstConnection();
    await setAiFeatureConfig({
      feature: AI_FEATURE.statementParsing,
      connectionId: connection.id,
      raw: true,
    });

    const estimate = await helpers.statementEstimateCost({ payload: { fileBase64: statementBase64() }, raw: true });

    expect(estimate.modelId).toBe(CUSTOM_MODEL_ID);
    expect(estimate.modelName).toBe(CUSTOM_ENDPOINT_MODEL);
    expect(estimate.usingUserKey).toBe(true);
    expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedOutputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedCostUsd).toBeNull();
  });

  it('estimates against the default connection when the feature has no config', async () => {
    await createFirstConnection();

    const estimate = await helpers.statementEstimateCost({ payload: { fileBase64: statementBase64() }, raw: true });

    expect(estimate.modelId).toBe(CUSTOM_MODEL_ID);
    expect(estimate.modelName).toBe(CUSTOM_ENDPOINT_MODEL);
    expect(estimate.estimatedCostUsd).toBeNull();
  });

  it('prices a native connection running a catalog model from the catalog', async () => {
    await createGeminiConnection({ model: CATALOG_MODEL });

    const estimate = await helpers.statementEstimateCost({ payload: { fileBase64: statementBase64() }, raw: true });

    expect(estimate.modelId).toBe(`${AI_PROVIDER.google}/${CATALOG_MODEL}`);
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('still estimates, with the price unknown, when the model catalog is unreachable', async () => {
    await createGeminiConnection({ model: CATALOG_MODEL });
    global.mswMockServer.use(modelsDevUnavailableMock());

    const estimate = await helpers.statementEstimateCost({ payload: { fileBase64: statementBase64() }, raw: true });

    expect(estimate.modelId).toBe(`${AI_PROVIDER.google}/${CATALOG_MODEL}`);
    expect(estimate.modelName).toBe(CATALOG_MODEL);
    expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedCostUsd).toBeNull();
  });

  it('prices a free catalog model at $0, not at "unknown"', async () => {
    await createGeminiConnection({ model: CATALOG_MODEL });
    const freeConnection = await createGeminiConnection({ model: FREE_CATALOG_MODEL });
    await setAiFeatureConfig({ feature: AI_FEATURE.statementParsing, connectionId: freeConnection.id, raw: true });

    const estimate = await helpers.statementEstimateCost({ payload: { fileBase64: statementBase64() }, raw: true });

    expect(estimate.modelId).toBe(`${AI_PROVIDER.google}/${FREE_CATALOG_MODEL}`);
    expect(estimate.estimatedCostUsd).toBe(0);
    expect(estimate.estimatedCostUsd).not.toBeNull();
  });

  // An encrypted PDF and a scanned one both yield zero text, and the fix for one
  // (type the password) is useless for the other, so the codes must stay distinct.
  describe('PDFs no text can be read from', () => {
    it('separates a missing password, a rejected password and a missing text layer', async () => {
      const missingPassword = await estimateFailure({ file: STATEMENT_PDF_FIXTURES.encrypted });

      expect(missingPassword.success).toBe(false);
      expect(missingPassword.textExtraction.success).toBe(false);
      expect(missingPassword.textExtraction.errorCode).toBe('PASSWORD_REQUIRED');
      expect(missingPassword.fileType).toBe('pdf');

      const rejectedPassword = await estimateFailure({
        file: STATEMENT_PDF_FIXTURES.encrypted,
        password: 'not-the-password',
      });

      expect(rejectedPassword.success).toBe(false);
      expect(rejectedPassword.textExtraction.errorCode).toBe('PASSWORD_INVALID');

      const noTextLayer = await estimateFailure({ file: STATEMENT_PDF_FIXTURES.noTextLayer });

      expect(noTextLayer.success).toBe(false);
      expect(noTextLayer.textExtraction.errorCode).toBe('NO_TEXT_CONTENT');
    });

    it('estimates normally once the correct password is supplied', async () => {
      await createGeminiConnection({ model: CATALOG_MODEL });

      const estimate = await helpers.statementEstimateCost({
        payload: {
          fileBase64: pdfFixtureBase64({ file: STATEMENT_PDF_FIXTURES.encrypted }),
          password: ENCRYPTED_STATEMENT_PASSWORD,
        },
        raw: true,
      });

      expect(estimate.textExtraction.success).toBe(true);
      expect(estimate.textExtraction.characterCount).toBeGreaterThan(0);
      expect(estimate.modelId).toBe(`${AI_PROVIDER.google}/${CATALOG_MODEL}`);
      expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    });
  });

  // PDF readers accept the `%PDF` header anywhere in the first 1024 bytes, and
  // bank exports do ship with a BOM or blank lines in front of it.
  it('reads a PDF whose header is preceded by junk bytes the same as the clean file', async () => {
    await createGeminiConnection({ model: CATALOG_MODEL });

    const clean = readStatementPdfFixture({ file: STATEMENT_PDF_FIXTURES.encrypted });
    const prefixed = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('\r\n\r\n'), clean]);

    const [cleanEstimate, prefixedEstimate] = await Promise.all(
      [clean, prefixed].map((buffer) =>
        helpers.statementEstimateCost({
          payload: { fileBase64: buffer.toString('base64'), password: ENCRYPTED_STATEMENT_PASSWORD },
          raw: true,
        }),
      ),
    );

    expect(cleanEstimate!.textExtraction.success).toBe(true);
    expect(prefixedEstimate!.textExtraction).toEqual(cleanEstimate!.textExtraction);
  });
});
