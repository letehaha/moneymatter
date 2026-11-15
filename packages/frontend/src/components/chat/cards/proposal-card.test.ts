import {
  approveChatProposal,
  commentOnChatProposal,
  editChatProposal,
  refreshChatProposal,
  rejectChatProposal,
} from '@/api/chat';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import { ApiErrorResponseError } from '@/js/errors';
import {
  API_ERROR_CODES,
  type ChatCardField,
  type ChatProposalCard,
  type ChatThreadWithMessages,
} from '@bt/shared/types';
import { QueryClient, VueQueryPlugin, useQuery } from '@tanstack/vue-query';
import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import CardFieldEditor from './card-field-editor.vue';
import { LOGO_STUBS, buildCard, buildField, buildLookups, createChatI18n } from './card-test-fixtures';
import ProposalCard from './proposal-card.vue';

vi.mock('@/api/chat', () => ({
  approveChatProposal: vi.fn(),
  approveAllChatMessage: vi.fn(),
  rejectChatProposal: vi.fn(),
  editChatProposal: vi.fn(),
  refreshChatProposal: vi.fn(),
  commentOnChatProposal: vi.fn(),
}));
vi.mock('@/composable/chat/use-apply-invalidation', () => ({
  useApplyInvalidation: () => ({ invalidateForCards: vi.fn() }),
}));
const addSuccessNotification = vi.fn();
vi.mock('@/components/notification-center', () => ({
  NotificationType: { error: 'error' },
  useNotificationCenter: () => ({ addSuccessNotification, addErrorNotification: vi.fn(), addNotification: vi.fn() }),
}));
vi.mock('./use-card-lookups', () => ({
  useCardLookups: () =>
    buildLookups({
      names: {
        'account:acc-1': 'Main card',
        'category:cat-1': 'Groceries',
        'category:cat-2': 'Dining',
      },
      currencies: { 'acc-1': 'USD', 'acc-gbp': 'GBP', 'acc-jpy': 'JPY' },
    }),
}));
// A dialog that renders only while open, with its slots and a confirm button.
vi.mock('@/components/common/responsive-alert-dialog.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue');
  return {
    default: define({
      props: { open: Boolean, confirmVariant: String, confirmLabel: String },
      emits: ['update:open', 'confirm'],
      setup:
        (props, { slots, emit }) =>
        () =>
          props.open
            ? render('div', { 'data-testid': 'alert-dialog', 'data-variant': props.confirmVariant }, [
                render('div', { 'data-testid': 'alert-title' }, slots.title?.()),
                render('div', { 'data-testid': 'alert-description' }, slots.description?.()),
                render(
                  'button',
                  { 'data-testid': 'alert-confirm', onClick: () => emit('confirm') },
                  props.confirmLabel,
                ),
              ])
            : null,
    }),
  };
});

const HEAVY_STUBS = {
  RouterLink: RouterLinkStub,
  ...LOGO_STUBS,
  AccountSelectField: true,
  CategorySelectField: true,
  PayeeSelectField: true,
  TagSelectField: true,
  SelectField: true,
  DateField: true,
};

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const mountCard = ({
  card,
  cards = {},
  queryClient = newClient(),
}: {
  card: ChatProposalCard;
  cards?: Record<string, ChatProposalCard>;
  queryClient?: QueryClient;
}) =>
  mount(ProposalCard, {
    props: { card, cards },
    global: { plugins: [[VueQueryPlugin, { queryClient }], createChatI18n()], stubs: HEAVY_STUBS },
  });

const fields = {
  amount: buildField({ path: 'amount', value: 12.5, display: { kind: 'money' }, editable: { type: 'money' } }),
  account: buildField({
    path: 'accountId',
    value: 'acc-1',
    display: { kind: 'entity' },
    editable: { type: 'entity', entity: 'account' },
  }),
  category: buildField({
    path: 'categoryId',
    value: 'cat-1',
    display: { kind: 'entity' },
    editable: { type: 'entity', entity: 'category' },
  }),
  note: buildField({ path: 'note', value: 'Lunch', display: { kind: 'text' }, editable: { type: 'text' } }),
} satisfies Record<string, ChatCardField>;

const createCard = (overrides: Partial<ChatProposalCard> = {}) =>
  buildCard({ fields: [fields.amount, fields.account, fields.category, fields.note], ...overrides });

const approveButton = (wrapper: ReturnType<typeof mountCard>) => wrapper.find('[data-testid="approve"]');
const foldToggle = (wrapper: ReturnType<typeof mountCard>) => wrapper.find('[data-testid="card-fold-toggle"]');

/** Opens a card that starts folded. */
const expand = async (wrapper: ReturnType<typeof mountCard>) => {
  await foldToggle(wrapper).trigger('click');
  return wrapper;
};

/** The first argument of each call: the mutation also passes its own context as a second one. */
const firstArgsOf = (fn: unknown) => vi.mocked(fn as (...args: unknown[]) => unknown).mock.calls.map((call) => call[0]);

const actionResponse = ({ card }: { card: ChatProposalCard }) => ({ card, cards: [card] });

describe('ProposalCard', () => {
  beforeEach(() => {
    vi.mocked(approveChatProposal).mockReset();
    vi.mocked(rejectChatProposal).mockReset();
    vi.mocked(editChatProposal).mockReset();
    vi.mocked(refreshChatProposal).mockReset();
    vi.mocked(commentOnChatProposal).mockReset();
    addSuccessNotification.mockReset();
  });

  describe('a create card', () => {
    it('lists the fields with labels, entity names and money formatting', () => {
      const wrapper = mountCard({ card: createCard() });
      const text = wrapper.text();

      expect(text).toContain('Create transaction');
      expect(text).toContain('Waiting for you');
      expect(text).toContain('Amount');
      expect(text).toContain('$12.50');
      expect(text).toContain('Account');
      expect(text).toContain('Main card');
      expect(text).toContain('Category');
      expect(text).toContain('Groceries');
      expect(text).toContain('Lunch');
    });
  });

  describe('an update card', () => {
    it('shows before and after', () => {
      const card = createCard({
        kind: 'update',
        title: { key: 'chat.cards.title.update', params: { entity: 'transaction' } },
        fields: [{ ...fields.note, value: 'Dinner', before: 'Lunch' }],
      });
      const wrapper = mountCard({ card });

      expect(wrapper.text()).toContain('Update transaction');
      expect(wrapper.find('[data-testid="field-before"]').text()).toContain('was Lunch');
      expect(wrapper.find('[data-testid="field-value"]').text()).toBe('Dinner');
    });
  });

  describe('uncertain fields', () => {
    it('highlights the field with its reason and sends an alternative as an edit', async () => {
      vi.mocked(editChatProposal).mockResolvedValue(createCard({ revision: 2 }));
      const card = createCard({
        fields: [
          fields.amount,
          fields.account,
          { ...fields.category, uncertain: { reason: 'ambiguousMatch', alternatives: ['cat-2'] } },
          fields.note,
        ],
      });
      const wrapper = mountCard({ card });

      expect(wrapper.find('[data-testid="uncertain"]').text()).toContain('More than one match');

      await wrapper.find('[data-testid="alternative"]').trigger('click');
      await flushPromises();

      expect(firstArgsOf(editChatProposal)).toContainEqual({
        proposalId: 'card-1',
        payload: { revision: 1, args: { amount: 12.5, accountId: 'acc-1', categoryId: 'cat-2', note: 'Lunch' } },
      });
    });
  });

  describe('dependencies', () => {
    it('names the parents that will also apply', () => {
      const card = createCard({
        dependsOn: [
          {
            id: 'parent-1',
            revision: 1,
            status: 'pending',
            title: { key: 'chat.cards.title.create', params: { entity: 'category' } },
          },
        ],
      });
      const wrapper = mountCard({ card });

      expect(wrapper.text()).toContain('Approving this also applies');
      expect(wrapper.text()).toContain('Create category');
    });
  });

  describe('approving', () => {
    it('sends the revision of the card and of its pending parents', async () => {
      const applied = createCard({ status: 'applied', revision: 3 });
      vi.mocked(approveChatProposal).mockResolvedValue(actionResponse({ card: applied }));
      const parent = buildCard({ id: 'parent-1', revision: 5 });
      const card = createCard({
        revision: 2,
        dependsOn: [{ id: 'parent-1', revision: 5, status: 'pending', title: parent.title }],
      });
      const wrapper = mountCard({ card, cards: { 'parent-1': parent } });

      await approveButton(wrapper).trigger('click');
      await flushPromises();

      expect(firstArgsOf(approveChatProposal)).toContainEqual({
        proposalId: 'card-1',
        payload: { revision: 2, parentRevisions: { 'parent-1': 5 } },
      });
      expect(vi.mocked(approveChatProposal).mock.calls[0]![0].payload).not.toHaveProperty('confirmation');
    });

    it('tells the user the change was applied', async () => {
      vi.mocked(approveChatProposal).mockResolvedValue(actionResponse({ card: createCard({ status: 'applied' }) }));
      const wrapper = mountCard({ card: createCard() });

      await approveButton(wrapper).trigger('click');
      await flushPromises();

      expect(addSuccessNotification).toHaveBeenCalledWith('Change applied');
    });

    it('replaces the card with the one a 409 returns and asks again', async () => {
      const queryClient = newClient();
      const original = createCard({ revision: 1 });
      const current = createCard({ revision: 2, fields: [{ ...fields.note, value: 'Edited elsewhere' }] });
      const page = {
        thread: { id: 'thread-1' },
        messages: [],
        hasMore: false,
        cards: { 'card-1': original },
      } as unknown as ChatThreadWithMessages;
      queryClient.setQueryData([...VUE_QUERY_CACHE_KEYS.chatThread, 'thread-1', 'latest'], page);

      vi.mocked(approveChatProposal)
        .mockRejectedValueOnce(
          new ApiErrorResponseError('Conflict', {
            code: API_ERROR_CODES.conflict,
            message: 'Conflict',
            details: { reason: 'revision', card: current, cards: [current] },
          }),
        )
        .mockResolvedValueOnce(actionResponse({ card: createCard({ status: 'applied', revision: 3 }) }));

      const Harness = defineComponent({
        setup() {
          const { data } = useQuery<ChatThreadWithMessages>({
            queryKey: [...VUE_QUERY_CACHE_KEYS.chatThread, 'thread-1', 'latest'],
            queryFn: () => page,
            staleTime: Infinity,
          });
          return () =>
            data.value ? h(ProposalCard, { card: data.value.cards['card-1']!, cards: data.value.cards }) : null;
        },
      });
      const wrapper = mount(Harness, {
        global: { plugins: [[VueQueryPlugin, { queryClient }], createChatI18n()], stubs: HEAVY_STUBS },
      });
      await flushPromises();

      await wrapper.find('[data-testid="approve"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Edited elsewhere');
      expect(wrapper.find('[data-testid="conflict"]').text()).toContain(
        'This card changed while you were looking at it.',
      );
      expect(wrapper.find('[data-testid="conflict"]').text()).toContain('Review it and approve again.');

      await wrapper.find('[data-testid="approve"]').trigger('click');
      await flushPromises();

      expect(vi.mocked(approveChatProposal).mock.calls[1]![0].payload.revision).toBe(2);
    });

    it('disables approve and says why when the card cannot be applied', () => {
      const wrapper = mountCard({
        card: createCard({ canApply: { ok: false, reasonKey: 'chat.cards.previewFailed' } }),
      });

      expect(approveButton(wrapper).attributes('disabled')).toBeDefined();
      expect(wrapper.find('[data-testid="cannot-apply"]').text()).toBe(
        'The preview could not be prepared, so this change cannot be approved.',
      );
    });

    it('disables approve while the request runs', async () => {
      vi.mocked(approveChatProposal).mockReturnValue(new Promise(() => {}));
      const wrapper = mountCard({ card: createCard() });

      await approveButton(wrapper).trigger('click');
      await flushPromises();

      expect(approveButton(wrapper).attributes('disabled')).toBeDefined();
    });
  });

  describe('a red bulk card', () => {
    const bulk = () =>
      createCard({
        kind: 'bulk',
        danger: 'destructive',
        confirmation: { mode: 'typed', phrase: '42' },
        affected: {
          count: 42,
          truncated: true,
          columns: [{ key: 'note', label: 'chat.cards.columns.note', kind: 'text' }],
          rows: [{ note: 'Coffee' }],
        },
      });

    it('lists the affected count and sample rows', () => {
      const wrapper = mountCard({ card: bulk() });

      expect(wrapper.text()).toContain('42 records affected');
      expect(wrapper.text()).toContain('Coffee');
    });

    it('keeps approve disabled until the typed count matches, then sends it', async () => {
      vi.mocked(approveChatProposal).mockResolvedValue(actionResponse({ card: createCard({ status: 'applied' }) }));
      const wrapper = mountCard({ card: bulk() });

      expect(approveButton(wrapper).attributes('disabled')).toBeDefined();

      await wrapper.find('[data-testid="typed-confirmation"] input').setValue('41');
      expect(approveButton(wrapper).attributes('disabled')).toBeDefined();

      await wrapper.find('[data-testid="typed-confirmation"] input').setValue('42');
      expect(approveButton(wrapper).attributes('disabled')).toBeUndefined();

      await approveButton(wrapper).trigger('click');
      await flushPromises();

      expect(firstArgsOf(approveChatProposal)).toContainEqual({
        proposalId: 'card-1',
        payload: { revision: 1, confirmation: '42' },
      });
    });
  });

  describe('a red single-record card', () => {
    const single = () =>
      createCard({
        kind: 'delete',
        title: { key: 'chat.cards.title.delete', params: { entity: 'transaction' } },
        danger: 'destructive',
        confirmation: { mode: 'confirm' },
      });

    it('asks for a second confirmation in a destructive dialog before approving', async () => {
      vi.mocked(approveChatProposal).mockResolvedValue(actionResponse({ card: createCard({ status: 'applied' }) }));
      const wrapper = mountCard({ card: single() });

      await approveButton(wrapper).trigger('click');

      expect(approveChatProposal).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="alert-dialog"]').attributes('data-variant')).toBe('destructive');

      await wrapper.find('[data-testid="alert-confirm"]').trigger('click');
      await flushPromises();

      expect(firstArgsOf(approveChatProposal)).toContainEqual({
        proposalId: 'card-1',
        payload: { revision: 1, confirmation: 'confirm' },
      });
    });
  });

  describe('an amber egress card', () => {
    const egress = () =>
      createCard({
        toolName: 'fetch_from_host',
        kind: 'action',
        egress: { url: 'https://rates.example.com/v1/{pair}', host: 'rates.example.com' },
        warnings: [{ key: 'chat.warnings.egress', params: { host: 'rates.example.com' } }],
      });

    it('shows the full URL and host', () => {
      const wrapper = mountCard({ card: egress() });

      expect(wrapper.find('[data-testid="egress-url"]').text()).toBe('https://rates.example.com/v1/{pair}');
      expect(wrapper.find('[data-testid="egress-host"]').text()).toBe('rates.example.com');
    });

    it('repeats the host in the confirm dialog and sends it', async () => {
      vi.mocked(approveChatProposal).mockResolvedValue(actionResponse({ card: createCard({ status: 'applied' }) }));
      const wrapper = mountCard({ card: egress() });

      await approveButton(wrapper).trigger('click');

      expect(wrapper.find('[data-testid="alert-title"]').text()).toContain('rates.example.com');
      expect(wrapper.find('[data-testid="alert-description"]').text()).toContain('rates.example.com');

      await wrapper.find('[data-testid="alert-confirm"]').trigger('click');
      await flushPromises();

      expect(firstArgsOf(approveChatProposal)).toContainEqual({
        proposalId: 'card-1',
        payload: { revision: 1, confirmation: 'rates.example.com' },
      });
    });
  });

  describe('warnings', () => {
    it('shows each warning with its parameters', () => {
      const wrapper = mountCard({
        card: createCard({ warnings: [{ key: 'chat.warnings.transferTwins', params: { count: 2 } }] }),
      });

      expect(wrapper.text()).toContain('2 linked transfer transactions will go with them.');
    });

    it('words the transfer twin warning of a single row for one twin and for several', () => {
      const textOf = (count: number) =>
        mountCard({
          card: createCard({ warnings: [{ key: 'chat.warnings.transferTwinsOfRow', params: { count } }] }),
        }).text();

      expect(textOf(1)).toContain('1 linked transfer transaction will be deleted with it.');
      expect(textOf(2)).toContain('2 linked transfer transactions will be deleted with it.');
    });
  });

  describe('a stale card', () => {
    const mountOnThread = ({ queryClient, card }: { queryClient: QueryClient; card: ChatProposalCard }) => {
      const page = {
        thread: { id: 'thread-1' },
        messages: [],
        hasMore: false,
        cards: { 'card-1': card },
      } as unknown as ChatThreadWithMessages;
      queryClient.setQueryData([...VUE_QUERY_CACHE_KEYS.chatThread, 'thread-1', 'latest'], page);

      const Harness = defineComponent({
        setup() {
          const { data } = useQuery<ChatThreadWithMessages>({
            queryKey: [...VUE_QUERY_CACHE_KEYS.chatThread, 'thread-1', 'latest'],
            queryFn: () => page,
            staleTime: Infinity,
          });
          return () =>
            data.value ? h(ProposalCard, { card: data.value.cards['card-1']!, cards: data.value.cards }) : null;
        },
      });
      return mount(Harness, {
        global: { plugins: [[VueQueryPlugin, { queryClient }], createChatI18n()], stubs: HEAVY_STUBS },
      });
    };

    const conflictOf = ({ reason, card }: { reason: string; card: ChatProposalCard }) =>
      new ApiErrorResponseError('Conflict', {
        code: API_ERROR_CODES.conflict,
        message: 'Conflict',
        details: { reason, card, cards: [card] },
      });

    const staleCard = () =>
      createCard({
        status: 'stale',
        revision: 2,
        stale: { reasonKey: 'chat.stale.targets', before: 10, after: 12 },
        canApply: { ok: false, reasonKey: 'chat.cards.notPending' },
      });

    it('says it once when the approval found the card stale, and not again after a refresh', async () => {
      const refreshed = createCard({ revision: 3 });
      vi.mocked(approveChatProposal).mockRejectedValueOnce(conflictOf({ reason: 'stale', card: staleCard() }));
      vi.mocked(refreshChatProposal).mockResolvedValue(refreshed);
      const wrapper = mountOnThread({ queryClient: newClient(), card: createCard({ revision: 1 }) });
      await flushPromises();

      await wrapper.find('[data-testid="approve"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="stale"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="conflict"]').exists()).toBe(false);

      await wrapper.find('[data-testid="refresh"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="stale"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="conflict"]').exists()).toBe(false);
    });

    it('keeps the callout of another conflict', async () => {
      vi.mocked(approveChatProposal).mockRejectedValueOnce(
        conflictOf({ reason: 'revision', card: createCard({ revision: 2 }) }),
      );
      const wrapper = mountOnThread({ queryClient: newClient(), card: createCard({ revision: 1 }) });
      await flushPromises();

      await wrapper.find('[data-testid="approve"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="conflict"]').exists()).toBe(true);
    });

    it('shows what moved and refreshes on request', async () => {
      vi.mocked(refreshChatProposal).mockResolvedValue(createCard({ revision: 2 }));
      const card = createCard({
        status: 'stale',
        stale: { reasonKey: 'chat.stale.targets', before: 10, after: 12 },
        canApply: { ok: false, reasonKey: 'chat.cards.notPending' },
      });
      const wrapper = mountCard({ card });

      expect(wrapper.find('[data-testid="stale"]').text()).toContain('The records it affects changed from 10 to 12.');
      expect(approveButton(wrapper).exists()).toBe(false);

      await wrapper.find('[data-testid="refresh"]').trigger('click');
      await flushPromises();

      expect(firstArgsOf(refreshChatProposal)).toContainEqual({ proposalId: 'card-1' });
    });
  });

  describe('finished states', () => {
    it('shows an applied card with its result and no actions', async () => {
      const card = createCard({
        status: 'applied',
        result: {
          refs: [{ kind: 'account', id: 'acc-1' }],
          executedArgs: {},
          appliedAt: '2026-03-05T10:05:00.000Z',
          alsoApplied: ['parent-1'],
        },
        dependsOn: [
          {
            id: 'parent-1',
            revision: 1,
            status: 'applied',
            title: { key: 'chat.cards.title.create', params: { entity: 'category' } },
          },
        ],
      });
      const wrapper = await expand(mountCard({ card }));

      expect(wrapper.text()).toContain('Applied');
      expect(wrapper.text()).toContain('Also applied: Create category');
      expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(true);
      expect(approveButton(wrapper).exists()).toBe(false);
      expect(wrapper.find('[data-testid="reject"]').exists()).toBe(false);
    });

    it('shows a failed card with the error and a way to try again', async () => {
      vi.mocked(refreshChatProposal).mockResolvedValue(createCard());
      // Refresh, edit and reject are still the owner's to take, so the card starts open.
      const wrapper = mountCard({ card: createCard({ status: 'failed', error: { message: 'Account is archived' } }) });

      expect(foldToggle(wrapper).attributes('aria-expanded')).toBe('true');
      expect(wrapper.text()).toContain('Failed');
      expect(wrapper.text()).toContain('This change could not be applied. Nothing was changed.');
      expect(wrapper.find('[data-testid="card-error"]').text()).toBe('Account is archived');

      await wrapper.find('[data-testid="refresh"]').trigger('click');

      expect(firstArgsOf(refreshChatProposal)).toContainEqual({ proposalId: 'card-1' });
    });

    it('translates the error key of a card whose preview failed', () => {
      const wrapper = mountCard({
        card: createCard({ status: 'failed', error: { messageKey: 'chat.cards.targetNotFound' } }),
      });

      expect(wrapper.find('[data-testid="card-error"]').text()).toBe('The record this change targets was not found.');
    });

    it.each([
      ['rejected', 'You rejected this change. Nothing was changed.'],
      ['blocked', 'Not applied: a change it depends on was rejected.'],
      ['expired', 'This change expired before it was approved.'],
      ['superseded', 'Replaced by a newer proposal.'],
      ['unknown', 'The result of this change is unknown.'],
    ] as const)('explains a %s card', async (status, text) => {
      const wrapper = mountCard({ card: createCard({ status }) });
      if (foldToggle(wrapper).attributes('aria-expanded') === 'false') await expand(wrapper);

      expect(wrapper.text()).toContain(text);
      expect(approveButton(wrapper).exists()).toBe(false);
    });
  });

  describe('folding', () => {
    const transactionTarget: ChatCardField[] = [
      buildField({ path: 'amount', value: 28.1, display: { kind: 'money', currencyCode: 'GEL' } }),
      buildField({ path: 'time', value: '2026-10-19T07:26:00Z', display: { kind: 'datetime' } }),
      buildField({ path: 'note', value: 'Nord Coffee', display: { kind: 'text' } }),
      buildField({
        path: 'accountId',
        value: 'acc-1',
        display: { kind: 'entity', entity: { kind: 'account', id: 'acc-1', label: '' } },
      }),
    ];
    const updateCard = (overrides: Partial<ChatProposalCard> = {}) =>
      buildCard({
        kind: 'update',
        toolName: 'update_transaction',
        title: { key: 'chat.cards.title.update', params: { entity: 'transaction' } },
        fields: [fields.category],
        target: transactionTarget,
        ...overrides,
      });

    it.each(['pending', 'stale', 'failed', 'applying', 'unknown'] as const)('keeps a %s card open', (status) => {
      const wrapper = mountCard({ card: updateCard({ status }) });

      expect(foldToggle(wrapper).attributes('aria-expanded')).toBe('true');
      expect(wrapper.find('[data-testid="card-body"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="card-summary"]').exists()).toBe(false);
    });

    it.each(['applied', 'rejected', 'blocked', 'superseded', 'expired'] as const)(
      'folds a %s card to its header and a one-line summary of the record',
      (status) => {
        const wrapper = mountCard({ card: updateCard({ status }) });

        expect(foldToggle(wrapper).attributes('aria-expanded')).toBe('false');
        expect(wrapper.find('[data-testid="card-body"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Update transaction');
        expect(wrapper.find('[data-testid="card-status"]').exists()).toBe(true);
        // Date · amount · payee (or note) · account.
        const summary = wrapper.find('[data-testid="card-summary"]').text();
        expect(summary).toMatch(/^Oct 19, 2026, [^·]+ · [^·]*28\.10[^·]* · Nord Coffee · Main card$/);
      },
    );

    it('opens and folds again from the header, a button that says whether it is open', async () => {
      const wrapper = mountCard({ card: updateCard({ status: 'applied' }) });
      const toggle = foldToggle(wrapper);

      expect(toggle.element.tagName).toBe('BUTTON');
      expect(toggle.attributes('type')).toBe('button');

      await toggle.trigger('click');

      expect(toggle.attributes('aria-expanded')).toBe('true');
      const body = wrapper.find('[data-testid="card-body"]');
      expect(body.exists()).toBe(true);
      expect(toggle.attributes('aria-controls')).toBe(body.attributes('id'));
      expect(wrapper.find('[data-testid="card-summary"]').exists()).toBe(false);
      expect(body.text()).toContain('Nord Coffee');

      await toggle.trigger('click');

      expect(toggle.attributes('aria-expanded')).toBe('false');
      expect(wrapper.find('[data-testid="card-body"]').exists()).toBe(false);
    });

    it('keeps a card open when it is approved while in view', async () => {
      const wrapper = mountCard({ card: updateCard() });

      await wrapper.setProps({ card: updateCard({ status: 'applied', revision: 2 }) });

      expect(foldToggle(wrapper).attributes('aria-expanded')).toBe('true');
    });

    it('sums up a create card from its own fields', () => {
      const wrapper = mountCard({ card: createCard({ status: 'applied' }) });

      expect(wrapper.find('[data-testid="card-summary"]').text()).toMatch(/12\.50.* · Lunch · Main card$/);
    });
  });

  describe('the status badge', () => {
    const badge = (wrapper: ReturnType<typeof mountCard>) => wrapper.find('[data-testid="card-status"]');

    it.each([
      ['pending', 'Waiting for you', 'info'],
      ['applied', 'Applied', 'success'],
      ['rejected', 'Rejected', 'destructive'],
      ['failed', 'Failed', 'destructive'],
      ['stale', 'Out of date', 'warning'],
      ['expired', 'Expired', 'neutral'],
    ] as const)('shows a %s card as "%s" in the %s colour', (status, text, variant) => {
      const wrapper = mountCard({ card: createCard({ status }) });

      expect(badge(wrapper).text()).toBe(text);
      expect(badge(wrapper).attributes('data-variant')).toBe(variant);
    });
  });

  describe('rejecting', () => {
    it('rejects the card', async () => {
      vi.mocked(rejectChatProposal).mockResolvedValue(actionResponse({ card: createCard({ status: 'rejected' }) }));
      const wrapper = mountCard({ card: createCard() });

      await wrapper.find('[data-testid="reject"]').trigger('click');
      await flushPromises();

      expect(firstArgsOf(rejectChatProposal)).toContainEqual({ proposalId: 'card-1' });
    });
  });

  describe('editing', () => {
    it('labels an expected amount with the expected currency, and follows that currency as it is edited', async () => {
      const card = createCard({
        fields: [
          buildField({ path: 'expectedAmount', value: 2.59, display: { kind: 'money' }, editable: { type: 'money' } }),
          buildField({
            path: 'expectedCurrencyCode',
            value: 'GEL',
            display: { kind: 'text' },
            editable: { type: 'entity', entity: 'userCurrency' },
          }),
        ],
      });
      const wrapper = mountCard({ card });

      await wrapper.find('[data-testid="edit"]').trigger('click');

      const editorOf = ({ path }: { path: string }) =>
        wrapper.findAllComponents(CardFieldEditor).find((editor) => editor.props('field').path === path)!;

      expect(editorOf({ path: 'expectedAmount' }).props('currencyCode')).toBe('GEL');

      editorOf({ path: 'expectedCurrencyCode' }).vm.$emit('update:modelValue', 'EUR');
      await flushPromises();

      expect(editorOf({ path: 'expectedAmount' }).props('currencyCode')).toBe('EUR');
    });

    it('builds editors from the editable fields and sends only the changed ones', async () => {
      vi.mocked(editChatProposal).mockResolvedValue(createCard({ revision: 2 }));
      const wrapper = mountCard({ card: createCard() });

      await wrapper.find('[data-testid="edit"]').trigger('click');

      expect(wrapper.findAllComponents(CardFieldEditor)).toHaveLength(4);
      expect(wrapper.find('[data-testid="save-edit"]').attributes('disabled')).toBeDefined();

      const note = wrapper.find('[data-testid="field-editor-note"]');
      await note.find('input').setValue('Dinner');

      expect(wrapper.find('[data-testid="save-edit"]').attributes('disabled')).toBeUndefined();

      await wrapper.find('[data-testid="save-edit"]').trigger('click');
      await flushPromises();

      expect(firstArgsOf(editChatProposal)).toContainEqual({
        proposalId: 'card-1',
        payload: { revision: 1, args: { amount: 12.5, accountId: 'acc-1', categoryId: 'cat-1', note: 'Dinner' } },
      });
    });

    it('leaves edit mode without sending anything on cancel', async () => {
      const wrapper = mountCard({ card: createCard() });

      await wrapper.find('[data-testid="edit"]').trigger('click');
      await wrapper.find('[data-testid="cancel-edit"]').trigger('click');

      expect(wrapper.find('[data-testid="save-edit"]').exists()).toBe(false);
      expect(editChatProposal).not.toHaveBeenCalled();
    });

    it('offers no edit on a card without editable fields', () => {
      const wrapper = mountCard({ card: createCard({ fields: [{ ...fields.note, editable: null }] }) });

      expect(wrapper.find('[data-testid="edit"]').exists()).toBe(false);
    });
  });

  describe('commenting', () => {
    it('sends the comment and reports the run it starts', async () => {
      vi.mocked(commentOnChatProposal).mockResolvedValue({ runId: 'run-1', messageId: 'm-2', userMessageId: 'm-1' });
      const wrapper = mountCard({ card: createCard() });

      await wrapper.find('[data-testid="comment-toggle"]').trigger('click');
      await wrapper.find('[data-testid="comment-input"] textarea').setValue('Use the travel category');
      await wrapper.find('[data-testid="comment-send"]').trigger('click');
      await flushPromises();

      expect(firstArgsOf(commentOnChatProposal)).toContainEqual({
        proposalId: 'card-1',
        text: 'Use the travel category',
      });
      expect(wrapper.emitted('commented')).toEqual([[{ runId: 'run-1', messageId: 'm-2', userMessageId: 'm-1' }]]);
    });

    it('does not send an empty comment', async () => {
      const wrapper = mountCard({ card: createCard() });

      await wrapper.find('[data-testid="comment-toggle"]').trigger('click');

      expect(wrapper.find('[data-testid="comment-send"]').attributes('disabled')).toBeDefined();
    });
  });

  describe('details', () => {
    it('lists the sources', async () => {
      const wrapper = mountCard({
        card: createCard({
          sources: [{ type: 'attachment', attachmentId: 'a1', fileName: 'receipt.png' }],
        }),
      });

      expect(wrapper.text()).not.toContain('receipt.png');

      await wrapper.find('[data-testid="details-toggle"]').trigger('click');

      expect(wrapper.text()).toContain('Attachment receipt.png');
    });
  });

  describe('the record a delete or update targets', () => {
    const target: ChatCardField[] = [
      buildField({ path: 'amount', value: 28.1, display: { kind: 'money', currencyCode: 'CHF' } }),
      buildField({ path: 'time', value: '2026-10-19T07:26:00Z', display: { kind: 'datetime' } }),
      buildField({ path: 'note', value: 'Nord Coffee', display: { kind: 'text' } }),
      buildField({
        path: 'accountId',
        value: 'acc-1',
        display: { kind: 'entity', entity: { kind: 'account', id: 'acc-1', label: '' } },
      }),
    ];

    it('lists what identifies the record: amount with its currency, date, note and account', () => {
      const wrapper = mountCard({
        card: buildCard({
          kind: 'delete',
          toolName: 'delete_transaction',
          fields: [
            { ...buildField({ path: 'id', value: 'tx-1', display: { kind: 'text' } }), namesRecord: true as const },
          ],
          target,
        }),
      });

      const block = wrapper;
      expect(wrapper.find('[data-testid="card-target"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('The record this changes');
      expect(block.text()).toContain('28.10');
      expect(block.text()).toContain('CHF');
      expect(block.text()).toContain('Oct 19, 2026');
      expect(block.text()).toContain('Nord Coffee');
      expect(block.text()).toContain('Main card');
    });

    it('shows no separate block and no row naming the record, on a card that targets nothing either', () => {
      const wrapper = mountCard({ card: buildCard() });

      expect(wrapper.find('[data-testid="card-target"]').exists()).toBe(false);
    });

    it('lists an update as one list: the changed field with what it replaces, the others as they are, each once', () => {
      const wrapper = mountCard({
        card: buildCard({
          kind: 'update',
          toolName: 'update_transaction',
          fields: [
            {
              ...buildField({
                path: 'transactionId',
                value: 'tx-1',
                display: { kind: 'entity', entity: { kind: 'transaction', id: 'tx-1', label: '' } },
              }),
              namesRecord: true as const,
            },
            buildField({ path: 'amount', value: 30, before: 28.1, display: { kind: 'money', currencyCode: 'CHF' } }),
          ],
          target,
        }),
      });

      const rows = wrapper.findAll('[data-tone]');
      expect(rows.map((row) => row.attributes('data-tone'))).toEqual(['changed', 'normal', 'normal', 'normal']);
      expect(rows[0]!.text()).toContain('30.00');
      expect(rows[0]!.find('[data-testid="field-before"]').text()).toContain('was');
      expect(rows[0]!.find('[data-testid="field-before"]').text()).toContain('28.10');
      expect(rows[0]!.find('s').exists()).toBe(false);
      expect(wrapper.findAll('[data-testid="field-value"]')).toHaveLength(4);
      expect(wrapper.text()).not.toContain('Transaction');
    });
  });

  describe('the currency of an amount', () => {
    const moneyField = ({ path, value = 30, before }: { path: string; value?: number; before?: number }) =>
      buildField({
        path,
        value,
        display: { kind: 'money' },
        editable: { type: 'money' },
        ...(before === undefined ? {} : { before }),
      });
    const codeField = ({ path, value, before }: { path: string; value: string; before?: string }) =>
      buildField({
        path,
        value,
        display: { kind: 'text' },
        editable: { type: 'entity', entity: 'userCurrency' },
        ...(before === undefined ? {} : { before }),
      });
    const accountField = ({ path = 'accountId', value, before }: { path?: string; value: string; before?: string }) =>
      buildField({
        path,
        value,
        display: { kind: 'entity' },
        editable: { type: 'entity', entity: 'account' },
        ...(before === undefined ? {} : { before }),
      });
    const storedMoney = ({ path, value = 25, currencyCode }: { path: string; value?: number; currencyCode: string }) =>
      buildField({ path, value, display: { kind: 'money', currencyCode } });
    const updateCard = ({
      toolName,
      fields: cardFields,
      target,
    }: {
      toolName: string;
      fields: ChatCardField[];
      target?: ChatCardField[];
    }) => buildCard({ kind: 'update', toolName, fields: cardFields, ...(target ? { target } : {}) });

    const openEditors = async ({ card }: { card: ChatProposalCard }) => {
      const wrapper = mountCard({ card });
      await wrapper.find('[data-testid="edit"]').trigger('click');
      return wrapper;
    };
    const editorOf = ({ wrapper, path }: { wrapper: ReturnType<typeof mountCard>; path: string }) =>
      wrapper.findAllComponents(CardFieldEditor).find((editor) => editor.props('field').path === path)!;
    const amountFieldOf = ({ wrapper, path }: { wrapper: ReturnType<typeof mountCard>; path: string }) =>
      editorOf({ wrapper, path }).findComponent(FormattedAmountField);
    const setArg = async ({
      wrapper,
      path,
      value,
    }: {
      wrapper: ReturnType<typeof mountCard>;
      path: string;
      value: unknown;
    }) => {
      editorOf({ wrapper, path }).vm.$emit('update:modelValue', value);
      await flushPromises();
    };

    describe('while it is edited', () => {
      it.each([
        { amount: 'amount', arg: codeField({ path: 'currencyCode', value: 'USD' }), edited: 'GBP' },
        { amount: 'originalAmount', arg: codeField({ path: 'originalCurrencyCode', value: 'USD' }), edited: 'GBP' },
        { amount: 'amount', arg: accountField({ value: 'acc-1' }), edited: 'acc-gbp' },
        {
          amount: 'destinationAmount',
          arg: accountField({ path: 'destinationAccountId', value: 'acc-1' }),
          edited: 'acc-gbp',
        },
      ])('$amount follows $arg.path in the form', async ({ amount, arg, edited }) => {
        const wrapper = await openEditors({ card: buildCard({ fields: [moneyField({ path: amount }), arg] }) });

        expect(amountFieldOf({ wrapper, path: amount }).props('label')).toContain('(USD)');

        await setArg({ wrapper, path: arg.path, value: edited });

        expect(amountFieldOf({ wrapper, path: amount }).props('label')).toContain('(GBP)');
      });

      it('goes back to the currency of the record when the account is cleared in the form', async () => {
        const wrapper = await openEditors({
          card: updateCard({
            toolName: 'update_transaction',
            fields: [moneyField({ path: 'amount' }), accountField({ value: 'acc-gbp' })],
            target: [storedMoney({ path: 'amount', currencyCode: 'EUR' })],
          }),
        });

        expect(amountFieldOf({ wrapper, path: 'amount' }).props('label')).toContain('(GBP)');

        await setArg({ wrapper, path: 'accountId', value: null });

        expect(amountFieldOf({ wrapper, path: 'amount' }).props('label')).toContain('(EUR)');
      });
    });

    describe('when the card names no currency', () => {
      const cases = [
        { toolName: 'update_transaction', path: 'amount' },
        { toolName: 'update_subscription', path: 'expectedAmount' },
      ];

      it.each(cases)('$toolName edits $path in the currency of the record', async ({ toolName, path }) => {
        const wrapper = await openEditors({
          card: updateCard({
            toolName,
            fields: [moneyField({ path, before: 25 })],
            target: [storedMoney({ path, currencyCode: 'EUR' })],
          }),
        });

        expect(amountFieldOf({ wrapper, path }).props('label')).toContain('(EUR)');
      });

      it.each(cases)('$toolName reads and edits $path in one currency', async ({ toolName, path }) => {
        const card = updateCard({
          toolName,
          fields: [moneyField({ path, before: 25 })],
          target: [storedMoney({ path, currencyCode: 'EUR' })],
        });

        expect(mountCard({ card }).get('[data-tone="changed"]').text()).toContain('€30.00');

        const wrapper = await openEditors({ card });
        expect(editorOf({ wrapper, path }).props('currencyCode')).toBe('EUR');
      });
    });

    describe('an amount the server states the currency of', () => {
      const stated = moneyField({ path: 'currentBalance', value: 30, before: 25 });
      const card = updateCard({
        toolName: 'update_loan',
        fields: [{ ...stated, display: { kind: 'money', currencyCode: 'EUR' } }],
      });

      it('reads it and the value it replaces in that currency', () => {
        const row = mountCard({ card }).get('[data-tone="changed"]');

        expect(row.get('[data-testid="field-value"]').text()).toBe('€30.00');
        expect(row.get('[data-testid="field-before"]').text()).toContain('€25.00');
      });

      it('labels its editor in that currency', async () => {
        const wrapper = await openEditors({ card });

        expect(amountFieldOf({ wrapper, path: 'currentBalance' }).props('label')).toContain('(EUR)');
      });
    });

    describe('a payment of a loan', () => {
      const jpy = updateCard({
        toolName: 'update_loan',
        fields: [
          {
            ...moneyField({ path: 'minPayment', value: 900, before: 800 }),
            display: { kind: 'money', currencyCode: 'JPY' },
          },
        ],
      });

      it('edits in the currency of the loan', async () => {
        const wrapper = await openEditors({ card: jpy });

        expect(amountFieldOf({ wrapper, path: 'minPayment' }).props('label')).toContain('(JPY)');
      });

      it('sends a number back', async () => {
        const wrapper = await openEditors({ card: jpy });

        amountFieldOf({ wrapper, path: 'minPayment' }).vm.$emit('update:modelValue', 950);
        await flushPromises();

        expect(editorOf({ wrapper, path: 'minPayment' }).emitted('update:modelValue')?.at(-1)).toEqual([950]);
      });
    });

    describe('a subscription', () => {
      const target = [storedMoney({ path: 'expectedAmount', value: 10, currencyCode: 'USD' })];

      it('reads a new amount in the new currency it states, and the old amount in the old one', () => {
        const wrapper = mountCard({
          card: updateCard({
            toolName: 'update_subscription',
            fields: [
              moneyField({ path: 'expectedAmount', value: 20, before: 10 }),
              codeField({ path: 'expectedCurrencyCode', value: 'EUR', before: 'USD' }),
            ],
            target,
          }),
        });

        const row = wrapper.get('[data-tone="changed"]');
        expect(row.get('[data-testid="field-value"]').text()).toBe('€20.00');
        expect(row.get('[data-testid="field-before"]').text()).toContain('$10.00');
      });

      it('keeps its stored currency when it moves to an account in another one', () => {
        const wrapper = mountCard({
          card: updateCard({
            toolName: 'update_subscription',
            fields: [
              moneyField({ path: 'expectedAmount', value: 20, before: 10 }),
              accountField({ value: 'acc-gbp', before: 'acc-1' }),
            ],
            target,
          }),
        });

        const row = wrapper.findAll('[data-tone="changed"]')[0]!;
        expect(row.get('[data-testid="field-value"]').text()).toBe('$20.00');
        expect(row.get('[data-testid="field-before"]').text()).toContain('$10.00');
      });

      it('edits its amount in the stored currency, whichever account the form picks', async () => {
        const wrapper = await openEditors({
          card: updateCard({
            toolName: 'update_subscription',
            fields: [moneyField({ path: 'expectedAmount', value: 20 }), accountField({ value: 'acc-gbp' })],
            target,
          }),
        });

        expect(amountFieldOf({ wrapper, path: 'expectedAmount' }).props('label')).toContain('(USD)');

        await setArg({ wrapper, path: 'accountId', value: 'acc-jpy' });

        expect(amountFieldOf({ wrapper, path: 'expectedAmount' }).props('label')).toContain('(USD)');
      });
    });

    it('names the stored amount of a template in the currency of its account on the folded summary', () => {
      const wrapper = mountCard({
        card: buildCard({
          kind: 'delete',
          toolName: 'delete_transaction_template',
          status: 'applied',
          fields: [],
          target: [storedMoney({ path: 'amount', value: 25, currencyCode: 'EUR' })],
        }),
      });

      expect(wrapper.get('[data-testid="card-summary"]').text()).toContain('€25.00');
    });

    it('reads a payment that moves to an account in another currency: the new amount in the new one, the old in the old', () => {
      const wrapper = mountCard({
        card: updateCard({
          toolName: 'update_transaction',
          fields: [
            moneyField({ path: 'amount', value: 30, before: 25 }),
            accountField({ value: 'acc-gbp', before: 'acc-1' }),
          ],
          target: [storedMoney({ path: 'amount', value: 25, currencyCode: 'USD' })],
        }),
      });

      const row = wrapper.findAll('[data-tone="changed"]')[0]!;
      expect(row.get('[data-testid="field-value"]').text()).toBe('£30.00');
      expect(row.get('[data-testid="field-before"]').text()).toContain('$25.00');
    });
  });

  it('shows the progress of a goal card before its fields', () => {
    const wrapper = mountCard({
      card: buildCard({
        toolName: 'update_goal',
        kind: 'update',
        entity: 'goal',
        goalProgress: {
          before: { currencyCode: 'USD', targetAmount: 2000, currentValue: 500, percent: 25, status: 'on_track' },
          after: { currencyCode: 'USD', targetAmount: 1000, currentValue: 500, percent: 50, status: 'ahead' },
        },
      }),
    });

    expect(wrapper.get('[data-testid="goal-progress"]').text()).toContain('$500.00 of $1,000.00 (50%)');
  });

  it('shows no goal progress on a card that has none', () => {
    expect(mountCard({ card: buildCard() }).find('[data-testid="goal-progress"]').exists()).toBe(false);
  });
});
