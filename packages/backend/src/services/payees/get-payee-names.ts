import Payees from '@models/payees.model';
import { Op } from 'sequelize';

/**
 * Names of the caller's own payees in one query, keyed by id. An id that is not the caller's
 * (a payee of another user's namespace) is left out, as `listPayees` leaves it out of its list.
 */
export const getPayeeNames = async ({
  userId,
  payeeIds,
}: {
  userId: number;
  payeeIds: string[];
}): Promise<Map<string, string>> => {
  const ids = [...new Set(payeeIds)];
  if (ids.length === 0) return new Map();

  const rows = (await Payees.findAll({
    where: { userId, id: { [Op.in]: ids } },
    attributes: ['id', 'name'],
    raw: true,
  })) as unknown as Array<{ id: string; name: string }>;

  return new Map(rows.map((row) => [row.id, row.name]));
};
