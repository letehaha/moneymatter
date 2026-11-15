import { CHAT_SANDBOX_LIMITS } from '@bt/shared/types';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { GUEST_DRIVER_SOURCE, GUEST_HELPERS_SOURCE } from './guest-helpers';
import type {
  SandboxError,
  SandboxLimits,
  SandboxRunRequest,
  SandboxRunResponse,
  SandboxWorkerData,
  SandboxWorkerResult,
} from './sandbox-protocol';

const DEFAULT_POOL_SIZE = 2;
const DEFAULT_MAX_QUEUED = 20;
/** A QuickJS heap that grew to the memory limit stays reserved by its worker; a fresh worker gives it back. */
const DEFAULT_MAX_RUNS_PER_WORKER = 50;
/** The worker thread's own V8 heap. QuickJS's memory lives in WebAssembly memory and is bounded separately. */
const WORKER_OLD_GENERATION_MB = 128;
/**
 * The WebAssembly heap a worker may grow to, as a multiple of the guest's memory limit. A run is stopped
 * once its heap grows past the limit, but the check runs between interpreter steps, so one built-in can
 * overshoot; this is the hard wall behind it.
 */
const WASM_HEAP_FACTOR = 3;

export interface SandboxPool {
  /** Runs one analysis in a worker, waiting for a free one. It never rejects: a failure is a result. */
  run: (params: { code: string; inputJson: string }) => Promise<SandboxWorkerResult>;
  /** Stops every worker now. Jobs running or waiting fail as `crashed`; the pool starts new workers on demand. */
  terminateWorkers: () => Promise<void>;
  workerCount: () => number;
}

interface PoolWorker {
  worker: Worker;
  runs: number;
  retired: boolean;
  active?: { timer: NodeJS.Timeout; settle: (result: SandboxWorkerResult) => void };
}

interface QueuedJob {
  code: string;
  inputJson: string;
  settle: (result: SandboxWorkerResult) => void;
}

const failure = ({ kind, message }: SandboxError): SandboxWorkerResult => ({ ok: false, error: { kind, message } });

/**
 * The worker is TypeScript source when the backend itself runs from source (dev server, Jest) and a
 * second bundle next to `app.js` in production. Node runs the TypeScript file by stripping its types.
 */
function resolveWorkerFile() {
  return __filename.endsWith('.ts')
    ? path.join(__dirname, 'sandbox-worker.mts')
    : path.join(__dirname, 'sandbox-worker.js');
}

export function createSandboxPool({
  size = DEFAULT_POOL_SIZE,
  limits: limitOverrides = {},
  maxQueued = DEFAULT_MAX_QUEUED,
  maxRunsPerWorker = DEFAULT_MAX_RUNS_PER_WORKER,
}: {
  size?: number;
  limits?: Partial<SandboxLimits>;
  maxQueued?: number;
  maxRunsPerWorker?: number;
} = {}): SandboxPool {
  const limits: SandboxLimits = {
    memoryBytes: CHAT_SANDBOX_LIMITS.memoryBytes,
    stackBytes: CHAT_SANDBOX_LIMITS.stackBytes,
    cpuMs: CHAT_SANDBOX_LIMITS.cpuMs,
    wallMs: CHAT_SANDBOX_LIMITS.wallMs,
    outputBytes: CHAT_SANDBOX_LIMITS.outputBytes,
    ...limitOverrides,
  };
  const workers = new Set<PoolWorker>();
  const queue: QueuedJob[] = [];
  let nextRequestId = 1;

  /** Removes a worker for good and fails the job it was running, if any. */
  function retire({ poolWorker, result }: { poolWorker: PoolWorker; result: SandboxWorkerResult }) {
    if (poolWorker.retired) return;
    poolWorker.retired = true;
    workers.delete(poolWorker);

    const { active } = poolWorker;
    poolWorker.active = undefined;
    if (active) {
      clearTimeout(active.timer);
      active.settle(result);
    }
    poolWorker.worker.terminate().catch(() => undefined);
    pump();
  }

  function spawn(): PoolWorker {
    const worker = new Worker(resolveWorkerFile(), {
      // Nothing from the host's environment or Node flags reaches the worker.
      env: {},
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: WORKER_OLD_GENERATION_MB },
      workerData: { wasmMaxBytes: limits.memoryBytes * WASM_HEAP_FACTOR } satisfies SandboxWorkerData,
    });
    worker.unref();

    const poolWorker: PoolWorker = { worker, runs: 0, retired: false };

    worker.on('message', (response: SandboxRunResponse) => {
      if (poolWorker.retired || response.type !== 'result' || !poolWorker.active) return;

      const { type: _type, id: _id, ...result } = response;
      const { active } = poolWorker;
      clearTimeout(active.timer);
      poolWorker.active = undefined;
      poolWorker.runs++;
      active.settle(result);

      if (result.recycle || poolWorker.runs >= maxRunsPerWorker) {
        retire({ poolWorker, result: failure({ kind: 'crashed', message: 'The sandbox worker was recycled' }) });
      } else {
        pump();
      }
    });
    worker.on('error', (error: Error & { code?: string }) => {
      retire({
        poolWorker,
        result:
          error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? failure({ kind: 'memory', message: 'The code used up the memory of its worker. Work on fewer rows.' })
            : failure({ kind: 'crashed', message: `The sandbox worker failed: ${error.message}` }),
      });
    });
    worker.on('exit', () => {
      retire({ poolWorker, result: failure({ kind: 'crashed', message: 'The sandbox worker stopped unexpectedly' }) });
    });

    workers.add(poolWorker);
    return poolWorker;
  }

  function dispatch({ poolWorker, job }: { poolWorker: PoolWorker; job: QueuedJob }) {
    const timer = setTimeout(() => {
      retire({
        poolWorker,
        result: failure({
          kind: 'timeout',
          message: `The code did not finish within ${limits.wallMs / 1000} seconds. Process less data or avoid heavy loops.`,
        }),
      });
    }, limits.wallMs);
    timer.unref();
    poolWorker.active = { timer, settle: job.settle };

    const request: SandboxRunRequest = {
      type: 'run',
      id: nextRequestId++,
      code: job.code,
      inputJson: job.inputJson,
      helpersSource: GUEST_HELPERS_SOURCE,
      driverSource: GUEST_DRIVER_SOURCE,
      limits,
    };
    // A worker thread's port has no origin, unlike window.postMessage.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    poolWorker.worker.postMessage(request);
  }

  function pump() {
    while (queue.length > 0) {
      const idle = [...workers].find((poolWorker) => !poolWorker.active);
      const poolWorker = idle ?? (workers.size < size ? spawn() : undefined);
      if (!poolWorker) return;

      const job = queue.shift();
      if (job) dispatch({ poolWorker, job });
    }
  }

  return {
    run: ({ code, inputJson }) =>
      new Promise<SandboxWorkerResult>((resolve) => {
        if (queue.length >= maxQueued) {
          resolve(failure({ kind: 'busy', message: 'Too many analyses are waiting. Try again in a moment.' }));
          return;
        }
        queue.push({ code, inputJson, settle: resolve });
        pump();
      }),

    terminateWorkers: async () => {
      for (const job of queue.splice(0)) {
        job.settle(failure({ kind: 'crashed', message: 'The sandbox was stopped' }));
      }
      const stopping = [...workers].map((poolWorker) => {
        const done = poolWorker.worker.terminate();
        retire({ poolWorker, result: failure({ kind: 'crashed', message: 'The sandbox was stopped' }) });
        return done;
      });
      await Promise.allSettled(stopping);
    },

    workerCount: () => workers.size,
  };
}

let defaultPool: SandboxPool | undefined;

/** The pool every chat run shares, created on first use. */
export function getDefaultSandboxPool(): SandboxPool {
  defaultPool ??= createSandboxPool();
  return defaultPool;
}
