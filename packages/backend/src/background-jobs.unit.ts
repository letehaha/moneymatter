import { describe, expect, it, jest } from '@jest/globals';

import { shutdownBackgroundJobs } from './background-jobs';
import * as cliAuthSessions from './services/ai/cli/login/cli-auth-sessions';

const mockWorkerClose = jest.fn(async () => undefined);

jest.mock('@services/bank-data-providers/sync/account-sync-queue', () => ({
  accountSyncWorker: { close: () => mockWorkerClose() },
}));

jest.mock('@js/utils/posthog', () => ({ shutdownPostHog: jest.fn(async () => undefined) }));

describe('shutdownBackgroundJobs', () => {
  it('cancels the running CLI sign-ins so their login processes and credential dirs do not outlive the server', async () => {
    const resetSpy = jest.spyOn(cliAuthSessions, 'resetCliAuthSessions');

    await shutdownBackgroundJobs();

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
  });
});
