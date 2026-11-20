import { connection } from '@models/connection';
import { TRACKER_SCAN_ENDED_GRACE_DAYS } from '@services/trackers/smart-tracking/run-tracker-scan';
import { subDays } from 'date-fns';
import { Op, literal } from 'sequelize';

const ACTIVE_WITHIN_DAYS = 30;

/** Trackers where-fragment: the owner has a session updated within the last 30 days. */
export const trackerOwnerActiveWhere = ({ now }: { now: Date }) => {
  const activeSince = connection.sequelize.escape(subDays(now, ACTIVE_WITHIN_DAYS));
  return literal(
    `"Trackers"."userId" IN (SELECT u."id" FROM "Users" u JOIN ba_session s ON s."userId" = u."authUserId" WHERE s."updatedAt" >= ${activeSince})`,
  );
};

/** Trackers where-fragment: open-ended, or ended within the grace period. */
export const trackerNotLongEndedWhere = ({ now }: { now: Date }) => ({
  [Op.or]: [{ endDate: null }, { endDate: { [Op.gte]: subDays(now, TRACKER_SCAN_ENDED_GRACE_DAYS) } }],
});
