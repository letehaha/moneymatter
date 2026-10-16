// Shared by every AI feature so a dead connection gets the same status and message.

import { AI_PROVIDER, type AICliProvider, asAiCliProvider, hasServerAiEntitlement } from '@bt/shared/types';
import { t } from '@i18n/index';
import { APICallError } from 'ai';

import { getEntitlementsByUserId } from '../entitlements/resolve-entitlements.service';
import { getConnectionInfos, markConnectionInvalid } from '../user-settings/ai-connections';
import { isWithinAiAllowance } from './ai-allowance';
import type { AIClientResult } from './ai-client-factory';
import { buildModelNotServedMessage } from './ai-error-classifiers';
import { CLI_PROVIDER_LABEL, isCliNotInstalledError } from './cli/cli-errors';
import { PRIMARY_SERVER_MODEL, suspendPrimaryServerKey } from './resolution-ladder';

/** Not translated: it surfaces in job error lists, where no request locale is available. */
const CUSTOM_ENDPOINT_UNREACHABLE_ERROR_MESSAGE =
  'Your custom AI endpoint did not respond. Check that the server is running and reachable, then reconnect it in AI settings.';

/**
 * Stored when a connection's key is missing or its ciphertext fails to decrypt (an
 * APPLICATION_JWT_SECRET rotation). The provider itself may be healthy, so the copy points at the key.
 */
export const CONNECTION_KEY_UNREADABLE_ERROR_MESSAGE =
  'The API key for this AI model is missing or can no longer be read. Enter the key again in Settings → AI.';

/** A local endpoint often has no key at all, so credits and permissions are the wrong advice there. */
const CUSTOM_ENDPOINT_REJECTED_ERROR_MESSAGE =
  'Your custom AI endpoint rejected the request. Please verify its URL, model name, and API key in AI settings.';

const INVALID_KEY_ERROR_MESSAGE =
  'API key is not working. Please verify the key is correct, has sufficient credits, and has the required permissions.';

/** Nothing in the ladder yielded credentials: no connection and no server model. */
const NO_AI_CONFIGURED_ERROR_MESSAGE = 'No AI model configured. Add one in Settings → AI.';

const AI_ALLOWANCE_REACHED_ERROR_MESSAGE =
  "You've used the AI included in your plan this month. Connect your own model in Settings → AI to keep going.";

/** The CLI is part of the backend image, so the fix is on the operator's side, not a key the user can re-enter. */
function buildCliNotInstalledMessage({ provider }: { provider: AICliProvider }): string {
  return `The ${CLI_PROVIDER_LABEL[provider]} CLI is not installed in the backend image. Update the image, then sign in again in Settings → AI.`;
}

/**
 * A user whose every connection is flagged down does own credentials, so telling them to add
 * a model would send them to the wrong screen.
 */
export async function describeMissingAiConfiguration({ userId }: { userId: number }): Promise<string> {
  const connections = await getConnectionInfos({ userId });
  const dialable = connections.find((connection) => connection.status !== 'invalid');
  const first = connections[0];

  if (!dialable && first) {
    return first.lastError ?? CUSTOM_ENDPOINT_UNREACHABLE_ERROR_MESSAGE;
  }

  const entitlements = await getEntitlementsByUserId({ userId });
  if (hasServerAiEntitlement({ entitlements }) && !(await isWithinAiAllowance({ userId, entitlements }))) {
    return AI_ALLOWANCE_REACHED_ERROR_MESSAGE;
  }

  return NO_AI_CONFIGURED_ERROR_MESSAGE;
}

/**
 * A custom endpoint that stopped answering and a missing CLI binary are the two "endpoint down" outcomes the
 * user or operator can fix. Every other one is transient: a native provider outage, and on CLI providers also
 * aborts, run timeouts and queue-ceiling expiries, which would flag a healthy subscription connection if
 * they counted.
 */
export function isUserFixableEndpointDown({ provider, error }: { provider: AI_PROVIDER; error: unknown }): boolean {
  return provider === AI_PROVIDER.custom || isCliNotInstalledError({ error });
}

/** Flags a custom endpoint or a CLI connection that cannot run, and returns the copy that fits its provider. */
export async function markEndpointUnreachable({
  userId,
  aiClient,
}: {
  userId: number;
  aiClient: AIClientResult;
}): Promise<string> {
  const cliProvider = asAiCliProvider({ provider: aiClient.provider });
  const message = cliProvider
    ? buildCliNotInstalledMessage({ provider: cliProvider })
    : CUSTOM_ENDPOINT_UNREACHABLE_ERROR_MESSAGE;

  if ((cliProvider || aiClient.provider === AI_PROVIDER.custom) && aiClient.connectionId) {
    await markConnectionInvalid({ userId, connectionId: aiClient.connectionId, errorMessage: message });
  }

  return message;
}

/** The user owns neither the key nor the model here, and the shared model serves their next run. */
const SERVER_MODEL_SUSPENDED_ERROR_MESSAGE = 'The AI model is temporarily unavailable. Please try again.';

function suspendDeadServerKey({ aiClient, message }: { aiClient: AIClientResult; message: string }): string {
  if (aiClient.usingUserKey || aiClient.provider !== PRIMARY_SERVER_MODEL.provider) return message;

  suspendPrimaryServerKey({ reason: message });
  return SERVER_MODEL_SUSPENDED_ERROR_MESSAGE;
}

/** A saved model passed the live check, so the provider has since dropped or renamed it. */
export async function markModelNotServed({
  userId,
  aiClient,
}: {
  userId: number;
  aiClient: AIClientResult;
}): Promise<string> {
  const message = buildModelNotServedMessage({ modelId: aiClient.modelId });

  if (aiClient.connectionId) {
    await markConnectionInvalid({ userId, connectionId: aiClient.connectionId, errorMessage: message });
  }

  return suspendDeadServerKey({ aiClient, message });
}

function buildRejectedMessage({ provider }: { provider: AI_PROVIDER }): string {
  if (provider === AI_PROVIDER.custom) return CUSTOM_ENDPOINT_REJECTED_ERROR_MESSAGE;

  const cliProvider = asAiCliProvider({ provider });
  if (cliProvider) {
    return `Your ${CLI_PROVIDER_LABEL[cliProvider]} sign-in is no longer valid. Sign in again in Settings → AI.`;
  }

  return INVALID_KEY_ERROR_MESSAGE;
}

/** Flags the connection that rejected the call and returns the copy that fits its provider. */
export async function markConnectionRejected({
  userId,
  aiClient,
}: {
  userId: number;
  aiClient: AIClientResult;
}): Promise<string> {
  const message = buildRejectedMessage({ provider: aiClient.provider });

  if (aiClient.connectionId) {
    await markConnectionInvalid({ userId, connectionId: aiClient.connectionId, errorMessage: message });
  }

  return suspendDeadServerKey({ aiClient, message });
}

/** `YYYY-MM-DD HH:mm UTC`: the message has no request locale or timezone to format against. */
function formatResetTime({ resetsAt }: { resetsAt: unknown }): string | null {
  if (typeof resetsAt !== 'string') return null;

  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;

  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * A subscription has a usage window rather than a per-minute limit, so the copy names the subscription and,
 * when the CLI reported it, when the window resets. `cause` is the unwrapped error from `classifyAiCallFailure`.
 */
export function describeRateLimited({ aiClient, cause }: { aiClient: AIClientResult; cause: Error }): string {
  const cliProvider = asAiCliProvider({ provider: aiClient.provider });
  if (!cliProvider) return t({ key: 'importExport.aiRateLimited' });

  const label = CLI_PROVIDER_LABEL[cliProvider];
  const data = cause instanceof APICallError ? (cause.data as { resetsAt?: unknown } | undefined) : undefined;
  const resetTime = formatResetTime({ resetsAt: data?.resetsAt });

  return resetTime
    ? t({ key: 'importExport.aiSubscriptionLimitResetsAt', variables: { label, resetTime } })
    : t({ key: 'importExport.aiSubscriptionLimitReached', variables: { label } });
}
