import { AI_PROVIDER } from '@bt/shared/types';
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { chmod, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { getCliBinaryPath, getCliVersion } from './cli-binaries';

const writeBinary = async ({ file, body }: { file: string; body: string }) => {
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
};

describe('cli-binaries', () => {
  let dir: string;
  let pathA: string;
  let pathB: string;
  const savedClaudePath = process.env.AI_CLI_CLAUDE_PATH;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mm-cli-binaries-'));
    pathA = path.join(dir, 'claude-a');
    pathB = path.join(dir, 'claude-b-missing');
    await writeBinary({ file: pathA, body: 'echo "9.9.9 (Fake Claude)"' });
  });

  afterEach(() => {
    jest.useRealTimers();
    if (savedClaudePath === undefined) delete process.env.AI_CLI_CLAUDE_PATH;
    else process.env.AI_CLI_CLAUDE_PATH = savedClaudePath;
    delete process.env.AI_CLI_CODEX_PATH;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves the binary path from the env var or falls back to the bare command', () => {
    delete process.env.AI_CLI_CLAUDE_PATH;
    process.env.AI_CLI_CODEX_PATH = '/opt/codex';

    expect(getCliBinaryPath({ provider: AI_PROVIDER.claudeCode })).toBe('claude');
    expect(getCliBinaryPath({ provider: AI_PROVIDER.codex })).toBe('/opt/codex');
  });

  it('keys the version cache by the resolved path', async () => {
    process.env.AI_CLI_CLAUDE_PATH = pathA;
    expect(await getCliVersion({ provider: AI_PROVIDER.claudeCode })).toBe('9.9.9 (Fake Claude)');

    process.env.AI_CLI_CLAUDE_PATH = pathB;
    expect(await getCliVersion({ provider: AI_PROVIDER.claudeCode })).toBeNull();

    // A's entry is still cached after the binary disappears.
    await rm(pathA);
    process.env.AI_CLI_CLAUDE_PATH = pathA;
    expect(await getCliVersion({ provider: AI_PROVIDER.claudeCode })).toBe('9.9.9 (Fake Claude)');
  });

  it('caches a missing binary under its path until the TTL passes', async () => {
    const missing = path.join(dir, 'late-binary');
    process.env.AI_CLI_CLAUDE_PATH = missing;

    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval'] });

    expect(await getCliVersion({ provider: AI_PROVIDER.claudeCode })).toBeNull();

    await writeBinary({ file: missing, body: 'echo "1.2.3"' });
    expect(await getCliVersion({ provider: AI_PROVIDER.claudeCode })).toBeNull();

    jest.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    expect(await getCliVersion({ provider: AI_PROVIDER.claudeCode })).toBe('1.2.3');
  });

  it('does not cache a failure other than a missing binary', async () => {
    const flaky = path.join(dir, 'flaky');
    process.env.AI_CLI_CLAUDE_PATH = flaky;

    await writeBinary({ file: flaky, body: 'exit 3' });
    expect(await getCliVersion({ provider: AI_PROVIDER.claudeCode })).toBeNull();

    await writeBinary({ file: flaky, body: 'echo "4.5.6"' });
    expect(await getCliVersion({ provider: AI_PROVIDER.claudeCode })).toBe('4.5.6');
  });
});
