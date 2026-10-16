import { describe, expect, it, jest } from '@jest/globals';
import { readFile, stat, writeFile } from 'fs/promises';
import path from 'path';

import { withCodexHome } from './codex-home';

const AUTH = JSON.stringify({ tokens: { refresh_token: 'rt-1' } });

const rewrite = async ({ codexHome }: { codexHome: string }) =>
  writeFile(path.join(codexHome, 'auth.json'), JSON.stringify({ rotated: true }));

describe('withCodexHome', () => {
  it('writes auth.json and config.toml with private modes and removes the dir', async () => {
    let home = '';

    await withCodexHome({
      authJson: AUTH,
      onRefreshed: jest.fn<() => Promise<void>>(),
      run: async ({ codexHome }) => {
        home = codexHome;

        expect((await stat(codexHome)).mode & 0o777).toBe(0o700);
        expect((await stat(path.join(codexHome, 'auth.json'))).mode & 0o777).toBe(0o600);
        expect((await stat(path.join(codexHome, 'config.toml'))).mode & 0o777).toBe(0o600);
        expect(await readFile(path.join(codexHome, 'auth.json'), 'utf8')).toBe(AUTH);
        expect(await readFile(path.join(codexHome, 'config.toml'), 'utf8')).toContain(
          'cli_auth_credentials_store = "file"',
        );
      },
    });

    await expect(stat(home)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not call onRefreshed when auth.json is untouched', async () => {
    const onRefreshed = jest.fn<(params: { authJson: string }) => Promise<void>>();

    await withCodexHome({ authJson: AUTH, onRefreshed, run: async () => 'ok' });

    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it('calls onRefreshed with the rewritten file', async () => {
    const onRefreshed = jest.fn<(params: { authJson: string }) => Promise<void>>().mockResolvedValue();
    const rewritten = JSON.stringify({ tokens: { refresh_token: 'rt-2' } });

    const result = await withCodexHome({
      authJson: AUTH,
      onRefreshed,
      run: async ({ codexHome }) => {
        await writeFile(path.join(codexHome, 'auth.json'), rewritten);

        return 'ok';
      },
    });

    expect(result).toBe('ok');
    expect(onRefreshed).toHaveBeenCalledWith({ authJson: rewritten });
  });

  it('calls onRefreshed when run rewrites auth.json and then throws, and rethrows the run error', async () => {
    const onRefreshed = jest.fn<(params: { authJson: string }) => Promise<void>>().mockResolvedValue();
    const rewritten = JSON.stringify({ tokens: { refresh_token: 'rt-3' } });
    let home = '';

    await expect(
      withCodexHome({
        authJson: AUTH,
        onRefreshed,
        run: async ({ codexHome }) => {
          home = codexHome;
          await writeFile(path.join(codexHome, 'auth.json'), rewritten);
          throw new Error('rate limited');
        },
      }),
    ).rejects.toThrow('rate limited');

    expect(onRefreshed).toHaveBeenCalledWith({ authJson: rewritten });
    await expect(stat(home)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('ignores a rewrite that is not JSON', async () => {
    const onRefreshed = jest.fn<(params: { authJson: string }) => Promise<void>>().mockResolvedValue();

    await withCodexHome({
      authJson: AUTH,
      onRefreshed,
      run: async ({ codexHome }) => {
        await writeFile(path.join(codexHome, 'auth.json'), '{not json');
      },
    });

    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it('lets the run error win over an onRefreshed failure, and surfaces onRefreshed failure otherwise', async () => {
    const failing = jest
      .fn<(params: { authJson: string }) => Promise<void>>()
      .mockRejectedValue(new Error('save failed'));

    await expect(
      withCodexHome({
        authJson: AUTH,
        onRefreshed: failing,
        run: async ({ codexHome }) => {
          await rewrite({ codexHome });
          throw new Error('run failed');
        },
      }),
    ).rejects.toThrow('run failed');

    await expect(
      withCodexHome({ authJson: AUTH, onRefreshed: failing, run: ({ codexHome }) => rewrite({ codexHome }) }),
    ).rejects.toThrow('save failed');
  });
});
