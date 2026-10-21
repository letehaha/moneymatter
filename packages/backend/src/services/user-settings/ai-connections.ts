import {
  AIConnectionInfo,
  AI_CONNECTION_NAME_MAX_LENGTH,
  AI_PROVIDER,
  CreateAIConnectionBody,
  ListAIConnectionModelsBody,
  MAX_AI_CONNECTIONS,
  TestAIConnectionBody,
  TestAIConnectionResponse,
  UpdateAIConnectionBody,
} from '@bt/shared/types';
import { decryptToken, encryptToken } from '@common/utils/encryption';
import { t } from '@i18n/index';
import { NotFoundError, TooManyRequests, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import UserSettings, {
  DEFAULT_SETTINGS,
  SettingsSchema,
  StoredAiSettings,
  StoredConnection,
} from '@models/user-settings.model';
import { randomUUID } from 'node:crypto';

import { validateConnection } from '../ai/connection-validation';
import { listConnectionModels } from '../ai/list-connection-models';
import {
  AI_PROBE_RATE_LIMIT_MAX_ATTEMPTS,
  AI_PROBE_RATE_LIMIT_WINDOW_SECONDS,
  aiProbeRateLimitKey,
} from '../ai/probe-rate-limit';
import { getCachedServedModels } from '../ai/served-models-cache';
import { RateLimitService } from '../common/rate-limit.service';
import { withTransaction } from '../common/with-transaction';
import { getOrCreateUserSettings } from './get-or-create-user-settings';

export const getStoredAiSettings = async ({ userId }: { userId: number }): Promise<StoredAiSettings | null> => {
  const userSettings = await UserSettings.findOne({ where: { userId }, attributes: ['settings'] });

  return userSettings?.settings?.ai ?? null;
};

async function readStoredConnections({ userId }: { userId: number }): Promise<StoredConnection[]> {
  return (await getStoredAiSettings({ userId }))?.connections ?? [];
}

function deriveAiSettingsState({ settings }: { settings: SettingsSchema | null | undefined }): {
  currentSettings: SettingsSchema;
  currentAiSettings: StoredAiSettings;
  existingConnections: StoredConnection[];
} {
  const currentSettings: SettingsSchema = settings ?? DEFAULT_SETTINGS;
  const currentAiSettings = currentSettings.ai ?? {};
  const existingConnections = currentAiSettings.connections ?? [];

  return { currentSettings, currentAiSettings, existingConnections };
}

async function saveAiSettings({
  userSettings,
  currentSettings,
  currentAiSettings,
  aiPatch,
}: {
  userSettings: UserSettings;
  currentSettings: SettingsSchema;
  currentAiSettings: StoredAiSettings;
  aiPatch: Partial<StoredAiSettings>;
}): Promise<void> {
  userSettings.settings = { ...currentSettings, ai: { ...currentAiSettings, ...aiPatch } };
  await userSettings.save();
}

/** Null when no key is stored, and when the stored ciphertext cannot be read. */
export function decryptConnectionKey({ connection, userId }: { connection: StoredConnection; userId: number }) {
  if (!connection.keyEncrypted) return null;

  try {
    return decryptToken(connection.keyEncrypted);
  } catch (error) {
    // Ciphertext written under a different APPLICATION_JWT_SECRET, or a mangled settings
    // blob. The user cannot cause or fix either one.
    logger.error(
      { message: 'Stored AI connection key could not be decrypted', error: error as Error },
      { userId, connectionId: connection.id },
    );

    return null;
  }
}

/**
 * Refuses to dial with a stored key whose ciphertext cannot be read. Dialling keyless would
 * report an authentication failure against a key the user never touched.
 */
function readStoredKey({ connection, userId }: { connection: StoredConnection; userId: number }): string | null {
  const apiKey = decryptConnectionKey({ connection, userId });

  if (connection.keyEncrypted && apiKey === null) {
    throw new ValidationError({ message: t({ key: 'ai.connectionStoredKeyUnreadable' }) });
  }

  return apiKey;
}

function toConnectionInfo({ connection }: { connection: StoredConnection }): AIConnectionInfo {
  return {
    id: connection.id,
    provider: connection.provider,
    name: connection.name,
    baseUrl: connection.baseUrl,
    model: connection.model,
    hasApiKey: Boolean(connection.keyEncrypted),
    createdAt: connection.createdAt,
    status: connection.status,
    lastValidatedAt: connection.lastValidatedAt,
    lastError: connection.lastError,
    invalidatedAt: connection.invalidatedAt,
  };
}

function findConnectionOrThrow({
  connections,
  connectionId,
}: {
  connections: StoredConnection[];
  connectionId: string;
}): StoredConnection {
  const connection = connections.find((candidate) => candidate.id === connectionId);

  if (!connection) {
    throw new NotFoundError({ message: t({ key: 'ai.connectionNotFound' }) });
  }

  return connection;
}

/** A stored key only ever goes to the provider it was saved for. */
function assertSameProvider({ connection, provider }: { connection: StoredConnection; provider: AI_PROVIDER }): void {
  if (connection.provider !== provider) {
    throw new ValidationError({ message: t({ key: 'ai.connectionProviderMismatch' }) });
  }
}

function assertNameAvailable({
  connections,
  name,
  ignoreId,
}: {
  connections: StoredConnection[];
  name: string;
  ignoreId?: string;
}): void {
  const wanted = name.toLowerCase();
  const taken = connections.some(
    (connection) => connection.name.toLowerCase() === wanted && (ignoreId === undefined || connection.id !== ignoreId),
  );

  if (taken) {
    throw new ValidationError({ message: t({ key: 'ai.connectionNameTaken' }) });
  }
}

function assertWithinConnectionCap({ connections }: { connections: StoredConnection[] }): void {
  if (connections.length >= MAX_AI_CONNECTIONS) {
    throw new ValidationError({
      message: t({ key: 'ai.connectionLimitReached', variables: { max: MAX_AI_CONNECTIONS } }),
    });
  }
}

function normalizeName({ name }: { name: string }): string {
  const normalized = name.trim();

  if (!normalized || normalized.length > AI_CONNECTION_NAME_MAX_LENGTH) {
    throw new ValidationError({
      message: t({ key: 'ai.connectionNameInvalidLength', variables: { max: AI_CONNECTION_NAME_MAX_LENGTH } }),
    });
  }

  return normalized;
}

function normalizeModel({ model }: { model: string }): string {
  const normalized = model.trim();

  if (!normalized) {
    throw new ValidationError({ message: t({ key: 'ai.connectionModelRequired' }) });
  }

  return normalized;
}

/**
 * `custom` needs a base URL, stored trimmed and without trailing slashes so `/v1/` and `/v1`
 * match. Native providers always dial their official API, so a base URL there is refused.
 */
function normalizeBaseUrl({ provider, baseUrl }: { provider: AI_PROVIDER; baseUrl: string | undefined }) {
  if (provider !== AI_PROVIDER.custom) {
    if (baseUrl !== undefined) {
      throw new ValidationError({ message: t({ key: 'ai.connectionBaseUrlNotAllowed' }) });
    }
    return undefined;
  }

  const normalized = baseUrl?.trim().replace(/\/+$/, '');

  if (!normalized) {
    throw new ValidationError({ message: t({ key: 'ai.connectionBaseUrlRequired' }) });
  }

  return normalized;
}

/** The ciphertext is copied verbatim: every connection encrypts with the same `encryptToken`. */
function borrowStoredKey({
  connections,
  sourceId,
  provider,
  userId,
}: {
  connections: StoredConnection[];
  sourceId: string;
  provider: AI_PROVIDER;
  userId: number;
}): { apiKey: string; keyEncrypted: string } {
  const source = findConnectionOrThrow({ connections, connectionId: sourceId });
  assertSameProvider({ connection: source, provider });

  const apiKey = readStoredKey({ connection: source, userId });

  if (!apiKey || !source.keyEncrypted) {
    throw new ValidationError({ message: t({ key: 'ai.connectionKeySourceMissing' }) });
  }

  return { apiKey, keyEncrypted: source.keyEncrypted };
}

/** Never carries key material. List order is priority. */
export const getConnectionInfos = async ({ userId }: { userId: number }): Promise<AIConnectionInfo[]> => {
  const connections = await readStoredConnections({ userId });
  return connections.map((connection) => toConnectionInfo({ connection }));
};

/** Writes a proven connection, re-checking the cap and the name against the locked row. */
const storeNewConnection = withTransaction(
  async ({ userId, connection }: { userId: number; connection: StoredConnection }): Promise<AIConnectionInfo> => {
    const [userSettings] = await getOrCreateUserSettings({ userId });
    const { currentSettings, currentAiSettings, existingConnections } = deriveAiSettingsState({
      settings: userSettings.settings,
    });

    assertWithinConnectionCap({ connections: existingConnections });
    assertNameAvailable({ connections: existingConnections, name: connection.name });

    await saveAiSettings({
      userSettings,
      currentSettings,
      currentAiSettings,
      aiPatch: { connections: [...existingConnections, connection] },
    });

    return toConnectionInfo({ connection });
  },
);

/**
 * Stores the connection only after a live call proves the provider, model and key work. The
 * probe runs before the transaction opens so it does not pin a database connection.
 */
export const createConnection = async ({
  userId,
  provider,
  name,
  model,
  baseUrl,
  apiKey,
  keyFromConnectionId,
}: { userId: number } & CreateAIConnectionBody): Promise<AIConnectionInfo> => {
  const normalizedName = normalizeName({ name });
  const normalizedModel = normalizeModel({ model });
  const normalizedBaseUrl = normalizeBaseUrl({ provider, baseUrl });

  // Fast fail before spending an outbound call on a request that cannot be saved.
  const storedConnections = await readStoredConnections({ userId });
  assertWithinConnectionCap({ connections: storedConnections });
  assertNameAvailable({ connections: storedConnections, name: normalizedName });

  const key =
    apiKey === undefined && keyFromConnectionId
      ? borrowStoredKey({ connections: storedConnections, sourceId: keyFromConnectionId, provider, userId })
      : { apiKey: apiKey ?? null, keyEncrypted: apiKey ? encryptToken(apiKey) : undefined };

  const validation = await validateConnection({
    provider,
    model: normalizedModel,
    apiKey: key.apiKey,
    baseUrl: normalizedBaseUrl,
  });

  if (!validation.isValid) {
    throw new ValidationError({ message: validation.error });
  }

  const now = new Date().toISOString();

  return storeNewConnection({
    userId,
    connection: {
      id: randomUUID(),
      provider,
      name: normalizedName,
      baseUrl: normalizedBaseUrl,
      keyEncrypted: key.keyEncrypted,
      model: normalizedModel,
      createdAt: now,
      status: 'valid',
      lastValidatedAt: now,
    },
  });
};

/**
 * Rewrites the connection list on the locked settings row and returns the new list. A
 * connection that is gone throws, or with `onMissing: 'skip'` leaves the row as it is.
 */
const mutateConnections = withTransaction(
  async ({
    userId,
    connectionId,
    onMissing,
    mutate,
  }: {
    userId: number;
    connectionId: string;
    onMissing: 'throw' | 'skip';
    mutate: (state: {
      connection: StoredConnection;
      connections: StoredConnection[];
      featureConfigs: NonNullable<StoredAiSettings['featureConfigs']>;
    }) => { connections: StoredConnection[]; featureConfigs?: StoredAiSettings['featureConfigs'] };
  }): Promise<StoredConnection[]> => {
    const userSettings = await UserSettings.findOne({ where: { userId }, lock: true });
    const { currentSettings, currentAiSettings, existingConnections } = deriveAiSettingsState({
      settings: userSettings?.settings,
    });
    const connection = existingConnections.find((candidate) => candidate.id === connectionId);

    if (!userSettings || !connection) {
      if (onMissing === 'throw') {
        throw new NotFoundError({ message: t({ key: 'ai.connectionNotFound' }) });
      }

      logger.info('Skipping AI connection update: the connection is no longer stored', { userId, connectionId });
      return existingConnections;
    }

    const aiPatch = mutate({
      connection,
      connections: existingConnections,
      featureConfigs: currentAiSettings.featureConfigs ?? [],
    });

    await saveAiSettings({ userSettings, currentSettings, currentAiSettings, aiPatch });

    return aiPatch.connections;
  },
);

/**
 * The provider never changes. Removing a key (custom only) is the one change that survives a
 * failed check: it is stored keyless and flagged invalid, because a server that demands a key
 * would reject every attempt to clear it. Every other change is only stored once it answers.
 */
export const updateConnection = async ({
  userId,
  connectionId,
  name,
  model,
  baseUrl,
  apiKey,
}: { userId: number; connectionId: string } & UpdateAIConnectionBody): Promise<AIConnectionInfo> => {
  const storedConnections = await readStoredConnections({ userId });
  const existing = findConnectionOrThrow({ connections: storedConnections, connectionId });
  const { provider } = existing;

  const normalizedName = name === undefined ? existing.name : normalizeName({ name });
  const normalizedModel = model === undefined ? existing.model : normalizeModel({ model });
  const normalizedBaseUrl = baseUrl === undefined ? existing.baseUrl : normalizeBaseUrl({ provider, baseUrl });

  assertNameAvailable({ connections: storedConnections, name: normalizedName, ignoreId: connectionId });

  if (apiKey === null && provider !== AI_PROVIDER.custom) {
    throw new ValidationError({ message: t({ key: 'ai.connectionApiKeyRequired' }) });
  }

  const keyEncrypted = apiKey === undefined ? existing.keyEncrypted : apiKey ? encryptToken(apiKey) : undefined;

  const connectionChanged =
    normalizedBaseUrl !== existing.baseUrl || normalizedModel !== existing.model || apiKey !== undefined;

  let verdict: Pick<StoredConnection, 'status' | 'lastValidatedAt' | 'lastError' | 'invalidatedAt'> = existing;

  if (connectionChanged) {
    const validation = await validateConnection({
      provider,
      model: normalizedModel,
      apiKey: apiKey === undefined ? readStoredKey({ connection: existing, userId }) : apiKey,
      baseUrl: normalizedBaseUrl,
    });
    const now = new Date().toISOString();

    if (validation.isValid) {
      verdict = { status: 'valid', lastValidatedAt: now, lastError: undefined, invalidatedAt: undefined };
    } else if (apiKey === null) {
      verdict = {
        status: 'invalid',
        lastValidatedAt: existing.lastValidatedAt,
        lastError: validation.error,
        invalidatedAt: now,
      };
    } else {
      throw new ValidationError({ message: validation.error });
    }
  }

  const patch: Partial<StoredConnection> = {
    name: normalizedName,
    baseUrl: normalizedBaseUrl,
    keyEncrypted,
    model: normalizedModel,
    status: verdict.status,
    lastValidatedAt: verdict.lastValidatedAt,
    lastError: verdict.lastError,
    invalidatedAt: verdict.invalidatedAt,
  };

  const connections = await mutateConnections({
    userId,
    connectionId,
    onMissing: 'throw',
    mutate: ({ connections: stored }) => {
      assertNameAvailable({ connections: stored, name: normalizedName, ignoreId: connectionId });

      return {
        connections: stored.map((candidate) =>
          candidate.id === connectionId ? { ...candidate, ...patch } : candidate,
        ),
      };
    },
  });

  return toConnectionInfo({ connection: findConnectionOrThrow({ connections, connectionId }) });
};

/** Features pinned to the deleted connection become automatic again. */
export const deleteConnection = async ({ userId, connectionId }: { userId: number; connectionId: string }) => {
  await mutateConnections({
    userId,
    connectionId,
    onMissing: 'throw',
    mutate: ({ connections, featureConfigs }) => ({
      connections: connections.filter((connection) => connection.id !== connectionId),
      featureConfigs: featureConfigs.filter((config) => config.connectionId !== connectionId),
    }),
  });
};

/** The first connection answers every unconfigured feature, so "default" means index 0. */
export const setDefaultConnection = async ({
  userId,
  connectionId,
}: {
  userId: number;
  connectionId: string;
}): Promise<AIConnectionInfo[]> => {
  const connections = await mutateConnections({
    userId,
    connectionId,
    onMissing: 'throw',
    mutate: ({ connection, connections: stored }) => ({
      connections: [connection, ...stored.filter((candidate) => candidate.id !== connectionId)],
    }),
  });

  return connections.map((connection) => toConnectionInfo({ connection }));
};

/**
 * With `connectionId`, omitted fields fall back to that saved connection, including its key.
 * Only an unmodified re-test records its verdict on the stored status, because that is the
 * same call real use makes; an override tried a combination the user never saved.
 */
export const testConnection = async ({
  userId,
  ...body
}: { userId: number } & TestAIConnectionBody): Promise<TestAIConnectionResponse> => {
  if (!('connectionId' in body)) {
    const { provider, apiKey, keyFromConnectionId } = body;
    const model = normalizeModel({ model: body.model });
    const baseUrl = normalizeBaseUrl({ provider, baseUrl: body.baseUrl });
    const borrowedKey =
      apiKey === undefined && keyFromConnectionId
        ? borrowStoredKey({
            connections: await readStoredConnections({ userId }),
            sourceId: keyFromConnectionId,
            provider,
            userId,
          }).apiKey
        : null;

    return validateConnection({ provider, model, baseUrl, apiKey: apiKey ?? borrowedKey });
  }

  const { connectionId, model, baseUrl, apiKey } = body;
  const saved = findConnectionOrThrow({ connections: await readStoredConnections({ userId }), connectionId });

  const result = await validateConnection({
    provider: saved.provider,
    model: normalizeModel({ model: model ?? saved.model }),
    baseUrl: baseUrl === undefined ? saved.baseUrl : normalizeBaseUrl({ provider: saved.provider, baseUrl }),
    apiKey: apiKey ?? readStoredKey({ connection: saved, userId }),
  });

  if (model === undefined && baseUrl === undefined && apiKey === undefined) {
    if (result.isValid) {
      await markConnectionValid({ userId, connectionId });
    } else {
      await markConnectionInvalid({ userId, connectionId, errorMessage: result.error });
    }
  }

  return result;
};

/** `connectionId` supplies the stored key and base URL the user didn't retype. */
export const listAvailableModels = async ({
  userId,
  provider,
  baseUrl,
  apiKey,
  connectionId,
}: { userId: number } & ListAIConnectionModelsBody): Promise<string[]> => {
  const saved = connectionId
    ? findConnectionOrThrow({ connections: await readStoredConnections({ userId }), connectionId })
    : undefined;

  if (saved) assertSameProvider({ connection: saved, provider });

  const effectiveBaseUrl = baseUrl === undefined && saved ? saved.baseUrl : normalizeBaseUrl({ provider, baseUrl });
  const effectiveApiKey = apiKey ?? (saved ? decryptConnectionKey({ connection: saved, userId }) : null);

  return listConnectionModels({ provider, baseUrl: effectiveBaseUrl, apiKey: effectiveApiKey });
};

/**
 * Spends one live probe from the user's budget, the one the connection routes share. A model pick that has
 * to probe is not behind those routes' middleware, so it takes the budget here. Fails open, like the middleware.
 */
async function spendProbeBudget({ userId }: { userId: number }): Promise<void> {
  const budget = await RateLimitService.checkRateLimit(
    aiProbeRateLimitKey({ userId }),
    AI_PROBE_RATE_LIMIT_WINDOW_SECONDS,
    AI_PROBE_RATE_LIMIT_MAX_ATTEMPTS,
  );

  if (!budget.allowed) {
    throw new TooManyRequests({
      message: t({ key: 'middleware.tooManyRequests' }),
      details: { retryAfter: budget.remainingSeconds ?? 0, resetTime: budget.resetTime?.toISOString() },
    });
  }
}

/**
 * Throws unless `connectionId` can serve `modelId`, so a feature or a chat thread never stores a model
 * the connection's provider does not offer. Returns what to store: the model, or null when it is the
 * connection's own model (always accepted: it is what the connection was validated with).
 *
 * The check reads the provider's model listing, cached for a few minutes per connection. Only a provider that
 * lists nothing gets the live probe a connection create runs, and that one is paid for, so it is spent from the
 * shared probe budget.
 */
export const assertConnectionServesModel = async ({
  userId,
  connectionId,
  modelId,
}: {
  userId: number;
  connectionId: string;
  modelId: string;
}): Promise<string | null> => {
  const connection = findConnectionOrThrow({ connections: await readStoredConnections({ userId }), connectionId });
  const model = normalizeModel({ model: modelId });

  if (model === connection.model) return null;

  const listed = await getCachedServedModels({
    key: [connection.id, connection.baseUrl ?? '', connection.keyEncrypted ?? ''].join('|'),
    load: () =>
      listConnectionModels({
        provider: connection.provider,
        baseUrl: connection.baseUrl,
        apiKey: readStoredKey({ connection, userId }),
      }),
  });

  if (listed.length > 0) {
    if (!listed.includes(model)) {
      throw new ValidationError({ message: t({ key: 'ai.connectionModelNotOffered', variables: { model } }) });
    }
    return model;
  }

  await spendProbeBudget({ userId });

  const validation = await validateConnection({
    provider: connection.provider,
    model,
    apiKey: readStoredKey({ connection, userId }),
    baseUrl: connection.baseUrl,
  });

  if (!validation.isValid) {
    throw new ValidationError({ message: validation.error });
  }

  return model;
};

async function patchConnectionStatus({
  userId,
  connectionId,
  patch,
}: {
  userId: number;
  connectionId: string;
  patch: Partial<StoredConnection>;
}): Promise<void> {
  await mutateConnections({
    userId,
    connectionId,
    onMissing: 'skip',
    mutate: ({ connections }) => ({
      connections: connections.map((connection) =>
        connection.id === connectionId ? { ...connection, ...patch } : connection,
      ),
    }),
  });
}

export const markConnectionInvalid = ({
  userId,
  connectionId,
  errorMessage,
}: {
  userId: number;
  connectionId: string;
  errorMessage: string;
}): Promise<void> =>
  patchConnectionStatus({
    userId,
    connectionId,
    patch: { status: 'invalid', lastError: errorMessage, invalidatedAt: new Date().toISOString() },
  });

export const markConnectionValid = ({ userId, connectionId }: { userId: number; connectionId: string }) =>
  patchConnectionStatus({
    userId,
    connectionId,
    patch: {
      status: 'valid',
      lastValidatedAt: new Date().toISOString(),
      lastError: undefined,
      invalidatedAt: undefined,
    },
  });
