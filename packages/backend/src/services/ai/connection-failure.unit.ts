import { AI_PROVIDER } from '@bt/shared/types';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { markConnectionInvalid } from '../user-settings/ai-connections';
import type { AIClientResult } from './ai-client-factory';
import { markConnectionRejected, markModelNotServed } from './connection-failure';
import { suspendPrimaryServerKey } from './resolution-ladder';

jest.mock('../user-settings/ai-connections', () => ({
  getConnectionInfos: jest.fn(),
  markConnectionInvalid: jest.fn(),
}));
jest.mock('./resolution-ladder', () => ({
  ...jest.requireActual<typeof import('./resolution-ladder')>('./resolution-ladder'),
  suspendPrimaryServerKey: jest.fn(),
}));

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
    expect(suspendPrimaryServerKey).not.toHaveBeenCalled();

    const serverKey = await mark({
      userId: USER_ID,
      aiClient: client({ provider: AI_PROVIDER.anthropic, usingUserKey: false }),
    });
    expect(suspendPrimaryServerKey).toHaveBeenCalledWith({ reason: ownKey });
    expect(serverKey).not.toBe(ownKey);
  });
});

describe('markModelNotServed on a model override', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('names the override and leaves the connection healthy, since its own model still works', async () => {
    const aiClient = {
      ...client({ provider: AI_PROVIDER.anthropic, usingUserKey: true }),
      modelId: 'anthropic/claude-haiku-5-5',
      connectionId: 'conn-1',
      modelOverridden: true,
    } as AIClientResult;

    const message = await markModelNotServed({ userId: USER_ID, aiClient });

    expect(message).toContain('claude-haiku-5-5');
    expect(markConnectionInvalid).not.toHaveBeenCalled();
  });

  it('still flags the connection when its own model is the one that went missing', async () => {
    const aiClient = {
      ...client({ provider: AI_PROVIDER.anthropic, usingUserKey: true }),
      connectionId: 'conn-1',
    } as AIClientResult;

    await markModelNotServed({ userId: USER_ID, aiClient });

    expect(markConnectionInvalid).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'conn-1' }));
  });
});
