import { DataTypes, QueryInterface, Transaction } from 'sequelize';

/**
 * Real-estate tracking — manual asset accounts whose value follows a single
 * signed annual appreciation rate.
 *
 * `Accounts.accountCategory` is already VARCHAR(50) (see
 * `20260529225218-create-vehicles.ts`), so the new `'property'` value needs no
 * schema change — only the `Properties` table, a 1:1 sidecar to the underlying
 * `Accounts` row that holds the property's projected balance.
 *
 * `loanAccountId` is the optional mortgage link. It is UNIQUE so one loan can
 * back at most one property, and `ON DELETE SET NULL` so deleting the mortgage
 * account leaves the property standing (unlinked) instead of cascading away a
 * far more valuable asset row.
 */

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'Properties',
        {
          id: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
          },
          accountId: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
            references: { model: 'Accounts', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Users', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          loanAccountId: {
            type: DataTypes.UUID,
            allowNull: true,
            unique: true,
            references: { model: 'Accounts', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
            comment: 'Optional mortgage: loan-category Accounts row backing this property',
          },
          address: {
            type: DataTypes.STRING(500),
            allowNull: false,
          },
          city: {
            type: DataTypes.STRING(120),
            allowNull: true,
          },
          country: {
            type: DataTypes.STRING(120),
            allowNull: true,
          },
          propertyType: {
            type: DataTypes.STRING(20),
            allowNull: false,
            defaultValue: 'house',
          },
          yearBuilt: {
            type: DataTypes.SMALLINT,
            allowNull: true,
          },
          notes: {
            type: DataTypes.TEXT,
            allowNull: true,
          },
          purchasePrice: {
            type: DataTypes.BIGINT,
            allowNull: false,
            comment: 'Purchase price in cents',
          },
          purchaseDate: {
            type: DataTypes.DATEONLY,
            allowNull: false,
          },
          valueAnchor: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Manual revaluation in cents; appreciation runs from here when set',
          },
          valueAnchorDate: {
            type: DataTypes.DATEONLY,
            allowNull: true,
          },
          annualAppreciationRatePct: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
            defaultValue: 3,
            comment: 'Signed flat annual rate; negative models a declining market',
          },
          valueLastComputedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: '30-day cache stamp for lazy-refresh; null forces recompute',
          },
          createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
          },
          updatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
          },
        },
        { transaction: t },
      );

      await queryInterface.addIndex('Properties', ['userId'], { transaction: t });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('Properties', { transaction: t });

      // The Accounts rows were cascade-deleted with the table, so this is a
      // safety net for any category value left dangling.
      await queryInterface.sequelize.query(
        `UPDATE "Accounts" SET "accountCategory" = 'general' WHERE "accountCategory" = 'property';`,
        { transaction: t },
      );

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
