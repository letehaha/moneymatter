import type { RecordId, TransactionTemplateModel } from '@bt/shared/types';
import { roundToCurrency } from '@common/lib/currency-precision';
import { moneyToApiDecimalOrNull, type Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import Accounts from '@models/accounts.model';
import TransactionTemplateTags from '@models/transaction-template-tags.model';
import TransactionTemplates from '@models/transaction-templates.model';
import { Op, UniqueConstraintError } from 'sequelize';

/**
 * A pinned amount is denominated in the currency of the account it is pinned to, so it is
 * stored at that currency's decimals. Without an account (a null amount, which the
 * consistency check requires) there is nothing to round.
 */
export const roundTemplateAmount = async ({
  userId,
  accountId,
  amount,
}: {
  userId: number;
  accountId: RecordId | null;
  amount: Money | null;
}): Promise<Money | null> => {
  if (amount === null || accountId === null) return amount;

  const account = await Accounts.findOne({ where: { id: accountId, userId }, attributes: ['currencyCode'] });
  if (!account) return amount;

  return roundToCurrency({ money: amount, userId, currencyCode: account.currencyCode, mode: 'half-up' });
};

export const loadTemplateTagIds = async ({
  templateIds,
}: {
  templateIds: RecordId[];
}): Promise<Map<string, RecordId[]>> => {
  const byId = new Map<string, RecordId[]>();
  if (templateIds.length === 0) return byId;

  const rows = await TransactionTemplateTags.findAll({
    where: { templateId: { [Op.in]: templateIds } },
    attributes: ['templateId', 'tagId'],
  });

  for (const row of rows) {
    const existing = byId.get(row.templateId);
    if (existing) existing.push(row.tagId);
    else byId.set(row.templateId, [row.tagId]);
  }

  return byId;
};

/**
 * The column holds a Money; the API exchanges decimals. A pinned amount is suppressed
 * without an account, which `ON DELETE SET NULL` can leave behind on the row.
 */
export const serializeTemplate = ({
  template,
  tagIds,
}: {
  template: TransactionTemplates;
  tagIds: RecordId[];
}): TransactionTemplateModel => ({
  id: template.id,
  userId: template.userId,
  name: template.name,
  transactionType: template.transactionType,
  amount: template.accountId ? moneyToApiDecimalOrNull(template.amount) : null,
  accountId: template.accountId,
  categoryId: template.categoryId,
  payeeId: template.payeeId,
  paymentType: template.paymentType,
  note: template.note,
  originalCurrencyCode: template.originalCurrencyCode,
  tagIds,
  createdAt: template.createdAt,
  updatedAt: template.updatedAt,
});

/** Maps the `lower(btrim(name))` unique-index violation to a 409. */
export const writeOrConflict = async <T>(write: () => Promise<T>): Promise<T> => {
  try {
    return await write();
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw new ConflictError({ message: t({ key: 'transactionTemplates.nameAlreadyExists' }) });
    }
    throw error;
  }
};
