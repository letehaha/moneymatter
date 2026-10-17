import { afterEach, describe, expect, it } from '@jest/globals';
import os from 'os';

import { PtySession, redactSecrets, startPtySession } from './pty-session';

const TOKEN = `sk-ant-oat01-${'A'.repeat(12)}${'B'.repeat(12)}`;

const sessions: PtySession[] = [];

const runScript = ({ script }: { script: string }) => {
  const session = startPtySession({
    command: process.execPath,
    args: ['-e', script],
    env: { PATH: process.env.PATH ?? '' },
    cwd: os.tmpdir(),
  });

  sessions.push(session);

  return session;
};

const TOKEN_PATTERN = /sk-ant-oat\w*-[A-Za-z0-9_-]{20,}(?=\s)/;

afterEach(() => {
  for (const session of sessions.splice(0)) session.kill();
});

describe('startPtySession', () => {
  it('matches on ANSI-stripped output', async () => {
    const session = runScript({
      script: `process.stdout.write('\\x1b[36mhttps://example.com/oauth?a=1\\x1b[0m\\n')`,
    });

    const result = await session.waitFor({ pattern: /https:\/\/\S*oauth\S*(?=\s)/, timeoutMs: 5000 });

    expect(result).toMatchObject({ matched: true });
    expect(result.matched && result.match[0]).toBe('https://example.com/oauth?a=1');
  });

  it('never matches a token that ends mid-field, only the whole token once its delimiter arrives', async () => {
    const half = Math.ceil(TOKEN.length / 2) + 4;
    const session = runScript({
      script: `
        process.stdout.write('token: ${TOKEN.slice(0, half)}');
        setTimeout(() => process.stdout.write('${TOKEN.slice(half)}'), 700);
        setTimeout(() => process.stdout.write('\\n'), 1400);
        setTimeout(() => {}, 5000);
      `,
    });

    // The prefix is already long enough for `{20,}`, so only the delimiter rule keeps it from matching.
    expect(await session.waitFor({ pattern: TOKEN_PATTERN, timeoutMs: 350 })).toEqual({
      matched: false,
      reason: 'timeout',
    });
    // Ends at ~1050 ms from the start, well before the delimiter at ~1400 ms plus process start-up.
    expect(await session.waitFor({ pattern: TOKEN_PATTERN, timeoutMs: 700 })).toEqual({
      matched: false,
      reason: 'timeout',
    });

    const result = await session.waitFor({ pattern: TOKEN_PATTERN, timeoutMs: 5000 });

    expect(result.matched && result.match[0]).toBe(TOKEN);
  });

  it('accepts a token printed as the very last bytes before the process exits', async () => {
    const session = runScript({ script: `process.stdout.write('${TOKEN}')` });

    const result = await session.waitFor({ pattern: TOKEN_PATTERN, timeoutMs: 5000 });

    expect(result.matched && result.match[0]).toBe(TOKEN);
  });

  it('reports an exit without a match', async () => {
    const session = runScript({ script: `process.stdout.write('nothing to see\\n')` });

    expect(await session.waitFor({ pattern: TOKEN_PATTERN, timeoutMs: 5000 })).toEqual({
      matched: false,
      reason: 'exited',
    });
  });

  it('matches output that arrived before waitFor was called', async () => {
    const session = runScript({ script: `process.stdout.write('hello\\n'); setTimeout(() => {}, 3000)` });

    while (!session.getLastLines({ count: 5 }).some((line) => line.includes('hello'))) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const result = await session.waitFor({ pattern: /hello(?=\s)/, timeoutMs: 1000 });

    expect(result.matched).toBe(true);
  });

  it('redacts secrets from the captured lines', async () => {
    const session = runScript({ script: `process.stdout.write('first\\nerror with ${TOKEN} inside\\n')` });

    await session.exited;

    const lines = session.getLastLines({ count: 5 });

    expect(lines.join('\n')).not.toContain('sk-ant-');
    expect(lines).toEqual(['first', 'error with [redacted] inside']);
  });

  it('kills the process and resolves exited', async () => {
    const session = runScript({ script: `setInterval(() => {}, 1000)` });

    session.kill();

    await expect(session.exited).resolves.toMatchObject({ exitCode: expect.any(Number) });
    expect(await session.waitFor({ pattern: /never/, timeoutMs: 1000 })).toEqual({ matched: false, reason: 'exited' });
  });
});

describe('redactSecrets', () => {
  it('replaces every Anthropic secret shape', () => {
    expect(redactSecrets({ text: `a ${TOKEN} b sk-ant-api03-xyz c` })).toBe('a [redacted] b [redacted] c');
  });
});
