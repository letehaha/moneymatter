const DEFAULT_MAX_CONCURRENT_RUNS = 4;

/** Run timeout for a feature call (categorization batch, statement parse, invoice extraction). */
const FEATURE_RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** Run timeout for the validation probe on create/update/test. */
export const CLI_PROBE_RUN_TIMEOUT_MS = 90 * 1000;

/** Run timeout for `codex logout` on disconnect. */
export const CLI_LOGOUT_RUN_TIMEOUT_MS = 5 * 1000;

/** How long a probe on a stored connection waits for the slot before reporting it busy. */
export const CLI_PROBE_MAX_WAIT_MS = 2 * 60 * 1000;

export class CliSlotBusyError extends Error {
  constructor() {
    super('The CLI run slot stayed busy past the wait limit');
    this.name = 'CliSlotBusyError';
  }
}

/** `AI_CLI_RUN_TIMEOUT_MS` shortens the feature-run timeout under `NODE_ENV=test` so e2e can exercise it. */
export function getFeatureRunTimeoutMs(): number {
  if (process.env.NODE_ENV === 'test') {
    const override = Number(process.env.AI_CLI_RUN_TIMEOUT_MS);

    if (Number.isFinite(override) && override > 0) return override;
  }

  return FEATURE_RUN_TIMEOUT_MS;
}

function getMaxConcurrentRuns(): number {
  const configured = Number(process.env.AI_CLI_MAX_CONCURRENT_RUNS);

  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_CONCURRENT_RUNS;
}

interface Gate {
  active: number;
  waiters: { grant: () => void }[];
}

const createGate = (): Gate => ({ active: 0, waiters: [] });

const globalGate = createGate();

function releaseGate({ gate, capacity }: { gate: Gate; capacity: () => number }) {
  gate.active -= 1;

  while (gate.active < capacity() && gate.waiters.length > 0) {
    gate.waiters.shift()!.grant();
  }
}

/** FIFO acquisition; a waiter whose signal aborts leaves the queue and rejects with the abort reason. */
function acquireGate({
  gate,
  capacity,
  signal,
}: {
  gate: Gate;
  capacity: () => number;
  signal: AbortSignal | undefined;
}): Promise<() => void> {
  signal?.throwIfAborted();

  const release = () => releaseGate({ gate, capacity });

  if (gate.active < capacity() && gate.waiters.length === 0) {
    gate.active += 1;

    return Promise.resolve(release);
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      grant: () => {
        signal?.removeEventListener('abort', onAbort);
        gate.active += 1;
        resolve(release);
      },
    };

    function onAbort() {
      gate.waiters.splice(gate.waiters.indexOf(waiter), 1);
      reject(signal!.reason);
    }

    gate.waiters.push(waiter);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A plain `Error` named `TimeoutError` rather than a `DOMException`: the classifiers require
 * `instanceof Error`, which a `DOMException` created by the host fails inside a sandboxed realm (jest).
 */
function createTimeoutError(): Error {
  return Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
}

/** A timeout signal driven by `setTimeout` (not `AbortSignal.timeout`), so it can be cleared and faked. */
function createTimeout({ ms }: { ms: number }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(createTimeoutError()), ms);

  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

const anySignal = ({ signals }: { signals: (AbortSignal | undefined)[] }) =>
  AbortSignal.any(signals.filter((signal): signal is AbortSignal => signal !== undefined));

async function acquireSlot({
  abortSignal,
  maxWaitMs,
}: {
  abortSignal: AbortSignal | undefined;
  maxWaitMs: number | undefined;
}): Promise<() => void> {
  const maxWait = maxWaitMs === undefined ? undefined : createTimeout({ ms: maxWaitMs });
  const waitSignal = anySignal({ signals: [abortSignal, maxWait?.signal] });

  try {
    return await acquireGate({ gate: globalGate, capacity: getMaxConcurrentRuns, signal: waitSignal });
  } catch (error) {
    if (maxWait?.signal.aborted && !abortSignal?.aborted) throw new CliSlotBusyError();
    throw error;
  } finally {
    maxWait?.clear();
  }
}

/** Longest `abortAllCliRuns` waits for aborted runs to clean up, inside the 5 s graceful-shutdown budget. */
const ABORT_ALL_SETTLE_CAP_MS = 3 * 1000;

interface TrackedRun {
  connectionKey: string;
  controller: AbortController;
  settled: Promise<unknown>;
}

/** Every call between entering `runWithCliSlot` (queue wait included) and its cleanup finishing. */
const trackedRuns = new Set<TrackedRun>();

/**
 * Aborts the given calls (their signals reach `runCliProcess`, which kills the child's process group)
 * and waits for them to settle, giving up after 3 s so a stuck cleanup cannot eat the caller's budget.
 * All controllers abort synchronously, so a queued waiter leaves before a freed slot could start it.
 */
async function abortAndSettle({ runs, reason }: { runs: TrackedRun[]; reason: Error }): Promise<void> {
  if (runs.length === 0) return;

  for (const { controller } of runs) controller.abort(reason);

  let capTimer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      Promise.all(runs.map(({ settled }) => settled)),
      new Promise<void>((resolve) => {
        capTimer = setTimeout(resolve, ABORT_ALL_SETTLE_CAP_MS);
      }),
    ]);
  } finally {
    clearTimeout(capTimer);
  }
}

const createAbortError = ({ message }: { message: string }) =>
  Object.assign(new Error(message), { name: 'AbortError' });

/**
 * Aborts every queued and running CLI call and waits for them to settle: the Codex home write-back
 * and temp dir removal run on that path. Used by graceful shutdown.
 */
export function abortAllCliRuns(): Promise<void> {
  return abortAndSettle({
    runs: [...trackedRuns],
    reason: createAbortError({ message: 'The CLI run was aborted: the server is shutting down' }),
  });
}

/**
 * Aborts every queued and running CLI call of one connection and waits for them to settle (same
 * 3 s cap). Disconnecting a connection uses it so no run is still using the credential, or the shared
 * Codex home, while the connection is signed out and deleted.
 */
export function abortCliRunsForConnection({ connectionKey }: { connectionKey: string }): Promise<void> {
  return abortAndSettle({
    runs: [...trackedRuns].filter((run) => run.connectionKey === connectionKey),
    reason: createAbortError({ message: 'The CLI run was aborted: the connection is being disconnected' }),
  });
}

/**
 * Runs one CLI call: at most `AI_CLI_MAX_CONCURRENT_RUNS` (default 4) instance-wide, FIFO, whatever the
 * connection. Calls of one `connectionKey` run in parallel; `connectionKey` only tags the call so
 * `abortCliRunsForConnection` can find it. Serializing a credential's users is the credential layer's
 * job (`withCodexHome` shares one home per connection). `abortSignal` bounds the whole call including the queue wait; the run timeout
 * starts only once the slot is held, so time spent behind another run never counts against it.
 * `maxWaitMs` makes a waiter give up with `CliSlotBusyError`. `abortAllCliRuns` aborts the call too.
 */
export function runWithCliSlot<T>({
  connectionKey,
  abortSignal,
  timeoutMs,
  maxWaitMs,
  run,
}: {
  connectionKey: string;
  abortSignal?: AbortSignal;
  timeoutMs: number;
  maxWaitMs?: number;
  run: (params: { signal: AbortSignal }) => Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  const callSignal = anySignal({ signals: [abortSignal, controller.signal] });

  const result = (async () => {
    const release = await acquireSlot({ abortSignal: callSignal, maxWaitMs });
    const runTimeout = createTimeout({ ms: timeoutMs });

    try {
      return await run({ signal: anySignal({ signals: [callSignal, runTimeout.signal] }) });
    } finally {
      runTimeout.clear();
      release();
    }
  })();

  const tracked: TrackedRun = { connectionKey, controller, settled: result.catch(() => undefined) };

  trackedRuns.add(tracked);
  void tracked.settled.then(() => trackedRuns.delete(tracked));

  return result;
}
