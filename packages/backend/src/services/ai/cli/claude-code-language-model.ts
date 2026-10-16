import type {
  JSONSchema7,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
} from '@ai-sdk/provider';
import { AI_PROVIDER } from '@bt/shared/types';
import { mkdir } from 'fs/promises';
import path from 'path';

import { getCliBinaryPath } from './cli-binaries';
import { runWithCliCredential } from './cli-credential-run';
import { buildClaudeEnv } from './cli-env';
import { createCliApiError, createToolUseBlockedError, CLI_ERROR_TYPE, mapCliFailure } from './cli-errors';
import { stripSchemaFormats } from './cli-json-schema';
import type { CliLanguageModelParams } from './cli-model-options';
import { runCliProcess } from './cli-process';
import { asCount, buildUsage, CliPrompt, extractCliPrompt, generateResultToStream } from './cli-prompt';
import { getFeatureRunTimeoutMs } from './cli-run-limiter';
import { withTempDir } from './cli-workdir';

const PROVIDER = AI_PROVIDER.claudeCode;

/** Name of the built-in tool the CLI uses to deliver `--json-schema` output. */
const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';

const MAX_TURNS = '3';
const DEFAULT_SYSTEM_PROMPT = 'You are a precise assistant. Answer only with what was asked for.';

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ClaudeResultEvent {
  type: 'result';
  subtype?: string;
  is_error?: boolean;
  api_error_status?: number | null;
  result?: unknown;
  errors?: unknown;
  structured_output?: unknown;
  usage?: ClaudeUsage;
}

interface ClaudeStreamEvent {
  type?: string;
  message?: { content?: unknown };
}

function buildStdinMessage({ prompt }: { prompt: CliPrompt }): string {
  const content = prompt.parts.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.base64 } },
  );

  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

export function buildClaudeArgs({
  model,
  system,
  schema,
}: {
  model: string;
  system: string;
  schema: JSONSchema7 | undefined;
}): string[] {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    model,
    '--system-prompt',
    system || DEFAULT_SYSTEM_PROMPT,
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns',
    MAX_TURNS,
  ];

  if (schema) args.push('--json-schema', JSON.stringify(stripSchemaFormats({ schema })));

  return args;
}

/**
 * Fails closed on tools: with `--tools ""` the model has none, so any `tool_use` block means the
 * hardening did not hold. The one exception is the CLI's own `StructuredOutput` call on a run that
 * passed `--json-schema`, once; it executes nothing and the answer is read from the `result` event.
 */
function createToolGuard({ hasSchema }: { hasSchema: boolean }) {
  let structuredOutputCalls = 0;

  return ({ event }: { event: ClaudeStreamEvent }) => {
    if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) return;

    for (const block of event.message.content as { type?: unknown; name?: unknown }[]) {
      if (typeof block?.type !== 'string' || !block.type.endsWith('tool_use')) continue;

      const name = typeof block.name === 'string' ? block.name : 'unknown';

      if (name === STRUCTURED_OUTPUT_TOOL && hasSchema && block.type === 'tool_use') {
        structuredOutputCalls += 1;

        if (structuredOutputCalls > 1) {
          throw createToolUseBlockedError({ provider: PROVIDER, detail: `${STRUCTURED_OUTPUT_TOOL} called twice` });
        }

        continue;
      }

      throw createToolUseBlockedError({
        provider: PROVIDER,
        detail: name === STRUCTURED_OUTPUT_TOOL ? `${STRUCTURED_OUTPUT_TOOL} without a schema` : name,
      });
    }
  };
}

function resultErrorText({ event }: { event: ClaudeResultEvent }): string {
  if (typeof event.result === 'string' && event.result) return event.result;

  if (Array.isArray(event.errors)) {
    return event.errors.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('; ');
  }

  return '';
}

function toUsage({ usage }: { usage: ClaudeUsage | undefined }) {
  const input = asCount(usage?.input_tokens);
  const cacheRead = asCount(usage?.cache_read_input_tokens);
  const cacheWrite = asCount(usage?.cache_creation_input_tokens);

  return buildUsage({
    inputTotal: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    inputNoCache: input,
    cacheRead,
    cacheWrite,
    outputTotal: asCount(usage?.output_tokens),
    reasoning: undefined,
    raw: usage as Record<string, number> | undefined,
  });
}

async function runClaude({
  model,
  credential,
  prompt,
  schema,
  signal,
}: {
  model: string;
  credential: string;
  prompt: CliPrompt;
  schema: JSONSchema7 | undefined;
  signal: AbortSignal;
}): Promise<LanguageModelV3GenerateResult> {
  return withTempDir({
    prefix: 'mm-claude-run',
    run: async ({ dir }) => {
      const home = path.join(dir, 'home');
      const cwd = path.join(dir, 'work');

      await mkdir(home, { mode: 0o700 });
      await mkdir(cwd, { mode: 0o700 });

      const guardTools = createToolGuard({ hasSchema: Boolean(schema) });
      const seen: { result: ClaudeResultEvent | null } = { result: null };

      const processResult = await runCliProcess({
        provider: PROVIDER,
        command: getCliBinaryPath({ provider: PROVIDER }),
        args: buildClaudeArgs({ model, system: prompt.system, schema }),
        env: buildClaudeEnv({ token: credential, home }),
        cwd,
        stdin: buildStdinMessage({ prompt }),
        signal,
        onStdoutLine: ({ line }) => {
          let event: (ClaudeStreamEvent & Partial<ClaudeResultEvent>) | null;

          try {
            event = JSON.parse(line);
          } catch {
            return;
          }

          if (!event || typeof event !== 'object') return;

          guardTools({ event });

          if (event.type === 'result') seen.result = event as ClaudeResultEvent;
        },
      });

      if (!seen.result) {
        throw mapCliFailure({
          provider: PROVIDER,
          text: processResult.stderrTail,
          exitCode: processResult.exitCode,
        });
      }

      return toGenerateResult({ event: seen.result, schema, model });
    },
  });
}

function toGenerateResult({
  event,
  schema,
  model,
}: {
  event: ClaudeResultEvent;
  schema: JSONSchema7 | undefined;
  model: string;
}): LanguageModelV3GenerateResult {
  const hitMaxTurns = event.subtype === 'error_max_turns';

  if (!hitMaxTurns && (event.is_error === true || (event.subtype && event.subtype !== 'success'))) {
    throw mapCliFailure({
      provider: PROVIDER,
      text: resultErrorText({ event }),
      apiErrorStatus: event.api_error_status,
    });
  }

  let text: string;

  if (schema) {
    if (event.structured_output === undefined || event.structured_output === null) {
      throw createCliApiError({
        provider: PROVIDER,
        type: CLI_ERROR_TYPE.failed,
        message: 'Claude Code finished without the structured output that was requested',
      });
    }

    text = JSON.stringify(event.structured_output);
  } else {
    text = typeof event.result === 'string' ? event.result : '';
  }

  const finishReason: LanguageModelV3FinishReason = hitMaxTurns
    ? { unified: 'other', raw: event.subtype }
    : { unified: 'stop', raw: event.subtype };

  return {
    content: [{ type: 'text', text }],
    finishReason,
    usage: toUsage({ usage: event.usage }),
    warnings: [],
    response: { modelId: model },
  };
}

/**
 * `LanguageModelV3` over the Claude Code CLI, one process per call, on the owner's subscription.
 * Sampling settings and `maxOutputTokens` have no CLI flag and are ignored. The credential comes
 * from `credentialSource` on every call, so a reused instance never holds a decrypted token.
 */
export function createClaudeCodeLanguageModel({
  model,
  credentialSource,
  runOptions,
}: CliLanguageModelParams): LanguageModelV3 {
  const doGenerate = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
    const prompt = extractCliPrompt({ options });
    const schema = options.responseFormat?.type === 'json' ? options.responseFormat.schema : undefined;

    return runWithCliCredential({
      provider: PROVIDER,
      source: credentialSource,
      abortSignal: options.abortSignal,
      timeoutMs: runOptions?.timeoutMs ?? getFeatureRunTimeoutMs(),
      maxWaitMs: runOptions?.maxWaitMs,
      beforeRelease: runOptions?.beforeRelease,
      run: ({ credential, signal }) => runClaude({ model, credential, prompt, schema, signal }),
    });
  };

  return {
    specificationVersion: 'v3',
    provider: PROVIDER,
    modelId: model,
    supportedUrls: {},
    doGenerate,
    doStream: (options) => generateResultToStream({ generate: () => doGenerate(options) }),
  };
}
