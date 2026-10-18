import { describe, expect, it } from '@jest/globals';
import { rm, stat, writeFile } from 'fs/promises';
import path from 'path';

import { createPrivateDir, withTempDir } from './cli-workdir';

describe('withTempDir', () => {
  it('creates a private directory and removes it afterwards', async () => {
    let seenDir = '';

    const result = await withTempDir({
      prefix: 'mm-test',
      run: async ({ dir }) => {
        seenDir = dir;
        await writeFile(path.join(dir, 'file.txt'), 'x');

        expect((await stat(dir)).mode & 0o777).toBe(0o700);

        return 'done';
      },
    });

    expect(result).toBe('done');
    await expect(stat(seenDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes the directory when run throws', async () => {
    let seenDir = '';

    await expect(
      withTempDir({
        prefix: 'mm-test',
        run: async ({ dir }) => {
          seenDir = dir;
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');

    await expect(stat(seenDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('createPrivateDir', () => {
  it('creates a distinct 0700 directory per call and leaves removal to the caller', async () => {
    const first = await createPrivateDir({ prefix: 'mm-test' });
    const second = await createPrivateDir({ prefix: 'mm-test' });

    try {
      expect(first).not.toBe(second);
      expect(path.basename(first)).toMatch(/^mm-test-/);
      expect((await stat(first)).mode & 0o777).toBe(0o700);
      expect((await stat(second)).mode & 0o777).toBe(0o700);
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });
});
