import type { ChatCardAffected, ChatProposalCard } from '@bt/shared/types';
import { RouterLinkStub, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { ApprovalRequirement } from './card-chain';
import { buildCard, buildLookups, createChatI18n } from './card-test-fixtures';
import ProposalCardDanger from './proposal-card-danger.vue';

const affected: ChatCardAffected = {
  count: 42,
  truncated: true,
  columns: [
    { key: 'time', label: 'chat.cards.columns.time', kind: 'date' },
    { key: 'account', label: 'chat.cards.columns.account', kind: 'entity' },
    { key: 'amount', label: 'chat.cards.columns.amount', kind: 'number' },
  ],
  rows: [
    { time: '2026-03-05', account: { kind: 'account', id: 'acc-1' }, amount: 12 },
    { time: '2026-03-06', account: { kind: 'account', id: 'acc-1' }, amount: 30 },
  ],
};

const mountDanger = ({
  card,
  requirement = { mode: 'none' },
  typed = '',
}: {
  card: ChatProposalCard;
  requirement?: ApprovalRequirement;
  typed?: string;
}) =>
  mount(ProposalCardDanger, {
    props: { card, requirement, typed, lookups: buildLookups({ names: { 'account:acc-1': 'Main card' } }) },
    global: { plugins: [createChatI18n()], stubs: { RouterLink: RouterLinkStub } },
  });

describe('ProposalCardDanger', () => {
  it('renders nothing for a plain card', () => {
    expect(mountDanger({ card: buildCard() }).text()).toBe('');
  });

  describe('related counts', () => {
    it('lists what goes with the target, one count per kind', () => {
      const wrapper = mountDanger({
        card: buildCard({
          kind: 'delete',
          danger: 'destructive',
          confirmation: { mode: 'confirm' },
          counts: { transferTwinCount: 1, splitCount: 2, periodCount: 6 },
        }),
        requirement: { mode: 'confirm' },
      });

      const counts = wrapper.get('[data-testid="card-counts"]').text();
      expect(counts).toContain('Includes');
      expect(counts).toContain('1 transfer leg');
      expect(counts).toContain('2 splits');
      expect(counts).toContain('6 periods');
    });

    it('shows the counts on a card that is not red, and skips a count it has no label for', () => {
      const wrapper = mountDanger({
        card: buildCard({ kind: 'update', counts: { transactionCount: 12, somethingNew: 3 } }),
      });

      expect(wrapper.get('[data-testid="card-counts"]').text()).toContain('12 transactions');
      expect(wrapper.text()).not.toContain('somethingNew');
    });

    it('shows nothing when the card has no counts', () => {
      expect(
        mountDanger({ card: buildCard({ kind: 'update' }) })
          .find('[data-testid="card-counts"]')
          .exists(),
      ).toBe(false);
    });
  });

  describe('a red bulk card', () => {
    const card = buildCard({
      kind: 'bulk',
      danger: 'destructive',
      confirmation: { mode: 'typed', phrase: '42' },
      affected,
    });

    it('lists the affected count and the sample rows', () => {
      const wrapper = mountDanger({ card, requirement: { mode: 'typed', expected: '42' } });

      expect(wrapper.text()).toContain('42 records affected');
      expect(wrapper.text()).toContain('and 40 more');
      expect(wrapper.findAll('tbody tr')).toHaveLength(2);
      expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual(['Date', 'Account', 'Amount']);
      expect(wrapper.text()).toContain('Main card');
    });

    it('asks for the typed count and reports what is typed', async () => {
      const wrapper = mountDanger({ card, requirement: { mode: 'typed', expected: '42' } });

      expect(wrapper.text()).toContain('To approve, type 42');

      await wrapper.find('input').setValue('42');

      expect(wrapper.emitted('update:typed')?.at(-1)).toEqual(['42']);
    });

    it('says the change cannot be undone', () => {
      expect(mountDanger({ card, requirement: { mode: 'typed', expected: '42' } }).text()).toContain(
        'This deletes data and cannot be undone.',
      );
    });
  });

  it('shows a single red card without a typed field', () => {
    const wrapper = mountDanger({
      card: buildCard({ kind: 'delete', danger: 'destructive', confirmation: { mode: 'confirm' } }),
      requirement: { mode: 'confirm' },
    });

    expect(wrapper.text()).toContain('This deletes data and cannot be undone.');
    expect(wrapper.find('input').exists()).toBe(false);
  });

  it('shows the full URL and host of an egress card', () => {
    const wrapper = mountDanger({
      card: buildCard({ egress: { url: 'https://rates.example.com/v1/{pair}?key=abc', host: 'rates.example.com' } }),
      requirement: { mode: 'host', expected: 'rates.example.com' },
    });

    expect(wrapper.text()).toContain('This sends requests from the server');
    expect(wrapper.find('[data-testid="egress-url"]').text()).toBe('https://rates.example.com/v1/{pair}?key=abc');
    expect(wrapper.find('[data-testid="egress-host"]').text()).toBe('rates.example.com');
    expect(wrapper.find('input').exists()).toBe(false);
  });
});
