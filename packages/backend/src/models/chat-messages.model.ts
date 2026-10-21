import {
  ChatMessageError,
  ChatMessagePart,
  ChatMessageRole,
  ChatMessageStatus,
  ChatPageContext,
  ChatUsage,
  RecordId,
} from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType } from 'sequelize-typescript';

import ChatThreads from './chat-threads.model';
import Users from './users.model';

/**
 * One user or assistant turn of a thread. `parts` is the ordered list of text, visual, card and
 * clarification parts; `plainText` carries the user text and the final answer text for search and
 * titles.
 *
 * The table also has a generated `searchVector` column (`to_tsvector('simple', "plainText")`, GIN
 * indexed). The model does not declare it, so ordinary reads never carry the vector; the search
 * query names it explicitly.
 */
@Table({
  tableName: 'ChatMessages',
  timestamps: true,
  freezeTableName: true,
})
export default class ChatMessages extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => ChatThreads)
  @Column({ type: DataType.UUID, allowNull: false })
  threadId!: RecordId;

  @ForeignKey(() => Users)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @Column({ type: DataType.STRING(16), allowNull: false })
  role!: ChatMessageRole;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'complete' })
  status!: ChatMessageStatus;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [] })
  parts!: ChatMessagePart[];

  @Column({ type: DataType.TEXT, allowNull: true })
  plainText!: string | null;

  // Set on user messages: the page the panel was opened on.
  @Column({ type: DataType.JSONB, allowNull: true })
  pageContext!: ChatPageContext | null;

  // Set on assistant messages: the run that produced the message.
  @Column({ type: DataType.UUID, allowNull: true })
  runId!: RecordId | null;

  @Column({ type: DataType.STRING(64), allowNull: true })
  provider!: string | null;

  @Column({ type: DataType.STRING(200), allowNull: true })
  modelId!: string | null;

  @Column({ type: DataType.STRING(32), allowNull: true })
  promptVersion!: string | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  usage!: ChatUsage | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  stepCount!: number;

  @Column({ type: DataType.JSONB, allowNull: true })
  error!: ChatMessageError | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => ChatThreads, { foreignKey: 'threadId', onDelete: 'CASCADE' })
  thread!: ChatThreads;

  @BelongsTo(() => Users, { foreignKey: 'userId', onDelete: 'CASCADE' })
  user!: Users;
}
