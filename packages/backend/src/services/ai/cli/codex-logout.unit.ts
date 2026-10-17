import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { logger } from '@js/utils/logger';

import { runWithCliCredential } from './cli-credential-run';
import { runCliProcess } from './cli-process';
import { logoutCodexConnection } from './codex-logout';

jest.mock('@js/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('./cli-process', () => ({ runCliProcess: jest.fn() }));

jest.mock('./cli-credential-run', () => ({
  runWithCliCredential: jest.fn(async ({ run }: { run: (params: unknown) => Promise<unknown> }) =>
    run({ codexHome: '/tmp/mm-codex-home-test', signal: new AbortController().signal }),
  ),
}));

const source = { connectionKey: 'connection:1', load: jest.fn(), save: jest.fn() } as never;

describe('logoutCodexConnection', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('redacts token-shaped output of a failed logout before logging it', async () => {
    jest.mocked(runCliProcess).mockResolvedValue({
      exitCode: 1,
      stderrTail: 'revoke failed {"refresh_token": "rt-very-secret-value"} sk-ant-oat01-FAKE0123456789abcdef',
    } as never);

    await logoutCodexConnection({ source });

    const [, details] = jest.mocked(logger.warn).mock.calls[0] as [string, { stderr: string }];

    expect(details.stderr).not.toContain('rt-very-secret-value');
    expect(details.stderr).not.toContain('FAKE0123456789abcdef');
    expect(details.stderr).toContain('[redacted]');
  });

  it('only logs when the logout could not be run at all', async () => {
    jest.mocked(runWithCliCredential).mockRejectedValueOnce(new Error('slot busy'));

    await expect(logoutCodexConnection({ source })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
