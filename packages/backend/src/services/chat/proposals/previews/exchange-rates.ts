import UserExchangeRates from '@models/user-exchange-rates.model';
import { Op } from 'sequelize';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import { forUpdate, PreviewError, SAMPLE_ROW_LIMIT } from './preview-helpers';
import type { PreviewResolver } from './types';

interface RatePair {
  baseCode: string;
  quoteCode: string;
}

/**
 * The user's own rates the removal takes away. The handler requires each pair's opposite in the same
 * call, so the pairs given are the whole set.
 */
export const resolveDeleteExchangeRates: PreviewResolver = async ({ userId, args, lock }) => {
  const pairs = args.pairs as RatePair[];

  const rows = (await UserExchangeRates.findAll({
    where: {
      [Op.or]: pairs.map((pair) => ({
        userId,
        baseCode: pair.baseCode,
        quoteCode: pair.quoteCode,
      })),
    },
    raw: true,
    ...forUpdate({ lock }),
    order: [
      ['baseCode', 'ASC'],
      ['quoteCode', 'ASC'],
    ],
  })) as UserExchangeRates[];

  if (rows.length === 0) {
    throw new PreviewError({
      messageKey: 'chat.cards.noTargets',
      message: 'You have no exchange rate of your own for these pairs, so there is nothing to remove',
    });
  }

  return {
    preview: {
      affected: {
        count: rows.length,
        columns: [
          { key: 'pair', label: 'chat.cards.columns.pair', kind: 'text' },
          { key: 'rate', label: 'chat.cards.columns.rate', kind: 'number' },
        ],
        rows: rows.slice(0, SAMPLE_ROW_LIMIT).map((row) => ({
          pair: `${row.baseCode}/${row.quoteCode}`,
          rate: Number(row.rate),
        })),
        truncated: rows.length > SAMPLE_ROW_LIMIT,
      },
    },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: rows.map((row) => row.date) }),
      targetHash: hashTargetIds({ ids: rows.map((row) => `${row.baseCode}/${row.quoteCode}`) }),
      targetCount: rows.length,
    },
    affectedCount: rows.length,
  };
};
