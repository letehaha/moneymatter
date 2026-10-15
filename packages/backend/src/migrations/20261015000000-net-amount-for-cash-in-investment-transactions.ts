import { QueryInterface } from 'sequelize';

/**
 * Sets sell/dividend `amount` to the cash received, quantity * price - fees, recomputed
 * from the row's own columns so rows already in that form are left alone. `refAmount`
 * keeps its ratio to `amount`, i.e. the row's effective rate to the base currency.
 */
const recompute = ({ feeSign }: { feeSign: '+' | '-' }) => `
  UPDATE "InvestmentTransactions"
  SET "amount" = ROUND("quantity" * "price" ${feeSign} "fees", 10),
      "refAmount" = CASE
        WHEN "amount" = 0 THEN "refAmount"
        ELSE ROUND("refAmount" * ("quantity" * "price" ${feeSign} "fees") / "amount", 10)
      END
  WHERE "category" IN ('sell', 'dividend')
    AND "amount" <> ROUND("quantity" * "price" ${feeSign} "fees", 10);
`;

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(recompute({ feeSign: '-' }));
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(recompute({ feeSign: '+' }));
  },
};
