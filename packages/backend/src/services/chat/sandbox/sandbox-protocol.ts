/**
 * The messages between the pool (main thread) and a sandbox worker. This file holds types only: the
 * worker imports it with `import type`, so nothing of it exists at run time and the worker needs no
 * path alias or extension to load.
 */

/** What went wrong in a sandbox run; the model reads the kind to decide how to fix its code. */
export type SandboxErrorKind =
  /** The code does not parse. */
  | 'syntax'
  /** The code threw. */
  | 'runtime'
  /** The code used up its CPU time or the wall clock. */
  | 'timeout'
  /** The code used up its memory. */
  | 'memory'
  /** The code recursed too deep. */
  | 'stack'
  /** The code or the input is over its size bound, or the input is not JSON. */
  | 'input'
  /** The code returned more than the output bound, or something that is not JSON. */
  | 'output'
  /** The code returned something that is not a valid analysis output. */
  | 'invalidOutput'
  /** The worker died; the pool has replaced it. */
  | 'crashed'
  /** Too many analyses are waiting for a worker. */
  | 'busy';

export interface SandboxError {
  kind: SandboxErrorKind;
  message: string;
}

export interface SandboxLimits {
  memoryBytes: number;
  stackBytes: number;
  cpuMs: number;
  wallMs: number;
  outputBytes: number;
}

/** What a worker is started with (its `workerData`). */
export interface SandboxWorkerData {
  /** Hard cap of the WebAssembly heap the worker's QuickJS runs in. */
  wasmMaxBytes: number;
}

export interface SandboxRunRequest {
  type: 'run';
  id: number;
  code: string;
  inputJson: string;
  helpersSource: string;
  driverSource: string;
  limits: SandboxLimits;
}

export type SandboxWorkerResult = ({ ok: true; outputJson: string } | { ok: false; error: SandboxError }) & {
  /** The worker must not be reused: its wasm heap may be damaged or grown large. */
  recycle?: boolean;
};

export type SandboxRunResponse = { type: 'result'; id: number } & SandboxWorkerResult;
