import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import { ROUTES_NAMES } from '@/routes/constants';
import type { ChatTableSpec } from '@bt/shared/types';
import { RouterLinkStub, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import ChatTable from './chat-table.vue';

const mountTable = ({ spec }: { spec: ChatTableSpec }) =>
  mount(ChatTable, {
    props: { spec },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: enChat } })],
      stubs: { RouterLink: RouterLinkStub },
    },
  });

const spec = (overrides: Partial<ChatTableSpec> = {}): ChatTableSpec => ({
  type: 'table',
  title: 'Recent activity',
  columns: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'amount', label: 'Amount', kind: 'money', currencyCode: 'USD' },
    { key: 'when', label: 'When', kind: 'date' },
    { key: 'share', label: 'Share', kind: 'percent' },
    { key: 'count', label: 'Count', kind: 'number' },
  ],
  rows: [{ name: 'Coffee', amount: 4.5, when: '2026-03-05', share: 12.5, count: 1200 }],
  ...overrides,
});

const cellsOf = ({ wrapper, row = 0 }: { wrapper: ReturnType<typeof mountTable>; row?: number }) => {
  const rowWrapper = wrapper.findAll('tbody tr')[row]!;
  return rowWrapper.findAll('td').map((cell) => cell.text());
};

describe('ChatTable', () => {
  it('shows the title and the column labels', () => {
    const wrapper = mountTable({ spec: spec() });

    expect(wrapper.text()).toContain('Recent activity');
    expect(wrapper.findAll('thead th').map((head) => head.text())).toEqual([
      'Name',
      'Amount',
      'When',
      'Share',
      'Count',
    ]);
  });

  it('formats money, dates, percents and numbers by column kind', () => {
    expect(cellsOf({ wrapper: mountTable({ spec: spec() }) })).toEqual([
      'Coffee',
      '$4.50',
      'Mar 5, 2026',
      '12.5%',
      '1,200',
    ]);
  });

  it('shows a dash for a null or missing cell', () => {
    const wrapper = mountTable({ spec: spec({ rows: [{ name: null, amount: null }] }) });

    expect(cellsOf({ wrapper })).toEqual(['—', '—', '—', '—', '—']);
  });

  it('links an entity cell to its page', () => {
    const wrapper = mountTable({
      spec: spec({
        columns: [{ key: 'account', label: 'Account', kind: 'entity' }],
        rows: [{ account: { kind: 'account', id: '42' } }],
      }),
    });
    const link = wrapper.findComponent(RouterLinkStub);

    expect(link.exists()).toBe(true);
    expect(link.props('to')).toEqual({ name: ROUTES_NAMES.account, params: { id: '42' } });
    expect(link.text()).toBe('Account');
  });

  it('shows an entity without a page as plain text', () => {
    const wrapper = mountTable({
      spec: spec({
        columns: [{ key: 'category', label: 'Category', kind: 'entity' }],
        rows: [{ category: { kind: 'category', id: '5' } }],
      }),
    });

    expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(false);
    expect(cellsOf({ wrapper })).toEqual(['Category']);
  });

  it('shows the resolved label of an entity cell, as the link text', () => {
    const wrapper = mountTable({
      spec: spec({
        columns: [{ key: 'account', label: 'Account', kind: 'entity' }],
        rows: [{ account: { kind: 'account', id: '42', label: 'Monobank salary' } }],
      }),
    });
    const link = wrapper.findComponent(RouterLinkStub);

    expect(link.props('to')).toEqual({ name: ROUTES_NAMES.account, params: { id: '42' } });
    expect(link.text()).toBe('Monobank salary');
  });

  it('shows the resolved label of an entity without a page as plain text', () => {
    const wrapper = mountTable({
      spec: spec({
        columns: [{ key: 'category', label: 'Category', kind: 'entity' }],
        rows: [{ category: { kind: 'category', id: '5', label: 'Groceries' } }],
      }),
    });

    expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(false);
    expect(cellsOf({ wrapper })).toEqual(['Groceries']);
  });

  it('renders a label as text, never as markup', () => {
    const label = '<img src=x onerror=alert(1)> <b>bold</b>';
    const wrapper = mountTable({
      spec: spec({
        columns: [{ key: 'payee', label: 'Payee', kind: 'entity' }],
        rows: [{ payee: { kind: 'payee', id: '9', label } }],
      }),
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('b').exists()).toBe(false);
    expect(cellsOf({ wrapper })).toEqual([label]);
  });

  it('shows text cells as text, not markup', () => {
    const wrapper = mountTable({
      spec: spec({
        columns: [{ key: 'name', label: 'Name', kind: 'text' }],
        rows: [{ name: '<a href="http://evil.example">x</a> [y](http://evil.example)' }],
      }),
    });

    expect(wrapper.find('tbody a').exists()).toBe(false);
    expect(cellsOf({ wrapper })).toEqual(['<a href="http://evil.example">x</a> [y](http://evil.example)']);
  });

  it('shows an empty state for no rows', () => {
    const wrapper = mountTable({ spec: spec({ rows: [] }) });

    expect(wrapper.find('[data-testid="table-empty"]').text()).toBe('No rows to show.');
    expect(wrapper.find('table').exists()).toBe(false);
  });
});
