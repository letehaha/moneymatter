import { logger } from '@js/utils';
import Trackers from '@models/trackers.model';
import { Op, literal } from 'sequelize';

/** Turns rules off on the user's trackers left with no rule category or tag. Existing rule links stay. */
export const disableEmptyTrackerRules = async ({ userId }: { userId: number }) => {
  const [, disabled] = await Trackers.update(
    { rulesEnabled: false },
    {
      where: {
        userId,
        rulesEnabled: true,
        [Op.and]: [
          literal(`NOT EXISTS (SELECT 1 FROM "TrackerCategories" tc WHERE tc."trackerId" = "Trackers"."id")`),
          literal(`NOT EXISTS (SELECT 1 FROM "TrackerTags" tt WHERE tt."trackerId" = "Trackers"."id")`),
        ],
      },
      returning: ['id'],
    },
  );
  if (disabled.length) {
    logger.info('Tracker rules disabled: no rule category or tag left', {
      userId,
      trackerIds: disabled.map((tracker) => tracker.id),
    });
  }
};
