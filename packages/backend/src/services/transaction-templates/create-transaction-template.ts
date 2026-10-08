import type { CreateTransactionTemplateBody, TransactionTemplateModel } from '@bt/shared/types';
import { Money } from '@common/types/money';
import TransactionTemplates from '@models/transaction-templates.model';
import { withTransaction } from '@services/common/with-transaction';

import { assertTemplateConsistent } from './assert-template-consistent';
import { serializeTemplate, writeOrConflict } from './helpers';

type CreateTransactionTemplateParams = CreateTransactionTemplateBody & { userId: number };

export const createTransactionTemplate = withTransaction(
  async ({
    userId,
    name,
    transactionType,
    amount = null,
    accountId = null,
    categoryId = null,
    payeeId = null,
    paymentType = null,
    note = null,
    originalCurrencyCode = null,
    tagIds = [],
  }: CreateTransactionTemplateParams): Promise<TransactionTemplateModel> => {
    const storedAmount = amount === null ? null : Money.fromDecimal(amount);

    await assertTemplateConsistent({ userId, amount: storedAmount, accountId, categoryId, payeeId, tagIds });

    const template = await writeOrConflict(() =>
      TransactionTemplates.create({
        userId,
        name,
        transactionType,
        amount: storedAmount,
        accountId,
        categoryId,
        payeeId,
        paymentType,
        note,
        originalCurrencyCode,
      }),
    );

    if (tagIds.length > 0) {
      await template.$set('tags', tagIds);
    }

    return serializeTemplate({ template, tagIds });
  },
);
