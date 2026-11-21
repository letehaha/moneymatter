import { DataTypes, QueryInterface, QueryTypes } from 'sequelize';

const RULE_METADATA = `'{"source":"rule"}'::jsonb`;

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'Trackers',
        'rulesEnabled',
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        { transaction },
      );
      await queryInterface.addColumn(
        'Trackers',
        'rulesCleanup',
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'Trackers',
        'rulesSyncedAt',
        { type: DataTypes.DATE, allowNull: true },
        { transaction },
      );

      await queryInterface.createTable(
        'TrackerTags',
        {
          trackerId: {
            type: DataTypes.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'Trackers', key: 'id' },
            onDelete: 'CASCADE',
          },
          tagId: {
            type: DataTypes.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'Tags', key: 'id' },
            onDelete: 'CASCADE',
          },
        },
        { transaction },
      );
      await queryInterface.addIndex('TrackerTags', ['tagId'], { transaction });

      // Category trackers were computed live; their current matches become rule links. A split matching by
      // one part links the whole transaction, so totals can rise where splits are involved.
      // Same row set as the stats boundary (`statsTransactions`), minus planned rows, which rules ignore.
      // One with no categories stays rules-off: rules need at least one category or tag.
      await queryInterface.sequelize.query(
        `UPDATE "Trackers" tr SET "rulesEnabled" = true, "rulesSyncedAt" = NOW()
          WHERE tr."type" = 'category'
            AND EXISTS (SELECT 1 FROM "TrackerCategories" tc WHERE tc."trackerId" = tr."id");
         INSERT INTO "TrackerTransactions" ("trackerId", "transactionId", "metadata")
         SELECT DISTINCT tr."id", t."id", ${RULE_METADATA}
           FROM "Trackers" tr
           JOIN "Transactions" t ON t."userId" = tr."userId"
           JOIN "Accounts" a ON a."id" = t."accountId" AND a."excludeFromStats" = false
          WHERE tr."rulesEnabled" = true
            AND t."deletedAt" IS NULL
            AND t."isPlanned" = false
            AND (t."transferNature" = 'not_transfer'
                 OR (t."transferNature" = 'transfer_to_loan' AND t."transactionType" = 'expense'))
            AND (t."externalData" IS NULL OR NOT (t."externalData" @> '{"balanceAdjustment": true}'))
            AND (tr."startDate" IS NULL OR t."time" >= tr."startDate")
            AND (tr."endDate" IS NULL OR t."time" <= tr."endDate")
            AND (
              t."categoryId" IN (SELECT tc."categoryId" FROM "TrackerCategories" tc WHERE tc."trackerId" = tr."id")
              OR EXISTS (
                SELECT 1 FROM "TransactionSplits" s
                  JOIN "TrackerCategories" tc ON tc."categoryId" = s."categoryId" AND tc."trackerId" = tr."id"
                 WHERE s."transactionId" = t."id"
              )
            )
         ON CONFLICT DO NOTHING;`,
        { transaction },
      );

      const [typeColumn] = await queryInterface.sequelize.query<{ udt_name: string }>(
        `SELECT udt_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'Trackers' AND column_name = 'type'`,
        { type: QueryTypes.SELECT, transaction },
      );
      await queryInterface.removeColumn('Trackers', 'type', { transaction });
      if (typeColumn) {
        await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${typeColumn.udt_name}";`, { transaction });
      }
      await queryInterface.removeColumn('Trackers', 'autoInclude', { transaction });
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'Trackers',
        'autoInclude',
        { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
        { transaction },
      );
      await queryInterface.addColumn(
        'Trackers',
        'type',
        { type: DataTypes.ENUM('manual', 'category'), allowNull: false, defaultValue: 'manual' },
        { transaction },
      );
      await queryInterface.sequelize.query(
        `UPDATE "Trackers" tr SET "type" = 'category'
           WHERE tr."rulesEnabled" = true AND EXISTS (SELECT 1 FROM "TrackerCategories" tc WHERE tc."trackerId" = tr."id");
         DELETE FROM "TrackerTransactions" WHERE "metadata" @> ${RULE_METADATA};`,
        { transaction },
      );
      await queryInterface.dropTable('TrackerTags', { transaction });
      await queryInterface.removeColumn('Trackers', 'rulesSyncedAt', { transaction });
      await queryInterface.removeColumn('Trackers', 'rulesCleanup', { transaction });
      await queryInterface.removeColumn('Trackers', 'rulesEnabled', { transaction });
    });
  },
};
