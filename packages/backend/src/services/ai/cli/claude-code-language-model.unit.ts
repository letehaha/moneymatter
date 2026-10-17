import { AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';
import { FakeCliResponse, useFakeAiClis } from '@tests/helpers/ai-cli';
import { generateText, Output, streamText } from 'ai';
import { UnsupportedFunctionalityError } from 'ai';
import { z } from 'zod';

import { classifyAiCallFailure } from '../ai-error-classifiers';
import { createClaudeCodeLanguageModel } from './claude-code-language-model';
import { CliCredentialSource } from './cli-credential-run';
import { isCliNotInstalledError } from './cli-errors';

jest.mock('@js/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const fakes = useFakeAiClis();

let counter = 0;

const buildModel = ({ model = 'sonnet', timeoutMs }: { model?: string; timeoutMs?: number } = {}) => {
  counter += 1;

  const load = jest.fn(async () => ({ credential: 'sk-ant-oat01-fake-token-value', revision: 'rev-1' }));
  const credentialSource: CliCredentialSource = { connectionKey: `claude-model-test-${counter}`, load };

  return { load, model: createClaudeCodeLanguageModel({ model, credentialSource, runOptions: { timeoutMs } }) };
};

const ask = ({ model, abortSignal }: { model: ReturnType<typeof buildModel>['model']; abortSignal?: AbortSignal }) =>
  generateText({ model, system: 'Be brief.', prompt: 'What is 2+2?', maxRetries: 0, abortSignal });

const failureOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error).not.toBeNull();

  return error;
};

/**
 * jest's sandbox has its own `Error`, so a DOMException from the host realm is not `instanceof Error`
 * there, which the classifiers require. In the real runtime it is, so the test re-wraps it by name.
 */
const inSandboxRealm = (error: unknown) => Object.assign(new Error('abort'), { name: (error as Error).name });

describe('claude code language model', () => {
  it('answers from the result event and maps usage', async () => {
    fakes.setResponses({ responses: [{ text: '4' }] });

    const result = await ask({ model: buildModel().model });

    expect(result.text).toBe('4');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.inputTokens).toBe(16);
    expect(result.usage.outputTokens).toBe(7);
  });

  it('runs hardened: no tools, no settings, no session, never --bare, scrubbed env', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api-should-not-leak';

    try {
      await ask({ model: buildModel({ model: 'opus' }).model });
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    const run = fakes.getRun();
    const { argv } = run;

    expect(argv[argv.indexOf('--tools') + 1]).toBe('');
    expect(argv[argv.indexOf('--setting-sources') + 1]).toBe('');
    expect(argv[argv.indexOf('--model') + 1]).toBe('opus');
    expect(argv[argv.indexOf('--system-prompt') + 1]).toBe('Be brief.');
    expect(argv).toEqual(expect.arrayContaining(['--no-session-persistence', '--strict-mcp-config', '--verbose']));
    expect(argv).not.toContain('--bare');
    expect(argv).not.toContain('--json-schema');
    expect(run.envKeys).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(run.envKeys).not.toContain('ANTHROPIC_API_KEY');
    expect(run.envKeys).not.toContain('APPLICATION_JWT_SECRET');
    expect(run.cwd).toMatch(/mm-claude-run-.+\/work$/);
  });

  it('sends the prompt as one stream-json user message with base64 images', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 1, 2, 3]);

    await generateText({
      model: buildModel().model,
      maxRetries: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read this statement' },
            { type: 'file', data: new Uint8Array(bytes), mediaType: 'image/png' },
          ],
        },
      ],
    });

    const message = JSON.parse(fakes.getRun().stdin);

    expect(message.type).toBe('user');
    expect(message.message.content[0]).toEqual({ type: 'text', text: 'Read this statement' });
    expect(message.message.content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') },
    });
  });

  it('refuses non-image file parts before starting a process', async () => {
    const error = await failureOf(
      generateText({
        model: buildModel().model,
        maxRetries: 0,
        messages: [
          { role: 'user', content: [{ type: 'file', data: new Uint8Array([1]), mediaType: 'application/pdf' }] },
        ],
      }),
    );

    expect(error).toBeInstanceOf(UnsupportedFunctionalityError);
    expect(fakes.readRuns()).toHaveLength(0);
  });

  it('round-trips structured output through the StructuredOutput tool_use and the result event', async () => {
    const schema = z.object({ vendor: z.string(), date: z.iso.date(), total: z.number() });
    const answer = { vendor: 'ACME', date: '2026-01-02', total: 12.5 };

    fakes.setResponses({ responses: [{ structuredOutput: answer }] });

    const result = await generateText({
      model: buildModel().model,
      prompt: 'Extract',
      output: Output.object({ schema }),
      maxRetries: 0,
    });

    expect(result.output).toEqual(answer);

    const { argv } = fakes.getRun();
    const sent = argv[argv.indexOf('--json-schema') + 1]!;

    expect(JSON.parse(sent).properties.vendor).toEqual({ type: 'string' });
    expect(sent).not.toContain('"format"');
  });

  it('fails a schema run whose result lacks structured_output as a 502 cli_failed', async () => {
    fakes.setScenario({ scenario: 'no-structured-output' });

    const error = await failureOf(
      generateText({
        model: buildModel().model,
        prompt: 'Extract',
        output: Output.object({ schema: z.object({ a: z.string() }) }),
        maxRetries: 0,
      }),
    );

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'temporary', httpStatus: 502 });
  });

  it.each([
    ['tool-call', false],
    ['tool-call-with-schema', true],
    ['structured-output-unrequested', false],
    ['structured-output-twice', true],
  ])('fails closed on the %s scenario', async (scenario, withSchema) => {
    fakes.setScenario({ scenario });

    const { model } = buildModel();
    const error = await failureOf(
      withSchema
        ? generateText({
            model,
            prompt: 'x',
            output: Output.object({ schema: z.object({ a: z.number() }) }),
            maxRetries: 0,
          })
        : ask({ model }),
    );

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind: 'temporary', httpStatus: 502 });
    expect(JSON.parse((error as { responseBody: string }).responseBody).error.type).toBe('cli_tool_use_blocked');

    // The run settles only after the child closed, so a killed fake can no longer complete.
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

    const error = await failureOf(ask({ model: buildModel().model }));

    expect(classifyAiCallFailure({ error })).toMatchObject({ kind, httpStatus });
  });

  it('carries the CLI message of an unmapped exit', async () => {
    fakes.setScenario({ scenario: 'exit-1' });

    const error = await failureOf(ask({ model: buildModel().model }));

    expect((error as Error).message).toContain('something broke');
  });

  it('treats the fake-rate-limit model as a subscription limit', async () => {
    const error = await failureOf(ask({ model: buildModel({ model: 'fake-rate-limit' }).model }));

    expect(classifyAiCallFailure({ error }).kind).toBe('rate-limited');
    expect((error as { data: { resetsAt: string } }).data.resetsAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it('reports a missing binary as endpoint-down and not-installed', async () => {
    process.env.AI_CLI_CLAUDE_PATH = '/nonexistent/claude';

    const error = await failureOf(ask({ model: buildModel().model }));

    expect(classifyAiCallFailure({ error }).kind).toBe('endpoint-down');
    expect(isCliNotInstalledError({ error })).toBe(true);
  });

  it('reports an abort as endpoint-down, not not-installed', async () => {
    fakes.setScenario({ scenario: 'hang' });

    const controller = new AbortController();
    const promise = ask({ model: buildModel().model, abortSignal: controller.signal });

    await fakes.waitForRun();
    controller.abort();

    const error = await failureOf(promise);

    expect((error as Error).name).toBe('AbortError');
    expect(classifyAiCallFailure({ error: inSandboxRealm(error) }).kind).toBe('endpoint-down');
    expect(isCliNotInstalledError({ error })).toBe(false);
  });

  it('reports a run timeout as endpoint-down, not not-installed', async () => {
    fakes.setScenario({ scenario: 'hang' });

    const error = await failureOf(ask({ model: buildModel({ timeoutMs: 300 }).model }));

    expect((error as Error).name).toBe('TimeoutError');
    expect(classifyAiCallFailure({ error: inSandboxRealm(error) }).kind).toBe('endpoint-down');
    expect(isCliNotInstalledError({ error })).toBe(false);
  });

  it('loads the credential on every call', async () => {
    const { model, load } = buildModel();

    await ask({ model });
    await ask({ model });

    expect(load).toHaveBeenCalledTimes(2);
    expect(fakes.readRuns()).toHaveLength(2);
  });

  it('streams the finished answer as one text chunk', async () => {
    const responses: FakeCliResponse[] = [{ text: 'streamed' }];

    fakes.setResponses({ responses });

    const result = streamText({ model: buildModel().model, prompt: 'x', maxRetries: 0 });

    expect(await result.text).toBe('streamed');
    expect(AI_PROVIDER.claudeCode).toBe('claude-code');
  });
});
