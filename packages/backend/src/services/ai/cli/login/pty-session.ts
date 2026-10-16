import * as pty from 'node-pty';
import { stripVTControlCharacters } from 'util';

const MAX_BUFFER_CHARS = 200 * 1000;
const KILL_GRACE_MS = 5 * 1000;
const DEFAULT_COLS = 1000;
const DEFAULT_ROWS = 24;

/** Every Anthropic secret shape (`sk-ant-oat01-...`); applied to any text that leaves a PTY. */
const ANTHROPIC_SECRET_PATTERN = /sk-ant-[A-Za-z0-9_-]+/g;

export function redactSecrets({ text }: { text: string }): string {
  return text.replace(ANTHROPIC_SECRET_PATTERN, '[redacted]');
}

export type PtyWaitResult =
  | { matched: true; match: RegExpExecArray }
  | { matched: false; reason: 'timeout' | 'exited' };

export interface PtySession {
  /**
   * Resolves with the first match of `pattern` on the ANSI-stripped output so far, re-evaluated after
   * every chunk and on exit. A pattern is expected to end in a lookahead for the delimiter that closes
   * the field (`(?=\s)`): a match counts only once that delimiter has arrived, and the end of the stream
   * counts as one, so a chunk boundary inside a URL, code or token never yields a prefix of it.
   */
  waitFor: (params: { pattern: RegExp; timeoutMs: number }) => Promise<PtyWaitResult>;
  write: (params: { data: string }) => void;
  /** SIGTERM to the process group, SIGKILL after a grace period. */
  kill: () => void;
  exited: Promise<{ exitCode: number }>;
  /** The last non-empty screen lines with secrets redacted, for failure messages. */
  getLastLines: (params: { count: number }) => string[];
}

interface Waiter {
  pattern: RegExp;
  settle: (result: PtyWaitResult) => void;
}

/**
 * Spawns a command in a PTY. The child leads its own session, so killing the group takes down
 * everything it started. The raw output is kept in memory only, capped, and never logged.
 */
export function startPtySession({
  command,
  args,
  env,
  cwd,
  cols = DEFAULT_COLS,
}: {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  cols?: number;
}): PtySession {
  const child = pty.spawn(command, args, { name: 'xterm-256color', cols, rows: DEFAULT_ROWS, cwd, env });

  let raw = '';
  let hasExited = false;
  const waiters = new Set<Waiter>();

  const readText = () => stripVTControlCharacters(raw);

  const evaluate = ({ waiter }: { waiter: Waiter }) => {
    const haystack = hasExited ? `${readText()}\n` : readText();
    const match = waiter.pattern.exec(haystack);

    if (match) {
      waiter.settle({ matched: true, match });
    } else if (hasExited) {
      waiter.settle({ matched: false, reason: 'exited' });
    }
  };

  let resolveExited!: (value: { exitCode: number }) => void;
  const exited = new Promise<{ exitCode: number }>((resolve) => {
    resolveExited = resolve;
  });

  child.onData((chunk) => {
    raw += chunk;
    if (raw.length > MAX_BUFFER_CHARS) raw = raw.slice(raw.length - MAX_BUFFER_CHARS);

    for (const waiter of waiters) evaluate({ waiter });
  });

  child.onExit(({ exitCode }) => {
    hasExited = true;
    for (const waiter of waiters) evaluate({ waiter });
    resolveExited({ exitCode });
  });

  return {
    waitFor: ({ pattern, timeoutMs }) =>
      new Promise<PtyWaitResult>((resolve) => {
        const timer = setTimeout(() => waiter.settle({ matched: false, reason: 'timeout' }), timeoutMs);
        const waiter: Waiter = {
          // Stateless matching: a global or sticky flag would carry `lastIndex` between evaluations.
          pattern: new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')),
          settle: (result) => {
            clearTimeout(timer);
            waiters.delete(waiter);
            resolve(result);
          },
        };

        waiters.add(waiter);
        evaluate({ waiter });
      }),

    write: ({ data }) => {
      if (!hasExited) child.write(data);
    },

    kill: () => {
      if (hasExited) return;

      const signalGroup = ({ signal }: { signal: NodeJS.Signals }) => {
        try {
          process.kill(-child.pid, signal);
        } catch {
          try {
            child.kill(signal);
          } catch {
            // Already gone.
          }
        }
      };

      signalGroup({ signal: 'SIGTERM' });

      const forceTimer = setTimeout(() => {
        if (!hasExited) signalGroup({ signal: 'SIGKILL' });
      }, KILL_GRACE_MS);

      forceTimer.unref();
      void exited.then(() => clearTimeout(forceTimer));
    },

    exited,

    getLastLines: ({ count }) =>
      redactSecrets({ text: readText() })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-count),
  };
}
