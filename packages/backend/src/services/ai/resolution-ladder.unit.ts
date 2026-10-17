import { AIFeatureConfig, AI_FEATURE } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  FALLBACK_SERVER_MODELS,
  PRIMARY_SERVER_MODEL,
  pickResolutionStep,
  suspendPrimaryServerKey,
  type LadderConnection,
} from './resolution-ladder';

jest.mock('@js/utils/logger', () => ({ logger: { error: jest.fn() } }));

const SERVER_KEY_ENV_VARS = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY'] as const;

// Its default model is a Google one, so GEMINI_API_KEY is what backs the server arm here.
const FEATURE = AI_FEATURE.categorization;
const SERVER_MODEL = FALLBACK_SERVER_MODELS[FEATURE];

const FIRST: LadderConnection = { id: 'conn-1', status: 'valid' };
const SECOND: LadderConnection = { id: 'conn-2', status: 'valid' };
const FLAGGED_FIRST: LadderConnection = { ...FIRST, status: 'invalid' };

const PICK_SECOND: AIFeatureConfig = { feature: FEATURE, connectionId: SECOND.id };
const PICK_SERVER: AIFeatureConfig = { feature: FEATURE, connectionId: null };

function pick({
  config = null,
  connections = [],
  serverKeysAllowed = true,
  excludedConnectionIds,
}: {
  config?: AIFeatureConfig | null;
  connections?: LadderConnection[];
  serverKeysAllowed?: boolean;
  excludedConnectionIds?: ReadonlySet<string>;
} = {}) {
  return pickResolutionStep({
    feature: FEATURE,
    config,
    connections,
    serverKeysAllowed,
    excludedConnectionIds,
  });
}

describe('pickResolutionStep', () => {
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
    jest.restoreAllMocks();
  });

  describe('configured connection', () => {
    it('picks the configured connection over the default one', () => {
      expect(pick({ config: PICK_SECOND, connections: [FIRST, SECOND] })).toEqual({
        kind: 'configured',
        connection: SECOND,
      });
    });

    it('still picks the configured connection when it is flagged invalid', () => {
      const flagged = { ...SECOND, status: 'invalid' as const };

      expect(pick({ config: PICK_SECOND, connections: [FIRST, flagged] })).toEqual({
        kind: 'configured',
        connection: flagged,
      });
    });

    it('treats a config naming a deleted connection as automatic', () => {
      expect(pick({ config: PICK_SECOND, connections: [FIRST] })).toEqual({
        kind: 'default-connection',
        connection: FIRST,
      });
    });
  });

  describe('configured server model', () => {
    it('runs the server model when the user can use it, even with connections of their own', () => {
      process.env.GEMINI_API_KEY = 'server-key';

      expect(pick({ config: PICK_SERVER, connections: [FIRST] })).toMatchObject({
        kind: 'configured-server',
        model: SERVER_MODEL,
      });
    });

    it('falls through to the default connection once the plan no longer includes the server model', () => {
      process.env.GEMINI_API_KEY = 'server-key';

      expect(pick({ config: PICK_SERVER, connections: [FIRST], serverKeysAllowed: false })).toEqual({
        kind: 'default-connection',
        connection: FIRST,
      });
    });

    it('falls through when no server key is set at all', () => {
      expect(pick({ config: PICK_SERVER, connections: [FIRST] })).toEqual({
        kind: 'default-connection',
        connection: FIRST,
      });
    });
  });

  describe('no usable config', () => {
    it('dials the first connection not flagged invalid', () => {
      expect(pick({ connections: [FLAGGED_FIRST, SECOND] })).toEqual({
        kind: 'default-connection',
        connection: SECOND,
      });
    });

    it('prefers the user connection over the server model', () => {
      process.env.GEMINI_API_KEY = 'server-key';

      expect(pick({ connections: [FIRST] })).toEqual({ kind: 'default-connection', connection: FIRST });
    });

    it('refuses with all-connections-down even when the server model could answer', () => {
      process.env.GEMINI_API_KEY = 'server-key';

      expect(pick({ connections: [FLAGGED_FIRST] })).toEqual({
        kind: 'all-connections-down',
        connection: FLAGGED_FIRST,
      });
    });

    it('falls back to the server model when the user has no connections at all', () => {
      process.env.GEMINI_API_KEY = 'server-key';

      expect(pick()).toMatchObject({ kind: 'server-default', model: SERVER_MODEL });
    });

    it('reports unserved when nothing anywhere can answer', () => {
      expect(pick()).toEqual({ kind: 'unserved' });
    });

    it('reports unserved when the server key exists but the plan does not include it', () => {
      process.env.GEMINI_API_KEY = 'server-key';

      expect(pick({ serverKeysAllowed: false })).toEqual({ kind: 'unserved' });
    });
  });

  describe('excluded connections', () => {
    it('skips an excluded connection in both the configured and default arms', () => {
      const excludedConnectionIds = new Set([SECOND.id]);

      expect(pick({ config: PICK_SECOND, connections: [SECOND, FIRST], excludedConnectionIds })).toEqual({
        kind: 'default-connection',
        connection: FIRST,
      });
      expect(pick({ connections: [SECOND], excludedConnectionIds })).toEqual({
        kind: 'all-connections-down',
        connection: SECOND,
      });
    });
  });

  describe('primary server model', () => {
    beforeEach(() => {
      process.env.GEMINI_API_KEY = 'server-key';
      process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    });

    it('takes precedence over the Gemini model while its key is set', () => {
      expect(pick()).toEqual({ kind: 'server-default', model: PRIMARY_SERVER_MODEL });
      expect(pick({ config: PICK_SERVER })).toEqual({ kind: 'configured-server', model: PRIMARY_SERVER_MODEL });
      expect(pick({ serverKeysAllowed: false })).toEqual({ kind: 'unserved' });
    });

    it('needs no Gemini key', () => {
      delete process.env.GEMINI_API_KEY;

      expect(pick()).toEqual({ kind: 'server-default', model: PRIMARY_SERVER_MODEL });
    });

    it('falls back to the Gemini model for an hour after a suspension', () => {
      // The clock runs two hours behind, so the suspension is over once it is restored.
      const suspendedAt = Date.now() - 2 * 60 * 60 * 1000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(suspendedAt);
      suspendPrimaryServerKey({ reason: 'test' });

      expect(pick()).toEqual({ kind: 'server-default', model: SERVER_MODEL });

      now.mockReturnValue(suspendedAt + 61 * 60 * 1000);
      expect(pick()).toEqual({ kind: 'server-default', model: PRIMARY_SERVER_MODEL });
    });
  });
});
