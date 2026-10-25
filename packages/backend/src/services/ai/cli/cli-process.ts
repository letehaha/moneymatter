import { AICliProvider } from '@bt/shared/types';
import { spawn } from 'child_process';

import { toSpawnEnv } from './cli-env';
import { mapSpawnError } from './cli-errors';

const STDERR_TAIL_BYTES = 8 * 1024;
const KILL_GRACE_MS = 5 * 1000;

interface CliProcessResult {
  exitCode: number | null;
  termSignal: NodeJS.Signals | null;
  /** Last 8 KB of stderr, for failure messages. */
  stderrTail: string;
}

/** The signal's reason when it is an `AbortError`/`TimeoutError`, otherwise a plain `AbortError`. */
function getAbortReason({ signal }: { signal: AbortSignal }): Error {
  const { reason } = signal;

  // Duck-typed: a caller's reason may be a DOMException, which is not `instanceof Error` across realms (jest sandboxes).
  const name = (reason as { name?: unknown } | undefined)?.name;

  if (name === 'AbortError' || name === 'TimeoutError') return reason as Error;

  return Object.assign(new Error('The CLI run was aborted'), { name: 'AbortError' });
}

/**
 * Runs a CLI once. The child leads its own process group, so an abort (or a thrown `onStdoutLine`)
 * takes down everything it spawned: SIGTERM, then SIGKILL after a grace period. The promise settles
 * only after the child closed. Resolves with the exit state; rejects with the abort reason, the error
 * `onStdoutLine` threw, or a mapped spawn failure (`CliNotInstalledError` for a missing binary).
 */
export function runCliProcess({
  provider,
  command,
  args,
  env,
  cwd,
  stdin,
  signal,
  onStdoutLine,
}: {
  provider: AICliProvider;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  stdin?: string;
  signal?: AbortSignal;
  /** May throw to stop the run: the process group is killed and the run rejects with that error. */
  onStdoutLine?: (params: { line: string }) => void;
}): Promise<CliProcessResult> {
  if (signal?.aborted) return Promise.reject(getAbortReason({ signal }));

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: toSpawnEnv({ env }),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    let failure: { error: unknown } | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    let stdoutBuffer = '';
    let stderrTail = '';

    const killGroup = ({ killSignal }: { killSignal: NodeJS.Signals }) => {
      if (!child.pid) return;

      try {
        process.kill(-child.pid, killSignal);
      } catch {
        // The group is already gone.
      }
    };

    const terminate = ({ error }: { error: unknown }) => {
      if (failure) return;

      failure = { error };
      killGroup({ killSignal: 'SIGTERM' });
      killTimer = setTimeout(() => killGroup({ killSignal: 'SIGKILL' }), KILL_GRACE_MS);
      killTimer.unref();
    };

    const onAbort = () => terminate({ error: getAbortReason({ signal: signal! }) });

    const finish = ({ settle }: { settle: () => void }) => {
      if (settled) return;

      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      settle();
    };

    const handleLine = ({ rawLine }: { rawLine: string }) => {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

      if (!line || failure || !onStdoutLine) return;

      try {
        onStdoutLine({ line });
      } catch (error) {
        terminate({ error });
      }
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (error) => {
      finish({ settle: () => reject(mapSpawnError({ provider, error })) });
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;

      let newline = stdoutBuffer.indexOf('\n');

      while (newline !== -1) {
        handleLine({ rawLine: stdoutBuffer.slice(0, newline) });
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        newline = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });

    child.on('close', (exitCode, termSignal) => {
      if (stdoutBuffer) {
        handleLine({ rawLine: stdoutBuffer });
        stdoutBuffer = '';
      }

      // Reap anything the child left behind in its group.
      if (failure) killGroup({ killSignal: 'SIGKILL' });

      finish({
        settle: () => {
          if (failure) return reject(failure.error);

          resolve({ exitCode, termSignal, stderrTail });
        },
      });
    });

    child.stdin.on('error', () => {
      // The child may exit before reading stdin; its exit state is what matters.
    });
    child.stdin.end(stdin);
  });
}
