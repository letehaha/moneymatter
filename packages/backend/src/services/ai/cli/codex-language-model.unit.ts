import { describe, expect, it, jest } from '@jest/globals';
import { useFakeAiClis } from '@tests/helpers/ai-cli';
import { generateText, Output, streamText, UnsupportedFunctionalityError } from 'ai';
import { readFileSync } from 'fs';
import path from 'path';
import { z } from 'zod';

import { classifyAiCallFailure } from '../ai-error-classifiers';
import { CliCredentialSource } from './cli-credential-run';
import { isCliNotInstalledError } from './cli-errors';
import { CODEX_DISABLED_FEATURES, CODEX_TOOL_DISABLE_ARGS, createCodexLanguageModel } from './codex-language-model';

jest.mock('@js/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const fakes = useFakeAiClis();

/** The 27 agent tool features verified against Codex 0.160.1 (plan Context). */
const PINNED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'unified_exec_tty',
  'shell_snapshot',
  'apps',
  'plugins',
  'remote_plugin',
  'plugin_sharing',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'in_app_browser',
  'multi_agent',
  'view_image',
  'image_generation',
  'hooks',
  'skill_search',
  'skill_mcp_dependency_install',
  'tool_suggest',
  'tool_call_mcp_elicitation',
  'sleep_tool',
  'code_mode_host',
  'goals',
  'realtime_conversation',
  'workspace_dependencies',
  'worktrees',
];

const authJson = ({ refreshToken }: { refreshToken: string }) =>
  JSON.stringify({ tokens: { access_token: 'at', refresh_token: refreshToken }, last_refresh: '2026-01-01T00:00:00Z' });

let counter = 0;

/** A source backed by an in-memory store, like a stored connection row. */
const buildSource = ({ initial = authJson({ refreshToken: 'rt-0' }) }: { initial?: string } = {}) => {
  counter += 1;

  const store = { credential: initial, revision: 1 };
  const load = jest.fn(async () => ({ credential: store.credential, revision: `rev-${store.revision}` }));
  const save = jest.fn<NonNullable<CliCredentialSource['save']>>(async ({ credential }) => {
    store.credential = credential;
    store.revision += 1;
  });

  const source: CliCredentialSource = { connectionKey: `codex-model-test-${counter}`, load, save };

  return { source, store, load, save };
};

const buildModel = ({
  model = 'gpt-6-astra',
  source = buildSource().source,
  timeoutMs,
}: { model?: string; source?: CliCredentialSource; timeoutMs?: number } = {}) =>
  createCodexLanguageModel({ model, credentialSource: source, runOptions: { timeoutMs } });

const ask = ({ model, abortSignal }: { model: ReturnType<typeof buildModel>; abortSignal?: AbortSignal }) =>
  generateText({ model, system: 'Be brief.', prompt: 'What is 2+2?', maxRetries: 0, abortSignal });

const failureOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error).not.toBeNull();

  return error;
};

const inSandboxRealm = (error: unknown) => Object.assign(new Error('abort'), { name: (error as Error).name });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('CODEX_TOOL_DISABLE_ARGS', () => {
  it('pins the 27 verified feature names, as --disable pairs', () => {
    expect([...CODEX_DISABLED_FEATURES]).toEqual(PINNED_FEATURES);
    expect(CODEX_TOOL_DISABLE_ARGS).toEqual(PINNED_FEATURES.flatMap((name) => ['--disable', name]));
  });

  it('matches the list the fake codex enforces', () => {
    const fixture = JSON.parse(
      readFileSync(path.join(__dirname, '../../../tests/fixtures/ai-cli/codex-disabled-features.json'), 'utf8'),
    );

    expect(fixture).toEqual(PINNED_FEATURES);
  });
});

describe('codex language model', () => {
  it('answers from the final message and maps usage', async () => {
    fakes.setResponses({ responses: [{ text: '4' }] });

    const result = await ask({ model: buildModel() });

    expect(result.text).toBe('4');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.inputTokens).toBe(21);
    expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(5);
    expect(result.usage.outputTokens).toBe(9);
    expect(result.usage.outputTokenDetails.reasoningTokens).toBe(4);
  });

  it('runs read-only, offline-search and without agent tools, with a scrubbed env', async () => {
    process.env.OPENAI_API_KEY = 'sk-should-not-leak';

    try {
      await ask({ model: buildModel() });
    } finally {
      delete process.env.OPENAI_API_KEY;
    }

    const run = fakes.getRun();
    const { argv } = run;
    const configs = argv.flatMap((arg, index) => (arg === '-c' ? [argv[index + 1]] : []));
    const disabled = argv.flatMap((arg, index) => (arg === '--disable' ? [argv[index + 1]] : []));

    expect(argv[argv.indexOf('-s') + 1]).toBe('read-only');
    expect(configs).toEqual(
      expect.arrayContaining([
        'approval_policy="never"',
        'web_search="disabled"',
        'shell_environment_policy.inherit="none"',
        'cli_auth_credentials_store="file"',
      ]),
    );
    expect(disabled).toEqual(PINNED_FEATURES);
    expect(argv).toEqual(expect.arrayContaining(['--ephemeral', '--ignore-user-config', '--ignore-rules', '--json']));
    expect(argv[argv.indexOf('-m') + 1]).toBe('gpt-6-astra');
    expect(argv.slice(-2)).toEqual(['--', '-']);
    expect(run.envKeys).toContain('CODEX_HOME');
    expect(run.envKeys).not.toContain('OPENAI_API_KEY');
    expect(run.envKeys).not.toContain('APPLICATION_JWT_SECRET');
    expect(run.cwd).toMatch(/mm-codex-run-.+\/work$/);
  });

  it('sends the system prompt as developer_instructions and the user text on stdin', async () => {
    await generateText({ model: buildModel(), system: 'Be "brief".\nAlways.', prompt: 'What is 2+2?', maxRetries: 0 });

    const run = fakes.getRun();
    const override = run.argv.find((arg) => arg.startsWith('developer_instructions='))!;

    expect(JSON.parse(override.slice('developer_instructions='.length))).toBe('Be "brief".\nAlways.');
    expect(run.stdin).toBe('What is 2+2?');
  });

  it('materializes the credential into the private CODEX_HOME', async () => {
    await ask({ model: buildModel() });

    expect(fakes.getRun().codexHome).toMatch(/mm-codex-home-/);
  });

  it('attaches images as files with -i', async () => {
    const bytes = Buffer.from([255, 216, 255, 1, 2, 3]);

    await generateText({
      model: buildModel(),
      maxRetries: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read this' },
            { type: 'file', data: new Uint8Array(bytes), mediaType: 'image/jpeg' },
          ],
        },
      ],
    });

    const run = fakes.getRun();

    expect(run.images).toEqual([{ ext: 'jpg', base64: bytes.toString('base64') }]);
    expect(run.argv.indexOf('-i')).toBeLessThan(run.argv.indexOf('--'));
  });

  it('refuses non-image file parts before starting a process', async () => {
    const error = await failureOf(
      generateText({
        model: buildModel(),
        maxRetries: 0,
        messages: [
          { role: 'user', content: [{ type: 'file', data: new Uint8Array([1]), mediaType: 'application/pdf' }] },
        ],
      }),
    );

    expect(error).toBeInstanceOf(UnsupportedFunctionalityError);
    expect(fakes.readRuns()).toHaveLength(0);
  });

  it('round-trips structured output with a closed, format-free schema', async () => {
    const schema = z.object({ vendor: z.string(), date: z.iso.date(), lines: z.array(z.object({ n: z.number() })) });
    const answer = { vendor: 'ACME', date: '2026-01-02', lines: [{ n: 1 }] };

    fakes.setResponses({ responses: [{ structuredOutput: answer }] });

    const result = await generateText({
      model: buildModel(),
      prompt: 'Extract',
      output: Output.object({ schema }),
      maxRetries: 0,
    });

    expect(result.output).toEqual(answer);

    const sent = fakes.getRun().schema as Record<string, any>;

    expect(sent.additionalProperties).toBe(false);
    expect(sent.properties.lines.items.additionalProperties).toBe(false);
    expect(JSON.stringify(sent)).not.toContain('"format"');
  });

  it('fails closed on a tool item', async () => {
    fakes.setScenario({ scenario: 'tool-call' });

    const error = await failureOf(ask({ model: buildModel() }));

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'temporary', httpStatus: 502 });
    expect(JSON.parse((error as { responseBody: string }).responseBody).error.type).toBe('cli_tool_use_blocked');

    await wait(800);
    expect(fakes.didRunComplete()).toBe(false);
  });

  it.each([
    ['auth', 'auth', 401],
    ['limit', 'rate-limited', 429],
    ['overloaded', 'temporary', 503],
    ['model-not-found', 'model-not-found', 404],
    ['exit-1', 'temporary', 502],
  ])('maps the %s scenario to kind %s', async (scenario, kind, httpStatus) => {
    fakes.setScenario({ scenario });

    const error = await failureOf(ask({ model: buildModel() }));

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind, httpStatus });
  });

  it('turns a usage limit into a 429, never a truncated answer', async () => {
    fakes.setScenario({ scenario: 'limit' });

    const error = await failureOf(ask({ model: buildModel() }));

    expect((error as { statusCode: number }).statusCode).toBe(429);
    expect((error as { data: { resetsAt: string } }).data.resetsAt).toEqual(expect.any(String));
  });

  it('reports a missing binary as endpoint-down and not-installed', async () => {
    process.env.AI_CLI_CODEX_PATH = '/nonexistent/codex';

    const error = await failureOf(ask({ model: buildModel() }));

    expect(classifyAiCallFailure({ error }).kind).toBe('endpoint-down');
    expect(isCliNotInstalledError({ error })).toBe(true);
  });

  it('reports an abort as an abort, not as not-installed', async () => {
    fakes.setScenario({ scenario: 'hang' });

    const controller = new AbortController();
    const promise = ask({ model: buildModel(), abortSignal: controller.signal });

    await wait(400);
    controller.abort();

    const error = await failureOf(promise);

    expect((error as Error).name).toBe('AbortError');
    expect(classifyAiCallFailure({ error: inSandboxRealm(error) }).kind).toBe('endpoint-down');
    expect(isCliNotInstalledError({ error })).toBe(false);
  });

  it('reports a run timeout as a timeout, not as not-installed', async () => {
    fakes.setScenario({ scenario: 'hang' });

    const error = await failureOf(ask({ model: buildModel({ timeoutMs: 300 }) }));

    expect((error as Error).name).toBe('TimeoutError');
    expect(classifyAiCallFailure({ error: inSandboxRealm(error) }).kind).toBe('endpoint-down');
    expect(isCliNotInstalledError({ error })).toBe(false);
  });

  it('streams the finished answer as one text chunk', async () => {
    fakes.setResponses({ responses: [{ text: 'streamed' }] });

    const result = streamText({ model: buildModel(), prompt: 'x', maxRetries: 0 });

    expect(await result.text).toBe('streamed');
  });

  describe('token refresh', () => {
    it('saves a refreshed auth.json with the revision load returned', async () => {
      fakes.setScenario({ scenario: 'refresh' });

      const { source, save, store } = buildSource();

      await ask({ model: buildModel({ source }) });

      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith({
        credential: expect.stringContaining('rt-refreshed-'),
        loadedRevision: 'rev-1',
      });
      expect(store.credential).toContain('rt-refreshed-');
    });

    it('saves the refresh also when the run then hits the usage limit', async () => {
      fakes.setScenario({ scenario: 'refresh-then-limit' });

      const { source, save } = buildSource();
      const error = await failureOf(ask({ model: buildModel({ source }) }));

      expect(classifyAiCallFailure({ error }).kind).toBe('rate-limited');
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith({
        credential: expect.stringContaining('rt-refreshed-'),
        loadedRevision: 'rev-1',
      });
    });

    it('does not save when the credential was not refreshed', async () => {
      const { source, save } = buildSource();

      await ask({ model: buildModel({ source }) });

      expect(save).not.toHaveBeenCalled();
    });

    it('lets one model instance make two calls under single-use refresh tokens', async () => {
      fakes.setScenario({ scenario: 'rotating' });

      const { source, load } = buildSource();
      const model = buildModel({ source });

      await ask({ model });
      await ask({ model });

      expect(load).toHaveBeenCalledTimes(2);
    });

    it('fails the second call as auth when it presents an already-rotated token', async () => {
      fakes.setScenario({ scenario: 'rotating' });

      const stale = buildSource();
      const staleModel = buildModel({ source: { ...stale.source, save: undefined } });

      await ask({ model: staleModel });

      const error = await failureOf(ask({ model: staleModel }));

      expect(classifyAiCallFailure({ error }).kind).toBe('auth');
    });
  });
});
