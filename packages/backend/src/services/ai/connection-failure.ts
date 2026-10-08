// Shared by every AI feature so a dead connection gets the same status and message.

import { AI_PROVIDER } from '@bt/shared/types';

import { getConnectionInfos, markConnectionInvalid } from '../user-settings/ai-connections';
import type { AIClientResult } from './ai-client-factory';
import { buildModelNotServedMessage } from './ai-error-classifiers';
import { suspendAnthropicServerKey } from './resolution-ladder';

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

  return NO_AI_CONFIGURED_ERROR_MESSAGE;
}

/** Only a custom connection can be down in a way the user fixes; a native provider outage is transient. */
export async function markCustomEndpointUnreachable({
  userId,
  aiClient,
}: {
  userId: number;
  aiClient: AIClientResult;
}): Promise<string> {
  if (aiClient.provider === AI_PROVIDER.custom && aiClient.connectionId) {
    await markConnectionInvalid({
      userId,
      connectionId: aiClient.connectionId,
      errorMessage: CUSTOM_ENDPOINT_UNREACHABLE_ERROR_MESSAGE,
    });
  }

  return CUSTOM_ENDPOINT_UNREACHABLE_ERROR_MESSAGE;
}

/** The user owns neither the key nor the model here, and the shared model serves their next run. */
const SERVER_MODEL_SUSPENDED_ERROR_MESSAGE = 'The AI model is temporarily unavailable. Please try again.';

function suspendDeadServerKey({ aiClient, message }: { aiClient: AIClientResult; message: string }): string {
  if (aiClient.usingUserKey || aiClient.provider !== AI_PROVIDER.anthropic) return message;

  suspendAnthropicServerKey({ reason: message });
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

/** Flags the connection that rejected the call and returns the copy that fits its provider. */
export async function markConnectionRejected({
  userId,
  aiClient,
}: {
  userId: number;
  aiClient: AIClientResult;
}): Promise<string> {
  const message =
    aiClient.provider === AI_PROVIDER.custom ? CUSTOM_ENDPOINT_REJECTED_ERROR_MESSAGE : INVALID_KEY_ERROR_MESSAGE;

  if (aiClient.connectionId) {
    await markConnectionInvalid({ userId, connectionId: aiClient.connectionId, errorMessage: message });
  }

  return suspendDeadServerKey({ aiClient, message });
}
