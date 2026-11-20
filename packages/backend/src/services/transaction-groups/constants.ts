import Transactions, { prepareTXInclude } from '@models/transactions.model';

/** Sequelize include for loading a group's transactions (without join-table attributes). */
export const INCLUDE_GROUP_TRANSACTIONS = {
  model: Transactions,
  through: { attributes: [] as string[] },
  include: prepareTXInclude({ includeSplits: true, includeTags: true }),
};
