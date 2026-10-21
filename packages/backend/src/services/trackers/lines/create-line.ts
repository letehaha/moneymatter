import { SHARE_PERMISSIONS } from '@bt/shared/types';
import { Money } from '@common/types/money';
import TrackerLines from '@models/tracker-lines.model';
import { withTransaction } from '@services/common/with-transaction';
import { roundToBaseCurrency } from '@services/currencies/round-to-base-currency';

import { authorizeTrackerAccess } from '../authorize-tracker-access';
import { findLineOrThrow, replaceLineCategories } from './line-helpers';

export const createTrackerLine = withTransaction(
  async ({
    userId,
    trackerId,
    name,
    limitAmount,
    categoryIds,
    position,
  }: {
    userId: number;
    trackerId: string;
    name: string;
    limitAmount?: Money | null;
    categoryIds: string[];
    position?: number;
  }) => {
    const { ownerUserId } = await authorizeTrackerAccess({
      userId,
      trackerId,
      requiredPermission: SHARE_PERMISSIONS.manage,
    });

    // A tracker is denominated in the owner's base currency.
    const [roundedLimit] = await roundToBaseCurrency({ userId: ownerUserId, values: [limitAmount] });

    const maxPosition = await TrackerLines.max<number | null, TrackerLines>('position', {
      where: { trackerId },
    });

    const line = await TrackerLines.create({
      trackerId,
      name,
      limitAmount: roundedLimit ?? null,
      position: position ?? (maxPosition ?? -1) + 1,
    });

    await replaceLineCategories({ trackerId, lineId: line.id, ownerUserId, categoryIds });

    return findLineOrThrow({ trackerId, lineId: line.id });
  },
);
