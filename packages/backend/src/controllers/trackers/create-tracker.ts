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
    type,
    categoryIds,
    startDate,
    endDate,
    autoInclude,
    limitAmount,
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
    type,
    categoryIds,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    autoInclude,
    limitAmount,
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
