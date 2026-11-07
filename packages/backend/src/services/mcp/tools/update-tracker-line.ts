import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { serializeTrackerLine } from '@root/serializers';
import { updateTrackerLine } from '@services/trackers/lines/update-line';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const updateTrackerLineTool = defineTool({
  name: 'update_tracker_line',
  toolset: 'trackers',
  access: 'write',
  description:
    'Update a tracker line: name, categories, limit, or position. Only passed fields change. A transaction lands in at most one line — the first line by position whose category set (expanded to children) contains its category; spending matching no line counts as "other". Requires manage access to the tracker. Returns the updated line.',
  input: {
    trackerId: recordId().describe('ID of the tracker the line belongs to'),
    lineId: recordId().describe('ID of the line to update'),
    name: z.string().trim().min(1).max(200).optional().describe('New line name'),
    categoryIds: z
      .array(recordId())
      .min(1)
      .optional()
      .describe('Replace the categories the line covers; parents expand to their children'),
    limitAmount: z
      .number()
      .positive()
      .nullable()
      .optional()
      .describe(
        "New line limit as a decimal amount in the tracker owner's base currency. Pass null to remove the limit",
      ),
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('New 0-based order. Earlier lines win when category sets overlap'),
  },
  run: async ({ userId, args }) => {
    const line = await updateTrackerLine({
      userId,
      trackerId: args.trackerId,
      lineId: args.lineId,
      name: args.name,
      categoryIds: args.categoryIds,
      limitAmount: args.limitAmount == null ? args.limitAmount : Money.fromDecimal(args.limitAmount),
      position: args.position,
    });

    return serializeTrackerLine(line);
  },
});
