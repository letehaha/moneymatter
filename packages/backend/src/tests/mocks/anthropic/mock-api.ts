import { HttpResponse, delay, http } from 'msw';

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';

export const VALID_ANTHROPIC_API_KEY = 'sk-ant-test-valid-key-12345';
export const INVALID_ANTHROPIC_API_KEY = 'sk-ant-test-invalid-key';

/** What the default `/v1/models` handler lists. */
export const ANTHROPIC_LISTED_MODELS = ['claude-haiku-4-5', 'claude-opus-5', 'claude-sonnet-5'];

function authErrorResponse() {
  return HttpResponse.json(
    { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
    { status: 401 },
  );
}

/** The model's categorization answer: one "t<tx ordinal>:c<category ordinal>" line per transaction. */
export function formatCategorizationLines({ categorizations }: { categorizations: Record<number, number> }): string {
  return Object.entries(categorizations)
    .map(([txOrdinal, catOrdinal]) => `t${txOrdinal}:c${catOrdinal}`)
    .join('\n');
}

interface MockCategorizationOptions {
  /** Map of transaction ordinal to category ordinal (1-based, prompt order), emitted as "t1:c2" alias pairs */
  categorizations?: Record<number, number>;
  /** Verbatim response text; overrides categorizations */
  rawText?: string;
  /** Hold the response for this long, simulating a slow model */
  delayMs?: number;
  /** If true, returns an error response */
  shouldFail?: boolean;
  /** Custom error status code */
  errorStatus?: number;
}

/**
 * Creates a mock response for the Anthropic messages API
 * Returns rawText verbatim, else the categorizations as "t<n>:c<n>" lines.
 */
export function createAnthropicMock(options: MockCategorizationOptions = {}) {
  const { categorizations = {}, rawText, delayMs = 0, shouldFail = false, errorStatus = 500 } = options;

  return http.post(ANTHROPIC_API_URL, async ({ request }) => {
    if (delayMs) await delay(delayMs);

    const apiKey = request.headers.get('x-api-key');

    if (apiKey === INVALID_ANTHROPIC_API_KEY) {
      return authErrorResponse();
    }

    // Simulate failure if requested
    if (shouldFail) {
      return HttpResponse.json(
        {
          type: 'error',
          error: {
            type: 'api_error',
            message: 'Internal server error',
          },
        },
        { status: errorStatus },
      );
    }

    const responseText = rawText ?? formatCategorizationLines({ categorizations });

    return HttpResponse.json({
      id: 'msg_test_123',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: responseText || '# No categorizations',
        },
      ],
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    });
  });
}

/**
 * Creates a dynamic mock that extracts transaction IDs from the request
 * and assigns them to the provided categoryId
 */
export function createDynamicCategorizationMock({ categoryId }: { categoryId: number }) {
  return http.post(ANTHROPIC_API_URL, async ({ request }) => {
    const apiKey = request.headers.get('x-api-key');

    if (apiKey === INVALID_ANTHROPIC_API_KEY) {
      return HttpResponse.json(
        {
          type: 'error',
          error: {
            type: 'authentication_error',
            message: 'Invalid API key',
          },
        },
        { status: 401 },
      );
    }

    // Parse request body to extract transaction IDs
    const body = (await request.json()) as { messages: { content: string }[] };
    const userMessage = body.messages[0]?.content || '';

    // Extract transaction IDs from the TRANSACTIONS section
    // Format: id|amount|currency|account|datetime|note
    const transactionSection = userMessage.split('TRANSACTIONS:')[1] || '';
    const lines = transactionSection.trim().split('\n');

    const transactionIds: number[] = [];
    for (const line of lines) {
      if (line.startsWith('id|')) continue; // Skip header
      const id = parseInt(line.split('|')[0] || '', 10);
      if (!isNaN(id)) {
        transactionIds.push(id);
      }
    }

    // Build response - assign all transactions to the given category
    const responseText = transactionIds.map((txId) => `${txId}:${categoryId}`).join('\n');

    return HttpResponse.json({
      id: 'msg_test_dynamic',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: responseText || '# No transactions found',
        },
      ],
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 150,
        output_tokens: transactionIds.length * 3,
      },
    });
  });
}

/** Answers in the paginated shape the API uses. */
const modelListHandler = http.get(ANTHROPIC_MODELS_URL, ({ request }) => {
  if (request.headers.get('x-api-key') === INVALID_ANTHROPIC_API_KEY) {
    return authErrorResponse();
  }

  return HttpResponse.json({
    data: ANTHROPIC_LISTED_MODELS.map((id) => ({
      type: 'model',
      id,
      display_name: id,
      created_at: '2026-01-01T00:00:00Z',
    })),
    has_more: false,
    first_id: ANTHROPIC_LISTED_MODELS[0],
    last_id: ANTHROPIC_LISTED_MODELS.at(-1),
  });
});

/**
 * Default handlers: an empty categorization answer and the model list
 */
export const anthropicHandlers = [createAnthropicMock(), modelListHandler];
