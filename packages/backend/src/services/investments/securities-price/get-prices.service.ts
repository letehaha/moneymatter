import { connection } from '@models/connection';
import SecurityPricing from '@models/investments/security-pricing.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op, WhereOptions } from 'sequelize';

interface PriceQueryOptions {
  securityId?: string;
  from?: Date;
  to?: Date;
  daily?: boolean;
}

/** Raw SQL for `DISTINCT ON`: the last price row of each UTC day, which Sequelize's query builder can't express. */
const getDailyPrices = ({ securityId, from, to }: PriceQueryOptions): Promise<SecurityPricing[]> =>
  connection.sequelize.query(
    `SELECT DISTINCT ON ("securityId", ("date" AT TIME ZONE 'UTC')::date) *
     FROM "SecurityPricings"
     WHERE (:securityId IS NULL OR "securityId" = :securityId)
       AND (:from IS NULL OR "date" >= :from)
       AND (:to IS NULL OR "date" <= :to)
     ORDER BY "securityId", ("date" AT TIME ZONE 'UTC')::date, "date" DESC`,
    {
      model: SecurityPricing,
      mapToModel: true,
      replacements: { securityId: securityId ?? null, from: from ?? null, to: to ?? null },
    },
  );

/**
 * Fetches security prices based on a flexible set of query options.
 * @param options - The query options including securityId and date ranges.
 */
const getPricesImpl = async (options: PriceQueryOptions): Promise<SecurityPricing[]> => {
  if (options.daily) return getDailyPrices(options);

  const where: WhereOptions<SecurityPricing> = {};

  if (options.securityId) {
    where.securityId = options.securityId;
  }

  if (options.from || options.to) {
    where.date = {};
    if (options.from) {
      where.date[Op.gte] = options.from;
    }
    if (options.to) {
      where.date[Op.lte] = options.to;
    }
  }

  return SecurityPricing.findAll({ where });
};

export const getPrices = withTransaction(getPricesImpl);
