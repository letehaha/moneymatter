import { RecordId } from '@bt/shared/types';
import { moneyToApiDecimalOrNull } from '@common/types/money';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import Tags from '@models/tags.model';
import TransactionTemplateTags from '@models/transaction-template-tags.model';
import TransactionTemplates from '@models/transaction-templates.model';
import { Op } from 'sequelize';

import type { TransactionTemplateRow } from '../types';
import { resolveRelationName } from './utils';

export async function transformTransactionTemplates({ userId }: { userId: number }): Promise<TransactionTemplateRow[]> {
  const templates = await TransactionTemplates.findAll({ where: { userId }, order: [['createdAt', 'ASC']] });
  if (templates.length === 0) return [];

  const collectIds = (pick: (tpl: TransactionTemplates) => RecordId | null) => [
    ...new Set(templates.map(pick).filter((id): id is RecordId => Boolean(id))),
  ];
  const accountIds = collectIds((tpl) => tpl.accountId);
  const categoryIds = collectIds((tpl) => tpl.categoryId);
  const payeeIds = collectIds((tpl) => tpl.payeeId);

  // Guard every FK lookup with `userId` so a stray cross-user reference cannot
  // leak another user's name into this export.
  const [accounts, categories, payees, tagLinks] = await Promise.all([
    accountIds.length
      ? Accounts.findAll({ where: { userId, id: { [Op.in]: accountIds } }, attributes: ['id', 'name', 'currencyCode'] })
      : Promise.resolve([] as Accounts[]),
    categoryIds.length
      ? Categories.findAll({ where: { userId, id: { [Op.in]: categoryIds } }, attributes: ['id', 'name'] })
      : Promise.resolve([] as Categories[]),
    payeeIds.length
      ? Payees.findAll({ where: { userId, id: { [Op.in]: payeeIds } }, attributes: ['id', 'name'] })
      : Promise.resolve([] as Payees[]),
    TransactionTemplateTags.findAll({
      where: { templateId: { [Op.in]: templates.map((tpl) => tpl.id) } },
      attributes: ['templateId', 'tagId'],
    }),
  ]);

  const tagIds = [...new Set(tagLinks.map((link) => link.tagId))];
  const tags = tagIds.length
    ? await Tags.findAll({ where: { userId, id: { [Op.in]: tagIds } }, attributes: ['id', 'name'] })
    : [];

  const accountNameById = new Map(accounts.map((a) => [String(a.id), a.name]));
  const accountCurrencyById = new Map(accounts.map((a) => [String(a.id), a.currencyCode]));
  const categoryNameById = new Map(categories.map((c) => [String(c.id), c.name]));
  const payeeNameById = new Map(payees.map((p) => [String(p.id), p.name]));
  const tagNameById = new Map(tags.map((tag) => [String(tag.id), tag.name]));

  const tagNamesByTemplate = new Map<string, string[]>();
  for (const link of tagLinks) {
    const name = tagNameById.get(String(link.tagId));
    if (name === undefined) continue;
    const existing = tagNamesByTemplate.get(link.templateId);
    if (existing) existing.push(name);
    else tagNamesByTemplate.set(link.templateId, [name]);
  }

  return templates.map((template): TransactionTemplateRow => {
    const context = `transaction template ${template.id}`;
    return {
      name: template.name,
      type: template.transactionType,
      // Without an account the stored amount has no currency, so it is not exported.
      amount: template.accountId ? moneyToApiDecimalOrNull(template.amount) : null,
      currency: template.accountId ? (accountCurrencyById.get(String(template.accountId)) ?? '') : '',
      account: resolveRelationName({
        id: template.accountId,
        nameById: accountNameById,
        relation: 'account',
        context,
      }),
      category: resolveRelationName({
        id: template.categoryId,
        nameById: categoryNameById,
        relation: 'category',
        context,
      }),
      payee: resolveRelationName({ id: template.payeeId, nameById: payeeNameById, relation: 'payee', context }),
      tags: tagNamesByTemplate.get(template.id) ?? [],
      note: template.note ?? '',
    };
  });
}
