import { TRACKER_STATUSES, TrackerModel } from '@bt/shared/types';
import Categories from '@models/categories.model';
import Tags from '@models/tags.model';
import TrackerLines from '@models/tracker-lines.model';
import Trackers from '@models/trackers.model';
import Users from '@models/users.model';
import { withTransaction } from '@services/common/with-transaction';
import {
  TrackerShareContext,
  buildOwnerTrackerShareContext,
  getSharedTrackerById,
  getSharedTrackersForUser,
} from '@services/sharing/get-shared-trackers.service';
import { Op } from 'sequelize';

type TrackerWithCategories = Trackers & {
  categories: Pick<Categories, 'id' | 'name' | 'color' | 'parentId'>[];
};

type TrackerWithShareContext = TrackerWithCategories & { _shareContext?: TrackerShareContext };

const categoryAttributes = ['id', 'name', 'color', 'parentId'];

export const includeCategories = {
  model: Categories,
  as: 'categories',
  attributes: categoryAttributes,
};

export const includeTags = {
  model: Tags,
  as: 'tags',
  attributes: ['id', 'name', 'color', 'icon'],
  through: { attributes: [] },
};

export const includeLineCategories = {
  model: Categories,
  as: 'categories',
  attributes: categoryAttributes,
  through: { attributes: [] },
};

export const includeLines = {
  model: TrackerLines,
  as: 'lines',
  separate: true,
  order: [
    ['position', 'ASC'],
    ['id', 'ASC'],
  ] as [string, string][],
  include: [includeLineCategories],
};

const filterByStatus = ({ statuses }: { statuses?: TRACKER_STATUSES[] }) =>
  statuses?.length ? { status: { [Op.in]: statuses } } : {};

/**
 * Returns every tracker the caller can read: trackers they own (with an owner share
 * context) merged with trackers shared with them (with a recipient share context).
 *
 * Status filter and category hydration are pushed down into both halves so the shared
 * branch loads in a single query instead of re-fetching post-load.
 */
export const getTrackers = withTransaction(
  async ({
    userId,
    statuses,
  }: {
    userId: number;
    statuses?: TRACKER_STATUSES[];
  }): Promise<TrackerWithShareContext[]> => {
    const statusWhere = filterByStatus({ statuses });
    const [ownedTrackers, sharedTrackers, ownerUser] = await Promise.all([
      Trackers.findAll({
        where: { userId, ...statusWhere },
        include: [includeCategories, includeTags, includeLines],
      }),
      getSharedTrackersForUser({
        userId,
        where: statusWhere,
        include: [includeCategories, includeTags, includeLines],
      }),
      Users.findByPk(userId),
    ]);

    const ownerContext = ownerUser ? await buildOwnerTrackerShareContext({ ownerUser }) : null;

    const ownedWithContext: TrackerWithShareContext[] = ownedTrackers.map((tracker) => {
      if (ownerContext) {
        Object.assign(tracker, { _shareContext: ownerContext });
      }
      return tracker as TrackerWithShareContext;
    });

    return [...ownedWithContext, ...(sharedTrackers as TrackerWithShareContext[])];
  },
);

export const getTrackerById = withTransaction(
  async ({
    userId,
    id,
  }: {
    userId: TrackerModel['userId'];
    id: TrackerModel['id'];
  }): Promise<TrackerWithShareContext | null> => {
    const owned = await Trackers.findOne({
      where: { userId, id },
      include: [includeCategories, includeTags, includeLines],
    });

    if (owned) {
      const ownerUser = await Users.findByPk(userId);
      if (ownerUser) {
        Object.assign(owned, { _shareContext: await buildOwnerTrackerShareContext({ ownerUser }) });
      }
      return owned as TrackerWithShareContext;
    }

    // Not owned — fall through to the shared lookup. `getSharedTrackerById` runs the
    // central auth check and returns the tracker with a recipient share context attached.
    const shared = await getSharedTrackerById({ userId, id, include: [includeCategories, includeTags, includeLines] });
    return (shared as TrackerWithShareContext | null) ?? null;
  },
);
