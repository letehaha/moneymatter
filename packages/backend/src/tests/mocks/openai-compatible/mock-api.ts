import { HttpResponse, delay, http } from 'msw';

/**
 * Stand-in for a user-supplied OpenAI-compatible endpoint (Ollama, vLLM, LiteLLM). msw
 * answers these in-process, so the hostname never has to resolve.
 */

/** Public-looking host, so the outbound URL guard is not what a test is measuring. */
export const CUSTOM_ENDPOINT_BASE_URL = 'http://custom-llm.test/v1';

/** Blocked by the guard in cloud mode, reachable in self-host mode. */
export const CUSTOM_ENDPOINT_LOOPBACK_BASE_URL = 'http://127.0.0.1:11434/v1';

/** Base URL whose handler fails the connection itself, standing in for a host that is down. */
export const CUSTOM_ENDPOINT_OFFLINE_BASE_URL = 'http://offline-llm.test/v1';

/** Base URL that serves a `/models` catalogue, the way LM Studio and OpenRouter do. */
export const CUSTOM_ENDPOINT_LISTING_BASE_URL = 'http://listing-llm.test/v1';

export const CUSTOM_ENDPOINT_MODEL = 'llama3.2';

/** The default handler answers 404 for this model name and succeeds for every other. */
export const CUSTOM_ENDPOINT_UNKNOWN_MODEL = 'model-that-was-never-pulled';

/** What `CUSTOM_ENDPOINT_LISTING_BASE_URL` reports as served. */
export const CUSTOM_ENDPOINT_LISTED_MODELS = [CUSTOM_ENDPOINT_MODEL, `${CUSTOM_ENDPOINT_MODEL}:70b`, 'qwen2.5'];

export const VALID_CUSTOM_ENDPOINT_API_KEY = 'custom-endpoint-valid-key';

/** The default handler answers 401 for this key. */
export const INVALID_CUSTOM_ENDPOINT_API_KEY = 'custom-endpoint-invalid-key';

function chatCompletionsUrl({ baseUrl }: { baseUrl: string }): string {
  return `${baseUrl}/chat/completions`;
}

function modelsUrl({ baseUrl }: { baseUrl: string }): string {
  return `${baseUrl}/models`;
}

function bearerToken({ request }: { request: Request }): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

async function requestedModel({ request }: { request: Request }): Promise<string> {
  const body = (await request.clone().json()) as { model?: string };
  return body.model ?? '';
}

/** Chat-completion payload shaped the way `@ai-sdk/openai`'s chat model parses it. */
function completionResponse({ model, content = 'ok' }: { model: string; content?: string }) {
  return HttpResponse.json({
    id: 'chatcmpl-custom-endpoint-test',
    object: 'chat.completion',
    created: 1_700_000_000,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
  });
}

function authErrorResponse() {
  return HttpResponse.json(
    {
      error: {
        message: 'Incorrect API key provided',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    },
    { status: 401 },
  );
}

function modelNotFoundResponse({ model }: { model: string }) {
  return HttpResponse.json(
    {
      error: {
        message: `model "${model}" not found, try pulling it first`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    },
    { status: 404 },
  );
}

/** Model-catalogue payload shaped the way an OpenAI-compatible `/models` route answers. */
function modelListResponse({ modelIds }: { modelIds: string[] }) {
  return HttpResponse.json({
    object: 'list',
    data: modelIds.map((id) => ({ id, object: 'model', owned_by: 'organization_owner' })),
  });
}

/** What a server that does not implement `/models` answers. */
function routeNotFoundResponse() {
  return HttpResponse.json({ error: { message: 'Unexpected endpoint or method' } }, { status: 404 });
}

/**
 * Succeeds unless the request carries `INVALID_CUSTOM_ENDPOINT_API_KEY` or asks for
 * `CUSTOM_ENDPOINT_UNKNOWN_MODEL`, so most tests need no override at all.
 */
async function defaultResolver({ request }: { request: Request }) {
  if (bearerToken({ request }) === INVALID_CUSTOM_ENDPOINT_API_KEY) {
    return authErrorResponse();
  }

  const model = await requestedModel({ request });
  if (model === CUSTOM_ENDPOINT_UNKNOWN_MODEL) {
    return modelNotFoundResponse({ model });
  }

  return completionResponse({ model });
}

/** Answers the catalogue unless the request carries `INVALID_CUSTOM_ENDPOINT_API_KEY`. */
function defaultModelListResolver({ request }: { request: Request }) {
  if (bearerToken({ request }) === INVALID_CUSTOM_ENDPOINT_API_KEY) {
    return authErrorResponse();
  }

  return modelListResponse({ modelIds: CUSTOM_ENDPOINT_LISTED_MODELS });
}

export const openAiCompatibleHandlers = [
  http.post(chatCompletionsUrl({ baseUrl: CUSTOM_ENDPOINT_BASE_URL }), ({ request }) => defaultResolver({ request })),
  http.post(chatCompletionsUrl({ baseUrl: CUSTOM_ENDPOINT_LOOPBACK_BASE_URL }), ({ request }) =>
    defaultResolver({ request }),
  ),
  http.post(chatCompletionsUrl({ baseUrl: CUSTOM_ENDPOINT_OFFLINE_BASE_URL }), () => HttpResponse.error()),

  http.get(modelsUrl({ baseUrl: CUSTOM_ENDPOINT_BASE_URL }), () => routeNotFoundResponse()),
  http.get(modelsUrl({ baseUrl: CUSTOM_ENDPOINT_LOOPBACK_BASE_URL }), () => routeNotFoundResponse()),
  http.get(modelsUrl({ baseUrl: CUSTOM_ENDPOINT_OFFLINE_BASE_URL }), () => HttpResponse.error()),

  http.get(modelsUrl({ baseUrl: CUSTOM_ENDPOINT_LISTING_BASE_URL }), ({ request }) =>
    defaultModelListResolver({ request }),
  ),
  http.post(chatCompletionsUrl({ baseUrl: CUSTOM_ENDPOINT_LISTING_BASE_URL }), ({ request }) =>
    defaultResolver({ request }),
  ),
];

export const getCustomEndpointSuccessMock = ({ baseUrl = CUSTOM_ENDPOINT_BASE_URL }: { baseUrl?: string } = {}) =>
  http.post(chatCompletionsUrl({ baseUrl }), async ({ request }) =>
    completionResponse({ model: await requestedModel({ request }) }),
  );

/** Answers with `content` verbatim, for tests whose subject is how the reply is parsed. */
export const getCustomEndpointContentMock = ({
  content,
  baseUrl = CUSTOM_ENDPOINT_BASE_URL,
}: {
  content: string;
  baseUrl?: string;
}) =>
  http.post(chatCompletionsUrl({ baseUrl }), async ({ request }) =>
    completionResponse({ model: await requestedModel({ request }), content }),
  );

/** Answers each request with what `respond` builds from its JSON body, for tests that read the prompt. */
export const getCustomEndpointDynamicMock = ({
  respond,
  delayMs = 0,
  baseUrl = CUSTOM_ENDPOINT_BASE_URL,
}: {
  respond: (params: { body: { model?: string; messages?: { role: string; content: unknown }[] } }) => string;
  delayMs?: number;
  baseUrl?: string;
}) =>
  http.post(chatCompletionsUrl({ baseUrl }), async ({ request }) => {
    if (delayMs) await delay(delayMs);
    const body = (await request.json()) as { model?: string; messages?: { role: string; content: unknown }[] };
    return completionResponse({ model: body.model ?? '', content: respond({ body }) });
  });

/**
 * vLLM's `/chat/completions`: rejects OpenAI's `file` content part (how the SDK sends a PDF)
 * and otherwise answers with `content`, handing each request body to `onBody`.
 */
export const getCustomEndpointVllmMock = ({
  content,
  onBody,
  baseUrl = CUSTOM_ENDPOINT_BASE_URL,
}: {
  content: string;
  onBody?: (body: string) => unknown;
  baseUrl?: string;
}) =>
  http.post(chatCompletionsUrl({ baseUrl }), async ({ request }) => {
    const body = await request.text();
    await onBody?.(body);
    if (body.includes('"type":"file"')) {
      return HttpResponse.json(
        {
          error: {
            message: "Unsupported chat content part type: 'file'. (parameter=type, value=file)",
            type: 'BadRequestError',
            code: 400,
          },
        },
        { status: 400 },
      );
    }
    return completionResponse({ model: (JSON.parse(body) as { model?: string }).model ?? '', content });
  });

/** Always answers 401, whatever key the request carries. */
export const getCustomEndpointAuthErrorMock = ({ baseUrl = CUSTOM_ENDPOINT_BASE_URL }: { baseUrl?: string } = {}) =>
  http.post(chatCompletionsUrl({ baseUrl }), () => authErrorResponse());

/** Fails the connection itself, so a test can take a base URL that answered a moment ago offline. */
export const getCustomEndpointOfflineMock = ({ baseUrl = CUSTOM_ENDPOINT_BASE_URL }: { baseUrl?: string } = {}) =>
  http.post(chatCompletionsUrl({ baseUrl }), () => HttpResponse.error());

/**
 * Answers every path with a web page instead of an API answer: a closed tunnel's 404, or
 * with `status` an auth gate's 401. Returns one handler per path, so spread it.
 */
export const getCustomEndpointWebPageMocks = ({
  baseUrl = CUSTOM_ENDPOINT_BASE_URL,
  status = 404,
}: { baseUrl?: string; status?: number } = {}) => [
  http.post(chatCompletionsUrl({ baseUrl }), () => offlineTunnelPage({ status })),
  http.get(modelsUrl({ baseUrl }), () => offlineTunnelPage({ status })),
];

function offlineTunnelPage({ status }: { status: number }) {
  return HttpResponse.html('<html><body>The endpoint is offline (ERR_NGROK_3200)</body></html>', { status });
}

/**
 * Always answers 404, the way Ollama and vLLM answer for a model that was never pulled.
 * `onCall` fires per request, so a test can count the outbound attempts a run makes.
 */
export const getCustomEndpointModelNotFoundMock = ({
  onCall,
  baseUrl = CUSTOM_ENDPOINT_BASE_URL,
}: { onCall?: () => void; baseUrl?: string } = {}) =>
  http.post(chatCompletionsUrl({ baseUrl }), async ({ request }) => {
    onCall?.();
    return modelNotFoundResponse({ model: await requestedModel({ request }) });
  });

/** OpenRouter's 404 for a request the model can't take, such as an image sent to a text-only model. */
export const getCustomEndpointUnsupportedInputMock = ({
  baseUrl = CUSTOM_ENDPOINT_BASE_URL,
}: { baseUrl?: string } = {}) =>
  http.post(chatCompletionsUrl({ baseUrl }), () =>
    HttpResponse.json(
      { error: { message: 'No endpoints found that support image input', code: 404 } },
      { status: 404 },
    ),
  );

/** Succeeds and fires `onCall`, so a test can prove the server issued an outbound request. */
export const getCustomEndpointCallCountingMock = ({
  onCall,
  baseUrl = CUSTOM_ENDPOINT_BASE_URL,
}: {
  onCall: () => void;
  baseUrl?: string;
}) =>
  http.post(chatCompletionsUrl({ baseUrl }), async ({ request }) => {
    onCall();
    return completionResponse({ model: await requestedModel({ request }) });
  });

/** Succeeds only for the exact bearer token given, so a test can prove which key was sent. */
export const getCustomEndpointRequireKeyMock = ({
  apiKey,
  baseUrl = CUSTOM_ENDPOINT_BASE_URL,
}: {
  apiKey: string;
  baseUrl?: string;
}) =>
  http.post(chatCompletionsUrl({ baseUrl }), async ({ request }) => {
    if (bearerToken({ request }) !== apiKey) return authErrorResponse();
    return completionResponse({ model: await requestedModel({ request }) });
  });

/** Gives a base URL a `/models` catalogue of exactly `modelIds`. */
export const getCustomEndpointModelListMock = ({
  modelIds,
  baseUrl = CUSTOM_ENDPOINT_LISTING_BASE_URL,
}: {
  modelIds: string[];
  baseUrl?: string;
}) => http.get(modelsUrl({ baseUrl }), () => modelListResponse({ modelIds }));

/** Answers 401 on `/models`, whatever key the request carries. */
export const getCustomEndpointModelListAuthErrorMock = ({
  baseUrl = CUSTOM_ENDPOINT_LISTING_BASE_URL,
}: { baseUrl?: string } = {}) => http.get(modelsUrl({ baseUrl }), () => authErrorResponse());
