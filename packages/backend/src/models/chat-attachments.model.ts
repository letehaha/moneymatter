import { ChatAttachmentKind, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType } from 'sequelize-typescript';

import ChatMessages from './chat-messages.model';
import ChatThreads from './chat-threads.model';
import Users from './users.model';

/**
 * A file the user attached to a chat as context. It is stored as prepared content, never as a file:
 * `extractedText` for PDF, CSV and text (capped), `imageData` for images. `messageId` is null from
 * the upload until the message that carries it is sent; an attachment that is never sent is swept
 * by age. Attachments are context only and are never saved onto transactions.
 */
@Table({
  tableName: 'ChatAttachments',
  timestamps: true,
  updatedAt: false,
  freezeTableName: true,
})
export default class ChatAttachments extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => ChatThreads)
  @Column({ type: DataType.UUID, allowNull: false })
  threadId!: RecordId;

  @ForeignKey(() => ChatMessages)
  @Column({ type: DataType.UUID, allowNull: true })
  messageId!: RecordId | null;

  @ForeignKey(() => Users)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @Column({ type: DataType.STRING(255), allowNull: false })
  fileName!: string;

  @Column({ type: DataType.STRING(127), allowNull: false })
  mimeType!: string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  kind!: ChatAttachmentKind;

  @Column({ type: DataType.INTEGER, allowNull: false })
  sizeBytes!: number;

  @Column({ type: DataType.STRING(64), allowNull: false })
  sha256!: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  extractedText!: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  pageCount!: number | null;

  @Column({ type: DataType.BLOB, allowNull: true })
  imageData!: Buffer | null;

  declare createdAt: Date;

  @BelongsTo(() => ChatThreads, { foreignKey: 'threadId', onDelete: 'CASCADE' })
  thread!: ChatThreads;

  @BelongsTo(() => ChatMessages, { foreignKey: 'messageId', onDelete: 'SET NULL' })
  message!: ChatMessages | null;

  @BelongsTo(() => Users, { foreignKey: 'userId', onDelete: 'CASCADE' })
  user!: Users;
}
