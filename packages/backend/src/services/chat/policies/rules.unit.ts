import type { ChatCardDanger, ChatCardKind, ChatEntityKind } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { CHAT_EXCLUDED_TOOLS } from './excluded';
import { getToolPolicy, resolveToolPolicy } from './index';
import { confirmationFor, HIGH_IMPACT_TOOLS, type PreviewResolverName } from './rules';

type PolicyRow = [
  tool: string,
  kind: ChatCardKind,
  entity: ChatEntityKind,
  danger: ChatCardDanger,
  resolver: PreviewResolverName | null,
  targetFields: string[],
];

const policyOf = ({ name }: { name: string }) => {
  const policy = getToolPolicy({ name });
  if (!policy) throw new Error(`no policy for ${name}`);
  return policy;
};

describe('tool policy rules', () => {
  it.each<PolicyRow>([
    // [tool, kind, entity, danger, resolver, targetFields]; targetFields name the target rows for the entity loader only
    ['create_transaction', 'create', 'transaction', 'none', null, []],
    ['create_budget_plan_line', 'create', 'budgetPlanLine', 'none', null, []],
    ['update_payee', 'update', 'payee', 'none', 'entity', ['id']],
    ['update_account', 'update', 'account', 'none', 'entity', ['accountId']],
    ['delete_tag', 'delete', 'tag', 'destructive', 'entity', ['id']],
    ['delete_budget_plan_line', 'delete', 'budgetPlanLine', 'destructive', 'entity', ['planId', 'lineId']],
    ['bulk_delete_payees', 'bulk', 'payee', 'destructive', 'bulkDeletePayees', []],
    ['bulk_update_transactions', 'bulk', 'transaction', 'destructive', 'bulkUpdateTransactions', []],
    ['bulk_delete_transactions', 'bulk', 'transaction', 'destructive', 'bulkDeleteTransactions', []],
    ['merge_payees', 'merge', 'payee', 'destructive', 'mergePayees', []],
    ['confirm_planned_transaction', 'action', 'transaction', 'none', 'entity', ['transactionId']],
    ['set_budget_plan_assignment', 'update', 'budgetPlanLine', 'none', 'budgetPlanAssignment', []],
    ['link_transfer', 'link', 'transaction', 'none', null, []],
    ['update_user_settings', 'settings', 'userSettings', 'none', null, []],
    ['set_payees_categorization_mode', 'settings', 'payee', 'none', null, []],
    ['remove_duplicate_transactions', 'bulk', 'transaction', 'highImpact', 'removeDuplicateTransactions', []],
    ['merge_duplicate_transactions', 'merge', 'transaction', 'highImpact', 'mergeDuplicateTransactions', []],
    ['unlink_account_from_bank_connection', 'link', 'account', 'highImpact', 'entity', ['accountId']],
  ])('%s is a %s card for %s, danger %s, resolver %s', (name, kind, entity, danger, resolver, targetFields) => {
    const policy = policyOf({ name });

    expect(policy).toMatchObject({ name, kind, entity, danger, previewResolver: resolver, targetFields });
  });

  it('derives a singular entity from a plural tool name', () => {
    expect(policyOf({ name: 'bulk_delete_payees' }).entity).toBe('payee');
    expect(policyOf({ name: 'create_account_group' }).entity).toBe('accountGroup');
  });

  it('gives a tool that queues work or commits on its own a standalone, high-impact policy', () => {
    for (const name of ['change_base_currency', 'delete_import_batch']) {
      expect(policyOf({ name })).toMatchObject({ standalone: true, danger: 'highImpact' });
    }
    expect(policyOf({ name: 'change_base_currency' })).toMatchObject({
      kind: 'action',
      previewResolver: 'changeBaseCurrency',
    });
    expect(policyOf({ name: 'delete_import_batch' })).toMatchObject({
      kind: 'delete',
      previewResolver: 'deleteImportBatch',
    });
  });

  it('leaves every other tool chainable', () => {
    for (const name of [
      'create_category',
      'create_tag',
      'delete_account',
      'merge_payees',
      'set_currency_rate_source',
    ]) {
      expect(policyOf({ name }).standalone).toBe(false);
    }
  });

  it('reads the id of a created entity from the handler output', () => {
    expect(policyOf({ name: 'create_category' }).resultIdPath).toBe('id');
    expect(policyOf({ name: 'create_transaction' }).resultIdPath).toBe('0.id');
    expect(policyOf({ name: 'create_budget_plan' }).resultIdPath).toBe('plan.id');
  });

  it('has no policy for a read tool, an excluded tool or an unknown name', () => {
    expect(getToolPolicy({ name: 'get_accounts' })).toBeNull();
    expect(getToolPolicy({ name: 'search_transactions' })).toBeNull();
    expect(getToolPolicy({ name: 'create_attachment_upload_url' })).toBeNull();
    expect(getToolPolicy({ name: 'test_currency_rate_source' })).toBeNull();
    expect(getToolPolicy({ name: 'frobnicate' })).toBeNull();
    expect(Object.keys(CHAT_EXCLUDED_TOOLS).toSorted()).toEqual([
      'create_attachment_upload_url',
      'test_currency_rate_source',
    ]);
  });

  describe('ignore_payee_name', () => {
    it('is a plain action without force', () => {
      expect(resolveToolPolicy({ name: 'ignore_payee_name', args: { rawName: 'ACME' } })).toMatchObject({
        kind: 'action',
        entity: 'payee',
        danger: 'none',
        previewResolver: 'ignorePayeeName',
        egress: null,
      });
      expect(resolveToolPolicy({ name: 'ignore_payee_name', args: { rawName: 'ACME', force: false } })?.danger).toBe(
        'none',
      );
    });

    it('turns red on its delete path, with force', () => {
      expect(resolveToolPolicy({ name: 'ignore_payee_name', args: { rawName: 'ACME', force: true } })?.danger).toBe(
        'destructive',
      );
    });
  });

  describe('set_currency_rate_source', () => {
    it('is an egress card for an http source and names the URL and host', () => {
      const resolved = resolveToolPolicy({
        name: 'set_currency_rate_source',
        args: {
          code: 'GEL2',
          rateSource: 'http',
          config: { urlTemplate: 'https://rates.example.com/v1/{code}?date={date}', jsonPath: 'data.price' },
        },
      });

      expect(resolved).toMatchObject({
        kind: 'update',
        entity: 'customCurrency',
        egress: { url: 'https://rates.example.com/v1/{code}?date={date}', host: 'rates.example.com' },
      });
    });

    it.each([
      ['coingecko', { coinId: 'bitcoin' }],
      ['peg', { pegCurrency: 'USD', factor: 1 }],
      ['manual', undefined],
      ['provider', undefined],
    ])('is not an egress card for a %s source', (rateSource, config) => {
      const resolved = resolveToolPolicy({
        name: 'set_currency_rate_source',
        args: { code: 'GEL2', rateSource, config },
      });

      expect(resolved?.egress).toBeNull();
    });

    it('stays egress when the URL does not parse, with an empty host', () => {
      const resolved = resolveToolPolicy({
        name: 'set_currency_rate_source',
        args: { code: 'GEL2', rateSource: 'http', config: { urlTemplate: 'not a url', jsonPath: 'x' } },
      });

      expect(resolved?.egress).toEqual({ url: 'not a url', host: '' });
    });
  });

  it('resolves no policy for a tool without one', () => {
    expect(resolveToolPolicy({ name: 'get_accounts', args: {} })).toBeNull();
  });

  it('pairs an id field with the entity it names', () => {
    expect(policyOf({ name: 'create_transaction' }).entityFields).toMatchObject({
      accountId: 'account',
      categoryId: 'category',
      tagIds: 'tag',
      payeeId: 'payee',
      destinationAccountId: 'account',
    });
    expect(policyOf({ name: 'update_payee' }).entityFields).toMatchObject({
      id: 'payee',
      defaultCategoryId: 'category',
    });
    expect(policyOf({ name: 'update_transaction_group' }).entityFields).toMatchObject({ id: 'transactionGroup' });
    expect(policyOf({ name: 'add_transactions_to_group' }).entityFields).toMatchObject({
      groupId: 'transactionGroup',
      transactionIds: 'transaction',
    });
    expect(policyOf({ name: 'add_account_to_group' }).entityFields).toMatchObject({
      groupId: 'accountGroup',
      accountId: 'account',
    });
    expect(policyOf({ name: 'update_investment_transaction' }).entityFields).toMatchObject({
      transactionId: 'investmentTransaction',
    });
    expect(policyOf({ name: 'merge_payees' }).entityFields).toMatchObject({ sourceId: 'payee', targetId: 'payee' });
  });

  describe('confirmationFor', () => {
    it('asks nothing of a plain card', () => {
      expect(confirmationFor({ danger: 'none', egress: null })).toEqual({ mode: 'none' });
      expect(confirmationFor({ danger: 'none', egress: null, affectedCount: 12 })).toEqual({ mode: 'none' });
    });

    it('asks a second confirmation of a red card that affects one record', () => {
      expect(confirmationFor({ danger: 'destructive', egress: null, affectedCount: 1 })).toEqual({ mode: 'confirm' });
      expect(confirmationFor({ danger: 'destructive', egress: null })).toEqual({ mode: 'confirm' });
    });

    it('asks for the affected count when a red card affects more than one record', () => {
      expect(confirmationFor({ danger: 'destructive', egress: null, affectedCount: 40 })).toEqual({
        mode: 'typed',
        phrase: '40',
      });
    });

    it('asks for the affected count on every high-impact card', () => {
      expect(confirmationFor({ danger: 'highImpact', egress: null, affectedCount: 1 })).toEqual({
        mode: 'typed',
        phrase: '1',
      });
      expect(confirmationFor({ danger: 'highImpact', egress: null, affectedCount: 250 })).toEqual({
        mode: 'typed',
        phrase: '250',
      });
    });

    it('falls back to a plain confirmation when a high-impact card has no count', () => {
      expect(confirmationFor({ danger: 'highImpact', egress: null })).toEqual({ mode: 'confirm' });
    });

    it('asks a confirmation of an egress card, and the stricter rule wins when the card is also red', () => {
      const egress = { url: 'https://rates.example.com/{code}', host: 'rates.example.com' };

      expect(confirmationFor({ danger: 'none', egress })).toEqual({ mode: 'confirm' });
      expect(confirmationFor({ danger: 'destructive', egress, affectedCount: 3 })).toEqual({
        mode: 'typed',
        phrase: '3',
      });
    });
  });

  it('marks the hand-kept high-impact tools red', () => {
    expect([...HIGH_IMPACT_TOOLS].toSorted()).toEqual(
      [
        'change_base_currency',
        'delete_import_batch',
        'merge_duplicate_transactions',
        'remove_duplicate_transactions',
        'unlink_account_from_bank_connection',
      ].toSorted(),
    );
    for (const name of HIGH_IMPACT_TOOLS) expect(policyOf({ name }).danger).toBe('highImpact');
  });
});
