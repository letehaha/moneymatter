import { SHARE_PERMISSIONS } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { removeUndefinedKeys } from '@js/helpers';
import { withTransaction } from '@services/common/with-transaction';
import { roundToBaseCurrency } from '@services/currencies/round-to-base-currency';

import { authorizeTrackerAccess } from '../authorize-tracker-access';
import { findLineOrThrow, replaceLineCategories } from './line-helpers';

export const updateTrackerLine = withTransaction(
  async ({
    userId,
    trackerId,
    lineId,
    categoryIds,
    ...fields
  }: {
    userId: number;
    trackerId: string;
    lineId: string;
    name?: string;
    limitAmount?: Money | null;
    categoryIds?: string[];
    position?: number;
  }) => {
    const { ownerUserId } = await authorizeTrackerAccess({
      userId,
      trackerId,
      requiredPermission: SHARE_PERMISSIONS.manage,
    });

    const line = await findLineOrThrow({ trackerId, lineId });

    // A tracker is denominated in the owner's base currency.
    const [limitAmount] = await roundToBaseCurrency({ userId: ownerUserId, values: [fields.limitAmount] });

    await line.update(removeUndefinedKeys(limitAmount === undefined ? fields : { ...fields, limitAmount }));

    if (categoryIds !== undefined) {
      await replaceLineCategories({ trackerId, lineId, ownerUserId, categoryIds });
    }

    return findLineOrThrow({ trackerId, lineId });
  },
);
