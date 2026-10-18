import { AICliProvider, AI_PROVIDER } from '@bt/shared/types';
import { i18nextReady, t } from '@i18n/index';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ValidationError } from '@js/errors';
import { useFakeAiClis } from '@tests/helpers/ai-cli';

import { CliCredentialSource } from './cli/cli-credential-run';
import {
  CliNotInstalledError,
  createCliApiError,
  createToolUseBlockedError,
  mapCliFailure,
  CLI_ERROR_TYPE,
} from './cli/cli-errors';
import { runWithCliSlot } from './cli/cli-run-limiter';
import {
  judgeCliProbeFailure,
  pickListedModelsToShow,
  readModelIds,
  validateCliConnection,
  validateConnection,
  validateCustomEndpoint,
} from './connection-validation';

// A busy slot must give up quickly for the test; the production wait is 2 minutes.
jest.mock('./cli/cli-run-limiter', () => ({
  ...(jest.requireActual('./cli/cli-run-limiter') as object),
  CLI_PROBE_MAX_WAIT_MS: 150,
}));

describe('readModelIds', () => {
  it('reads the ids out of an OpenAI-style list', () => {
    const body = { object: 'list', data: [{ id: 'llama3.2' }, { id: 'qwen2.5' }] };
    expect(readModelIds({ body })).toEqual(['llama3.2', 'qwen2.5']);
  });

  it('keeps only the entries that carry a usable id', () => {
    const body = { data: [{ id: 'llama3.2' }, { id: '' }, { id: 42 }, null, 'qwen2.5'] };
    expect(readModelIds({ body })).toEqual(['llama3.2']);
  });

  it.each([
    ['a body that is not an object', 'llama3.2'],
    ['a body without data', { object: 'list' }],
    ['a body whose data is not an array', { data: { id: 'llama3.2' } }],
    ['null', null],
  ])('returns nothing for %s', (_label, body) => {
    expect(readModelIds({ body })).toEqual([]);
  });
});

describe('pickListedModelsToShow', () => {
  it('puts ids sharing a prefix with the typed name first', () => {
    const modelIds = ['mistral', 'qwen3.6-35b-distilled@q6_k', 'phi4'];

    const { shown } = pickListedModelsToShow({ modelName: 'qwen3.6-35b-distill', modelIds });

    expect(shown[0]).toBe('qwen3.6-35b-distilled@q6_k');
  });

  // An aggregator lists hundreds of ids; the message has to stay readable
  it('caps the ids it shows and counts the rest', () => {
    const modelIds = Array.from({ length: 40 }, (_, index) => `model-${index}`);

    const { shown, remaining } = pickListedModelsToShow({ modelName: 'nothing-alike', modelIds });

    expect(shown).toHaveLength(5);
    expect(remaining).toBe(35);
  });

  it('reports nothing remaining when every id fits', () => {
    const { shown, remaining } = pickListedModelsToShow({ modelName: 'llama3.2', modelIds: ['llama3.2', 'qwen2.5'] });

    expect(shown).toEqual(['llama3.2', 'qwen2.5']);
    expect(remaining).toBe(0);
  });
});

describe('validateCustomEndpoint', () => {
  const BASE_URL = 'http://listing-llm.test/v1';
  const MODEL = 'llama3.2';

  let selfHostFlagBeforeTest: string | undefined;
  let fetchBeforeTest: typeof globalThis.fetch;
  let generateCalls: number;

  beforeAll(async () => {
    // The verdicts are translated strings, so the locale has to be loaded to compare them
    await i18nextReady;
  });

  beforeEach(() => {
    selfHostFlagBeforeTest = process.env.IS_SELF_HOST;
    // Self-host mode stands the outbound guard down, so the stub below answers instead of a
    // hostname that never resolves.
    process.env.IS_SELF_HOST = 'true';
    fetchBeforeTest = globalThis.fetch;
    generateCalls = 0;
  });

  afterEach(() => {
    globalThis.fetch = fetchBeforeTest;

    if (selfHostFlagBeforeTest === undefined) {
      delete process.env.IS_SELF_HOST;
    } else {
      process.env.IS_SELF_HOST = selfHostFlagBeforeTest;
    }
  });

  function jsonResponse({ body, status = 200 }: { body: unknown; status?: number }): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  /** Chat-completion payload shaped the way `@ai-sdk/openai`'s chat model parses it. */
  function completionResponse(): Response {
    return jsonResponse({
      body: {
        id: 'chatcmpl-unit',
        object: 'chat.completion',
        created: 1_700_000_000,
        model: MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
      },
    });
  }

  /** Counts every `/chat/completions` post, so a test can prove whether the generate probe ran. */
  function stubEndpoint({
    onModelList,
    onGenerate = () => completionResponse(),
  }: {
    onModelList: () => Response;
    onGenerate?: () => Response;
  }): void {
    globalThis.fetch = (async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/models')) return onModelList();

      if (url.endsWith('/chat/completions')) {
        generateCalls += 1;
        return onGenerate();
      }

      throw new Error(`Unexpected request to ${url}`);
    }) as typeof globalThis.fetch;
  }

  function listOf({ modelIds }: { modelIds: string[] }): Response {
    return jsonResponse({ body: { object: 'list', data: modelIds.map((id) => ({ id, object: 'model' })) } });
  }

  it('accepts a model the endpoint lists without asking it to generate', async () => {
    stubEndpoint({ onModelList: () => listOf({ modelIds: ['qwen2.5', MODEL] }) });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(result.isValid).toBe(true);
    expect(generateCalls).toBe(0);
  });

  it('rejects a model the endpoint does not list and names what it offers', async () => {
    stubEndpoint({ onModelList: () => listOf({ modelIds: ['qwen2.5', 'mistral'] }) });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: 'llama3.2-typo', apiKey: null });

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('llama3.2-typo');
    expect(result.error).toContain('qwen2.5');
    expect(result.error).toContain('mistral');
    expect(generateCalls).toBe(0);
  });

  it('shows the closest ids first and counts the ones it leaves out', async () => {
    const modelIds = ['unrelated-a', 'unrelated-b', 'unrelated-c', 'unrelated-d', `${MODEL}-distilled@q6_k`];
    stubEndpoint({ onModelList: () => listOf({ modelIds }) });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: `${MODEL}-distill`, apiKey: null });

    expect(result.error).toContain(`${MODEL}-distilled@q6_k`);
  });

  it('reports an auth failure when the list request is refused', async () => {
    stubEndpoint({ onModelList: () => jsonResponse({ body: { error: 'no' }, status: 401 }) });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: 'wrong-key' });

    expect(result.isValid).toBe(false);
    expect(result.error).toBe(t({ key: 'ai.customEndpointAuthFailed' }));
    expect(generateCalls).toBe(0);
  });

  it('reports the endpoint unreachable when the list request never connects', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(result.isValid).toBe(false);
    expect(result.error).toBe(t({ key: 'ai.customEndpointUnreachable' }));
  });

  it('rethrows a blocked-address rejection instead of turning it into a verdict', async () => {
    globalThis.fetch = (async () => {
      throw new ValidationError({ message: 'blocked' });
    }) as typeof globalThis.fetch;

    await expect(validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('falls back to the generate probe when the endpoint has no list route', async () => {
    stubEndpoint({ onModelList: () => jsonResponse({ body: { error: 'not found' }, status: 404 }) });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(result.isValid).toBe(true);
    expect(generateCalls).toBe(1);
  });

  it('falls back to the generate probe when the list body is not JSON', async () => {
    stubEndpoint({ onModelList: () => new Response('<html>nope</html>', { status: 200 }) });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(result.isValid).toBe(true);
    expect(generateCalls).toBe(1);
  });

  it.each([
    ['an empty list', { object: 'list', data: [] }],
    ['a shape it cannot read', { models: ['llama3.2'] }],
  ])('falls back to the generate probe for %s', async (_label, body) => {
    stubEndpoint({ onModelList: () => jsonResponse({ body }) });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(result.isValid).toBe(true);
    expect(generateCalls).toBe(1);
  });

  it('falls back to the generate probe when the list request times out', async () => {
    stubEndpoint({
      onModelList: () => {
        throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      },
    });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(result.isValid).toBe(true);
    expect(generateCalls).toBe(1);
  });

  // Rejecting here would make a working endpoint unsaveable.
  it('accepts the endpoint when the generate probe hits a rate limit', async () => {
    stubEndpoint({
      onModelList: () => jsonResponse({ body: { error: 'not found' }, status: 404 }),
      onGenerate: () =>
        jsonResponse({ body: { error: { message: 'rate limit reached', type: 'rate_limit_exceeded' } }, status: 429 }),
    });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('reports a model the generate probe rejects when there is no list to check', async () => {
    stubEndpoint({
      onModelList: () => jsonResponse({ body: { error: 'not found' }, status: 404 }),
      onGenerate: () =>
        jsonResponse({ body: { error: { message: 'model not found', code: 'model_not_found' } }, status: 404 }),
    });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(result.isValid).toBe(false);
    expect(result.error).toBe(t({ key: 'ai.customEndpointModelNotFound', variables: { model: MODEL } }));
    expect(generateCalls).toBe(1);
  });

  it('reports a server answering with a web page instead of blaming the model', async () => {
    const offlinePage = () =>
      new Response('<html><body>The endpoint is offline (ERR_NGROK_3200)</body></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      });
    stubEndpoint({ onModelList: offlinePage, onGenerate: offlinePage });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(result.isValid).toBe(false);
    expect(result.error).toBe(t({ key: 'ai.customEndpointNotApiResponse', variables: { status: 404 } }));
    expect(result.error).not.toContain(MODEL);
    expect(generateCalls).toBe(1);
  });

  // Cloudflare Access or basic auth answers 401 with its own page before the API ever sees
  // the request, so "check your API key" would send the user rotating a fine key.
  it('reports an HTML 401 as a non-API answer, not a rejected key', async () => {
    const gatePage = () =>
      new Response('<html><body>Sign in to continue</body></html>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      });
    stubEndpoint({ onModelList: gatePage, onGenerate: gatePage });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(result.isValid).toBe(false);
    expect(result.error).toBe(t({ key: 'ai.customEndpointNotApiResponse', variables: { status: 401 } }));
    expect(result.error).not.toBe(t({ key: 'ai.customEndpointAuthFailed' }));
    // The HTML 401 on `/models` is not a verdict either, so the generate probe must run
    expect(generateCalls).toBe(1);
  });

  it('still reports an auth failure when the API itself answers the probe with a JSON 401', async () => {
    stubEndpoint({
      onModelList: () => jsonResponse({ body: { error: 'not found' }, status: 404 }),
      onGenerate: () =>
        jsonResponse({
          body: { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } },
          status: 401,
        }),
    });

    const result = await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: 'wrong-key' });

    expect(result.isValid).toBe(false);
    expect(result.error).toBe(t({ key: 'ai.customEndpointAuthFailed' }));
  });

  it('sends the API key with the list request only when there is one', async () => {
    const authorizationHeaders: (string | null)[] = [];
    globalThis.fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization'));
      return listOf({ modelIds: [MODEL] });
    }) as typeof globalThis.fetch;

    await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: 'endpoint-key' });
    await validateCustomEndpoint({ baseUrl: BASE_URL, modelName: MODEL, apiKey: null });

    expect(authorizationHeaders).toEqual(['Bearer endpoint-key', null]);
  });
});

describe('validateConnection for a native provider', () => {
  const MODEL = 'gemini-3.8-flash';

  let fetchBeforeTest: typeof globalThis.fetch;
  let requests: number;

  beforeAll(async () => {
    await i18nextReady;
  });

  beforeEach(() => {
    fetchBeforeTest = globalThis.fetch;
    requests = 0;
  });

  afterEach(() => {
    globalThis.fetch = fetchBeforeTest;
  });

  function stubGemini({ status, body }: { status: number; body: unknown }): void {
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
  }

  const validate = ({ apiKey = 'gemini-key' }: { apiKey?: string | null } = {}) =>
    validateConnection({ provider: AI_PROVIDER.google, model: MODEL, apiKey });

  it('asks for the key without dialling the provider when there is none', async () => {
    stubGemini({ status: 200, body: {} });

    expect(await validate({ apiKey: null })).toEqual({
      isValid: false,
      error: t({ key: 'ai.connectionApiKeyRequired' }),
    });
    expect(requests).toBe(0);
  });

  it('accepts a model that answers', async () => {
    stubGemini({
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' }, finishReason: 'STOP' }] },
    });

    expect(await validate()).toEqual({ isValid: true });
  });

  // Gemini answers a bad key with a 400, not a 401
  it('reports the key rejected on a Gemini API_KEY_INVALID 400', async () => {
    stubGemini({
      status: 400,
      body: {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
        },
      },
    });

    expect(await validate()).toEqual({ isValid: false, error: t({ key: 'ai.connectionKeyRejected' }) });
  });

  it('reports the model unavailable on a 404', async () => {
    stubGemini({ status: 404, body: { error: { code: 404, message: 'models/x is not found', status: 'NOT_FOUND' } } });

    expect(await validate()).toEqual({
      isValid: false,
      error: t({ key: 'ai.connectionModelNotAvailable', variables: { model: MODEL } }),
    });
  });

  it('accepts the key when the provider is rate limiting', async () => {
    stubGemini({
      status: 429,
      body: { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } },
    });

    expect(await validate()).toEqual({ isValid: true });
    expect(requests).toBe(1);
  });

  it('accepts the key when the provider is temporarily unavailable', async () => {
    stubGemini({
      status: 503,
      body: { error: { code: 503, message: 'The model is overloaded', status: 'UNAVAILABLE' } },
    });

    expect(await validate()).toEqual({ isValid: true });
  });

  it('reports the provider unreachable when the request never connects', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;

    expect(await validate()).toEqual({ isValid: false, error: t({ key: 'ai.connectionProviderUnreachable' }) });
  });

  it("passes the provider's own message through for an unclassified refusal", async () => {
    stubGemini({
      status: 400,
      body: { error: { code: 400, message: 'max_output_tokens is too large', status: 'INVALID_ARGUMENT' } },
    });

    expect(await validate()).toEqual({
      isValid: false,
      error: t({ key: 'ai.connectionValidationFailed', variables: { reason: 'max_output_tokens is too large' } }),
    });
  });
});

const failed = (reason: string) => ({
  isValid: false,
  error: t({ key: 'ai.connectionValidationFailed', variables: { reason } }),
});

describe('CLI connection verdicts', () => {
  const MODEL = 'sonnet';
  const claude = AI_PROVIDER.claudeCode;

  beforeAll(async () => {
    await i18nextReady;
  });

  const judge = ({ error, provider = claude }: { error: unknown; provider?: AICliProvider }) =>
    judgeCliProbeFailure({ provider, model: MODEL, error });

  describe('judgeCliProbeFailure', () => {
    it('accepts the subscription limit: the sign-in and the model were recognised', () => {
      expect(
        judge({ error: mapCliFailure({ provider: claude, text: 'Claude AI usage limit reached|1900000000' }) }),
      ).toEqual({
        isValid: true,
      });
    });

    it('accepts an overloaded service (503)', () => {
      expect(judge({ error: mapCliFailure({ provider: claude, text: 'Overloaded', apiErrorStatus: 529 }) })).toEqual({
        isValid: true,
      });
    });

    it('refuses an unmapped exit (502 cli_failed) with the CLI own message', () => {
      const error = mapCliFailure({ provider: claude, text: 'Unknown feature flag: shell_tool', exitCode: 2 });

      expect(judge({ error })).toEqual(
        failed('The Claude Code CLI exited with code 2: Unknown feature flag: shell_tool'),
      );
    });

    it('refuses a blocked tool use (502 cli_tool_use_blocked) with the CLI own message', () => {
      const error = createToolUseBlockedError({ provider: AI_PROVIDER.codex, detail: 'command_execution' });

      expect(judge({ error, provider: AI_PROVIDER.codex })).toEqual(
        failed('The Codex run was stopped because the model tried to use a tool (command_execution)'),
      );
    });

    it('never puts a token into the reason', () => {
      const error = createCliApiError({
        provider: claude,
        type: CLI_ERROR_TYPE.failed,
        message: 'crashed with sk-ant-oat01-abcdefghijklmnop1234',
      });

      const verdict = judge({ error });

      expect(verdict.isValid).toBe(false);
      expect(verdict.error).not.toContain('abcdefghijklmnop');
    });

    it('tells the user to sign in again when the CLI rejects the sign-in', () => {
      expect(judge({ error: mapCliFailure({ provider: claude, text: 'invalid_grant' }) })).toEqual({
        isValid: false,
        error: t({ key: 'ai.cliSignInRejected', variables: { provider: 'Claude Code' } }),
      });
    });

    it('names the model when the CLI does not serve it', () => {
      expect(
        judge({ error: mapCliFailure({ provider: claude, text: 'There is an issue with the selected model (x).' }) }),
      ).toEqual({
        isValid: false,
        error: t({ key: 'ai.cliModelNotAvailable', variables: { provider: 'Claude Code', model: MODEL } }),
      });
    });

    it('reports a missing binary with the not-installed copy', () => {
      expect(
        judge({ error: new CliNotInstalledError({ provider: claude, cause: new Error('spawn ENOENT') }) }),
      ).toEqual({
        isValid: false,
        error: t({ key: 'ai.cliNotInstalled', variables: { provider: 'Claude Code' } }),
      });
    });

    it('keeps the unreachable copy for a probe timeout', () => {
      const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });

      expect(judge({ error: timeout })).toEqual({
        isValid: false,
        error: t({ key: 'ai.connectionProviderUnreachable' }),
      });
    });

    it('passes an unclassified failure through', () => {
      expect(judge({ error: new Error('something odd') })).toEqual(failed('something odd'));
    });
  });

  describe('validateCliConnection', () => {
    const fakes = useFakeAiClis();
    let counter = 0;

    const buildSource = (): CliCredentialSource => {
      counter += 1;

      return {
        connectionKey: `validation-test-${counter}`,
        load: async () => ({ credential: 'sk-ant-oat01-fake-token-value', revision: 'rev-1' }),
      };
    };

    it('accepts a working sign-in and runs onValid once', async () => {
      const onValid = jest.fn<() => void>();

      const verdict = await validateCliConnection({
        provider: claude,
        model: MODEL,
        credentialSource: buildSource(),
        onValid,
      });

      expect(verdict).toEqual({ isValid: true });
      expect(onValid).toHaveBeenCalledTimes(1);
      expect(fakes.readRuns()).toHaveLength(1);
    });

    it.each([
      ['limit', true],
      ['overloaded', true],
      ['auth', false],
      ['model-not-found', false],
      ['exit-1', false],
      ['tool-call', false],
    ])(
      'under the %s scenario the verdict is valid: %s, and onValid runs only for a valid one',
      async (scenario, valid) => {
        fakes.setScenario({ scenario });
        const onValid = jest.fn<() => void>();

        const verdict = await validateCliConnection({
          provider: claude,
          model: MODEL,
          credentialSource: buildSource(),
          onValid,
        });

        expect(verdict.isValid).toBe(valid);
        expect(onValid).toHaveBeenCalledTimes(valid ? 1 : 0);
      },
    );

    it('lets an onValid failure surface instead of turning it into a verdict', async () => {
      const onValid = jest.fn(() => {
        throw new ValidationError({ message: 'session already used' });
      });

      await expect(
        validateCliConnection({ provider: claude, model: MODEL, credentialSource: buildSource(), onValid }),
      ).rejects.toThrow('session already used');
    });

    it('throws the busy message, without a verdict, when every instance-wide slot stays taken', async () => {
      const savedCap = process.env.AI_CLI_MAX_CONCURRENT_RUNS;

      process.env.AI_CLI_MAX_CONCURRENT_RUNS = '1';

      try {
        const credentialSource = buildSource();
        const holder = runWithCliSlot({
          connectionKey: 'another-connection',
          timeoutMs: 5_000,
          run: () => new Promise((resolve) => setTimeout(resolve, 600)),
        });

        await expect(validateCliConnection({ provider: claude, model: MODEL, credentialSource })).rejects.toThrow(
          t({ key: 'ai.cliConnectionBusy' }),
        );
        expect(fakes.readRuns()).toHaveLength(0);

        await holder;
      } finally {
        if (savedCap === undefined) delete process.env.AI_CLI_MAX_CONCURRENT_RUNS;
        else process.env.AI_CLI_MAX_CONCURRENT_RUNS = savedCap;
      }
    });
  });
});
