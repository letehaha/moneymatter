import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTracker } from '@root/serializers';
import * as editTrackerService from '@services/trackers/edit-tracker';
import { z } from 'zod';

import { editTrackerBodySchema } from './shared-schemas';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: editTrackerBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const {
    name,
    categoryIds,
    startDate,
    endDate,
    limitAmount,
    autoInclude,
    archivePromptDismissed,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    logoImage,
    aiEnabled,
    aiDescription,
    aiPreWindowDays,
  } = body;

  const tracker = await editTrackerService.editTracker({
    id: params.id,
    userId: user.id,
    name,
    categoryIds,
    startDate,
    endDate,
    limitAmount,
    autoInclude,
    archivePromptDismissed,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    logoImage,
    aiEnabled,
    aiDescription,
    aiPreWindowDays,
  });

  // Serialize: convert cents to decimal for API response
  return { data: tracker ? serializeTracker(tracker) : null };
});
