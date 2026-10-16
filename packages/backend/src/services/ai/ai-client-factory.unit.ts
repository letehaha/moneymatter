import { AI_CLI_PROVIDERS, AI_NATIVE_PROVIDERS, AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';
import { useFakeAiClis } from '@tests/helpers/ai-cli';
import { generateText } from 'ai';

import { createProviderModel } from './ai-client-factory';
import { CliCredentialSource } from './cli/cli-credential-run';

jest.mock('@js/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const fakes = useFakeAiClis();

describe('createProviderModel', () => {
  it.each(AI_NATIVE_PROVIDERS)('refuses to build a %s client without a key', (provider) => {
    expect(() => createProviderModel({ provider, model: 'x', apiKey: '' })).toThrow();
  });

  describe.each(AI_CLI_PROVIDERS)('%s', (provider) => {
    const buildSource = () => {
      const load = jest.fn(async () => ({
        credential:
          provider === AI_PROVIDER.codex ? '{"tokens":{"refresh_token":"rt"}}' : 'sk-ant-oat01-fake-token-value',
        revision: 'rev-1',
      }));
      const credentialSource: CliCredentialSource = { connectionKey: `factory-${provider}`, load };

      return { load, credentialSource };
    };

    it('builds a model from a credential source without loading the credential', () => {
      const { load, credentialSource } = buildSource();
      const model = createProviderModel({ provider, model: 'sonnet', credentialSource });

      expect(model).toMatchObject({ specificationVersion: 'v3', provider, modelId: 'sonnet' });
      expect(load).not.toHaveBeenCalled();
    });

    it('loads the credential on every call, so a reused model runs on the latest one', async () => {
      const { load, credentialSource } = buildSource();
      const model = createProviderModel({ provider, model: 'sonnet', credentialSource });

      await generateText({ model, prompt: 'x', maxRetries: 0 });
      await generateText({ model, prompt: 'x', maxRetries: 0 });

      expect(load).toHaveBeenCalledTimes(2);
      expect(fakes.readRuns()).toHaveLength(2);
    });
  });
});
