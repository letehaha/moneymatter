import { AI_PROVIDER, AICliProvider } from '@bt/shared/types';
import { APICallError } from 'ai';

import { unwrapRetryError } from '../ai-error-classifiers';

const MAX_MESSAGE_LENGTH = 500;

export const CLI_PROVIDER_LABEL: Record<AICliProvider, string> = {
  [AI_PROVIDER.claudeCode]: 'Claude Code',
  [AI_PROVIDER.codex]: 'Codex',
};

/** Distinguishes the synthetic failures in the JSON body (`error.type`). */
export const CLI_ERROR_TYPE = {
  auth: 'authentication_failed',
  limit: 'usage_limit_reached',
  modelNotFound: 'model_not_found',
  overloaded: 'overloaded',
  failed: 'cli_failed',
  toolUseBlocked: 'cli_tool_use_blocked',
} as const;

type CliErrorType = (typeof CLI_ERROR_TYPE)[keyof typeof CLI_ERROR_TYPE];

const STATUS_BY_TYPE: Record<CliErrorType, number> = {
  [CLI_ERROR_TYPE.auth]: 401,
  [CLI_ERROR_TYPE.limit]: 429,
  [CLI_ERROR_TYPE.modelNotFound]: 404,
  [CLI_ERROR_TYPE.overloaded]: 503,
  [CLI_ERROR_TYPE.failed]: 502,
  [CLI_ERROR_TYPE.toolUseBlocked]: 502,
};

const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[redacted]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[redacted-jwt]'],
  [/("?(?:refresh|access|id)_token"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1[redacted]'],
];

/** Strips token-shaped strings from CLI output before it reaches a message, log or response body. */
export function redactCliSecrets({ text }: { text: string }): string {
  return SECRET_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

function sanitizeMessage({ text }: { text: string }): string {
  const clean = redactCliSecrets({ text }).replace(/\s+/g, ' ').trim();

  return clean.length > MAX_MESSAGE_LENGTH ? `${clean.slice(0, MAX_MESSAGE_LENGTH)}…` : clean;
}

/**
 * Every CLI failure is an `APICallError` with a synthetic status and a JSON body, so the shared
 * classifiers (`classifyAiCallFailure`) and feature switches treat it like an HTTP API answer.
 */
export function createCliApiError({
  provider,
  type,
  message,
  data,
  cause,
}: {
  provider: AICliProvider;
  type: CliErrorType;
  message: string;
  data?: unknown;
  cause?: unknown;
}): APICallError {
  const safeMessage = sanitizeMessage({ text: message }) || `${CLI_PROVIDER_LABEL[provider]} run failed`;

  return new APICallError({
    message: safeMessage,
    url: `cli://${provider}`,
    requestBodyValues: {},
    statusCode: STATUS_BY_TYPE[type],
    responseBody: JSON.stringify({ error: { type, message: safeMessage } }),
    isRetryable: false,
    data,
    cause,
  });
}

/**
 * The binary is not on disk: the one CLI failure with no status, which `isConnectionError` reads as
 * `endpoint-down`. The feature switches single it out as the user-fixable case.
 */
export class CliNotInstalledError extends APICallError {
  readonly provider: AICliProvider;

  constructor({ provider, cause }: { provider: AICliProvider; cause: unknown }) {
    super({
      message: `The ${CLI_PROVIDER_LABEL[provider]} CLI is not installed`,
      url: `cli://${provider}`,
      requestBodyValues: {},
      isRetryable: false,
      cause,
    });

    this.name = 'CliNotInstalledError';
    this.provider = provider;
  }
}

export function isCliNotInstalledError({ error }: { error: unknown }): boolean {
  return unwrapRetryError({ error }) instanceof CliNotInstalledError;
}

/** A spawn failure: `ENOENT` is a missing binary, anything else a generic failed run. */
export function mapSpawnError({ provider, error }: { provider: AICliProvider; error: unknown }): APICallError {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return new CliNotInstalledError({ provider, cause: error });
  }

  const reason = error instanceof Error ? error.message : String(error);

  return createCliApiError({
    provider,
    type: CLI_ERROR_TYPE.failed,
    message: `The ${CLI_PROVIDER_LABEL[provider]} CLI could not be started: ${reason}`,
    cause: error,
  });
}

export function createToolUseBlockedError({
  provider,
  detail,
}: {
  provider: AICliProvider;
  detail: string;
}): APICallError {
  return createCliApiError({
    provider,
    type: CLI_ERROR_TYPE.toolUseBlocked,
    message: `The ${CLI_PROVIDER_LABEL[provider]} run was stopped because the model tried to use a tool (${detail})`,
  });
}

const AUTH_PATTERN =
  /not logged in|please run \/login|invalid[_ ]grant|oauth token has expired|token (?:has )?expired|authentication[_ ]failed|authentication_error|failed to authenticate|invalid (?:x-)?api[_ ]key|invalid bearer token|unauthorized|refresh_token_failed|refresh token (?:was )?(?:already )?(?:used|reused|revoked|expired)|access token could not be refreshed|\b401\b/i;

const LIMIT_PATTERN =
  /usage[_ ]limit|rate[_ ]limit|limit reached|quota[_ ]exceeded|too many requests|hit your (?:usage )?limit|\b429\b/i;

const MODEL_PATTERN =
  /model_not_found|selected model|unknown model|invalid model|model\b.{0,80}\b(?:not found|not supported|does not exist|not available|may not exist)/i;

const OVERLOADED_PATTERN = /overloaded|server_overloaded|\b529\b|\b503\b/i;

/** Claude prints `Claude AI usage limit reached|<epoch seconds>`; Codex embeds `resets_in_seconds` / `resets_at` in its error JSON. */
function parseResetTime({ text }: { text: string }): Date | null {
  const claudeEpoch = /limit reached\|(\d{9,13})/i.exec(text);

  if (claudeEpoch) {
    const raw = Number(claudeEpoch[1]);

    return new Date(raw < 1e11 ? raw * 1000 : raw);
  }

  const resetsAt = /"?resets_at"?\s*[:=]\s*"?(\d{9,13})/i.exec(text);

  if (resetsAt) {
    const raw = Number(resetsAt[1]);

    return new Date(raw < 1e11 ? raw * 1000 : raw);
  }

  const resetsIn = /"?resets_in_seconds"?\s*[:=]\s*"?(\d+)/i.exec(text);

  if (resetsIn) return new Date(Date.now() + Number(resetsIn[1]) * 1000);

  return null;
}

/**
 * Maps the text a failed CLI run left behind (its `result`/`error` message, stderr tail) to the
 * synthetic HTTP-shaped error of Technical Details → Error mapping. `apiErrorStatus` is the upstream
 * HTTP status Claude reports on its `result` event, when it has one.
 */
export function mapCliFailure({
  provider,
  text,
  apiErrorStatus,
  exitCode,
}: {
  provider: AICliProvider;
  text: string;
  apiErrorStatus?: number | null;
  exitCode?: number | null;
}): APICallError {
  const label = CLI_PROVIDER_LABEL[provider];
  const body = text.trim();

  if (apiErrorStatus === 401 || AUTH_PATTERN.test(body)) {
    return createCliApiError({
      provider,
      type: CLI_ERROR_TYPE.auth,
      message: body || `${label} is not signed in`,
    });
  }

  if (apiErrorStatus === 429 || LIMIT_PATTERN.test(body)) {
    const resetsAt = parseResetTime({ text: body });
    const suffix = resetsAt ? ` (resets at ${resetsAt.toISOString()})` : '';

    return createCliApiError({
      provider,
      type: CLI_ERROR_TYPE.limit,
      message: `${label} usage limit reached${suffix}`,
      data: resetsAt ? { resetsAt: resetsAt.toISOString() } : undefined,
    });
  }

  if (MODEL_PATTERN.test(body) || (apiErrorStatus === 404 && /model/i.test(body))) {
    return createCliApiError({
      provider,
      type: CLI_ERROR_TYPE.modelNotFound,
      message: body || `${label} does not serve this model`,
    });
  }

  if (apiErrorStatus === 529 || apiErrorStatus === 503 || OVERLOADED_PATTERN.test(body)) {
    return createCliApiError({
      provider,
      type: CLI_ERROR_TYPE.overloaded,
      message: body || `${label} is overloaded`,
    });
  }

  const fallback =
    exitCode === undefined || exitCode === null
      ? `The ${label} CLI run failed`
      : `The ${label} CLI exited with code ${exitCode}`;

  return createCliApiError({
    provider,
    type: CLI_ERROR_TYPE.failed,
    message: body ? `${fallback}: ${body}` : fallback,
  });
}
