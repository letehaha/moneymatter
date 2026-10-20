import {
  CHAT_ANALYSIS_MAX_INPUTS,
  CHAT_ANALYSIS_MAX_ROWS,
  CHAT_SANDBOX_LIMITS,
  type ChatAnalysisInputSource,
} from '@bt/shared/types';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { CHAT_EXCLUDED_TOOLS } from '../policies/excluded';
import { READ_TOOL_PAGINATION } from '../policies/explicit';
import { type AnalysisOutput, runSandboxedAnalysis } from '../sandbox/run-sandboxed-analysis';
import { readFromCatalog } from './catalog-read';
import { defineNativeTool } from './native-tool';
import { capForModel, toolFailure, toolSuccess } from './result-text';
import type { ChatToolContext, ChatToolResult } from './types';

/** Pages one input may take, a bound on top of the row cap for tools whose pages come back short. */
const MAX_PAGES = 100;

/** How many earlier reads a refusal lists, so the model can pick the right id. */
const MAX_LISTED_READS = 10;

const INPUT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const DESCRIPTION = `Run JavaScript on data your read tools returned, for sums, groupings, comparisons and trends the stats tools do not give. Inputs are named reads, never numbers you typed: fromCall (the id of a read you already made) or tool + args (any read tool; allPages: true joins every page of a list tool such as search_transactions, up to ${CHAT_ANALYSIS_MAX_ROWS} rows, into one result of the same shape). The code is a function body: read input.<name>, which is the whole result exactly as the read returned it, so a list is one of its fields (input.tx.transactions for search_transactions, not input.tx itself), then return { values, tables, charts, kpis }. values is any JSON you want back; tables, charts and kpis map a key to a spec like render_table, render_chart and render_kpis take, and are shown with source: { analysisId, key }. Amounts are decimals. Helpers: sum, mean, median, percentile(items, p, selector), groupBy, sortBy(items, selector, 'asc'|'desc'), movingAverage(items, window, selector), byMonth(items, dateSelector, valueSelector), minor.sum(items, decimals, selector) for exact money totals; a selector is a property name or a function. No network, clock, timers or require. Return aggregates, not rows (256 KB). Errors name their kind: fix the code and call again.`;

const inputSchema = z.object({
  name: z.string().regex(INPUT_NAME_PATTERN, 'An input name starts with a letter and uses letters, digits and _'),
  fromCall: z.string().min(1).max(200).optional().describe('Id of a read you already made in this conversation turn'),
  tool: z.string().min(1).max(100).optional().describe('A read tool to run for this input'),
  args: z.record(z.string(), z.unknown()).optional().describe("The tool's arguments"),
  allPages: z.boolean().optional().describe('With tool: read every page, up to the row cap'),
});

type AnalysisInput = z.infer<typeof inputSchema>;

type ResolvedInput =
  | { ok: true; name: string; value: unknown; source: ChatAnalysisInputSource }
  | { ok: false; text: string };

const parseJsonOrText = ({ text }: { text: string }): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** The list a paged result is made of: the result itself, or the longest array among its fields. */
function findRows({ parsed }: { parsed: unknown }): { key: string | null; rows: unknown[] } | null {
  if (Array.isArray(parsed)) return { key: null, rows: parsed };
  if (parsed === null || typeof parsed !== 'object') return null;

  const arrays = Object.entries(parsed).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]));
  if (arrays.length === 0) return null;

  const [key, rows] = arrays.reduce((best, entry) => (entry[1].length > best[1].length ? entry : best));
  return { key, rows };
}

async function readAllPages({
  ctx,
  input,
}: {
  ctx: ChatToolContext;
  input: AnalysisInput;
}): Promise<{ ok: true; value: unknown } | { ok: false; text: string }> {
  const name = input.tool!;
  const pagination = READ_TOOL_PAGINATION[name];
  const entry = ctx.catalog.find((candidate) => candidate.name === name);
  if (!pagination || !entry) {
    const pageable = Object.keys(READ_TOOL_PAGINATION).join(', ');
    return {
      ok: false,
      text: `${name} cannot be read page by page. Read it without allPages. Pageable tools: ${pageable}.`,
    };
  }

  const { limitArg, offsetArg, pageArg, maxLimit } = pagination;
  const base = input.args ?? {};
  const startArg = offsetArg ?? pageArg!;
  const firstPosition = offsetArg ? 0 : 1;
  const requested = Number(base[startArg]);
  let position = Number.isInteger(requested) && requested >= firstPosition ? requested : firstPosition;

  const collected: unknown[] = [];
  let template: unknown = null;
  let key: string | null = null;
  let pages = 0;
  let truncated = false;

  while (pages < MAX_PAGES) {
    const pageArgs = { ...base, [limitArg]: maxLimit, [startArg]: position };
    const read = await readFromCatalog({ ctx, entry, input: pageArgs });
    if (!read.ok) return { ok: false, text: read.failure.text };

    const parsed = parseJsonOrText({ text: read.fullText });
    const found = findRows({ parsed });
    if (!found) {
      if (pages === 0) return { ok: false, text: `${name} returned no list, so it cannot be read page by page.` };
      break;
    }

    pages++;
    if (pages === 1) {
      template = parsed;
      key = found.key;
    }
    collected.push(...found.rows);

    if (found.rows.length < maxLimit) break;
    if (collected.length >= CHAT_ANALYSIS_MAX_ROWS) {
      truncated = true;
      break;
    }
    position += offsetArg ? maxLimit : 1;
  }

  const rows = collected.slice(0, CHAT_ANALYSIS_MAX_ROWS);
  if (key === null) return { ok: true, value: rows };

  const shape = template as Record<string, unknown>;
  return {
    ok: true,
    value: {
      ...shape,
      [key]: rows,
      ...(typeof shape.count === 'number' ? { count: rows.length } : {}),
      pages,
      truncated,
    },
  };
}

async function resolveInput({ ctx, input }: { ctx: ChatToolContext; input: AnalysisInput }): Promise<ResolvedInput> {
  const { name } = input;
  const sources = [input.fromCall !== undefined, input.tool !== undefined].filter(Boolean).length;
  if (sources !== 1) {
    return {
      ok: false,
      text: `Input "${name}" needs exactly one source: fromCall (an earlier read) or tool (a read tool to run).`,
    };
  }

  if (input.fromCall !== undefined) {
    if (input.allPages !== undefined || input.args !== undefined) {
      return { ok: false, text: `Input "${name}": args and allPages go with tool, not with fromCall.` };
    }

    const earlier = ctx.state.reads.get(input.fromCall);
    if (!earlier) {
      const available = [...ctx.state.reads.values()]
        .slice(-MAX_LISTED_READS)
        .map((read) => `${read.callId} (${read.toolName})`)
        .join(', ');
      return {
        ok: false,
        text: `Input "${name}": no read with call id "${input.fromCall}" was made in this run. ${
          available ? `Reads you can use: ${available}.` : 'No reads were made yet; use tool + args to read the data.'
        }`,
      };
    }

    return { ok: true, name, value: parseJsonOrText({ text: earlier.fullText }), source: { fromCall: input.fromCall } };
  }

  const toolName = input.tool!;
  const entry = ctx.catalog.find((candidate) => candidate.name === toolName);
  if (!entry || toolName in CHAT_EXCLUDED_TOOLS) {
    return { ok: false, text: `Input "${name}": ${toolName} is not a tool you can read from. Use a read tool.` };
  }
  if (entry.access !== 'read') {
    return {
      ok: false,
      text: `Input "${name}": ${toolName} changes data. An input is a read tool, so use one that only reads.`,
    };
  }

  const source: ChatAnalysisInputSource = {
    tool: toolName,
    args: input.args ?? {},
    ...(input.allPages ? { allPages: true } : {}),
  };

  if (input.allPages) {
    const paged = await readAllPages({ ctx, input });
    return paged.ok
      ? { ok: true, name, value: paged.value, source }
      : { ok: false, text: `Input "${name}": ${paged.text}` };
  }

  const read = await readFromCatalog({ ctx, entry, input: input.args ?? {} });
  if (!read.ok) return { ok: false, text: `Input "${name}": ${read.failure.text}` };

  return { ok: true, name, value: parseJsonOrText({ text: read.fullText }), source };
}

const keyed = <T>(specs: Record<string, T> | undefined, describe: (spec: T) => unknown) =>
  specs ? Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, describe(spec)])) : undefined;

/** What the model learns of an output: the values in full, and the keys (with a title) of what it can show. */
function describeOutput({ analysisId, output }: { analysisId: string; output: AnalysisOutput }) {
  return {
    analysisId,
    values: output.values,
    charts: keyed(output.charts, (spec) => ({ kind: spec.kind, title: spec.title })),
    tables: keyed(output.tables, (spec) => ({ title: spec.title, rows: spec.rows.length })),
    kpis: keyed(output.kpis, (spec) => ({ items: spec.items.length })),
  };
}

export function createRunAnalysisTool({ ctx }: { ctx: ChatToolContext }) {
  return defineNativeTool({
    name: 'run_analysis',
    description: DESCRIPTION,
    shape: {
      code: z
        .string()
        .min(1)
        .max(CHAT_SANDBOX_LIMITS.codeBytes)
        .describe('The body of a function that returns the output'),
      inputs: z
        .array(inputSchema)
        .max(CHAT_ANALYSIS_MAX_INPUTS)
        .optional()
        .describe('Named data, read as input.<name>'),
    },
    run: async ({ args }): Promise<ChatToolResult> => {
      const resolved: Array<Extract<ResolvedInput, { ok: true }>> = [];
      const names = new Set<string>();
      for (const input of args.inputs ?? []) {
        if (names.has(input.name))
          return toolFailure({ text: `Two inputs are named "${input.name}". Names must differ.` });
        names.add(input.name);

        const outcome = await resolveInput({ ctx, input });
        if (!outcome.ok) return toolFailure({ text: outcome.text });
        resolved.push(outcome);
      }

      const taken = ctx.state.limits.take({ kind: 'analyses' });
      if (!taken.ok) {
        await ctx.notice({ key: taken.noticeKey, params: { limit: taken.limit } });
        return toolFailure({ text: taken.message });
      }

      const analysisId = randomUUID();
      await ctx.run.emit({
        type: 'part.started',
        part: {
          type: 'analysis',
          id: analysisId,
          code: args.code,
          inputs: resolved.map(({ name, source }) => ({ name, source })),
          status: 'running',
        },
      });

      const result = await runSandboxedAnalysis({
        code: args.code,
        inputs: Object.fromEntries(resolved.map(({ name, value }) => [name, value])),
      });

      if (!result.ok) {
        const message = `${result.error.kind}: ${result.error.message}`;
        await ctx.run.emit({
          type: 'part.updated',
          partId: analysisId,
          patch: { status: 'error', error: message, durationMs: result.durationMs },
        });
        const hint = /is not a function|not iterable|undefined|null/.test(result.error.message)
          ? ' An input is the whole result of a read, so its list is a field of it (for example input.tx.transactions).'
          : '';
        return toolFailure({ text: `The analysis failed (${message}).${hint}` });
      }

      ctx.state.analyses.set(analysisId, result.output);
      ctx.state.sources.push({ type: 'analysis', partId: analysisId });
      await ctx.run.emit({
        type: 'part.updated',
        partId: analysisId,
        patch: { status: 'ok', output: result.output, durationMs: result.durationMs },
      });

      const answer = describeOutput({ analysisId, output: result.output });
      const text = capForModel({ text: JSON.stringify(answer) });
      const shown = ['charts', 'tables', 'kpis'].flatMap((kind) => Object.keys(answer[kind as 'charts'] ?? {}));

      return toolSuccess({
        text: ctx.run.wrapUntrusted?.({ kind: 'toolResult', text }) ?? text,
        summary: `analysis ${analysisId}: ${Object.keys(result.output.values ?? {}).length} values, ${shown.length} visuals`,
      });
    },
  });
}
