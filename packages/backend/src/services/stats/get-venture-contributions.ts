import { type MinorUnits, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, asMinorUnits } from '@bt/shared/types';
import Transactions from '@models/transactions.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import VentureEvents from '@models/venture/venture-events.model';
import { endOfDay } from 'date-fns';
import { Op } from 'sequelize';

export interface VentureContributionMinor {
  dealId: string;
  name: string;
  /** Net contribution in base minor units at the `decimals` handed to the report. */
  amount: MinorUnits;
}

export const getVentureContributions = async ({
  userId,
  from,
  to,
  decimals,
}: {
  userId: number;
  from: string;
  to: string;
  /** Decimals of the base currency: the minor-unit scale the amounts are summed at. */
  decimals: number;
}): Promise<VentureContributionMinor[]> => {
  const links = await VentureEventLinks.findAll({
    attributes: ['id'],
    include: [
      {
        model: Transactions,
        attributes: ['refAmount', 'transactionType'],
        required: true,
        where: {
          userId,
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_venture,
          time: { [Op.between]: [new Date(from), endOfDay(new Date(to))] },
        },
      },
      {
        model: VentureEvents,
        attributes: ['dealId'],
        required: true,
        include: [{ model: VentureDeals, attributes: ['name'], required: true }],
      },
    ],
  });

  const byDeal = new Map<string, VentureContributionMinor>();
  for (const link of links) {
    const { dealId, deal } = link.event!;
    const tx = link.transaction!;
    const minor = tx.refAmount.toMinorUnits({ decimals }) * (tx.transactionType === TRANSACTION_TYPES.expense ? 1 : -1);
    const entry = byDeal.get(dealId) ?? { dealId, name: deal!.name, amount: asMinorUnits(0) };
    entry.amount = asMinorUnits(entry.amount + minor);
    byDeal.set(dealId, entry);
  }
  return [...byDeal.values()].filter((d) => d.amount !== 0).toSorted((a, b) => b.amount - a.amount);
};
