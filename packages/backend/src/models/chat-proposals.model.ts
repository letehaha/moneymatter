import {
  ChatCardDanger,
  ChatCardError,
  ChatCardKind,
  ChatConfirmationMode,
  ChatEntityKind,
  ChatProposalPreview,
  ChatProposalResult,
  ChatProposalSnapshot,
  ChatProposalStatus,
  ChatSource,
  ChatUncertainField,
  RecordId,
} from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType } from 'sequelize-typescript';

import ChatMessages from './chat-messages.model';
import ChatThreads from './chat-threads.model';
import Users from './users.model';

/**
 * One change card: a write the model proposed and the user has not (or has) approved.
 *
 * `proposedArgs` keeps the arguments as the model sent them; `args` is the current validated copy
 * (edits land here), with `$proposal:<id>` refs to parent cards left in place. `revision` starts at
 * 1 and is incremented by every edit and refresh, and an approval must carry the revision the user
 * saw. After an approval `executedArgs` holds what the handler ran (refs substituted, bulk ids
 * frozen) and `result` the slimmed handler output.
 *
 * A card lives and dies with its thread, so the applied cards double as the applied-changes record.
 */
@Table({
  tableName: 'ChatProposals',
  timestamps: true,
  freezeTableName: true,
})
export default class ChatProposals extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => ChatThreads)
  @Column({ type: DataType.UUID, allowNull: false })
  threadId!: RecordId;

  @ForeignKey(() => ChatMessages)
  @Column({ type: DataType.UUID, allowNull: false })
  messageId!: RecordId;

  @ForeignKey(() => Users)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @Column({ type: DataType.STRING(100), allowNull: false })
  toolName!: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  proposedArgs!: Record<string, unknown>;

  @Column({ type: DataType.JSONB, allowNull: false })
  args!: Record<string, unknown>;

  @Column({ type: DataType.ARRAY(DataType.TEXT), allowNull: false, defaultValue: [] })
  editedFields!: string[];

  @Column({ type: DataType.STRING(16), allowNull: false })
  cardKind!: ChatCardKind;

  @Column({ type: DataType.STRING(48), allowNull: false })
  entity!: ChatEntityKind;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'none' })
  danger!: ChatCardDanger;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'none' })
  confirmation!: ChatConfirmationMode;

  // The affected count the user types for a `typed` confirmation.
  @Column({ type: DataType.STRING(64), allowNull: true })
  confirmationPhrase!: string | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  preview!: ChatProposalPreview | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  uncertainFields!: ChatUncertainField[] | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  sources!: ChatSource[] | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  snapshot!: ChatProposalSnapshot | null;

  // Ids of the cards whose results this card refers to through `$proposal:<id>`.
  @Column({ type: DataType.ARRAY(DataType.UUID), allowNull: false, defaultValue: [] })
  dependsOn!: RecordId[];

  // The card this one replaced after a refresh that changed its target.
  @Column({ type: DataType.UUID, allowNull: true })
  supersedesId!: RecordId | null;

  // `applying` and `unknown` occur only for standalone tools, whose effects escape the approval transaction.
  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'pending' })
  status!: ChatProposalStatus;

  @Column({ type: DataType.STRING(200), allowNull: true })
  statusReason!: string | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
  revision!: number;

  @Column({ type: DataType.JSONB, allowNull: true })
  executedArgs!: Record<string, unknown> | null;

  // One per approval: every card applied by the same approval shares it.
  @Column({ type: DataType.UUID, allowNull: true })
  chainId!: RecordId | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  result!: ChatProposalResult | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  error!: ChatCardError | null;

  // An unapproved card expires 24 hours after it was proposed, pinned thread or not.
  @Column({ type: DataType.DATE, allowNull: false })
  expiresAt!: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  decidedAt!: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  appliedAt!: Date | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => ChatThreads, { foreignKey: 'threadId', onDelete: 'CASCADE' })
  thread!: ChatThreads;

  @BelongsTo(() => ChatMessages, { foreignKey: 'messageId', onDelete: 'CASCADE' })
  message!: ChatMessages;

  @BelongsTo(() => Users, { foreignKey: 'userId', onDelete: 'CASCADE' })
  user!: Users;
}
