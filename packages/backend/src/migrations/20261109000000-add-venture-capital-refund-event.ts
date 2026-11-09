import { QueryInterface } from 'sequelize';

const PREVIOUS_EVENT_TYPES = [
  'initial_investment',
  'capital_call',
  'distribution',
  'nav_update',
  'exit',
  'writedown',
  'fee_payment',
] as const;
const EVENT_TYPES = [...PREVIOUS_EVENT_TYPES, 'capital_refund'] as const;

function replaceTypeCheck({ queryInterface, types }: { queryInterface: QueryInterface; types: readonly string[] }) {
  const inClause = types.map((v) => `'${v}'`).join(', ');
  return queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "VentureEvents" DROP CONSTRAINT IF EXISTS "chk_venture_events_type";`,
      { transaction },
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "VentureEvents" ADD CONSTRAINT "chk_venture_events_type" CHECK ("type" IN (${inClause}));`,
      { transaction },
    );
  });
}

module.exports = {
  up: (queryInterface: QueryInterface) => replaceTypeCheck({ queryInterface, types: EVENT_TYPES }),
  // Fails while any capital_refund rows exist; delete or retype them first.
  down: (queryInterface: QueryInterface) => replaceTypeCheck({ queryInterface, types: PREVIOUS_EVENT_TYPES }),
};
