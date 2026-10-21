import {
  CHAT_SANDBOX_LIMITS,
  type ChatChartSpec,
  type ChatKpisSpec,
  type ChatTableSpec,
  CHAT_VISUAL_LIMITS,
} from '@bt/shared/types';
import { z } from 'zod';

import { chatChartSpecSchema, chatKpisSpecSchema, chatTableSpecSchema } from '../visuals/visual-spec';
import { getDefaultSandboxPool, type SandboxPool } from './sandbox-pool';
import type { SandboxError } from './sandbox-protocol';

/**
 * What an analysis returns. `values` is free-form JSON for the model to read; `tables`, `charts` and
 * `kpis` are visual specs a `render_*` tool can show by their key. Keys start with a letter, so none
 * of them can be `__proto__` or another name that means something to an object.
 */
export interface AnalysisOutput {
  values?: Record<string, unknown>;
  tables?: Record<string, ChatTableSpec>;
  charts?: Record<string, ChatChartSpec>;
  kpis?: Record<string, ChatKpisSpec>;
}

export type SandboxResult =
  | { ok: true; output: AnalysisOutput; durationMs: number }
  | { ok: false; error: SandboxError; durationMs: number };

const ERROR_MESSAGE_MAX_CHARS = 800;
const MAX_ISSUES_SHOWN = 4;

const OUTPUT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const outputKey = z.string().regex(OUTPUT_KEY_PATTERN, 'Output keys start with a letter and use letters, digits and _');

const withinVisualSize = <T extends z.ZodType>(schema: T) =>
  schema.superRefine((spec, ctx) => {
    if (Buffer.byteLength(JSON.stringify(spec)) > CHAT_VISUAL_LIMITS.maxBytes) {
      ctx.addIssue({ code: 'custom', message: `A visual is limited to ${CHAT_VISUAL_LIMITS.maxBytes} bytes` });
    }
  });

const analysisOutputSchema = z
  .object({
    values: z.record(outputKey, z.unknown()).optional(),
    tables: z.record(outputKey, withinVisualSize(chatTableSpecSchema)).optional(),
    charts: z.record(outputKey, withinVisualSize(chatChartSpecSchema)).optional(),
    kpis: z.record(outputKey, withinVisualSize(chatKpisSpecSchema)).optional(),
  })
  .strict();

const describeIssues = (error: z.ZodError) => {
  const shown = error.issues
    .slice(0, MAX_ISSUES_SHOWN)
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
  const more = error.issues.length - shown.length;
  const text = `The output is not valid. ${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}`;
  return text.length > ERROR_MESSAGE_MAX_CHARS ? `${text.slice(0, ERROR_MESSAGE_MAX_CHARS)}...` : text;
};

const parseOutput = (outputJson: string): { ok: true; output: AnalysisOutput } | { ok: false; error: SandboxError } => {
  if (Buffer.byteLength(outputJson) > CHAT_SANDBOX_LIMITS.outputBytes) {
    return {
      ok: false,
      error: {
        kind: 'output',
        message: `The output is over the limit of ${CHAT_SANDBOX_LIMITS.outputBytes} bytes. Return aggregates, not raw rows.`,
      },
    };
  }

  let parsed: unknown;
  try {
    // A `__proto__` key would be an own property here, which `Object.assign` and friends turn into a prototype.
    parsed = JSON.parse(outputJson, (key, value: unknown) => (key === '__proto__' ? undefined : value));
  } catch {
    return { ok: false, error: { kind: 'output', message: 'The output is not valid JSON' } };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: {
        kind: 'invalidOutput',
        message: 'The output must be an object like { values, tables, charts, kpis }',
      },
    };
  }

  const checked = analysisOutputSchema.safeParse(parsed);
  if (!checked.success) return { ok: false, error: { kind: 'invalidOutput', message: describeIssues(checked.error) } };

  return { ok: true, output: checked.data as AnalysisOutput };
};

const serializeInputs = (
  inputs: Record<string, unknown>,
): { ok: true; json: string } | { ok: false; error: SandboxError } => {
  let json: string | undefined;
  try {
    json = JSON.stringify(inputs);
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'input',
        message: `The inputs are not JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
      },
    };
  }
  if (json === undefined) return { ok: false, error: { kind: 'input', message: 'The inputs are not JSON' } };

  if (Buffer.byteLength(json) > CHAT_SANDBOX_LIMITS.inputBytes) {
    return {
      ok: false,
      error: { kind: 'input', message: `The inputs are over the limit of ${CHAT_SANDBOX_LIMITS.inputBytes} bytes` },
    };
  }
  return { ok: true, json };
};

/**
 * Runs the model's JavaScript on `inputs` (read as `input` in the code) in an isolated QuickJS
 * sandbox and validates what it returns. It never throws: every failure is an `error` with a kind the
 * model can act on.
 */
export async function runSandboxedAnalysis({
  code,
  inputs,
  pool = getDefaultSandboxPool(),
}: {
  code: string;
  inputs: Record<string, unknown>;
  /** Tests give their own pool, to run with tighter limits. */
  pool?: SandboxPool;
}): Promise<SandboxResult> {
  const startedAt = Date.now();
  const done = (result: { ok: true; output: AnalysisOutput } | { ok: false; error: SandboxError }): SandboxResult => ({
    ...result,
    durationMs: Date.now() - startedAt,
  });

  if (Buffer.byteLength(code) > CHAT_SANDBOX_LIMITS.codeBytes) {
    return done({
      ok: false,
      error: { kind: 'input', message: `The code is over the limit of ${CHAT_SANDBOX_LIMITS.codeBytes} bytes` },
    });
  }

  const serialized = serializeInputs(inputs);
  if (!serialized.ok) return done(serialized);

  const result = await pool.run({ code, inputJson: serialized.json });
  if (!result.ok) return done({ ok: false, error: result.error });

  return done(parseOutput(result.outputJson));
}

/** Stops the shared pool's workers; the next analysis starts new ones. */
export async function shutdownSandbox() {
  await getDefaultSandboxPool().terminateWorkers();
}
