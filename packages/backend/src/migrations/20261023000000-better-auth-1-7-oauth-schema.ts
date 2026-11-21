import { DataTypes, QueryInterface, Transaction } from 'sequelize';

/**
 * Schema for @better-auth/oauth-provider 1.7 (resource indicators, back-channel logout,
 * client registration alignment). string[] columns are TEXT holding a JSON array, json
 * columns are JSONB: that is how better-auth's kysely adapter reads them on Postgres.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      const addColumn = (table: string, column: string, type: DataTypes.DataType, defaultValue?: unknown) =>
        queryInterface.addColumn(table, column, { type, allowNull: true, defaultValue }, { transaction: t });

      // 1.7 only accepts a credential account whose accountId equals userId; legacy-migrated
      // users have their username there and can't sign in otherwise. Not reverted in `down`.
      await queryInterface.sequelize.query(
        `UPDATE "ba_account" SET "accountId" = "userId"
          WHERE "providerId" = 'credential' AND "accountId" <> "userId"`,
        { transaction: t },
      );

      await addColumn('ba_jwks', 'alg', DataTypes.TEXT);
      await addColumn('ba_jwks', 'crv', DataTypes.TEXT);

      await addColumn('ba_oauth_client', 'clientDiscoveryId', DataTypes.TEXT);
      await addColumn('ba_oauth_client', 'clientCredentialsScopes', DataTypes.TEXT, '[]');
      await addColumn('ba_oauth_client', 'backchannelLogoutUri', DataTypes.TEXT);
      await addColumn('ba_oauth_client', 'backchannelLogoutSessionRequired', DataTypes.BOOLEAN);
      await addColumn('ba_oauth_client', 'applicationType', DataTypes.TEXT);
      await addColumn('ba_oauth_client', 'jwks', DataTypes.TEXT);
      await addColumn('ba_oauth_client', 'jwksUri', DataTypes.TEXT);
      await addColumn('ba_oauth_client', 'dpopBoundAccessTokens', DataTypes.BOOLEAN, false);

      // Mapping from the 1.7 upgrade guide: web/native carry over, user-agent-based needs manual
      // review (left NULL); `public` is replaced by tokenEndpointAuthMethod = 'none'.
      await queryInterface.sequelize.query(
        `UPDATE "ba_oauth_client"
           SET "applicationType" = CASE WHEN "type" IN ('web', 'native') THEN "type" END,
               "tokenEndpointAuthMethod" = CASE WHEN "public" = true THEN 'none' ELSE "tokenEndpointAuthMethod" END,
               "clientCredentialsScopes" = '[]'`,
        { transaction: t },
      );
      await queryInterface.removeColumn('ba_oauth_client', 'type', { transaction: t });
      await queryInterface.removeColumn('ba_oauth_client', 'public', { transaction: t });

      await addColumn('ba_oauth_access_token', 'authorizationCodeId', DataTypes.TEXT);
      await addColumn('ba_oauth_access_token', 'resources', DataTypes.TEXT);
      await addColumn('ba_oauth_access_token', 'requestedUserInfoClaims', DataTypes.TEXT);
      await addColumn('ba_oauth_access_token', 'revoked', DataTypes.DATE);
      await addColumn('ba_oauth_access_token', 'confirmation', DataTypes.JSONB);

      await addColumn('ba_oauth_refresh_token', 'authorizationCodeId', DataTypes.TEXT);
      await addColumn('ba_oauth_refresh_token', 'resources', DataTypes.TEXT);
      await addColumn('ba_oauth_refresh_token', 'requestedUserInfoClaims', DataTypes.TEXT);
      await addColumn('ba_oauth_refresh_token', 'rotatedAt', DataTypes.DATE);
      await addColumn('ba_oauth_refresh_token', 'rotationReplayResponse', DataTypes.TEXT);
      await addColumn('ba_oauth_refresh_token', 'rotationReplayExpiresAt', DataTypes.DATE);
      await addColumn('ba_oauth_refresh_token', 'confirmation', DataTypes.JSONB);

      await addColumn('ba_oauth_consent', 'resources', DataTypes.TEXT);
      await addColumn('ba_oauth_consent', 'requestedUserInfoClaims', DataTypes.TEXT);

      await queryInterface.createTable(
        'ba_oauth_resource',
        {
          id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
          identifier: { type: DataTypes.TEXT, allowNull: false, unique: true },
          name: { type: DataTypes.TEXT, allowNull: false },
          accessTokenTtl: { type: DataTypes.INTEGER, allowNull: true },
          refreshTokenTtl: { type: DataTypes.INTEGER, allowNull: true },
          signingAlgorithm: { type: DataTypes.TEXT, allowNull: true },
          signingKeyId: { type: DataTypes.TEXT, allowNull: true },
          allowedScopes: { type: DataTypes.TEXT, allowNull: true },
          customClaims: { type: DataTypes.JSONB, allowNull: true },
          dpopBoundAccessTokensRequired: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
          disabled: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
          createdAt: { type: DataTypes.DATE, allowNull: true },
          updatedAt: { type: DataTypes.DATE, allowNull: true },
          policyVersion: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1 },
          metadata: { type: DataTypes.JSONB, allowNull: true },
        },
        { transaction: t },
      );

      await queryInterface.createTable(
        'ba_oauth_client_resource',
        {
          id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
          clientId: {
            type: DataTypes.TEXT,
            allowNull: false,
            references: { model: 'ba_oauth_client', key: 'clientId' },
            onDelete: 'CASCADE',
          },
          resourceId: {
            type: DataTypes.TEXT,
            allowNull: false,
            references: { model: 'ba_oauth_resource', key: 'identifier' },
            onDelete: 'CASCADE',
          },
          metadata: { type: DataTypes.JSONB, allowNull: true },
          createdAt: { type: DataTypes.DATE, allowNull: true },
        },
        { transaction: t },
      );
      await queryInterface.addIndex('ba_oauth_client_resource', ['clientId', 'resourceId'], {
        name: 'ba_oauth_client_resource_client_resource_idx',
        unique: true,
        transaction: t,
      });

      await queryInterface.createTable(
        'ba_oauth_client_assertion',
        {
          id: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
          expiresAt: { type: DataTypes.DATE, allowNull: false },
        },
        { transaction: t },
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('ba_oauth_client_assertion', { transaction: t });
      await queryInterface.dropTable('ba_oauth_client_resource', { transaction: t });
      await queryInterface.dropTable('ba_oauth_resource', { transaction: t });

      const removeColumns = async (table: string, columns: string[]) => {
        for (const column of columns) {
          await queryInterface.removeColumn(table, column, { transaction: t });
        }
      };

      await removeColumns('ba_oauth_consent', ['resources', 'requestedUserInfoClaims']);
      await removeColumns('ba_oauth_refresh_token', [
        'authorizationCodeId',
        'resources',
        'requestedUserInfoClaims',
        'rotatedAt',
        'rotationReplayResponse',
        'rotationReplayExpiresAt',
        'confirmation',
      ]);
      await removeColumns('ba_oauth_access_token', [
        'authorizationCodeId',
        'resources',
        'requestedUserInfoClaims',
        'revoked',
        'confirmation',
      ]);

      await queryInterface.addColumn(
        'ba_oauth_client',
        'type',
        { type: DataTypes.TEXT, allowNull: true },
        { transaction: t },
      );
      await queryInterface.addColumn(
        'ba_oauth_client',
        'public',
        { type: DataTypes.BOOLEAN, allowNull: true },
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `UPDATE "ba_oauth_client"
           SET "type" = "applicationType",
               "public" = ("tokenEndpointAuthMethod" = 'none')`,
        { transaction: t },
      );
      await removeColumns('ba_oauth_client', [
        'clientDiscoveryId',
        'clientCredentialsScopes',
        'backchannelLogoutUri',
        'backchannelLogoutSessionRequired',
        'applicationType',
        'jwks',
        'jwksUri',
        'dpopBoundAccessTokens',
      ]);

      await removeColumns('ba_jwks', ['alg', 'crv']);

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
