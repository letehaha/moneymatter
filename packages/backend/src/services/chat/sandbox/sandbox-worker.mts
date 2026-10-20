/**
 * Entry of a sandbox worker thread. It loads the QuickJS WebAssembly module once, then runs one
 * analysis per message in a fresh runtime that is thrown away afterwards, so no state carries over.
 *
 * This file is loaded by `new Worker(...)` outside the backend's path aliases and outside Jest's
 * transform, in two ways: as this TypeScript file (Node strips the types), and as the bundled
 * `sandbox-worker.js` next to `app.js` in production. It therefore imports no repo module at run time;
 * the guest sources and the limits arrive in each request, and the shared types are `import type`.
 */
import releaseSyncVariant from '@jitl/quickjs-wasmfile-release-sync';
import { parentPort, workerData } from 'node:worker_threads';
import { newQuickJSWASMModuleFromVariant, newVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten';

import type {
  SandboxError,
  SandboxRunRequest,
  SandboxRunResponse,
  SandboxWorkerData,
  SandboxWorkerResult,
} from './sandbox-protocol';

// The backend compiles without the DOM lib, which is where `WebAssembly` is typed; Node provides it at run time.
declare global {
  namespace WebAssembly {
    class Memory {
      constructor(descriptor: { initial: number; maximum?: number });
      readonly buffer: ArrayBuffer;
    }
  }
}

if (!parentPort) throw new Error('sandbox-worker must run inside a worker thread');
const port = parentPort;

const WASM_PAGE_BYTES = 65_536;
const WASM_INITIAL_PAGES = 256;

/**
 * QuickJS's own memory limit does not count what its allocator hands out in this build (the engine
 * cannot ask WebAssembly's allocator for block sizes), so it only refuses single huge requests.
 * The memory the guest can really use is bounded here: the WebAssembly heap has a hard maximum, and the
 * interrupt handler stops a run whose heap grew past the run's limit.
 */
const { wasmMaxBytes } = workerData as SandboxWorkerData;
const wasmMemory = new WebAssembly.Memory({
  initial: WASM_INITIAL_PAGES,
  maximum: Math.floor(wasmMaxBytes / WASM_PAGE_BYTES),
});

const modulePromise: Promise<QuickJSWASMModule> = newQuickJSWASMModuleFromVariant(
  newVariant(releaseSyncVariant, { wasmMemory }),
);
// A failed load surfaces on the first request, with a reply; this only stops an early unhandled rejection.
modulePromise.catch(() => undefined);

interface GuestError {
  phase: string;
  name: string;
  message: string;
}

const MESSAGE_MAX_CHARS = 500;

const trim = (text: string) => (text.length > MESSAGE_MAX_CHARS ? `${text.slice(0, MESSAGE_MAX_CHARS)}...` : text);

/** Maps a QuickJS or guest error to what the model needs to know. Limit errors come from the engine, not the code. */
function classify({ name, message, phase, memoryExceeded }: GuestError & { memoryExceeded: boolean }): SandboxError {
  if (name === 'InternalError') {
    if (memoryExceeded && /interrupted/i.test(message)) {
      return {
        kind: 'memory',
        message: 'The code used up its memory. Work on fewer rows or keep fewer copies of the data.',
      };
    }
    if (/interrupted/i.test(message)) {
      return { kind: 'timeout', message: 'The code used up its CPU time. Process less data or avoid heavy loops.' };
    }
    if (/out of memory/i.test(message)) {
      return {
        kind: 'memory',
        message: 'The code used up its memory. Work on fewer rows or keep fewer copies of the data.',
      };
    }
    if (/stack overflow/i.test(message)) {
      return { kind: 'stack', message: 'The code recursed too deep. Use a loop instead of deep recursion.' };
    }
  }
  if (phase === 'syntax') return { kind: 'syntax', message: trim(`${name}: ${message}`) };
  if (phase === 'output') return { kind: 'output', message: trim(message) };
  return { kind: 'runtime', message: trim(`${name}: ${message}`) };
}

function setGlobal({ vm, name, make }: { vm: QuickJSContext; name: string; make: () => QuickJSHandle }) {
  const handle = make();
  vm.setProp(vm.global, name, handle);
  handle.dispose();
}

function evaluate({ vm, source, filename }: { vm: QuickJSContext; source: string; filename: string }) {
  const result = vm.evalCode(source, filename);
  if (result.error) {
    const dumped = vm.dump(result.error) as { name?: unknown; message?: unknown } | null;
    result.error.dispose();
    return {
      ok: false as const,
      error: {
        phase: 'run',
        name: typeof dumped?.name === 'string' ? dumped.name : 'Error',
        message: typeof dumped?.message === 'string' ? dumped.message : String(dumped),
      } satisfies GuestError,
    };
  }
  return { ok: true as const, handle: result.value };
}

/** Runs the analysis in the given context; the caller disposes the context and the runtime. */
function execute({
  vm,
  request,
  memoryExceeded,
}: {
  vm: QuickJSContext;
  request: SandboxRunRequest;
  memoryExceeded: () => boolean;
}): SandboxWorkerResult {
  const { limits } = request;

  const helpers = evaluate({ vm, source: request.helpersSource, filename: 'helpers.js' });
  if (!helpers.ok)
    return { ok: false, error: classify({ ...helpers.error, memoryExceeded: memoryExceeded() }), recycle: true };
  helpers.handle.dispose();

  setGlobal({ vm, name: '__code', make: () => vm.newString(request.code) });
  setGlobal({ vm, name: '__input', make: () => vm.newString(request.inputJson) });
  setGlobal({ vm, name: '__outputLimit', make: () => vm.newNumber(limits.outputBytes) });

  const driven = evaluate({ vm, source: request.driverSource, filename: 'analysis.js' });
  if (!driven.ok) {
    const error = classify({ ...driven.error, memoryExceeded: memoryExceeded() });
    return { ok: false, error, recycle: error.kind === 'memory' };
  }

  const text = vm.getString(driven.handle);
  driven.handle.dispose();

  if (text.startsWith('O')) return { ok: true, outputJson: text.slice(1) };
  if (text.startsWith('T')) {
    return {
      ok: false,
      error: {
        kind: 'output',
        message: `The output is ${text.slice(1)} characters, over the limit of ${limits.outputBytes} bytes. Return aggregates, not raw rows.`,
      },
    };
  }
  return {
    ok: false,
    error: classify({ ...(JSON.parse(text.slice(1)) as GuestError), memoryExceeded: memoryExceeded() }),
  };
}

async function runAnalysis(request: SandboxRunRequest): Promise<SandboxWorkerResult> {
  const qjs = await modulePromise;
  const { limits } = request;
  let runtime: QuickJSRuntime | undefined;
  let vm: QuickJSContext | undefined;
  let outcome: SandboxWorkerResult;

  try {
    runtime = qjs.newRuntime();
    runtime.setMemoryLimit(limits.memoryBytes);
    runtime.setMaxStackSize(limits.stackBytes);
    const pastDeadline = shouldInterruptAfterDeadline(Date.now() + limits.cpuMs);
    const heapAtStart = wasmMemory.buffer.byteLength;
    let exceeded = false;
    runtime.setInterruptHandler((interruptedRuntime) => {
      if (wasmMemory.buffer.byteLength - heapAtStart > limits.memoryBytes) exceeded = true;
      return exceeded || pastDeadline(interruptedRuntime);
    });
    vm = runtime.newContext();
    outcome = execute({ vm, request, memoryExceeded: () => exceeded });
    // The handler runs between interpreter steps, so a run that ends before its next poll is checked here.
    if (outcome.ok && wasmMemory.buffer.byteLength - heapAtStart > limits.memoryBytes) {
      outcome = {
        ok: false,
        error: classify({ phase: 'run', name: 'InternalError', message: 'interrupted', memoryExceeded: true }),
      };
    }
  } catch (error) {
    // Anything thrown on this side of the engine (a wasm trap, a failed marshal) means the heap is not trusted.
    // Freeing a deeply nested value can overflow the worker's own stack; that is the guest's recursion too.
    outcome =
      error instanceof RangeError && /call stack/i.test(error.message)
        ? {
            ok: false,
            error: classify({ phase: 'run', name: 'InternalError', message: 'stack overflow', memoryExceeded: false }),
            recycle: true,
          }
        : {
            ok: false,
            error: {
              kind: 'crashed',
              message: trim(`The sandbox failed: ${error instanceof Error ? error.message : String(error)}`),
            },
            recycle: true,
          };
  }

  // A worker that is going to be replaced is not cleaned up: freeing the heap of a run that overflowed or
  // crashed can trap, and the replacement discards all of it anyway.
  if (!outcome.recycle) {
    try {
      vm?.dispose();
      runtime?.dispose();
    } catch {
      outcome = { ...outcome, recycle: true };
    }
  }
  // A heap that grew past the guest's limit stays reserved by this worker; a new worker gives it back.
  if (wasmMemory.buffer.byteLength > limits.memoryBytes) outcome = { ...outcome, recycle: true };
  return outcome;
}

port.on('message', (request: SandboxRunRequest) => {
  if (request.type !== 'run') return;

  runAnalysis(request)
    .catch(
      (error: unknown): SandboxWorkerResult => ({
        ok: false,
        error: {
          kind: 'crashed',
          message: trim(`The sandbox failed to start: ${error instanceof Error ? error.message : String(error)}`),
        },
        recycle: true,
      }),
    )
    .then((result) => {
      const response: SandboxRunResponse = { type: 'result', id: request.id, ...result };
      port.postMessage(response);
    });
});
