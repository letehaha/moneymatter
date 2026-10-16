import {
  AICliProvider,
  AIConnectionInfo,
  AI_CONNECTION_NAME_MAX_LENGTH,
  AI_PROVIDER,
  CreateAIConnectionBody,
  ListAIConnectionModelsBody,
  MAX_AI_CONNECTIONS,
  TestAIConnectionBody,
  TestAIConnectionResponse,
  UpdateAIConnectionBody,
  asAiCliProvider,
} from '@bt/shared/types';
import { decryptToken, encryptToken } from '@common/utils/encryption';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import UserSettings, {
  DEFAULT_SETTINGS,
  SettingsSchema,
  StoredAiSettings,
  StoredConnection,
} from '@models/user-settings.model';
import { randomUUID } from 'node:crypto';

import { assertCliAiAllowed } from '../ai/cli/cli-access';
import { CliCredentialSource } from '../ai/cli/cli-credential-run';
import { logoutCodexConnection } from '../ai/cli/codex-logout';
import { consumeCredential, peekCredential, sessionCredentialSource } from '../ai/cli/login/cli-auth-sessions';
import { validateCliConnection, validateConnection } from '../ai/connection-validation';
import { listConnectionModels } from '../ai/list-connection-models';
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

/**
 * A CLI connection's credential as a source the CLI runner loads inside the connection's slot. The
 * row is read fresh and decrypted per run, so no caller holds a decrypted CLI credential, and a
 * Codex refresh a previous run persisted is what the next run starts from.
 */
export function connectionCredentialSource({
  userId,
  connectionId,
}: {
  userId: number;
  connectionId: string;
}): CliCredentialSource {
  return {
    connectionKey: connectionId,
    load: async () => {
      const connection = findConnectionOrThrow({
        connections: await readStoredConnections({ userId }),
        connectionId,
      });
      const credential = readStoredKey({ connection, userId });

      if (!credential || !connection.keyEncrypted) {
        throw new ValidationError({ message: t({ key: 'ai.connectionStoredKeyUnreadable' }) });
      }

      return { credential, revision: connection.keyEncrypted };
    },
    save: ({ credential, loadedRevision }) =>
      replaceConnectionCredential({
        userId,
        connectionId,
        expectedKeyEncrypted: loadedRevision,
        keyEncrypted: encryptToken(credential),
      }),
  };
}

/**
 * Swaps the stored credential only while it still is the ciphertext the caller started from;
 * anything else means a newer credential (a re-authentication) was written in between and wins.
 */
export function swapConnectionCredential({
  connections,
  connectionId,
  expectedKeyEncrypted,
  keyEncrypted,
}: {
  connections: StoredConnection[];
  connectionId: string;
  expectedKeyEncrypted: string;
  keyEncrypted: string;
}): { connections: StoredConnection[]; swapped: boolean } {
  const current = connections.find((candidate) => candidate.id === connectionId);

  if (!current || current.keyEncrypted !== expectedKeyEncrypted) return { connections, swapped: false };

  return {
    connections: connections.map((candidate) =>
      candidate.id === connectionId ? { ...candidate, keyEncrypted } : candidate,
    ),
    swapped: true,
  };
}

/**
 * Persists a credential the CLI refreshed during a run as a compare-and-swap on `keyEncrypted`.
 * A connection deleted mid-run is not resurrected, and a credential replaced mid-run is kept.
 */
export async function replaceConnectionCredential({
  userId,
  connectionId,
  expectedKeyEncrypted,
  keyEncrypted,
}: {
  userId: number;
  connectionId: string;
  expectedKeyEncrypted: string;
  keyEncrypted: string;
}): Promise<void> {
  await mutateConnections({
    userId,
    connectionId,
    onMissing: 'skip',
    mutate: ({ connections }) => {
      const result = swapConnectionCredential({ connections, connectionId, expectedKeyEncrypted, keyEncrypted });

      if (!result.swapped) {
        logger.warn('Skipped saving a refreshed CLI credential: the stored credential changed during the run', {
          userId,
          connectionId,
        });
      }

      return { connections: result.connections };
    },
  });
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
    credentialExpiresAt: connection.credentialExpiresAt,
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

/** A CLI connection's credential comes only from a sign-in session; a typed key has nowhere to go. */
function assertNoApiKeyForCli({
  apiKey,
  keyFromConnectionId,
}: {
  apiKey?: string | null;
  keyFromConnectionId?: string;
}): void {
  if (apiKey !== undefined || keyFromConnectionId !== undefined) {
    throw new ValidationError({ message: t({ key: 'ai.cliConnectionNoApiKey' }) });
  }
}

function assertCliSessionOnlyForCli({ cliAuthSessionId }: { cliAuthSessionId: string | undefined }): void {
  if (cliAuthSessionId !== undefined) {
    throw new ValidationError({ message: t({ key: 'ai.cliAuthSessionOnlyForCli' }) });
  }
}

/**
 * Probes with the session's credential. With `consume`, the session is spent while the probe still
 * holds its slot, and only when the probe passed, so a failed probe (wrong model) leaves the
 * session usable for a retry. Returns the credential taken from the session, if consumed.
 */
async function probeWithSession({
  userId,
  provider,
  model,
  cliAuthSessionId,
  consume,
}: {
  userId: number;
  provider: AICliProvider;
  model: string;
  cliAuthSessionId: string;
  consume: boolean;
}): Promise<{
  validation: TestAIConnectionResponse;
  credential?: { keyEncrypted: string; credentialExpiresAt?: string };
}> {
  // Fails fast on a session that is missing, foreign, unfinished, consumed or for another provider.
  peekCredential({ userId, sessionId: cliAuthSessionId, provider });

  let credential: { keyEncrypted: string; credentialExpiresAt?: string } | undefined;

  const validation = await validateCliConnection({
    provider,
    model,
    credentialSource: sessionCredentialSource({ userId, sessionId: cliAuthSessionId, provider }),
    onValid: consume
      ? () => {
          credential = consumeCredential({ userId, sessionId: cliAuthSessionId, provider });
        }
      : undefined,
  });

  return { validation, credential };
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
 * A CLI connection stores the credential of a finished sign-in session, taken out of the session
 * once the probe has passed.
 */
async function createCliConnection({
  userId,
  provider,
  name,
  model,
  cliAuthSessionId,
}: {
  userId: number;
  provider: AICliProvider;
  name: string;
  model: string;
  cliAuthSessionId: string | undefined;
}): Promise<AIConnectionInfo> {
  if (!cliAuthSessionId) {
    throw new ValidationError({ message: t({ key: 'ai.cliAuthSessionNotUsable' }) });
  }

  const { validation, credential } = await probeWithSession({
    userId,
    provider,
    model,
    cliAuthSessionId,
    consume: true,
  });

  if (!validation.isValid) {
    throw new ValidationError({ message: validation.error });
  }

  if (!credential) {
    throw new ValidationError({ message: t({ key: 'ai.cliAuthSessionNotUsable' }) });
  }

  const now = new Date().toISOString();

  return storeNewConnection({
    userId,
    connection: {
      id: randomUUID(),
      provider,
      name,
      keyEncrypted: credential.keyEncrypted,
      credentialExpiresAt: credential.credentialExpiresAt,
      model,
      createdAt: now,
      status: 'valid',
      lastValidatedAt: now,
    },
  });
}

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
  cliAuthSessionId,
}: { userId: number } & CreateAIConnectionBody): Promise<AIConnectionInfo> => {
  const cliProvider = asAiCliProvider({ provider });

  if (cliProvider) {
    await assertCliAiAllowed({ userId });
    assertNoApiKeyForCli({ apiKey, keyFromConnectionId });
  } else {
    assertCliSessionOnlyForCli({ cliAuthSessionId });
  }

  const normalizedName = normalizeName({ name });
  const normalizedModel = normalizeModel({ model });
  const normalizedBaseUrl = normalizeBaseUrl({ provider, baseUrl });

  // Fast fail before spending an outbound call on a request that cannot be saved.
  const storedConnections = await readStoredConnections({ userId });
  assertWithinConnectionCap({ connections: storedConnections });
  assertNameAvailable({ connections: storedConnections, name: normalizedName });

  if (cliProvider) {
    return createCliConnection({
      userId,
      provider: cliProvider,
      name: normalizedName,
      model: normalizedModel,
      cliAuthSessionId,
    });
  }

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
  cliAuthSessionId,
}: { userId: number; connectionId: string } & UpdateAIConnectionBody): Promise<AIConnectionInfo> => {
  const storedConnections = await readStoredConnections({ userId });
  const existing = findConnectionOrThrow({ connections: storedConnections, connectionId });
  const { provider } = existing;
  const cliProvider = asAiCliProvider({ provider });

  if (cliProvider) {
    await assertCliAiAllowed({ userId });
    assertNoApiKeyForCli({ apiKey });
  } else {
    assertCliSessionOnlyForCli({ cliAuthSessionId });
  }

  const normalizedName = name === undefined ? existing.name : normalizeName({ name });
  const normalizedModel = model === undefined ? existing.model : normalizeModel({ model });
  const normalizedBaseUrl = baseUrl === undefined ? existing.baseUrl : normalizeBaseUrl({ provider, baseUrl });

  assertNameAvailable({ connections: storedConnections, name: normalizedName, ignoreId: connectionId });

  if (apiKey === null && provider !== AI_PROVIDER.custom) {
    throw new ValidationError({ message: t({ key: 'ai.connectionApiKeyRequired' }) });
  }

  const connectionChanged =
    normalizedBaseUrl !== existing.baseUrl ||
    normalizedModel !== existing.model ||
    apiKey !== undefined ||
    cliAuthSessionId !== undefined;

  let verdict: Pick<StoredConnection, 'status' | 'lastValidatedAt' | 'lastError' | 'invalidatedAt'> = existing;
  let reauthCredential: { keyEncrypted: string; credentialExpiresAt?: string } | undefined;

  if (connectionChanged) {
    let validation: TestAIConnectionResponse;

    if (cliProvider && cliAuthSessionId !== undefined) {
      // Re-authentication: the new sign-in is probed, then spent while the probe holds its slot.
      const probe = await probeWithSession({
        userId,
        provider: cliProvider,
        model: normalizedModel,
        cliAuthSessionId,
        consume: true,
      });

      validation = probe.validation;
      reauthCredential = probe.credential;
    } else if (cliProvider) {
      validation = await validateCliConnection({
        provider: cliProvider,
        model: normalizedModel,
        credentialSource: connectionCredentialSource({ userId, connectionId }),
      });
    } else {
      validation = await validateConnection({
        provider,
        model: normalizedModel,
        apiKey: apiKey === undefined ? readStoredKey({ connection: existing, userId }) : apiKey,
        baseUrl: normalizedBaseUrl,
      });
    }

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

  if (cliAuthSessionId !== undefined && !reauthCredential) {
    throw new ValidationError({ message: t({ key: 'ai.cliAuthSessionNotUsable' }) });
  }

  // The key goes into the patch only when this request supplied one. Otherwise the locked row's
  // key stays as it is, so a refresh that a probe or a concurrent run persisted since the read
  // above is never overwritten with the stale value.
  const credentialPatch: Partial<StoredConnection> = reauthCredential
    ? { keyEncrypted: reauthCredential.keyEncrypted, credentialExpiresAt: reauthCredential.credentialExpiresAt }
    : apiKey === undefined
      ? {}
      : { keyEncrypted: apiKey ? encryptToken(apiKey) : undefined };

  const patch: Partial<StoredConnection> = {
    name: normalizedName,
    baseUrl: normalizedBaseUrl,
    ...credentialPatch,
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

/**
 * Features pinned to the deleted connection become automatic again. A Codex connection is signed
 * out first, best effort, so the tokens it held stop working; Claude Code has no CLI revoke.
 */
export const deleteConnection = async ({ userId, connectionId }: { userId: number; connectionId: string }) => {
  const stored = (await readStoredConnections({ userId })).find((connection) => connection.id === connectionId);

  if (stored?.provider === AI_PROVIDER.codex && stored.keyEncrypted) {
    const { connectionKey, load } = connectionCredentialSource({ userId, connectionId });

    // No `save`: logging out invalidates the stored credential, so there is nothing to write back.
    await logoutCodexConnection({ source: { connectionKey, load } });
  }

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
    const { provider, apiKey, keyFromConnectionId, cliAuthSessionId } = body;
    const cliProvider = asAiCliProvider({ provider });

    if (cliProvider) {
      await assertCliAiAllowed({ userId });
      assertNoApiKeyForCli({ apiKey, keyFromConnectionId });
    } else {
      assertCliSessionOnlyForCli({ cliAuthSessionId });
    }

    const model = normalizeModel({ model: body.model });
    const baseUrl = normalizeBaseUrl({ provider, baseUrl: body.baseUrl });

    if (cliProvider) {
      if (!cliAuthSessionId) {
        throw new ValidationError({ message: t({ key: 'ai.cliAuthSessionNotUsable' }) });
      }

      // Never consumes: the same sign-in is still there for the save that follows a passing test.
      return (await probeWithSession({ userId, provider: cliProvider, model, cliAuthSessionId, consume: false }))
        .validation;
    }
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

  const { connectionId, model, baseUrl, apiKey, cliAuthSessionId } = body;
  const saved = findConnectionOrThrow({ connections: await readStoredConnections({ userId }), connectionId });
  const savedCliProvider = asAiCliProvider({ provider: saved.provider });

  if (savedCliProvider) {
    await assertCliAiAllowed({ userId });
    assertNoApiKeyForCli({ apiKey });
  } else {
    assertCliSessionOnlyForCli({ cliAuthSessionId });
  }

  const probeModel = normalizeModel({ model: model ?? saved.model });
  const probeBaseUrl = baseUrl === undefined ? saved.baseUrl : normalizeBaseUrl({ provider: saved.provider, baseUrl });

  let result: TestAIConnectionResponse;

  if (savedCliProvider) {
    // The stored credential is probed through its own slot, so the probe queues behind a running job
    // and a Codex refresh it triggers is persisted. A fresh sign-in is tried without being spent.
    result =
      cliAuthSessionId === undefined
        ? await validateCliConnection({
            provider: savedCliProvider,
            model: probeModel,
            credentialSource: connectionCredentialSource({ userId, connectionId }),
          })
        : (
            await probeWithSession({
              userId,
              provider: savedCliProvider,
              model: probeModel,
              cliAuthSessionId,
              consume: false,
            })
          ).validation;
  } else {
    result = await validateConnection({
      provider: saved.provider,
      model: probeModel,
      baseUrl: probeBaseUrl,
      apiKey: apiKey ?? readStoredKey({ connection: saved, userId }),
    });
  }

  if (model === undefined && baseUrl === undefined && apiKey === undefined && cliAuthSessionId === undefined) {
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

  // A CLI provider lists its curated models; its stored credential is never decrypted for that.
  if (asAiCliProvider({ provider })) return listConnectionModels({ provider, apiKey: null });

  const effectiveBaseUrl = baseUrl === undefined && saved ? saved.baseUrl : normalizeBaseUrl({ provider, baseUrl });
  const effectiveApiKey = apiKey ?? (saved ? decryptConnectionKey({ connection: saved, userId }) : null);

  return listConnectionModels({ provider, baseUrl: effectiveBaseUrl, apiKey: effectiveApiKey });
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
