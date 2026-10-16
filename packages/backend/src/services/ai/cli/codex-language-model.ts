import type {
  JSONSchema7,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from '@ai-sdk/provider';
import { AI_PROVIDER } from '@bt/shared/types';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCliBinaryPath } from './cli-binaries';
import { runWithCliCredential } from './cli-credential-run';
import { buildCodexEnv } from './cli-env';
import { createCliApiError, createToolUseBlockedError, CLI_ERROR_TYPE, mapCliFailure } from './cli-errors';
import { closeObjectSchemas, stripSchemaFormats } from './cli-json-schema';
import type { CliLanguageModelParams } from './cli-model-options';
import { runCliProcess } from './cli-process';
import { asCount, buildUsage, CliPrompt, extractCliPrompt, generateResultToStream } from './cli-prompt';
import { getFeatureRunTimeoutMs } from './cli-run-limiter';
import { withTempDir } from './cli-workdir';

const PROVIDER = AI_PROVIDER.codex;

/**
 * Agent tool features switched off with `--disable <name>`, verified against Codex 0.160.1 with
 * `codex features list` under an empty `CODEX_HOME`. `--disable` rejects a name the version does not
 * know, so a rename in a newer Codex fails the first run instead of silently re-enabling a tool.
 * `view_image` is the model's tool for reading local files; attachments passed with `-i` don't need it.
 * `unified_exec` stays `true` on 0.160.1 whatever is passed; the fail-closed item allowlist covers it.
 */
export const CODEX_DISABLED_FEATURES = [
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
] as const;

export const CODEX_TOOL_DISABLE_ARGS: readonly string[] = CODEX_DISABLED_FEATURES.flatMap((name) => [
  '--disable',
  name,
]);

/** `--json` item types a plain answer produces; anything else is tool activity or a type this code has not vetted. */
const ALLOWED_ITEM_TYPES = new Set(['agent_message', 'reasoning', 'error']);

/** Past this size the system prompt goes in on stdin instead of as one argv entry. */
const MAX_DEVELOPER_INSTRUCTIONS_CHARS = 100_000;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const USAGE_LIMIT_SIGNAL = /usage_limit_(?:exceeded|reached)/i;

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface CodexEvent {
  type?: string;
  message?: unknown;
  error?: { message?: unknown; type?: unknown; code?: unknown } | string;
  item?: { type?: unknown; text?: unknown; message?: unknown };
  usage?: CodexUsage;
}

/** TOML basic string (the `-c` value is parsed as TOML), which JSON escaping satisfies apart from DEL. */
const toTomlString = ({ value }: { value: string }) => JSON.stringify(value).replace(/\u007f/g, '\\u007f');

function buildCodexArgs({
  model,
  workdir,
  lastMessagePath,
  schemaPath,
  imagePaths,
  developerInstructions,
}: {
  model: string;
  workdir: string;
  lastMessagePath: string;
  schemaPath: string | undefined;
  imagePaths: string[];
  developerInstructions: string | undefined;
}): string[] {
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '-s',
    'read-only',
    '-c',
    'approval_policy="never"',
    '-c',
    'cli_auth_credentials_store="file"',
    '-c',
    'web_search="disabled"',
    '-c',
    'shell_environment_policy.inherit="none"',
    ...CODEX_TOOL_DISABLE_ARGS,
    '-m',
    model,
    '-C',
    workdir,
    '-o',
    lastMessagePath,
  ];

  if (developerInstructions)
    args.push('-c', `developer_instructions=${toTomlString({ value: developerInstructions })}`);
  if (schemaPath) args.push('--output-schema', schemaPath);

  for (const imagePath of imagePaths) args.push('-i', imagePath);

  // `-i` takes a list of values, so `--` keeps the stdin marker from being read as another image.
  args.push('--', '-');

  return args;
}

function eventErrorText({ event }: { event: CodexEvent }): string {
  const { error } = event;

  if (typeof error === 'string') return error;

  const parts = [error?.type, error?.code, error?.message ?? event.message ?? event.item?.message].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );

  return parts.join(' ');
}

function toUsage({ usage }: { usage: CodexUsage | undefined }) {
  const input = asCount(usage?.input_tokens);
  const cached = asCount(usage?.cached_input_tokens);

  return buildUsage({
    inputTotal: input,
    inputNoCache: input === undefined ? undefined : input - (cached ?? 0),
    cacheRead: cached,
    cacheWrite: undefined,
    outputTotal: asCount(usage?.output_tokens),
    reasoning: asCount(usage?.reasoning_output_tokens),
    raw: usage as Record<string, number> | undefined,
  });
}

async function readLastMessage({ lastMessagePath }: { lastMessagePath: string }): Promise<string | null> {
  try {
    const content = await readFile(lastMessagePath, 'utf8');

    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

async function runCodex({
  model,
  codexHome,
  prompt,
  schema,
  signal,
}: {
  model: string;
  codexHome: string;
  prompt: CliPrompt;
  schema: JSONSchema7 | undefined;
  signal: AbortSignal;
}): Promise<LanguageModelV3GenerateResult> {
  return withTempDir({
    prefix: 'mm-codex-run',
    run: async ({ dir }) => {
      const workdir = path.join(dir, 'work');
      const ioDir = path.join(dir, 'io');

      await mkdir(workdir, { mode: 0o700 });
      await mkdir(ioDir, { mode: 0o700 });

      const lastMessagePath = path.join(ioDir, 'last.txt');
      let schemaPath: string | undefined;

      if (schema) {
        schemaPath = path.join(ioDir, 'schema.json');
        await writeFile(schemaPath, JSON.stringify(closeObjectSchemas({ schema: stripSchemaFormats({ schema }) })));
      }

      const imagePaths: string[] = [];
      const textParts: string[] = [];

      for (const part of prompt.parts) {
        if (part.type === 'text') {
          textParts.push(part.text);
          continue;
        }

        const extension = IMAGE_EXTENSIONS[part.mediaType] ?? 'png';
        const imagePath = path.join(ioDir, `img-${imagePaths.length}.${extension}`);

        await writeFile(imagePath, Buffer.from(part.base64, 'base64'));
        imagePaths.push(imagePath);
      }

      const systemFitsArgv = prompt.system.length <= MAX_DEVELOPER_INSTRUCTIONS_CHARS;
      const stdinParts = systemFitsArgv ? textParts : [prompt.system, ...textParts].filter(Boolean);

      // `codex exec -` refuses an empty prompt, which an image-only call would otherwise send.
      if (stdinParts.length === 0) stdinParts.push('Use the attached image(s) to answer.');

      const state = {
        sawTurnCompleted: false,
        usage: undefined as CodexUsage | undefined,
        lastAgentMessage: null as string | null,
        errorTexts: [] as string[],
        turnFailedText: null as string | null,
      };

      const processResult = await runCliProcess({
        provider: PROVIDER,
        command: getCliBinaryPath({ provider: PROVIDER }),
        args: buildCodexArgs({
          model,
          workdir,
          lastMessagePath,
          schemaPath,
          imagePaths,
          developerInstructions: systemFitsArgv && prompt.system ? prompt.system : undefined,
        }),
        env: buildCodexEnv({ codexHome }),
        cwd: workdir,
        stdin: stdinParts.join('\n\n'),
        signal,
        onStdoutLine: ({ line }) => {
          let event: CodexEvent | null;

          try {
            event = JSON.parse(line);
          } catch {
            return;
          }

          if (!event || typeof event !== 'object') return;

          if (event.type?.startsWith('item.')) {
            const itemType = String(event.item?.type);

            if (!ALLOWED_ITEM_TYPES.has(itemType)) {
              throw createToolUseBlockedError({ provider: PROVIDER, detail: itemType });
            }

            if (itemType === 'error') state.errorTexts.push(eventErrorText({ event }));

            if (
              itemType === 'agent_message' &&
              event.type === 'item.completed' &&
              typeof event.item?.text === 'string'
            ) {
              state.lastAgentMessage = event.item.text;
            }

            return;
          }

          if (event.type === 'turn.completed') {
            state.sawTurnCompleted = true;
            state.usage = event.usage;
          } else if (event.type === 'turn.failed') {
            state.turnFailedText = eventErrorText({ event });
          } else if (event.type === 'error') {
            state.errorTexts.push(eventErrorText({ event }));
          }
        },
      });

      const failureText = [state.turnFailedText, ...state.errorTexts].filter(Boolean).join(' ');

      if (USAGE_LIMIT_SIGNAL.test(failureText)) {
        throw mapCliFailure({ provider: PROVIDER, text: failureText, exitCode: processResult.exitCode });
      }

      if (processResult.exitCode !== 0 || !state.sawTurnCompleted || state.turnFailedText !== null) {
        throw mapCliFailure({
          provider: PROVIDER,
          text: state.turnFailedText ?? (state.errorTexts.at(-1) || processResult.stderrTail),
          exitCode: processResult.exitCode,
        });
      }

      const text = (await readLastMessage({ lastMessagePath })) ?? state.lastAgentMessage;

      if (text === null) {
        throw createCliApiError({
          provider: PROVIDER,
          type: CLI_ERROR_TYPE.failed,
          message: 'Codex finished without a final message',
        });
      }

      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'turn.completed' },
        usage: toUsage({ usage: state.usage }),
        warnings: [],
        response: { modelId: model },
      };
    },
  });
}

/**
 * `LanguageModelV3` over `codex exec`, one process per call, on the owner's ChatGPT subscription.
 * Each call materializes the credential into a private `CODEX_HOME` through `runWithCliCredential`
 * (which persists a token refresh), so a reused instance never holds a decrypted `auth.json`.
 * Sampling settings and `maxOutputTokens` have no `codex exec` flag and are ignored.
 */
export function createCodexLanguageModel({
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
      run: ({ codexHome, signal }) => runCodex({ model, codexHome: codexHome!, prompt, schema, signal }),
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
