import { AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@services/ai/connection-failure', () => ({
  markConnectionRejected: jest.fn(),
  markCustomEndpointUnreachable: jest.fn(),
  markModelNotServed: jest.fn(),
}));

import { markConnectionRejected } from '@services/ai/connection-failure';

import { describeRunFailure } from './run-failure';

const aiClient = { provider: AI_PROVIDER.custom, modelId: 'custom/llama3.2', usingUserKey: true } as never;

describe('describeRunFailure', () => {
  it('still classifies everything else', async () => {
    const failure = await describeRunFailure({ error: new Error('something odd'), userId: 1, aiClient });

    expect(failure).toEqual({ code: 'unknown', messageKey: 'chat.errors.unknown' });
  });
});
