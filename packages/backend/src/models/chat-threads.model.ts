import { AI_MODEL_NAME_MAX_LENGTH, ChatPageContext, ChatThreadTitleSource, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, HasMany, DataType } from 'sequelize-typescript';

import ChatAttachments from './chat-attachments.model';
import ChatMessages from './chat-messages.model';
import ChatProposals from './chat-proposals.model';
import Users from './users.model';

/**
 * One AI chat conversation. Private to its owner: threads are never shared with household members
 * and are left out of backups. Messages, cards and attachments cascade with the thread.
 *
 * `expiresAt` is the end of the retention window (`lastMessageAt` plus the user's retention), and
 * null for a pinned thread or when retention is "never". Token counters are summed per run.
 * BIGINT columns come back from Postgres as strings, so the counters are typed accordingly.
 */
@Table({
  tableName: 'ChatThreads',
  timestamps: true,
  freezeTableName: true,
})
export default class ChatThreads extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @Column({ type: DataType.STRING(120), allowNull: false })
  title!: string;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'auto' })
  titleSource!: ChatThreadTitleSource;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  pinned!: boolean;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  lastMessageAt!: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  expiresAt!: Date | null;

  /** An id in the owner's settings (`ai.connections`); null is the included server model or no choice yet. */
  @Column({ type: DataType.UUID, allowNull: true })
  connectionId!: string | null;

  /** A model of the connection's provider used instead of the connection's own; null is the connection's own. */
  @Column({ type: DataType.STRING(AI_MODEL_NAME_MAX_LENGTH), allowNull: true })
  modelId!: string | null;

  /** The page the conversation is about; null is none. The runs read it, and the user can remove or replace it. */
  @Column({ type: DataType.JSONB, allowNull: true })
  pageContext!: ChatPageContext | null;

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: 0 })
  inputTokens!: string | number;

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: 0 })
  outputTokens!: string | number;

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: 0 })
  cachedInputTokens!: string | number;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Users, { foreignKey: 'userId', onDelete: 'CASCADE' })
  user!: Users;

  @HasMany(() => ChatMessages, { foreignKey: 'threadId', onDelete: 'CASCADE' })
  messages!: ChatMessages[];

  @HasMany(() => ChatProposals, { foreignKey: 'threadId', onDelete: 'CASCADE' })
  proposals!: ChatProposals[];

  @HasMany(() => ChatAttachments, { foreignKey: 'threadId', onDelete: 'CASCADE' })
  attachments!: ChatAttachments[];
}
