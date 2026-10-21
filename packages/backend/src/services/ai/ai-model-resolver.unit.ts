import { AI_FEATURE, AI_PROVIDER, type Entitlements, FEATURES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { StoredAiSettings, StoredConnection } from '@models/user-settings.model';

import { getEntitlementsByUserId } from '../entitlements/resolve-entitlements.service';
import { decryptConnectionKey, getStoredAiSettings, markConnectionInvalid } from '../user-settings/ai-connections';
import { isWithinAiAllowance } from './ai-allowance';
import { resolveAIConfiguration } from './ai-model-resolver';
import { CONNECTION_KEY_UNREADABLE_ERROR_MESSAGE } from './connection-failure';
import { FALLBACK_SERVER_MODELS, PRIMARY_SERVER_MODEL, buildConnectionModelId } from './resolution-ladder';

jest.mock('../entitlements/resolve-entitlements.service', () => ({ getEntitlementsByUserId: jest.fn() }));
jest.mock('./ai-allowance', () => ({ isWithinAiAllowance: jest.fn() }));
jest.mock('../user-settings/ai-connections', () => ({
  getStoredAiSettings: jest.fn(),
  decryptConnectionKey: jest.fn(),
  markConnectionInvalid: jest.fn(),
}));
jest.mock('@js/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Its default model is a Google one, so GEMINI_API_KEY is what backs the server arm here.
const FEATURE = AI_FEATURE.categorization;
const USER_ID = 1;
const NOW = new Date().toISOString();
const SERVER_KEY_ENV_VARS = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY'] as const;

const getEntitlementsMock = jest.mocked(getEntitlementsByUserId);
const isWithinAiAllowanceMock = jest.mocked(isWithinAiAllowance);
const getStoredAiSettingsMock = jest.mocked(getStoredAiSettings);
const decryptConnectionKeyMock = jest.mocked(decryptConnectionKey);
const markConnectionInvalidMock = jest.mocked(markConnectionInvalid);

const CLAUDE: StoredConnection = {
  id: 'conn-claude',
  provider: AI_PROVIDER.anthropic,
  name: 'Claude',
  keyEncrypted: 'ciphertext',
  model: 'claude-sonnet-5',
  createdAt: NOW,
  status: 'valid',
  lastValidatedAt: NOW,
};

const OLLAMA: StoredConnection = {
  id: 'conn-ollama',
  provider: AI_PROVIDER.custom,
  name: 'Ollama',
  baseUrl: 'http://ollama.lan/v1',
  model: 'llama3.2',
  createdAt: NOW,
  status: 'valid',
  lastValidatedAt: NOW,
};

function storeSettings({ connections, featureConfigs = [] }: Partial<StoredAiSettings>): void {
  getStoredAiSettingsMock.mockResolvedValue({ connections, featureConfigs });
}

function grantEntitlements(overrides: Partial<Entitlements> = {}): void {
  getEntitlementsMock.mockResolvedValue({
    features: [],
    readOnly: false,
    seats: 5,
    plan: null,
    trialEndsAt: null,
    budgetPlanTrialEndsAt: null,
    subscriptions: [],
    trialUsage: {},
    featureTrials: {},
    ...overrides,
  });
}

describe('resolveAIConfiguration', () => {
  const envBeforeTest = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of SERVER_KEY_ENV_VARS) envBeforeTest.set(name, process.env[name]);
    process.env.GEMINI_API_KEY = 'server-key';
    delete process.env.ANTHROPIC_API_KEY;
    getStoredAiSettingsMock.mockResolvedValue(null);
    isWithinAiAllowanceMock.mockResolvedValue(true);
    grantEntitlements();
  });

  afterEach(() => {
    for (const name of SERVER_KEY_ENV_VARS) {
      const value = envBeforeTest.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    jest.resetAllMocks();
  });

  it('leaves the feature unserved when the user lacks operator_ai', async () => {
    expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toBeNull();
  });

  describe('server model', () => {
    beforeEach(() => {
      grantEntitlements({ features: [FEATURES.operator_ai] });
    });

    it('serves the primary Anthropic model once ANTHROPIC_API_KEY is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'anthropic-key';

      expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toMatchObject({
        kind: 'server',
        modelId: buildConnectionModelId(PRIMARY_SERVER_MODEL),
        apiKey: 'anthropic-key',
        usingUserKey: false,
      });
    });

    it('leaves the server model unserved over the AI allowance, but still dials a user connection', async () => {
      isWithinAiAllowanceMock.mockResolvedValue(false);

      expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toBeNull();

      storeSettings({ connections: [CLAUDE] });
      decryptConnectionKeyMock.mockReturnValue('user-key');

      expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toMatchObject({
        kind: 'connection',
        connectionId: CLAUDE.id,
        usingUserKey: true,
      });
    });
  });

  it('serves the same user from the server key once operator_ai is granted', async () => {
    grantEntitlements({ features: [FEATURES.operator_ai] });

    expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toMatchObject({
      kind: 'server',
      modelId: buildConnectionModelId(FALLBACK_SERVER_MODELS[FEATURE]!),
      apiKey: 'server-key',
      usingUserKey: false,
    });
  });

  it('serves tracker matching from the server key only with smart_tracking, not operator_ai', async () => {
    const feature = AI_FEATURE.trackerMatching;
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    grantEntitlements({ features: [FEATURES.operator_ai] });

    expect(await resolveAIConfiguration({ userId: USER_ID, feature })).toBeNull();

    grantEntitlements({ features: [FEATURES.smart_tracking] });

    expect(await resolveAIConfiguration({ userId: USER_ID, feature })).toMatchObject({
      kind: 'server',
      usingUserKey: false,
    });
  });

  it('dials a native connection with its decrypted key and a provider/model id', async () => {
    storeSettings({ connections: [CLAUDE] });
    decryptConnectionKeyMock.mockReturnValue('user-key');

    expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toEqual({
      kind: 'connection',
      provider: AI_PROVIDER.anthropic,
      model: 'claude-sonnet-5',
      modelId: 'anthropic/claude-sonnet-5',
      apiKey: 'user-key',
      connectionId: CLAUDE.id,
      usingUserKey: true,
    });
  });

  describe('model override', () => {
    beforeEach(() => {
      decryptConnectionKeyMock.mockReturnValue('user-key');
    });

    it('dials the stored override on the configured connection, keeping its credentials', async () => {
      storeSettings({
        connections: [OLLAMA, CLAUDE],
        featureConfigs: [{ feature: FEATURE, connectionId: CLAUDE.id, modelId: 'claude-haiku-5-5' }],
      });

      expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toEqual({
        kind: 'connection',
        provider: AI_PROVIDER.anthropic,
        model: 'claude-haiku-5-5',
        modelId: 'anthropic/claude-haiku-5-5',
        modelOverridden: true,
        apiKey: 'user-key',
        connectionId: CLAUDE.id,
        usingUserKey: true,
      });
    });

    it('does not carry the override over to another connection when the configured one cannot be dialled', async () => {
      storeSettings({
        connections: [CLAUDE, OLLAMA],
        featureConfigs: [{ feature: FEATURE, connectionId: CLAUDE.id, modelId: 'claude-haiku-5-5' }],
      });
      decryptConnectionKeyMock.mockReturnValue(null);

      const resolution = await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE });

      expect(resolution).toMatchObject({ connectionId: OLLAMA.id, model: 'llama3.2' });
      expect(resolution).not.toHaveProperty('modelOverridden');
    });

    it('lets a pinned connection carry its own model, which a chat thread uses', async () => {
      storeSettings({ connections: [OLLAMA, CLAUDE] });

      expect(
        await resolveAIConfiguration({
          userId: USER_ID,
          feature: AI_FEATURE.chat,
          pinnedConnectionId: CLAUDE.id,
          pinnedModelId: 'claude-opus-5',
        }),
      ).toMatchObject({ connectionId: CLAUDE.id, model: 'claude-opus-5', modelOverridden: true });
    });

    it('runs on the connection model when no override is stored', async () => {
      storeSettings({
        connections: [CLAUDE],
        featureConfigs: [{ feature: FEATURE, connectionId: CLAUDE.id }],
      });

      const resolution = await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE });

      expect(resolution).toMatchObject({ model: CLAUDE.model });
      expect(resolution).not.toHaveProperty('modelOverridden');
    });
  });

  it('dials a keyless custom connection at its base URL', async () => {
    storeSettings({ connections: [OLLAMA] });
    decryptConnectionKeyMock.mockReturnValue(null);

    expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toMatchObject({
      kind: 'connection',
      provider: AI_PROVIDER.custom,
      modelId: 'custom/llama3.2',
      baseUrl: OLLAMA.baseUrl,
      apiKey: null,
    });
  });

  it('flags a connection whose key no longer decrypts and moves on to the next one', async () => {
    storeSettings({ connections: [CLAUDE, OLLAMA] });
    decryptConnectionKeyMock.mockReturnValue(null);

    expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toMatchObject({
      connectionId: OLLAMA.id,
    });
    expect(markConnectionInvalidMock).toHaveBeenCalledWith({
      userId: USER_ID,
      connectionId: CLAUDE.id,
      errorMessage: CONNECTION_KEY_UNREADABLE_ERROR_MESSAGE,
    });
  });

  // A connection restored from a backup has no key and already carries its own message.
  it('keeps the message of an already-flagged keyless connection the user picked', async () => {
    const restored = { ...CLAUDE, keyEncrypted: undefined, status: 'invalid' as const, lastError: 'from backup' };
    storeSettings({
      connections: [restored, OLLAMA],
      featureConfigs: [{ feature: FEATURE, connectionId: restored.id }],
    });
    decryptConnectionKeyMock.mockReturnValue(null);

    expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toMatchObject({
      connectionId: OLLAMA.id,
    });
    expect(markConnectionInvalidMock).not.toHaveBeenCalled();
  });

  it('never falls back to the server key when every connection is down', async () => {
    grantEntitlements({ features: [FEATURES.operator_ai] });
    storeSettings({ connections: [{ ...CLAUDE, status: 'invalid' }] });

    expect(await resolveAIConfiguration({ userId: USER_ID, feature: FEATURE })).toBeNull();
  });
});
