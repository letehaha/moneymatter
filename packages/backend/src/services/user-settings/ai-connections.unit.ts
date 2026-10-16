import { AI_PROVIDER } from '@bt/shared/types';
import { decryptToken, encryptToken } from '@common/utils/encryption';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { logger } from '@js/utils/logger';
import UserSettings, { type StoredConnection } from '@models/user-settings.model';

import { connectionCredentialSource, replaceConnectionCredential, swapConnectionCredential } from './ai-connections';

jest.mock('@js/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../common/with-transaction', () => ({ withTransaction: (fn: unknown) => fn }));
jest.mock('./get-or-create-user-settings', () => ({ getOrCreateUserSettings: jest.fn() }));
jest.mock('../ai/connection-validation', () => ({ validateCliConnection: jest.fn(), validateConnection: jest.fn() }));
jest.mock('../ai/list-connection-models', () => ({ listConnectionModels: jest.fn() }));
jest.mock('../ai/cli/cli-access', () => ({ assertCliAiAllowed: jest.fn() }));
jest.mock('../ai/cli/codex-logout', () => ({ logoutCodexConnection: jest.fn() }));
jest.mock('../ai/cli/login/cli-auth-sessions', () => ({
  consumeCredential: jest.fn(),
  peekCredential: jest.fn(),
  sessionCredentialSource: jest.fn(),
}));
jest.mock('@models/user-settings.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
  DEFAULT_SETTINGS: {},
}));

const USER_ID = 7;
const NOW = new Date().toISOString();
const AUTH_JSON = '{"tokens":{"refresh_token":"rt-1"}}';

const findOneMock = jest.mocked(UserSettings.findOne) as unknown as jest.Mock<(options: unknown) => Promise<unknown>>;

function buildConnection({ id, keyEncrypted }: { id: string; keyEncrypted?: string }): StoredConnection {
  return {
    id,
    provider: AI_PROVIDER.codex,
    name: `Connection ${id}`,
    keyEncrypted,
    model: 'gpt-6-astra',
    createdAt: NOW,
    status: 'valid',
    lastValidatedAt: NOW,
  };
}

/** The locked settings row the service reads and saves. */
function stubSettingsRow({ connections }: { connections: StoredConnection[] }) {
  const row = {
    settings: { ai: { connections } } as { ai: { connections: StoredConnection[] } },
    save: jest.fn(async () => undefined),
  };

  findOneMock.mockResolvedValue(row);

  return row;
}

describe('swapConnectionCredential', () => {
  const connections = [
    buildConnection({ id: 'a', keyEncrypted: 'old' }),
    buildConnection({ id: 'b', keyEncrypted: 'other' }),
  ];

  it('swaps the key of the connection that still holds the expected ciphertext', () => {
    const result = swapConnectionCredential({
      connections,
      connectionId: 'a',
      expectedKeyEncrypted: 'old',
      keyEncrypted: 'new',
    });

    expect(result.swapped).toBe(true);
    expect(result.connections.map((connection) => connection.keyEncrypted)).toEqual(['new', 'other']);
  });

  it('leaves everything alone when a newer credential replaced the expected one', () => {
    const result = swapConnectionCredential({
      connections,
      connectionId: 'a',
      expectedKeyEncrypted: 'stale',
      keyEncrypted: 'new',
    });

    expect(result).toEqual({ connections, swapped: false });
  });

  it('leaves everything alone for a connection that is gone', () => {
    const result = swapConnectionCredential({
      connections,
      connectionId: 'gone',
      expectedKeyEncrypted: 'old',
      keyEncrypted: 'new',
    });

    expect(result).toEqual({ connections, swapped: false });
  });
});

describe('replaceConnectionCredential', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes the refreshed credential while the row still holds the loaded ciphertext', async () => {
    const row = stubSettingsRow({ connections: [buildConnection({ id: 'a', keyEncrypted: 'loaded' })] });

    await replaceConnectionCredential({
      userId: USER_ID,
      connectionId: 'a',
      expectedKeyEncrypted: 'loaded',
      keyEncrypted: 'refreshed',
    });

    expect(row.save).toHaveBeenCalledTimes(1);
    expect(row.settings.ai.connections[0]!.keyEncrypted).toBe('refreshed');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps a credential a re-authentication wrote in between and logs it without key material', async () => {
    const row = stubSettingsRow({ connections: [buildConnection({ id: 'a', keyEncrypted: 'reauthenticated' })] });

    await replaceConnectionCredential({
      userId: USER_ID,
      connectionId: 'a',
      expectedKeyEncrypted: 'loaded',
      keyEncrypted: 'refreshed',
    });

    expect(row.settings.ai.connections[0]!.keyEncrypted).toBe('reauthenticated');
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { userId: USER_ID, connectionId: 'a' });
  });

  it('does not resurrect a connection deleted mid-run', async () => {
    const row = stubSettingsRow({ connections: [buildConnection({ id: 'other', keyEncrypted: 'loaded' })] });

    await replaceConnectionCredential({
      userId: USER_ID,
      connectionId: 'a',
      expectedKeyEncrypted: 'loaded',
      keyEncrypted: 'refreshed',
    });

    expect(row.save).not.toHaveBeenCalled();
    expect(row.settings.ai.connections.map((connection) => connection.id)).toEqual(['other']);
  });
});

describe('connectionCredentialSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const readStoredRow = ({ connections }: { connections: StoredConnection[] }) =>
    findOneMock.mockResolvedValue({ settings: { ai: { connections } } });

  it('keys the slot by the connection id and loads the freshly decrypted credential with its ciphertext as revision', async () => {
    const keyEncrypted = encryptToken(AUTH_JSON);
    readStoredRow({ connections: [buildConnection({ id: 'a', keyEncrypted })] });

    const source = connectionCredentialSource({ userId: USER_ID, connectionId: 'a' });

    expect(source.connectionKey).toBe('a');
    expect(await source.load()).toEqual({ credential: AUTH_JSON, revision: keyEncrypted });
  });

  it('reads the row again on every load, so a persisted refresh is what the next run starts from', async () => {
    const first = encryptToken(AUTH_JSON);
    const second = encryptToken('{"tokens":{"refresh_token":"rt-2"}}');
    const source = connectionCredentialSource({ userId: USER_ID, connectionId: 'a' });

    readStoredRow({ connections: [buildConnection({ id: 'a', keyEncrypted: first })] });
    expect((await source.load()).revision).toBe(first);

    readStoredRow({ connections: [buildConnection({ id: 'a', keyEncrypted: second })] });
    expect(await source.load()).toEqual({ credential: '{"tokens":{"refresh_token":"rt-2"}}', revision: second });
  });

  it('refuses a connection without a stored credential', async () => {
    readStoredRow({ connections: [buildConnection({ id: 'a' })] });

    await expect(connectionCredentialSource({ userId: USER_ID, connectionId: 'a' }).load()).rejects.toThrow();
  });

  it('refuses a stored credential that no longer decrypts instead of running without one', async () => {
    readStoredRow({ connections: [buildConnection({ id: 'a', keyEncrypted: 'not-a-ciphertext' })] });

    await expect(connectionCredentialSource({ userId: USER_ID, connectionId: 'a' }).load()).rejects.toThrow();
  });

  it('saves a refresh as a compare-and-swap against the revision it loaded', async () => {
    const loaded = encryptToken(AUTH_JSON);
    const row = {
      settings: { ai: { connections: [buildConnection({ id: 'a', keyEncrypted: loaded })] } },
      save: jest.fn(async () => undefined),
    };
    findOneMock.mockResolvedValue(row);

    const source = connectionCredentialSource({ userId: USER_ID, connectionId: 'a' });
    await source.save!({ credential: '{"tokens":{"refresh_token":"rt-2"}}', loadedRevision: loaded });

    const stored = row.settings.ai.connections[0]!.keyEncrypted!;

    expect(stored).not.toBe(loaded);
    expect(decryptToken(stored)).toBe('{"tokens":{"refresh_token":"rt-2"}}');
  });
});
