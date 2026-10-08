import { AI_PROVIDER } from '@bt/shared/types';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { AIClientResult } from './ai-client-factory';
import { markConnectionRejected, markModelNotServed } from './connection-failure';
import { suspendAnthropicServerKey } from './resolution-ladder';

jest.mock('../user-settings/ai-connections', () => ({
  getConnectionInfos: jest.fn(),
  markConnectionInvalid: jest.fn(),
}));
jest.mock('./resolution-ladder', () => ({ suspendAnthropicServerKey: jest.fn() }));

const USER_ID = 1;

const client = ({ provider, usingUserKey }: { provider: AI_PROVIDER; usingUserKey: boolean }) =>
  ({ provider, usingUserKey, modelId: `${provider}/some-model` }) as AIClientResult;

describe.each([
  ['markConnectionRejected', markConnectionRejected],
  ['markModelNotServed', markModelNotServed],
])('%s', (_name, mark) => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('suspends the Anthropic server key only when that key is the one that failed', async () => {
    const ownKey = await mark({
      userId: USER_ID,
      aiClient: client({ provider: AI_PROVIDER.anthropic, usingUserKey: true }),
    });
    await mark({ userId: USER_ID, aiClient: client({ provider: AI_PROVIDER.google, usingUserKey: false }) });
    expect(suspendAnthropicServerKey).not.toHaveBeenCalled();

    const serverKey = await mark({
      userId: USER_ID,
      aiClient: client({ provider: AI_PROVIDER.anthropic, usingUserKey: false }),
    });
    expect(suspendAnthropicServerKey).toHaveBeenCalledWith({ reason: ownKey });
    expect(serverKey).not.toBe(ownKey);
  });
});
