import { afterEach, beforeEach } from '@jest/globals';

const SERVER_KEY_ENV_VARS = ['GEMINI_API_KEY', 'GEMINI_PLUS_API_KEY', 'ANTHROPIC_PLUS_API_KEY'] as const;

/** The outbound URL guard rejects anything that is not a public internet host. */
export function runAsCloud(): void {
  delete process.env.IS_SELF_HOST;
}

/** Any value works: the server model only needs the operator to hold a key for its provider. */
export function enableServerModel(): void {
  process.env.GEMINI_API_KEY = 'server-side-gemini-key';
}

/**
 * Self-host stands the outbound URL guard down, which the mock endpoints need because they
 * live on hosts that never resolve. Server keys are cleared so the included server model
 * answers only in tests that call enableServerModel().
 */
export function useSelfHostWithoutServerAiKeys(): void {
  let selfHostFlagBeforeTest: string | undefined;
  const serverKeysBeforeTest = new Map<string, string | undefined>();

  beforeEach(() => {
    selfHostFlagBeforeTest = process.env.IS_SELF_HOST;
    process.env.IS_SELF_HOST = 'true';

    for (const envVar of SERVER_KEY_ENV_VARS) {
      serverKeysBeforeTest.set(envVar, process.env[envVar]);
      delete process.env[envVar];
    }
  });

  afterEach(() => {
    if (selfHostFlagBeforeTest === undefined) {
      delete process.env.IS_SELF_HOST;
    } else {
      process.env.IS_SELF_HOST = selfHostFlagBeforeTest;
    }

    for (const envVar of SERVER_KEY_ENV_VARS) {
      const keyBeforeTest = serverKeysBeforeTest.get(envVar);

      if (keyBeforeTest === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = keyBeforeTest;
      }
    }
  });
}
