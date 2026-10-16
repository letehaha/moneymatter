import { AIConnectionInfo, AIFeatureStatus, AI_FEATURE, AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  AUTOMATIC_OPTION,
  SERVER_OPTION,
  buildFeatureModelOptions,
  readFeatureSelectValue,
} from './feature-model-options';

const CONNECTION_A = '3f1c9a2e-8b47-4d63-9d51-6c0f2a7e5b90';
const CONNECTION_B = '9b2d4e6f-1a3c-4e5d-8f7a-0b1c2d3e4f5a';

const buildStatus = (overrides: Partial<AIFeatureStatus> = {}): AIFeatureStatus => ({
  feature: AI_FEATURE.categorization,
  isConfigured: false,
  servedBy: 'server',
  modelId: 'google/gemini-flash',
  modelName: 'Gemini Flash',
  pricing: null,
  capabilities: null,
  usingUserKey: false,
  billing: 'per-token',
  serverModelName: 'Gemini Flash',
  ...overrides,
});

const buildConnection = ({
  id,
  name,
  status = 'valid',
}: {
  id: string;
  name: string;
  status?: AIConnectionInfo['status'];
}): AIConnectionInfo => ({
  id,
  provider: AI_PROVIDER.anthropic,
  name,
  model: 'claude-sonnet-5',
  hasApiKey: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  status,
  lastValidatedAt: '2026-01-01T00:00:00.000Z',
});

describe('readFeatureSelectValue', () => {
  it('reads an unconfigured feature as automatic', () => {
    expect(readFeatureSelectValue({ status: buildStatus() })).toBe(AUTOMATIC_OPTION);
  });

  it('reads a server pick as the server option', () => {
    expect(readFeatureSelectValue({ status: buildStatus({ isConfigured: true, configuredConnectionId: null }) })).toBe(
      SERVER_OPTION,
    );
  });

  it('reads a connection pick as its id', () => {
    expect(
      readFeatureSelectValue({ status: buildStatus({ isConfigured: true, configuredConnectionId: CONNECTION_A }) }),
    ).toBe(CONNECTION_A);
  });
});

describe('buildFeatureModelOptions', () => {
  it('lists automatic, server, then every connection in list order', () => {
    const options = buildFeatureModelOptions({
      status: buildStatus(),
      connections: [
        buildConnection({ id: CONNECTION_A, name: 'Claude smart', status: 'invalid' }),
        buildConnection({ id: CONNECTION_B, name: 'Claude fast' }),
      ],
    });

    expect(options).toEqual([
      { value: AUTOMATIC_OPTION, kind: 'automatic', target: { kind: 'server' } },
      { value: SERVER_OPTION, kind: 'server' },
      { value: CONNECTION_A, kind: 'connection', name: 'Claude smart', model: 'claude-sonnet-5', needsAttention: true },
      { value: CONNECTION_B, kind: 'connection', name: 'Claude fast', model: 'claude-sonnet-5', needsAttention: false },
    ]);
  });

  it('omits the server option when the user cannot use it', () => {
    const options = buildFeatureModelOptions({
      status: buildStatus({ serverModelName: null, servedBy: null }),
      connections: [],
    });

    expect(options).toEqual([{ value: AUTOMATIC_OPTION, kind: 'automatic', target: null }]);
  });

  it('names what answers an unconfigured feature from the status', () => {
    const [automatic] = buildFeatureModelOptions({
      status: buildStatus({ servedBy: 'connection', connectionId: CONNECTION_B, connectionName: 'Claude fast' }),
      connections: [],
    });

    expect(automatic).toEqual({
      value: AUTOMATIC_OPTION,
      kind: 'automatic',
      target: { kind: 'connection', name: 'Claude fast' },
    });
  });

  it('keeps the picked connection selectable while the list is missing it', () => {
    const options = buildFeatureModelOptions({
      status: buildStatus({
        isConfigured: true,
        configuredConnectionId: CONNECTION_A,
        servedBy: 'connection',
        connectionId: CONNECTION_A,
        connectionName: 'Claude smart',
        modelId: 'anthropic/claude-sonnet-5',
      }),
      connections: [],
    });

    expect(options.at(-1)).toEqual({
      value: CONNECTION_A,
      kind: 'connection',
      name: 'Claude smart',
      model: 'claude-sonnet-5',
      needsAttention: false,
    });
  });
});
