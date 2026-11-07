import { DataTypes, QueryInterface } from 'sequelize';

/**
 * AI chat storage: "ChatThreads", "ChatMessages", "ChatProposals" and "ChatAttachments".
 *
 * Every table cascades with "Users". Messages, proposals and attachments cascade with their thread;
 * proposals also cascade with the message that proposed them. An attachment keeps living when its
 * message goes ("messageId" is set to null), because it is uploaded before the message is sent and
 * is swept by age when it never gets sent. A proposal that supersedes another one points at it and
 * loses the pointer when that row goes.
 *
 * "ChatMessages"."searchVector" is generated from "plainText" with the 'simple' configuration, so
 * it needs no extension and treats every language the same way (no stemming).
 *
 * "ChatThreads"."connectionId" and "modelId" name the AI connection a thread's runs use and, optionally, a
 * model of its provider instead of the connection's own. AI connections live in the user's settings JSON,
 * not in a table, so neither column has a foreign key: a connection deleted in Settings leaves its id behind
 * and the next run settles on another one. Null "connectionId" is the included server model, or no choice yet.
 *
 * "ChatThreads"."pageContext" is the page the conversation is about, set when it starts and kept until the
 * user removes or replaces it. Its runs read it instead of a context per message. Null is no context.
 *
 * No money columns: token counts and cost estimates are not user money.
 *
 * `down` drops the four tables with every thread, message, card and attachment in them. Threads are
 * short-lived conversation logs, and a card is only valid against the data it was proposed for.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const userFk = {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      } as const;
      const threadFk = {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'ChatThreads', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      } as const;
      const timestamps = {
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      } as const;

      await queryInterface.createTable(
        'ChatThreads',
        {
          id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
          userId: userFk,
          title: { type: DataTypes.STRING(120), allowNull: false },
          titleSource: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'auto' },
          pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          connectionId: { type: DataTypes.UUID, allowNull: true },
          modelId: { type: DataTypes.STRING(200), allowNull: true },
          pageContext: { type: DataTypes.JSONB, allowNull: true },
          lastMessageAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
          expiresAt: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Null when the thread is pinned or the retention is "never"',
          },
          inputTokens: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
          outputTokens: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
          cachedInputTokens: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
          ...timestamps,
        },
        { transaction },
      );
      await queryInterface.addIndex('ChatThreads', {
        name: 'chat_threads_user_pinned_last_message_idx',
        fields: ['userId', 'pinned', { name: 'lastMessageAt', order: 'DESC' }],
        transaction,
      });
      await queryInterface.addIndex('ChatThreads', ['expiresAt'], { transaction });

      await queryInterface.createTable(
        'ChatMessages',
        {
          id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
          threadId: threadFk,
          userId: userFk,
          role: { type: DataTypes.STRING(16), allowNull: false },
          status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'complete' },
          parts: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
          plainText: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'User text and final answer text, for search and titles',
          },
          pageContext: { type: DataTypes.JSONB, allowNull: true },
          runId: { type: DataTypes.UUID, allowNull: true },
          provider: { type: DataTypes.STRING(64), allowNull: true },
          modelId: { type: DataTypes.STRING(200), allowNull: true },
          promptVersion: { type: DataTypes.STRING(32), allowNull: true },
          usage: { type: DataTypes.JSONB, allowNull: true },
          stepCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          error: { type: DataTypes.JSONB, allowNull: true },
          ...timestamps,
        },
        { transaction },
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "ChatMessages"
           ADD COLUMN "searchVector" tsvector
           GENERATED ALWAYS AS (to_tsvector('simple', coalesce("plainText", ''))) STORED;`,
        { transaction },
      );
      await queryInterface.addIndex('ChatMessages', ['threadId', 'createdAt'], { transaction });
      await queryInterface.addIndex('ChatMessages', ['userId'], { transaction });
      await queryInterface.sequelize.query(
        `CREATE INDEX "chat_messages_search_vector_idx" ON "ChatMessages" USING GIN ("searchVector");`,
        { transaction },
      );

      await queryInterface.createTable(
        'ChatProposals',
        {
          id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
          threadId: threadFk,
          messageId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'ChatMessages', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          userId: userFk,
          toolName: { type: DataTypes.STRING(100), allowNull: false },
          proposedArgs: {
            type: DataTypes.JSONB,
            allowNull: false,
            comment: 'The arguments exactly as the model sent them',
          },
          args: {
            type: DataTypes.JSONB,
            allowNull: false,
            comment: 'The current, validated arguments; $proposal refs stay in place',
          },
          editedFields: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
          cardKind: { type: DataTypes.STRING(16), allowNull: false },
          entity: { type: DataTypes.STRING(48), allowNull: false },
          danger: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'none' },
          confirmation: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'none' },
          confirmationPhrase: { type: DataTypes.STRING(64), allowNull: true },
          preview: { type: DataTypes.JSONB, allowNull: true },
          uncertainFields: { type: DataTypes.JSONB, allowNull: true },
          sources: { type: DataTypes.JSONB, allowNull: true },
          snapshot: { type: DataTypes.JSONB, allowNull: true },
          dependsOn: { type: DataTypes.ARRAY(DataTypes.UUID), allowNull: false, defaultValue: [] },
          supersedesId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: { model: 'ChatProposals', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
          statusReason: { type: DataTypes.STRING(200), allowNull: true },
          revision: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
            comment: 'Incremented by every edit and refresh; approve must send the revision the user saw',
          },
          executedArgs: {
            type: DataTypes.JSONB,
            allowNull: true,
            comment: 'What the handler ran: refs substituted, bulk ids frozen',
          },
          chainId: { type: DataTypes.UUID, allowNull: true, comment: 'One per approval' },
          result: { type: DataTypes.JSONB, allowNull: true },
          error: { type: DataTypes.JSONB, allowNull: true },
          expiresAt: {
            type: DataTypes.DATE,
            allowNull: false,
            comment: 'An unapproved card expires 24 hours after it was proposed',
          },
          decidedAt: { type: DataTypes.DATE, allowNull: true },
          appliedAt: { type: DataTypes.DATE, allowNull: true },
          ...timestamps,
        },
        { transaction },
      );
      await queryInterface.addIndex('ChatProposals', ['threadId'], { transaction });
      await queryInterface.addIndex('ChatProposals', ['userId', 'status'], { transaction });
      await queryInterface.addIndex('ChatProposals', ['status', 'expiresAt'], { transaction });
      await queryInterface.addIndex('ChatProposals', {
        name: 'chat_proposals_user_applied_at_idx',
        fields: ['userId', { name: 'appliedAt', order: 'DESC' }],
        transaction,
      });

      await queryInterface.createTable(
        'ChatAttachments',
        {
          id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
          threadId: threadFk,
          messageId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: { model: 'ChatMessages', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          userId: userFk,
          fileName: { type: DataTypes.STRING(255), allowNull: false },
          mimeType: { type: DataTypes.STRING(127), allowNull: false },
          kind: { type: DataTypes.STRING(16), allowNull: false },
          sizeBytes: { type: DataTypes.INTEGER, allowNull: false },
          sha256: { type: DataTypes.STRING(64), allowNull: false },
          extractedText: { type: DataTypes.TEXT, allowNull: true },
          pageCount: { type: DataTypes.INTEGER, allowNull: true },
          imageData: { type: DataTypes.BLOB, allowNull: true, comment: 'Image attachments only' },
          createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        { transaction },
      );
      await queryInterface.addIndex('ChatAttachments', ['threadId'], { transaction });
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('ChatAttachments', { transaction });
      await queryInterface.dropTable('ChatProposals', { transaction });
      await queryInterface.dropTable('ChatMessages', { transaction });
      await queryInterface.dropTable('ChatThreads', { transaction });
    });
  },
};
