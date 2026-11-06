import { TRACKER_STATUSES } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTracker } from '@root/serializers';
import * as trackersService from '@root/services/trackers/create-tracker';
import { z } from 'zod';

import { createTrackerBodySchema } from './shared-schemas';

const schema = z.object({ body: createTrackerBodySchema });

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;
  const {
    name,
    categoryIds,
    tagIds,
    rulesEnabled,
    rulesCleanup,
    startDate,
    endDate,
    limitAmount,
    limitKind,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    logoImage,
    aiEnabled,
    aiDescription,
    aiPreWindowDays,
  } = body;

  const tracker = await trackersService.createTracker({
    name,
    userId,
    status: TRACKER_STATUSES.active,
    categoryIds,
    tagIds,
    rulesEnabled,
    rulesCleanup,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    limitAmount,
    limitKind,
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
  return { data: serializeTracker(tracker) };
});
