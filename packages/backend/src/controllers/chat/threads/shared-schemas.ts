import { CHAT_ENTITY_KINDS, CHAT_THREAD_TITLE_MAX_CHARS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/** A thread title as typed: trimmed, 1 to 120 characters. */
export const threadTitleSchema = z.string().trim().min(1).max(CHAT_THREAD_TITLE_MAX_CHARS);

/** Filters are free-form for the model's benefit; a size bound keeps a page context from carrying a payload. */
const PAGE_CONTEXT_FILTERS_MAX_BYTES = 4_096;

/** The rows ticked on a page are a sample for the model; the page says how many there are in all. */
const PAGE_CONTEXT_SELECTION_MAX_IDS = 50;

const entityRefSchema = z.strictObject({ kind: z.enum(CHAT_ENTITY_KINDS), id: recordId() });

export const pageContextSchema = z.strictObject({
  route: z.string().max(100).optional(),
  // A kind this server does not know (a newer browser) is left out; it does not fail the message.
  entity: entityRefSchema.optional().catch(undefined),
  focus: entityRefSchema.optional().catch(undefined),
  selection: z
    .strictObject({
      kind: z.enum(CHAT_ENTITY_KINDS),
      ids: z.array(recordId()).max(PAGE_CONTEXT_SELECTION_MAX_IDS),
      total: z.number().int().nonnegative().optional(),
    })
    .optional()
    .catch(undefined),
  filters: z
    .record(z.string().max(100), z.unknown())
    .refine((filters) => JSON.stringify(filters).length <= PAGE_CONTEXT_FILTERS_MAX_BYTES)
    .optional(),
  period: z.strictObject({ from: z.string().max(40), to: z.string().max(40) }).optional(),
});
