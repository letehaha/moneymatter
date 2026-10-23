import { AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import os from 'os';

import { buildClaudeEnv } from './cli-env';
import { CliNotInstalledError } from './cli-errors';
import { runCliProcess } from './cli-process';

const run = (params: {
  script: string;
  stdin?: string;
  signal?: AbortSignal;
  onStdoutLine?: (p: { line: string }) => void;
}) =>
  runCliProcess({
    provider: AI_PROVIDER.claudeCode,
    command: process.execPath,
    args: ['-e', params.script],
    env: buildClaudeEnv({ home: os.tmpdir() }),
    cwd: os.tmpdir(),
    stdin: params.stdin,
    signal: params.signal,
    onStdoutLine: params.onStdoutLine,
  });

const isAlive = ({ pid }: { pid: number }) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

const waitUntilDead = async ({ pid }: { pid: number }) => {
  for (let attempt = 0; attempt < 50 && isAlive({ pid }); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

describe('runCliProcess', () => {
  it('delivers complete stdout lines, including a last line without a newline', async () => {
    const lines: string[] = [];

    const result = await run({
      script: `process.stdout.write('one\\ntw'); setTimeout(() => process.stdout.write('o\\r\\nthree'), 50);`,
      onStdoutLine: ({ line }) => lines.push(line),
    });

    expect(lines).toEqual(['one', 'two', 'three']);
    expect(result.exitCode).toBe(0);
  });

  it('writes stdin and reports the exit code', async () => {
    const lines: string[] = [];

    const result = await run({
      script: `let d=''; process.stdin.on('data', c => d += c).on('end', () => { console.log(d.toUpperCase()); process.exit(3); });`,
      stdin: 'hello',
      onStdoutLine: ({ line }) => lines.push(line),
    });

    expect(lines).toEqual(['HELLO']);
    expect(result.exitCode).toBe(3);
  });

  it('keeps only the last 8 KB of stderr', async () => {
    const result = await run({ script: `process.stderr.write('a'.repeat(20000) + 'END')` });

    expect(result.stderrTail).toHaveLength(8 * 1024);
    expect(result.stderrTail.endsWith('END')).toBe(true);
  });

  it('rejects with CliNotInstalledError when the binary does not exist', async () => {
    const promise = runCliProcess({
      provider: AI_PROVIDER.claudeCode,
      command: '/nonexistent/claude-binary',
      args: [],
      env: buildClaudeEnv({ home: os.tmpdir() }),
      cwd: os.tmpdir(),
    });

    await expect(promise).rejects.toBeInstanceOf(CliNotInstalledError);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    await expect(run({ script: '', signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('kills the whole process group on abort and rejects with the abort reason', async () => {
    const controller = new AbortController();
    const pids: number[] = [];

    const promise = run({
      script: `
        const { spawn } = require('child_process');
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        console.log(process.pid + ' ' + child.pid);
        setInterval(() => {}, 1000);
      `,
      signal: controller.signal,
      onStdoutLine: ({ line }) => {
        pids.push(...line.split(' ').map(Number));
        controller.abort();
      },
    });

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(pids).toHaveLength(2);

    for (const pid of pids) await waitUntilDead({ pid });

    expect(pids.map((pid) => isAlive({ pid }))).toEqual([false, false]);
  });

  it('rejects with the timeout reason of the signal', async () => {
    const signal = AbortSignal.timeout(100);

    await expect(run({ script: 'setInterval(() => {}, 1000)', signal })).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('kills the child and rejects with the error a line handler throws', async () => {
    const marker = new Error('blocked');
    let pid = 0;

    const promise = run({
      script: `console.log(process.pid); setInterval(() => {}, 1000);`,
      onStdoutLine: ({ line }) => {
        pid = Number(line);
        throw marker;
      },
    });

    await expect(promise).rejects.toBe(marker);
    await waitUntilDead({ pid });
    expect(isAlive({ pid })).toBe(false);
  });
});
