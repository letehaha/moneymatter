import { CHAT_MAX_TOOL_CALLS, CHAT_UNCERTAINTY_REASONS } from '@bt/shared/types';
import { z } from 'zod';

import type { ToolCatalogEntry } from '../../mcp/tool-catalog';
import { slimToolListSchema } from '../../mcp/tool-list-slimming';
import { describeInputError, ToolInputError, validateWithRefs } from '../proposals/placeholders';
import type { ChatToolValidation, JsonSchema } from './types';

/** The optional field every write tool takes next to its own arguments. Stripped before validation. */
export const CHAT_META_FIELD = '_chat';

/**
 * The meta field is repeated on every write tool, so its schema carries no per-field prose: the
 * system prompt explains `uncertain`, `replaces` and `sourceCallIds`, and the field names and the
 * closed reason list say the rest.
 */
export const chatMetaSchema = z
  .object({
    uncertain: z
      .array(
        z
          .object({
            field: z.string().min(1).max(100),
            reason: z.enum(CHAT_UNCERTAINTY_REASONS),
            alternatives: z.array(z.unknown()).max(5).optional(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    replaces: z.uuid().optional(),
    sourceCallIds: z.array(z.string().min(1).max(200)).max(CHAT_MAX_TOOL_CALLS).optional(),
  })
  .strict();

export type ChatMeta = z.infer<typeof chatMetaSchema>;

/** The same conversion the MCP SDK uses for `tools/list`, minus the `$schema` line, with the uuid and date patterns dropped. */
export function zodToModelSchema({ schema }: { schema: z.ZodType }): JsonSchema {
  const { $schema: _dropped, ...converted } = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as JsonSchema;
  return slimToolListSchema({ schema: converted as JsonSchema });
}

/**
 * Shows every uuid position as a plain string. A call may refer to a card that does not exist yet with
 * a `$proposal:<id>` ref, so the provider's own schema check must not insist on a
 * uuid; the real schema still runs in `execute`. A plain string says it in a few tokens, where a uuid
 * alternative next to a ref pattern repeated at every id position cost over 4 KB on each step.
 */
function widenUuidPositions({ node }: { node: unknown }): unknown {
  if (Array.isArray(node)) return node.map((item) => widenUuidPositions({ node: item }));
  if (node === null || typeof node !== 'object') return node;

  const widened = Object.fromEntries(
    Object.entries(node).map(([key, child]) => [key, widenUuidPositions({ node: child })]),
  ) as JsonSchema;

  if (widened.type !== 'string' || widened.format !== 'uuid') return widened;

  const { format: _format, ...rest } = widened;
  return rest;
}

/**
 * What the model sees of `_chat`. It repeats on every write tool, so it is written lean by hand (no
 * bounds, no per-field prose): `chatMetaSchema` enforces the limits, and the system prompt explains
 * the three fields.
 */
const metaProperty: JsonSchema = {
  type: 'object',
  description:
    'Optional. uncertain: arguments you guessed. replaces: a pending proposal this one supersedes. sourceCallIds: the reads it rests on',
  properties: {
    uncertain: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          reason: { type: 'string', enum: [...CHAT_UNCERTAINTY_REASONS] },
          alternatives: { type: 'array' },
        },
        required: ['field', 'reason'],
      },
    },
    replaces: { type: 'string' },
    sourceCallIds: { type: 'array', items: { type: 'string' } },
  },
};

const schemaCache = new WeakMap<object, Partial<Record<'read' | 'write', JsonSchema>>>();
const noInputKey = {};

/**
 * What the provider sees for a catalog tool: the tool's input schema, with a ref accepted in every
 * uuid position and the optional `_chat` field on a write. A tool with no input gets an empty
 * object. One object per tool, so a runner can hand it on by reference.
 */
export function getModelSchema({ entry }: { entry: ToolCatalogEntry }): JsonSchema {
  const cacheKey = entry.inputShape ?? noInputKey;
  const isWrite = entry.access === 'write';
  const slot = isWrite ? 'write' : 'read';

  const cached = schemaCache.get(cacheKey)?.[slot];
  if (cached) return cached;

  const base: JsonSchema =
    entry.inputShape === null
      ? { type: 'object', properties: {} }
      : zodToModelSchema({ schema: z.object(entry.inputShape) });
  const built = isWrite ? withMetaField({ schema: widenUuidPositions({ node: base }) as JsonSchema }) : base;

  schemaCache.set(cacheKey, { ...schemaCache.get(cacheKey), [slot]: built });
  return built;
}

const withMetaField = ({ schema }: { schema: JsonSchema }): JsonSchema => ({
  ...schema,
  properties: { ...(schema.properties as JsonSchema), [CHAT_META_FIELD]: metaProperty },
});

const asToolInputError = ({ error }: { error: unknown }) =>
  error instanceof ToolInputError ? error : new ToolInputError(describeInputError({ error }));

/**
 * Splits a write call's input into its arguments and its `_chat` meta, and validates both: the meta
 * with its schema (and its `uncertain` fields against the tool's own arguments), the arguments with
 * `validateWithRefs`. Returns the arguments with their refs in place. Throws `ToolInputError`.
 */
export function parseWriteInput({ entry, input }: { entry: ToolCatalogEntry; input: unknown }): {
  args: Record<string, unknown>;
  meta: ChatMeta;
  refs: string[];
} {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ToolInputError('The arguments must be an object');
  }
  const { [CHAT_META_FIELD]: rawMeta, ...args } = input as Record<string, unknown>;

  const parsedMeta = chatMetaSchema.safeParse(rawMeta ?? {});
  if (!parsedMeta.success) {
    throw new ToolInputError(`${CHAT_META_FIELD}.${describeInputError({ error: parsedMeta.error })}`);
  }
  const meta = parsedMeta.data;

  const fields = new Set(Object.keys(entry.inputShape ?? {}));
  for (const { field } of meta.uncertain ?? []) {
    if (!fields.has(field)) {
      throw new ToolInputError(`${CHAT_META_FIELD}.uncertain: "${field}" is not an argument of ${entry.name}`);
    }
  }

  const { refs } = validateWithRefs({ entry, args });
  return { args, meta, refs };
}

/**
 * The check a provider runs on a call before `execute`. It only checks: a valid
 * input comes back as the very object it was given, `$proposal:` refs and `_chat` intact.
 */
export function createInputValidator({
  entry,
}: {
  entry: ToolCatalogEntry;
}): (params: { input: unknown }) => ChatToolValidation {
  return ({ input }) => {
    try {
      if (entry.access === 'write') {
        parseWriteInput({ entry, input });
      } else if (entry.inputShape !== null) {
        entry.validateArgs({ args: z.object(entry.inputShape).parse(input ?? {}) });
      }
      return { success: true, value: input };
    } catch (error) {
      return { success: false, error: asToolInputError({ error }) };
    }
  };
}
