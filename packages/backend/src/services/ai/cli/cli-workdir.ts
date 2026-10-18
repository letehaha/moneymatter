import { chmod, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Creates a fresh 0700 directory with an unpredictable name under the OS temp dir. The caller owns
 * its removal; `withTempDir` is the variant that removes it.
 */
export async function createPrivateDir({ prefix }: { prefix: string }): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`));

  try {
    await chmod(dir, 0o700);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  return dir;
}

/** Runs `run` with a fresh 0700 directory under the OS temp dir and always removes it afterwards. */
export async function withTempDir<T>({
  prefix,
  run,
}: {
  prefix: string;
  run: (params: { dir: string }) => Promise<T>;
}): Promise<T> {
  const dir = await createPrivateDir({ prefix });

  try {
    return await run({ dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
