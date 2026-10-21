import type { ChatCardDependency, ChatCardField } from '@bt/shared/types';
import { RouterLinkStub, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CardField from './card-field.vue';
import { buildField, buildLookups, createChatI18n } from './card-test-fixtures';

const mountField = ({
  field,
  currencyCode = null,
  dependsOn = [],
  names = {},
}: {
  field: ChatCardField;
  currencyCode?: string | null;
  dependsOn?: ChatCardDependency[];
  names?: Record<string, string>;
}) =>
  mount(CardField, {
    props: { field, currencyCode, dependsOn, lookups: buildLookups({ names }) },
    global: { plugins: [createChatI18n()], stubs: { RouterLink: RouterLinkStub } },
  });

describe('CardField', () => {
  it('shows the translated label and the value', () => {
    const wrapper = mountField({ field: buildField({ path: 'note', value: 'Lunch', display: { kind: 'text' } }) });

    expect(wrapper.text()).toContain('Note');
    expect(wrapper.text()).toContain('Lunch');
  });

  it('formats money with the currency', () => {
    const wrapper = mountField({
      field: buildField({ path: 'amount', value: 4.5, display: { kind: 'money' } }),
      currencyCode: 'USD',
    });

    expect(wrapper.text()).toContain('$4.50');
  });

  it('formats a date', () => {
    const wrapper = mountField({ field: buildField({ path: 'time', value: '2026-03-05', display: { kind: 'date' } }) });

    expect(wrapper.text()).toContain('Mar 5, 2026');
  });

  it('shows a boolean as yes or no', () => {
    expect(
      mountField({ field: buildField({ path: 'isPlanned', value: true, display: { kind: 'boolean' } }) }).text(),
    ).toContain('Yes');
    expect(
      mountField({ field: buildField({ path: 'isPlanned', value: false, display: { kind: 'boolean' } }) }).text(),
    ).toContain('No');
  });

  it('names an entity from the lookups', () => {
    const wrapper = mountField({
      field: buildField({
        path: 'categoryId',
        value: 'cat-1',
        display: { kind: 'entity' },
        editable: { type: 'entity', entity: 'category' },
      }),
      names: { 'category:cat-1': 'Groceries' },
    });

    expect(wrapper.text()).toContain('Groceries');
  });

  it('names every entity of a list', () => {
    const wrapper = mountField({
      field: buildField({
        path: 'tagIds',
        value: ['t1', 't2'],
        display: { kind: 'entity' },
        editable: { type: 'entity', entity: 'tag' },
      }),
      names: { 'tag:t1': 'Trip', 'tag:t2': 'Work' },
    });

    expect(wrapper.text()).toContain('Trip');
    expect(wrapper.text()).toContain('Work');
  });

  it('shows the first records of a long list and counts the rest', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `tx-${index + 1}`);
    const wrapper = mountField({
      field: buildField({
        path: 'transactionIds',
        value: ids,
        display: { kind: 'entity' },
        editable: { type: 'entity', entity: 'transaction' },
      }),
      names: Object.fromEntries(ids.map((id) => [`transaction:${id}`, `Payment ${id}`])),
    });

    expect(wrapper.text()).toContain('Payment tx-5');
    expect(wrapper.text()).not.toContain('Payment tx-6');
    expect(wrapper.text()).toContain('and 3 more');
  });

  it('reads matching rules as sentences, with the account named', () => {
    const wrapper = mountField({
      field: buildField({
        path: 'matchingRules',
        value: {
          rules: [
            { field: 'note', operator: 'contains_any', value: ['netflix', 'nflx'] },
            { field: 'amount', operator: 'between', value: { min: 9, max: 11.5 }, currencyCode: 'USD' },
            { field: 'transactionType', operator: 'equals', value: 'expense' },
            { field: 'accountId', operator: 'equals', value: 'acc-1' },
          ],
        },
        display: { kind: 'matchingRules' },
      }),
      names: { 'account:acc-1': 'Main card' },
    });

    expect(wrapper.get('[data-testid="field-value"]').text()).toBe(
      'Note contains “netflix”, “nflx”; Amount from 9 to 11.5 USD; Type is Expense; Account is Main card',
    );
  });

  it('shows the matching rules before an edit beside the new ones', () => {
    const wrapper = mountField({
      field: buildField({
        path: 'matchingRules',
        value: { rules: [] },
        before: { rules: [{ field: 'note', operator: 'contains_any', value: ['spotify'] }] },
        display: { kind: 'matchingRules' },
      }),
    });

    expect(wrapper.get('[data-testid="field-value"]').text()).toBe('No rules');
    expect(wrapper.get('[data-testid="field-before"]').text()).toBe('Was Note contains “spotify”');
  });

  it('names every option of a list of presets', () => {
    const wrapper = mountField({
      field: buildField({ path: 'remindBefore', value: ['0_days', '1_week'], display: { kind: 'enum' } }),
    });

    expect(wrapper.get('[data-testid="field-value"]').text()).toBe('On the due date, 1 week before');
  });

  it('falls back to the entity kind when the name is not known', () => {
    const wrapper = mountField({
      field: buildField({
        path: 'trackerId',
        value: 'b1',
        display: { kind: 'entity' },
        editable: { type: 'entity', entity: 'tracker' },
      }),
    });

    expect(wrapper.text()).toContain('Tracker');
  });

  it('shows a ref to a pending card as a link to that card', () => {
    const wrapper = mountField({
      field: buildField({
        path: 'categoryId',
        value: '$proposal:p1',
        display: { kind: 'entity' },
        editable: { type: 'entity', entity: 'category' },
      }),
      dependsOn: [
        {
          id: 'p1',
          revision: 1,
          status: 'pending',
          title: { key: 'chat.cards.title.create', params: { entity: 'category' } },
        },
      ],
    });

    expect(wrapper.text()).toContain('From the card “Create category”');
  });

  it('shows before and after for an update', () => {
    const wrapper = mountField({
      field: buildField({ path: 'note', value: 'Dinner', before: 'Lunch', display: { kind: 'text' } }),
    });

    expect(wrapper.find('[data-testid="field-before"]').text()).toContain('Was Lunch');
    expect(wrapper.find('[data-testid="field-value"]').text()).toBe('Dinner');
  });

  it('does not show a before value when there is none', () => {
    const wrapper = mountField({ field: buildField({ path: 'note', value: 'Dinner', display: { kind: 'text' } }) });

    expect(wrapper.find('[data-testid="field-before"]').exists()).toBe(false);
  });

  it('renders markup in a value as text', () => {
    const wrapper = mountField({
      field: buildField({ path: 'note', value: '<b onclick="x()">hi</b>', display: { kind: 'text' } }),
    });

    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.text()).toContain('<b onclick="x()">hi</b>');
  });

  describe('uncertain field', () => {
    const uncertain = buildField({
      path: 'categoryId',
      value: 'cat-1',
      display: { kind: 'entity' },
      editable: { type: 'entity', entity: 'category' },
      uncertain: { reason: 'guessedFromHistory', alternatives: ['cat-2', 'cat-3'] },
    });
    const names = { 'category:cat-1': 'Groceries', 'category:cat-2': 'Dining', 'category:cat-3': 'Fuel' };

    it('highlights the field with the reason', () => {
      const wrapper = mountField({ field: uncertain, names });

      expect(wrapper.find('[data-testid="uncertain"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('The assistant guessed this from your history');
    });

    it('offers each alternative as a one-tap choice', async () => {
      const wrapper = mountField({ field: uncertain, names });
      const choices = wrapper.findAll('[data-testid="alternative"]');

      expect(choices.map((choice) => choice.text())).toEqual(['Dining', 'Fuel']);

      await choices[0]!.trigger('click');

      expect(wrapper.emitted('choose')).toEqual([['cat-2']]);
    });

    it('does not mark a certain field', () => {
      const wrapper = mountField({ field: buildField({ path: 'note', value: 'x', display: { kind: 'text' } }) });

      expect(wrapper.find('[data-testid="uncertain"]').exists()).toBe(false);
    });

    it('disables the choices when the card cannot be changed', () => {
      const wrapper = mount(CardField, {
        props: {
          field: uncertain,
          currencyCode: null,
          dependsOn: [],
          lookups: buildLookups({ names }),
          disabled: true,
        },
        global: { plugins: [createChatI18n()], stubs: { RouterLink: RouterLinkStub } },
      });

      expect(wrapper.find('[data-testid="alternative"]').attributes('disabled')).toBeDefined();
    });
  });

  describe('values a person reads', () => {
    it('shows a date and time in the locale, not as ISO text', () => {
      const wrapper = mountField({
        field: buildField({ path: 'time', value: '2026-10-19T07:26:00Z', display: { kind: 'datetime' } }),
      });

      expect(wrapper.text()).toContain('Oct 19, 2026');
      expect(wrapper.text()).not.toContain('2026-10-19T');
    });

    it.each([
      ['transactionType', 'expense', 'Expense'],
      ['transactionType', 'income', 'Income'],
      ['transferNature', 'not_transfer', 'Not a transfer'],
      ['transferNature', 'transfer_between_user_accounts', 'Between your accounts'],
      ['paymentType', 'debitCard', 'Debit card'],
      ['paymentType', 'cash', 'Cash'],
    ])('shows %s %s as "%s"', (path, value, label) => {
      const wrapper = mountField({ field: buildField({ path, value, display: { kind: 'enum' } }) });

      expect(wrapper.find('[data-testid="field-value"]').text()).toBe(label);
    });

    it('falls back to the value for an option it has no name for', () => {
      const wrapper = mountField({
        field: buildField({ path: 'someChoice', value: 'odd_value', display: { kind: 'enum' } }),
      });

      expect(wrapper.find('[data-testid="field-value"]').text()).toBe('odd_value');
    });

    it('takes the currency of a money value from the field itself when it carries one', () => {
      const wrapper = mountField({
        field: buildField({ path: 'amount', value: 28.1, display: { kind: 'money', currencyCode: 'GEL' } }),
        currencyCode: 'USD',
      });

      expect(wrapper.text()).toContain('GEL');
      expect(wrapper.text()).not.toContain('$');
    });
  });

  describe('doubt about a field', () => {
    it('says the assistant guessed from the history, without claiming it was checked', () => {
      const wrapper = mountField({
        field: buildField({
          path: 'paymentType',
          value: 'cash',
          display: { kind: 'enum' },
          uncertain: { reason: 'guessedFromHistory' },
        }),
      });

      expect(wrapper.text()).toContain('The assistant guessed this from your history');
    });

    it('says the account is usually paid another way and offers that way', () => {
      const wrapper = mountField({
        field: buildField({
          path: 'paymentType',
          value: 'cash',
          display: { kind: 'enum' },
          uncertain: { reason: 'accountHistoryMismatch', alternatives: ['debitCard'] },
        }),
      });

      expect(wrapper.text()).toContain('Differs from how this account is usually paid');
      expect(wrapper.text()).toContain('Debit card');
    });
  });

  describe('other options of an uncertain field', () => {
    const uncertainCategory = (alternatives: unknown[]) =>
      buildField({
        path: 'categoryId',
        value: 'cat-1',
        display: { kind: 'entity', entity: { kind: 'category', id: 'cat-1', label: '' } },
        editable: { type: 'entity', entity: 'category' },
        uncertain: { reason: 'ambiguousMatch', alternatives },
      });

    it('names the records the alternatives point to, as the main value is named', () => {
      const wrapper = mountField({
        field: uncertainCategory(['cat-2', 'cat-3']),
        names: { 'category:cat-1': 'Groceries', 'category:cat-2': 'Dining', 'category:cat-3': 'Transport' },
      });

      const options = wrapper.findAll('[data-testid="alternative"]').map((item) => item.text());
      expect(options).toEqual(['Dining', 'Transport']);
    });

    it('shows an alternative that is a name and not an id as that name', () => {
      const wrapper = mountField({ field: uncertainCategory(['Coffee shops']), names: {} });

      expect(wrapper.find('[data-testid="alternative"]').text()).toBe('Coffee shops');
    });

    it('shows the kind of a record it cannot name', () => {
      const wrapper = mountField({
        field: uncertainCategory(['3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11']),
        names: {},
      });

      expect(wrapper.find('[data-testid="alternative"]').text()).toBe('Category');
    });
  });
});
