import { CHAT_VISUAL_LIMITS, type ChatVisualSpec } from '@bt/shared/types';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { resolveEntityLabels } from '../visuals/resolve-entity-labels';
import {
  chatChartSpecSchema,
  chatKpisSpecSchema,
  chatTableSpecSchema,
  chatVisualSpecSchema,
} from '../visuals/visual-spec';
import { defineNativeTool } from './native-tool';
import { toolFailure, toolSuccess } from './result-text';
import type { ChatToolContext } from './types';

const OUTPUT_COLLECTIONS = { chart: 'charts', table: 'tables', kpis: 'kpis' } as const;

const analysisSourceSchema = z.object({
  analysisId: z.uuid().describe('The analysisId run_analysis returned'),
  key: z.string().min(1).max(40).describe('A key of its charts, tables or kpis'),
});

/** The spec an earlier analysis of the run returned under `key`, so the model need not copy its data. */
function specFromAnalysis({
  ctx,
  type,
  source,
}: {
  ctx: ChatToolContext;
  type: ChatVisualSpec['type'];
  source: z.infer<typeof analysisSourceSchema>;
}): { ok: true; spec: unknown } | { ok: false; text: string } {
  const output = ctx.state.analyses.get(source.analysisId);
  if (!output) {
    return {
      ok: false,
      text: `No successful analysis with id ${source.analysisId} ran in this conversation turn. Call run_analysis first.`,
    };
  }

  const collection = OUTPUT_COLLECTIONS[type];
  const specs: Record<string, unknown> = output[collection] ?? {};
  if (!Object.hasOwn(specs, source.key)) {
    const keys = Object.keys(specs);
    return {
      ok: false,
      text: `That analysis returned no ${collection} entry named "${source.key}". ${
        keys.length > 0 ? `Its ${collection}: ${keys.join(', ')}.` : `It returned no ${collection}.`
      }`,
    };
  }

  return { ok: true, spec: specs[source.key] };
}

function createRenderTool({
  ctx,
  name,
  type,
  description,
  specSchema,
}: {
  ctx: ChatToolContext;
  name: string;
  type: ChatVisualSpec['type'];
  description: string;
  specSchema: z.ZodType;
}) {
  return defineNativeTool({
    name,
    description,
    shape: { spec: specSchema.optional(), source: analysisSourceSchema.optional() },
    run: async ({ args }) => {
      if (args.spec !== undefined && args.source !== undefined) {
        return toolFailure({ text: 'Pass either spec or source, not both.' });
      }
      if (args.spec === undefined && args.source === undefined) {
        return toolFailure({ text: `${name} needs a spec, or a source from run_analysis.` });
      }

      let candidate: unknown = args.spec;
      if (args.source !== undefined) {
        const found = specFromAnalysis({ ctx, type, source: args.source });
        if (!found.ok) return toolFailure({ text: found.text });
        candidate = found.spec;
      }

      const parsed = chatVisualSpecSchema.safeParse(candidate);
      if (!parsed.success) return toolFailure({ text: parsed.error.issues.map((issue) => issue.message).join('; ') });

      const spec = parsed.data as ChatVisualSpec;
      if (spec.type !== type) return toolFailure({ text: `${name} takes a spec of type "${type}"` });

      if (ctx.state.visuals >= CHAT_VISUAL_LIMITS.maxPerMessage) {
        await ctx.notice({ key: 'chat.notices.visualLimit', params: { limit: CHAT_VISUAL_LIMITS.maxPerMessage } });
        return toolFailure({
          text: `This message already shows ${CHAT_VISUAL_LIMITS.maxPerMessage} visuals. Describe the rest in words.`,
        });
      }

      const { spec: resolved, foreign } = await resolveEntityLabels({ userId: ctx.run.user.id, spec });
      if (foreign.length > 0) {
        return toolFailure({
          text: `These table links name rows that are not the user's or cannot be linked: ${foreign
            .map(({ kind, id }) => `${kind} ${id}`)
            .join(', ')}. Use ids returned by the read tools, or plain text cells.`,
        });
      }

      ctx.state.visuals++;
      await ctx.run.emit({ type: 'part.started', part: { type: 'visual', id: randomUUID(), spec: resolved } });
      return toolSuccess({ text: `The ${type} is shown to the user.` });
    },
  });
}

export function createRenderTools({ ctx }: { ctx: ChatToolContext }) {
  return [
    createRenderTool({
      ctx,
      name: 'render_chart',
      type: 'chart',
      description:
        'Show a chart in your answer. Numbers must come from tool results. Do not repeat the chart in words. Pass spec, or source for a chart run_analysis returned.',
      specSchema: chatChartSpecSchema,
    }),
    createRenderTool({
      ctx,
      name: 'render_table',
      type: 'table',
      description:
        'Show a table. Money columns need a currencyCode; an entity cell {kind, id} links only for ids from read tools. Pass spec, or source for a table run_analysis returned.',
      specSchema: chatTableSpecSchema,
    }),
    createRenderTool({
      ctx,
      name: 'render_kpis',
      type: 'kpis',
      description: 'Show up to six key figures as tiles. Pass spec, or source for kpis run_analysis returned.',
      specSchema: chatKpisSpecSchema,
    }),
  ];
}
