import type { RecordId, TransactionTemplateModel, UpdateTransactionTemplateBody } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import TransactionTemplates from '@models/transaction-templates.model';
import { withTransaction } from '@services/common/with-transaction';

import { assertTemplateConsistent } from './assert-template-consistent';
import { loadTemplateTagIds, serializeTemplate, writeOrConflict } from './helpers';

type UpdateTransactionTemplateParams = UpdateTransactionTemplateBody & { id: RecordId; userId: number };

export const updateTransactionTemplate = withTransaction(
  async ({ id, userId, tagIds, ...fields }: UpdateTransactionTemplateParams): Promise<TransactionTemplateModel> => {
    const template = await findOrThrowNotFound({
      query: TransactionTemplates.findOne({ where: { id, userId } }),
      message: t({ key: 'transactionTemplates.notFound' }),
    });

    const mergedTagIds = tagIds ?? (await loadTemplateTagIds({ templateIds: [id] })).get(id) ?? [];

    // `undefined` leaves a field unchanged, `null` clears it. The stored amount starts
    // normalized because `ON DELETE SET NULL` on the account can strand it without a
    // currency, and the merged object is both validated and written.
    const merged = {
      name: template.name,
      transactionType: template.transactionType,
      amount: template.accountId ? template.amount : null,
      accountId: template.accountId,
      categoryId: template.categoryId,
      payeeId: template.payeeId,
      paymentType: template.paymentType,
      note: template.note,
      originalCurrencyCode: template.originalCurrencyCode,
      ...(fields.name !== undefined && { name: fields.name }),
      ...(fields.transactionType !== undefined && { transactionType: fields.transactionType }),
      ...(fields.amount !== undefined && { amount: fields.amount === null ? null : Money.fromDecimal(fields.amount) }),
      ...(fields.accountId !== undefined && { accountId: fields.accountId }),
      ...(fields.categoryId !== undefined && { categoryId: fields.categoryId }),
      ...(fields.payeeId !== undefined && { payeeId: fields.payeeId }),
      ...(fields.paymentType !== undefined && { paymentType: fields.paymentType }),
      ...(fields.note !== undefined && { note: fields.note }),
      ...(fields.originalCurrencyCode !== undefined && { originalCurrencyCode: fields.originalCurrencyCode }),
    };

    await assertTemplateConsistent({
      userId,
      amount: merged.amount,
      accountId: merged.accountId,
      categoryId: merged.categoryId,
      payeeId: merged.payeeId,
      tagIds: mergedTagIds,
    });

    await writeOrConflict(() => template.update(merged));

    if (tagIds !== undefined) {
      await template.$set('tags', tagIds);
    }

    return serializeTemplate({ template, tagIds: mergedTagIds });
  },
);
