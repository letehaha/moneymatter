import { describe, expect, it } from '@jest/globals';
import { stat, writeFile } from 'fs/promises';
import path from 'path';

import { withTempDir } from './cli-workdir';

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
