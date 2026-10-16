import { describe, expect, it } from '@jest/globals';
import * as pty from 'node-pty';

describe('node-pty', () => {
  it('spawns a child in a PTY and reads its output', async () => {
    const child = pty.spawn(process.execPath, ['-e', "process.stdout.write('ok')"], {
      name: 'xterm',
      cols: 80,
      rows: 24,
      env: { PATH: process.env.PATH ?? '' },
    });

    const output = await new Promise<string>((resolve) => {
      let buffer = '';
      child.onData((chunk) => {
        buffer += chunk;
      });
      child.onExit(() => resolve(buffer));
    });

    expect(output).toBe('ok');
  });
});
