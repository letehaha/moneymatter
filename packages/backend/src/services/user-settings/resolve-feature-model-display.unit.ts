import { AIFeatureConfig, AI_FEATURE, AI_PROVIDER } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { StoredConnection } from '@models/user-settings.model';

import type { ModelProfile } from '../ai/model-catalog';
import { PLUS_SERVER_MODELS, SERVER_MODELS } from '../ai/resolution-ladder';
import { resolveFeatureStatus } from './resolve-feature-model-display';

const mockSonnetProfile: ModelProfile = {
  name: 'Claude Sonnet 5',
  contextWindow: 1_000_000,
  pricing: { inputPerMillion: 2, outputPerMillion: 10 },
  capabilities: { inputs: ['text', 'image', 'pdf'], maxOutputTokens: 64_000, structuredOutput: true },
};

jest.mock('../ai/model-catalog', () => ({
  getModelProfile: jest.fn(async ({ provider, model }: { provider: string; model: string }) =>
    `${provider}/${model}` === 'anthropic/claude-sonnet-5'
      ? mockSonnetProfile
      : { name: model, contextWindow: null, pricing: null, capabilities: null },
  ),
}));

const SERVER_KEY_ENV_VARS = ['GEMINI_API_KEY', 'ANTHROPIC_PLUS_API_KEY'] as const;

const FEATURE = AI_FEATURE.categorization;
const SERVER_MODEL = SERVER_MODELS[FEATURE];
const NOW = new Date().toISOString();

const OLLAMA: StoredConnection = {
  id: 'conn-ollama',
  provider: AI_PROVIDER.custom,
  name: 'Home Ollama',
  baseUrl: 'https://ollama.home.lan/v1',
  model: 'llama3.2',
  createdAt: NOW,
  status: 'valid',
  lastValidatedAt: NOW,
};

const CLAUDE: StoredConnection = {
  id: 'conn-claude',
  provider: AI_PROVIDER.anthropic,
  name: 'Claude smart',
  keyEncrypted: 'ciphertext',
  model: 'claude-sonnet-5',
  createdAt: NOW,
  status: 'valid',
  lastValidatedAt: NOW,
};

function status({
  connections = [],
  config,
  serverKeysAllowed = true,
  paidPlus = false,
}: {
  connections?: StoredConnection[];
  config?: AIFeatureConfig;
  serverKeysAllowed?: boolean;
  paidPlus?: boolean;
} = {}) {
  return resolveFeatureStatus({
    feature: FEATURE,
    aiSettings: { connections, featureConfigs: config ? [config] : [] },
    serverKeysAllowed,
    paidPlus,
  });
}

describe('resolveFeatureStatus', () => {
  const envBeforeTest = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const envVar of SERVER_KEY_ENV_VARS) {
      envBeforeTest.set(envVar, process.env[envVar]);
      delete process.env[envVar];
    }
  });

  afterEach(() => {
    for (const envVar of SERVER_KEY_ENV_VARS) {
      const value = envBeforeTest.get(envVar);
      if (value === undefined) delete process.env[envVar];
      else process.env[envVar] = value;
    }
  });

  it('names the Plus model for a paying Plus user only', async () => {
    process.env.GEMINI_API_KEY = 'server-key';
    process.env.ANTHROPIC_PLUS_API_KEY = 'anthropic-plus-key';
    const plusModelName = PLUS_SERVER_MODELS[FEATURE]!.model;

    expect(await status({ paidPlus: true })).toMatchObject({
      modelName: plusModelName,
      serverModelName: plusModelName,
    });
    expect(await status()).toMatchObject({ modelName: SERVER_MODEL.model, serverModelName: SERVER_MODEL.model });
  });

  it('names the configured connection with its catalog model name and price', async () => {
    expect(
      await status({ connections: [OLLAMA, CLAUDE], config: { feature: FEATURE, connectionId: CLAUDE.id } }),
    ).toEqual({
      feature: FEATURE,
      isConfigured: true,
      configuredConnectionId: CLAUDE.id,
      servedBy: 'connection',
      modelId: 'anthropic/claude-sonnet-5',
      modelName: mockSonnetProfile.name,
      pricing: mockSonnetProfile.pricing,
      capabilities: mockSonnetProfile.capabilities,
      usingUserKey: true,
      connectionId: CLAUDE.id,
      connectionName: CLAUDE.name,
      serverModelName: null,
    });
  });

  it('names the default connection for an unconfigured feature, with the free-text model name', async () => {
    expect(await status({ connections: [OLLAMA] })).toMatchObject({
      isConfigured: false,
      servedBy: 'connection',
      modelId: 'custom/llama3.2',
      modelName: 'llama3.2',
      pricing: null,
      capabilities: null,
      connectionId: OLLAMA.id,
    });
  });

  it('reports a config naming a deleted connection as unconfigured', async () => {
    expect(
      await status({ connections: [OLLAMA], config: { feature: FEATURE, connectionId: 'deleted' } }),
    ).toMatchObject({
      isConfigured: false,
      connectionId: OLLAMA.id,
    });
  });

  it('skips a picked native connection that has no key, as the run does', async () => {
    const keyless: StoredConnection = { ...CLAUDE, keyEncrypted: undefined, status: 'invalid' };

    expect(
      await status({ connections: [keyless, OLLAMA], config: { feature: FEATURE, connectionId: keyless.id } }),
    ).toMatchObject({ isConfigured: false, servedBy: 'connection', connectionId: OLLAMA.id });
  });

  it('reports an explicit server pick with the server model', async () => {
    process.env.GEMINI_API_KEY = 'server-key';

    expect(await status({ connections: [OLLAMA], config: { feature: FEATURE, connectionId: null } })).toEqual({
      feature: FEATURE,
      isConfigured: true,
      configuredConnectionId: null,
      servedBy: 'server',
      modelId: `${SERVER_MODEL.provider}/${SERVER_MODEL.model}`,
      modelName: SERVER_MODEL.model,
      pricing: null,
      capabilities: null,
      usingUserKey: false,
      serverModelName: SERVER_MODEL.model,
    });
  });

  it('reports a server pick the plan no longer covers as unconfigured and hides the server model', async () => {
    process.env.GEMINI_API_KEY = 'server-key';

    expect(
      await status({
        connections: [OLLAMA],
        config: { feature: FEATURE, connectionId: null },
        serverKeysAllowed: false,
      }),
    ).toMatchObject({ isConfigured: false, servedBy: 'connection', serverModelName: null });
  });

  // The run refuses to move to the server model while the user owns connections.
  it('names the first connection but reports nothing serving when every connection is down', async () => {
    process.env.GEMINI_API_KEY = 'server-key';
    const flagged = { ...OLLAMA, status: 'invalid' as const };

    expect(await status({ connections: [flagged, { ...CLAUDE, status: 'invalid' }] })).toMatchObject({
      servedBy: null,
      connectionId: flagged.id,
      connectionName: flagged.name,
      modelId: 'custom/llama3.2',
      serverModelName: SERVER_MODEL.model,
    });
  });

  it('reports nothing serving and no model when there are no credentials anywhere', async () => {
    expect(await status()).toEqual({
      feature: FEATURE,
      isConfigured: false,
      servedBy: null,
      modelId: '',
      modelName: '',
      pricing: null,
      capabilities: null,
      usingUserKey: false,
      serverModelName: null,
    });
  });
});
