import { describe, expect, it } from '@jest/globals';
import {
  ENCRYPTED_STATEMENT_PASSWORD,
  PNG_1X1_BASE64,
  STATEMENT_PDF_FIXTURES,
  readStatementPdfFixture,
} from '@tests/fixtures/statement-parser-fixtures';
import * as helpers from '@tests/helpers';
import { enableServerModel, useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { makeRequest } from '@tests/helpers/common';
import {
  createFirstConnection,
  createOpenAiConnection,
  errorMessage,
  getTestUserId,
  readStoredConnections,
} from '@tests/helpers/user-settings';
import { VALID_GEMINI_API_KEY, createGeminiMock } from '@tests/mocks/gemini/mock-api';
import { createCallsCounter } from '@tests/mocks/helpers';
import {
  CUSTOM_ENDPOINT_MODEL,
  getCustomEndpointAuthErrorMock,
  getCustomEndpointCallCountingMock,
  getCustomEndpointContentMock,
  getCustomEndpointModelNotFoundMock,
  getCustomEndpointOfflineMock,
  getCustomEndpointVllmMock,
  getCustomEndpointWebPageMocks,
} from '@tests/mocks/openai-compatible/mock-api';
import { createOpenAiAuthErrorMock } from '@tests/mocks/openai/mock-api';

const STATEMENT_CSV = ['date;description;amount', '2026-06-01;Grocery store;-42.10', '2026-06-02;Salary;2500.00'].join(
  '\n',
);

const STATEMENT_FILE_BASE64 = Buffer.from(STATEMENT_CSV, 'utf-8').toString('base64');

describe('Statement parser AI extraction against a dead endpoint', () => {
  useSelfHostWithoutServerAiKeys();

  it('names the endpoint and flags it when the server is gone', async () => {
    const userId = await getTestUserId();
    await createFirstConnection();
    global.mswMockServer.use(getCustomEndpointOfflineMock());

    const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

    expect(errorMessage({ response })).toMatch(/did not respond/i);
    expect(errorMessage({ response })).not.toContain(CUSTOM_ENDPOINT_MODEL);

    const [stored] = await readStoredConnections({ userId });
    expect(stored?.status).toBe('invalid');
    expect(stored?.lastError).toMatch(/did not respond/i);
  });

  it('flags the endpoint when a web page answers instead of the API', async () => {
    const userId = await getTestUserId();
    await createFirstConnection();
    global.mswMockServer.use(...getCustomEndpointWebPageMocks());

    const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

    expect(errorMessage({ response })).toMatch(/did not respond/i);

    const [stored] = await readStoredConnections({ userId });
    expect(stored?.status).toBe('invalid');
  });

  it('names the rejection and flags the endpoint when it answers 401', async () => {
    const userId = await getTestUserId();
    await createFirstConnection();
    global.mswMockServer.use(getCustomEndpointAuthErrorMock());

    const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

    expect(errorMessage({ response })).toMatch(/rejected the request/i);
    expect(errorMessage({ response })).toContain('AI settings');

    const [stored] = await readStoredConnections({ userId });
    expect(stored?.status).toBe('invalid');
    expect(stored?.lastError).toMatch(/rejected the request/i);
  });

  // Falling back to the server model would send the statement to a provider the user never picked.
  it('names the key and flags a native connection whose key is rejected, without the server model', async () => {
    const userId = await getTestUserId();
    process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
    await createOpenAiConnection();
    global.mswMockServer.use(createOpenAiAuthErrorMock(), createGeminiMock());
    const geminiCalls = createCallsCounter(global.mswMockServer, /generativelanguage\.googleapis\.com/);

    const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

    expect(errorMessage({ response })).toMatch(/API key is not working/);

    const [stored] = await readStoredConnections({ userId });
    expect(stored?.status).toBe('invalid');
    expect(stored?.lastError).not.toMatch(/endpoint/i);
    expect(geminiCalls.count).toBe(0);
  });

  it('names the model and flags the connection when the model is not served', async () => {
    const userId = await getTestUserId();
    await createFirstConnection();
    global.mswMockServer.use(getCustomEndpointModelNotFoundMock());

    const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

    expect(errorMessage({ response })).toContain(CUSTOM_ENDPOINT_MODEL);
    expect(errorMessage({ response })).toContain('AI settings');

    const [stored] = await readStoredConnections({ userId });
    expect(stored?.status).toBe('invalid');
    expect(stored?.lastError).toContain(CUSTOM_ENDPOINT_MODEL);
  });

  // Once flagged, the endpoint is the only thing that may answer: falling through to the
  // server key would send the statement to a provider the user never picked.
  it('refuses to extract at all once every endpoint is flagged, even with a server key', async () => {
    const userId = await getTestUserId();
    await createFirstConnection();
    global.mswMockServer.use(getCustomEndpointOfflineMock());
    await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

    const [stored] = await readStoredConnections({ userId });
    expect(stored?.status).toBe('invalid');

    // The endpoint would answer now and a server key exists, so the counter below proves
    // neither of them was dialled.
    let endpointCalls = 0;
    global.mswMockServer.use(
      getCustomEndpointCallCountingMock({
        onCall: () => {
          endpointCalls += 1;
        },
      }),
    );
    enableServerModel();

    const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

    expect(errorMessage({ response })).toMatch(/did not respond/i);
    expect(endpointCalls).toBe(0);
  });

  it('tells a user with no AI models to add one', async () => {
    const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

    expect(response.statusCode).toBe(422);
    expect(errorMessage({ response })).toMatch(/no ai model configured/i);
  });
});

/** First line is the metadata row, the rest are transactions, per the extraction prompt. */
const AI_CSV_REPLY = [
  'Testbanken,4321,2026-06-01,2026-06-30,SEK',
  '2026-06-01,Card purchase,LIDL STOCKHOLM,42.10,E,1000.00,95',
  '2026-06-02,Hotel booking,HOTEL BERLIN,1150.00,E,,90,99.90,eur,Ref 8F2K91',
].join('\n');

describe('Statement parser extraction of an image', () => {
  useSelfHostWithoutServerAiKeys();

  it('sends the image itself to the model and reads the transactions it answers with', async () => {
    await createFirstConnection();
    let requestBody = '';
    global.mswMockServer.use(
      getCustomEndpointVllmMock({
        content: AI_CSV_REPLY,
        onBody: (body) => {
          requestBody = body;
        },
      }),
    );

    const result = await helpers.statementExtract({ payload: { fileBase64: PNG_1X1_BASE64 }, raw: true });

    expect(requestBody).toContain('"type":"image_url"');
    expect(requestBody).toContain(`data:image/png;base64,${PNG_1X1_BASE64}`);
    expect(result.fileType).toBe('image');
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ amount: 42.1, type: 'expense', merchant: 'LIDL STOCKHOLM' });
    expect(result.transactions[0]?.originalAmount).toBeUndefined();
    expect(result.transactions[1]).toMatchObject({
      amount: 1150,
      originalAmount: 99.9,
      originalCurrencyCode: 'EUR',
      externalReference: 'Ref 8F2K91',
    });
  });

  it("dates the prompt with today in the user's timezone", async () => {
    await createFirstConnection();
    let requestBody = '';
    global.mswMockServer.use(
      getCustomEndpointVllmMock({
        content: AI_CSV_REPLY,
        onBody: (body) => {
          requestBody = body;
        },
      }),
    );

    await helpers.statementExtract({
      payload: { fileBase64: PNG_1X1_BASE64, timezone: 'Pacific/Kiritimati' },
      raw: true,
    });

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
    expect(requestBody).toContain(`Today is ${today}.`);
  });
});

function encryptedPdfBase64(): string {
  return readStatementPdfFixture({ file: STATEMENT_PDF_FIXTURES.encrypted }).toString('base64');
}

describe('Statement parser extraction of an encrypted PDF', () => {
  useSelfHostWithoutServerAiKeys();

  // Retyping the password fixes this, so it must not answer as a server fault.
  it('answers 422 and names the password when none was sent and when it was rejected', async () => {
    await createFirstConnection();

    const missingPassword = await helpers.statementExtract({ payload: { fileBase64: encryptedPdfBase64() } });

    expect(missingPassword.statusCode).toBe(422);
    expect(errorMessage({ response: missingPassword })).toMatch(/password/i);

    const rejectedPassword = await helpers.statementExtract({
      payload: { fileBase64: encryptedPdfBase64(), password: 'not-the-password' },
    });

    expect(rejectedPassword.statusCode).toBe(422);
    expect(errorMessage({ response: rejectedPassword })).toMatch(/password/i);
  });

  it('extracts the statement once the correct password is supplied', async () => {
    await createFirstConnection();
    global.mswMockServer.use(getCustomEndpointContentMock({ content: AI_CSV_REPLY }));

    const result = await helpers.statementExtract({
      payload: { fileBase64: encryptedPdfBase64(), password: ENCRYPTED_STATEMENT_PASSWORD },
      raw: true,
    });

    expect(result.fileType).toBe('pdf');
    expect(result.metadata.currencyCode).toBe('SEK');
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ amount: 42.1, type: 'expense', merchant: 'LIDL STOCKHOLM' });
  });
});

describe('Statement parser extraction that yields nothing usable', () => {
  useSelfHostWithoutServerAiKeys();

  const METADATA_ONLY_REPLY = 'Testbanken,4321,2026-06-01,2026-06-30,SEK';

  it('answers 422 and says no transactions were found when the model returns metadata only', async () => {
    await createFirstConnection();
    global.mswMockServer.use(getCustomEndpointVllmMock({ content: METADATA_ONLY_REPLY }));

    const response = await helpers.statementExtract({ payload: { fileBase64: PNG_1X1_BASE64 } });

    expect(response.statusCode).toBe(422);
    expect(errorMessage({ response })).toMatch(/no transactions found/i);
  });

  it('words the no-transactions answer in the language of the request', async () => {
    await createFirstConnection();
    global.mswMockServer.use(getCustomEndpointVllmMock({ content: METADATA_ONLY_REPLY }));

    const response = await makeRequest({
      method: 'post',
      url: '/import/text-source/extract?lang=uk',
      payload: { fileBase64: PNG_1X1_BASE64 },
    });

    expect(response.statusCode).toBe(422);
    expect(errorMessage({ response })).toMatch(/не знайдено транзакцій/);
  });

  it('keeps the language of the request when an English request lands while the AI is answering', async () => {
    await createFirstConnection();
    global.mswMockServer.use(
      getCustomEndpointVllmMock({
        content: METADATA_ONLY_REPLY,
        onBody: () => makeRequest({ method: 'get', url: '/user/settings', headers: { 'Accept-Language': 'en' } }),
      }),
    );

    const response = await makeRequest({
      method: 'post',
      url: '/import/text-source/extract?lang=uk',
      payload: { fileBase64: PNG_1X1_BASE64 },
    });

    expect(response.statusCode).toBe(422);
    expect(errorMessage({ response })).toMatch(/не знайдено транзакцій/);
  });

  it('answers 422 when every row the model returned has an unreadable date', async () => {
    await createFirstConnection();
    global.mswMockServer.use(
      getCustomEndpointVllmMock({
        content: [METADATA_ONLY_REPLY, 'sometime last week,Card purchase,LIDL,42.10,E,,90'].join('\n'),
      }),
    );

    const response = await helpers.statementExtract({ payload: { fileBase64: PNG_1X1_BASE64 } });

    expect(response.statusCode).toBe(422);
    expect(errorMessage({ response })).toMatch(/readable date/i);
  });

  it('answers 502 when the AI endpoint is down', async () => {
    await createFirstConnection();
    global.mswMockServer.use(getCustomEndpointOfflineMock());

    const response = await helpers.statementExtract({ payload: { fileBase64: PNG_1X1_BASE64 } });

    expect(response.statusCode).toBe(502);
    expect(errorMessage({ response })).toMatch(/did not respond/i);
  });
});
