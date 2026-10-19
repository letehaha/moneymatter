import { CATEGORIZATION_MODE, LogoResolutionState, RecordId, TransactionLocation } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, BelongsToMany, HasMany, DataType } from 'sequelize-typescript';

import Categories from './categories.model';
import PayeeAliases from './payee-aliases.model';
import PayeeTags from './payee-tags.model';
import Tags from './tags.model';
import Users from './users.model';

@Table({
  tableName: 'Payees',
  timestamps: true,
  freezeTableName: true,
})
export default class Payees extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @Column({
    type: DataType.STRING(200),
    allowNull: false,
  })
  name!: string;

  @Column({
    type: DataType.STRING(200),
    allowNull: false,
  })
  normalizedName!: string;

  @ForeignKey(() => Categories)
  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  defaultCategoryId!: RecordId | null;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: CATEGORIZATION_MODE.enforce,
  })
  categorizationMode!: CATEGORIZATION_MODE;

  @Column({
    type: DataType.JSONB,
    allowNull: true,
  })
  defaultLocation!: TransactionLocation | null;

  @Column({
    type: DataType.STRING(253),
    allowNull: true,
  })
  logoDomain!: string | null;

  // VARCHAR + TS-side union (project convention: no DB enums). 'auto' =
  // system-resolved via BrandLogos; 'manual' = user override; null = unresolved.
  @Column({
    type: DataType.STRING(16),
    allowNull: true,
  })
  logoSource!: LogoResolutionState;

  // 1-2 graphemes rendered as a monogram instead of a logo.dev image. 16 chars
  // because one grapheme can span many code points; the count is enforced in Zod.
  @Column({
    type: DataType.STRING(16),
    allowNull: true,
  })
  logoInitials!: string | null;

  // '#rrggbb' lowercase, the monogram background. Only meaningful alongside
  // logoInitials; null there falls back to the primary tint.
  @Column({
    type: DataType.STRING(7),
    allowNull: true,
  })
  logoColor!: string | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
  })
  logoIcon!: string | null;

  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  logoImageId!: string | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Users)
  user!: Users;

  @BelongsTo(() => Categories)
  defaultCategory?: Categories | null;

  @HasMany(() => PayeeAliases, { foreignKey: 'payeeId', as: 'aliases' })
  aliases?: PayeeAliases[];

  @BelongsToMany(() => Tags, {
    through: () => PayeeTags,
    foreignKey: 'payeeId',
    otherKey: 'tagId',
    as: 'defaultTags',
  })
  defaultTags?: Tags[];
}
