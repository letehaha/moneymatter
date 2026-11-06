import Transactions, { prepareTXInclude } from '@models/transactions.model';

export const MIN_GROUP_SIZE = 2;
export const MAX_GROUP_SIZE = 50;

/** Sequelize include for loading a group's transactions (without join-table attributes). */
export const INCLUDE_GROUP_TRANSACTIONS = {
  model: Transactions,
  through: { attributes: [] as string[] },
  include: prepareTXInclude({ includeSplits: true, includeTags: true }),
};
