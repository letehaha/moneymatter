import {
  type ChatProposalCard,
  PAYMENT_TYPES,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  type SharePermission,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TRANSACTIONS_WRITE_SCOPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { cardFor, proposeCards } from '@tests/helpers/chat-cards';
import { failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

/** A card preview reads and counts rows by the account access the user has now, not by who wrote them. */
async function provisionRecipient() {
  const handle = await helpers.signUpSecondUser();
  await helpers.asUser({
    cookies: handle.cookies,
    fn: async () => {
      const res = await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
      if (res.statusCode !== 200) throw new Error(`Failed to set base currency: ${res.statusCode}`);
    },
  });
  return handle;
}

async function shareAccount({
  accountId,
  recipient,
}: {
  accountId: string;
  recipient: helpers.SecondUserHandle;
}): Promise<void> {
  const invitation = await helpers.createShareInvitation({
    inviteeEmail: recipient.email,
    resourceType: RESOURCE_TYPES.account,
    resourceId: accountId,
    permission: SHARE_PERMISSIONS.write,
    policy: { transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all },
    raw: true,
  });
  await helpers.asUser({
    cookies: recipient.cookies,
    fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
  });
}

async function revokeShare({
  accountId,
  recipient,
}: {
  accountId: string;
  recipient: helpers.SecondUserHandle;
}): Promise<void> {
  const member = await helpers.findAppUserByEmail({ email: recipient.email });
  await helpers.revokeShareMember({
    resourceType: RESOURCE_TYPES.account,
    resourceId: accountId,
    memberUserId: member.id,
    raw: true,
  });
}

const proposeAs = ({
  recipient,
  turns,
}: {
  recipient: helpers.SecondUserHandle;
  turns: Parameters<typeof proposeCards>[0]['turns'];
}) => helpers.asUser({ cookies: recipient.cookies, fn: () => proposeCards({ turns }) });

const noteField = ({ card }: { card: { fields: Array<{ path: string; before?: unknown }> } }) =>
  card.fields.find((field) => field.path === 'note');

describe('Chat card previews on a shared account', () => {
  it('shows a recipient the row the owner wrote, which the recipient may edit', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [ownerTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, note: 'Owner note' }),
      raw: true,
    });
    const recipient = await provisionRecipient();
    await shareAccount({ accountId: account.id, recipient });

    const { cards } = await proposeAs({
      recipient,
      turns: [
        { toolCalls: [{ name: 'update_transaction', arguments: { id: ownerTx.id, note: 'Edited by recipient' } }] },
        { text: 'Done.' },
      ],
    });
    const card = cardFor({ cards, toolName: 'update_transaction' });

    expect(card.canApply).toEqual({ ok: true });
    expect(noteField({ card })?.before).toBe('Owner note');
  });

  it('shows a recipient the row they wrote while the share lasts, and nothing of it once it is revoked', async () => {
    const account = await helpers.createAccount({ raw: true });
    const ownerCategory = await helpers.addCustomCategory({ name: 'preview-cat', color: '#00AA00', raw: true });
    const recipient = await provisionRecipient();
    await shareAccount({ accountId: account.id, recipient });
    const [recipientTx] = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () =>
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: ownerCategory.id,
            note: 'Recipient note',
          }),
          raw: true,
        }),
    });
    const turns = [
      { toolCalls: [{ name: 'update_transaction', arguments: { id: recipientTx.id, note: 'Edited' } }] },
      { text: 'Done.' },
    ];

    const whileShared = cardFor({
      cards: (await proposeAs({ recipient, turns })).cards,
      toolName: 'update_transaction',
    });
    expect(whileShared.canApply).toEqual({ ok: true });
    expect(noteField({ card: whileShared })?.before).toBe('Recipient note');

    await revokeShare({ accountId: account.id, recipient });
    await helpers.updateTransaction({ id: recipientTx.id, payload: { note: 'Owner private edit' }, raw: true });

    const afterRevoke = cardFor({
      cards: (await proposeAs({ recipient, turns })).cards,
      toolName: 'update_transaction',
    });
    expect(afterRevoke.canApply).toEqual({ ok: false, reasonKey: 'chat.cards.previewFailed' });
    expect(noteField({ card: afterRevoke })?.before).toBeUndefined();
    expect(JSON.stringify(afterRevoke)).not.toContain('Owner private edit');
  });

  it('counts a bulk update of the recipient rows after a revoke but lists none of them', async () => {
    const account = await helpers.createAccount({ raw: true });
    const ownerCategory = await helpers.addCustomCategory({ name: 'bulk-preview-cat', color: '#AA0000', raw: true });
    const recipient = await provisionRecipient();
    await shareAccount({ accountId: account.id, recipient });
    const [recipientTx] = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () =>
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId: account.id, categoryId: ownerCategory.id }),
          raw: true,
        }),
    });
    const turns = [
      { toolCalls: [{ name: 'bulk_update_transactions', arguments: { transactionIds: [recipientTx.id], note: 'x' } }] },
      { text: 'Done.' },
    ];

    const whileShared = cardFor({
      cards: (await proposeAs({ recipient, turns })).cards,
      toolName: 'bulk_update_transactions',
    });
    expect(whileShared.affected).toMatchObject({ count: 1 });
    expect(whileShared.affected!.rows).toHaveLength(1);

    await revokeShare({ accountId: account.id, recipient });

    const afterRevoke = cardFor({
      cards: (await proposeAs({ recipient, turns })).cards,
      toolName: 'bulk_update_transactions',
    });
    expect(afterRevoke.affected).toMatchObject({ count: 1, rows: [] });
  });
});

/** The tools that are not core: the model asks `find_capabilities` for them first. */
const proposeTool = ({ toolName, args }: { toolName: string; args: Record<string, unknown> }) =>
  proposeCards({
    turns: [
      {
        toolCalls: [
          { id: 'call_find', name: 'find_capabilities', arguments: { query: toolName.replaceAll('_', ' ') } },
        ],
      },
      { toolCalls: [{ id: 'call_card', name: toolName, arguments: args }] },
      { text: 'Done.' },
    ],
  });

const proposedCard = async ({ toolName, args }: { toolName: string; args: Record<string, unknown> }) =>
  cardFor({ cards: (await proposeTool({ toolName, args })).cards, toolName });

const moneyDisplayOf = ({ card, path }: { card: ChatProposalCard; path: string }) =>
  card.fields.find((field) => field.path === path)?.display;

const NON_BASE_CURRENCY = 'EUR';

const provisionTemplate = async () => {
  const { account } = await helpers.createAccountWithNewCurrency({ currency: NON_BASE_CURRENCY });
  const template = await helpers.createTransactionTemplate({
    payload: { name: 'Rent', transactionType: TRANSACTION_TYPES.expense, accountId: account.id, amount: 25 },
    raw: true,
  });
  return { account, template };
};

const transferTo = async ({ currency }: { currency: string }) => {
  const source = await helpers.createAccount({ raw: true });
  const { account: destination } = await helpers.createAccountWithNewCurrency({ currency });
  const [leg] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId: source.id, amount: 100 }),
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: 90,
      destinationAccountId: destination.id,
    },
    raw: true,
  });
  return { source, leg };
};

const updateTurns = ({ id }: { id: string }) => [
  { toolCalls: [{ name: 'update_transaction', arguments: { id, destinationAmount: 95 } }] },
  { text: 'Done.' },
];

const provisionSharedTracker = async ({
  permission = SHARE_PERMISSIONS.manage,
}: { permission?: SharePermission } = {}) => {
  const tracker = await helpers.createTracker({ name: 'Trip', limitAmount: 500, raw: true });
  const category = await helpers.addCustomCategory({ name: 'trip-food', color: '#00AA00', raw: true });
  const line = await helpers.createTrackerLine({
    trackerId: tracker.id,
    payload: { name: 'Food', limitAmount: 100, categoryIds: [category.id] },
    raw: true,
  });
  const recipient = await helpers.provisionSecondUserWithBaseCurrency();
  await helpers.shareTrackerWith({ trackerId: tracker.id, recipient, permission });
  return { tracker, category, line, recipient };
};

const proposedRunByRecipient = ({
  recipient,
  toolName,
  args,
}: {
  recipient: helpers.SecondUserHandle;
  toolName: string;
  args: Record<string, unknown>;
}) => helpers.asUser({ cookies: recipient.cookies, fn: () => proposeTool({ toolName, args }) });

const proposedByRecipient = async (params: {
  recipient: helpers.SecondUserHandle;
  toolName: string;
  args: Record<string, unknown>;
}) => cardFor({ cards: (await proposedRunByRecipient(params)).cards, toolName: params.toolName });

/** What the model read last from a tool: the error of a call that made no card. */
const lastToolResult = ({ script }: { script: Awaited<ReturnType<typeof proposeTool>>['script'] }) =>
  String(
    script.requests
      .at(-1)!
      .messages!.filter((message) => message.role === 'tool')
      .at(-1)!.content,
  );

describe('Chat cards state the currency of an amount their arguments leave without one', () => {
  it('shows the balance of a loan in the currency of its account', async () => {
    const loan = await helpers.createLoan({ payload: helpers.buildCreateLoanPayload(), raw: true });

    const card = await proposedCard({ toolName: 'update_loan', args: { loanId: loan.id, currentBalance: 150_000 } });

    expect(card.canApply).toEqual({ ok: true });
    expect(moneyDisplayOf({ card, path: 'currentBalance' })).toEqual({ kind: 'money', currencyCode: 'USD' });
  });

  describe('a template', () => {
    it('shows a new amount and its stored one in the currency of its stored account', async () => {
      const { template } = await provisionTemplate();

      const card = await proposedCard({
        toolName: 'update_transaction_template',
        args: { templateId: template.id, amount: 30 },
      });

      expect(moneyDisplayOf({ card, path: 'amount' })).toEqual({ kind: 'money', currencyCode: NON_BASE_CURRENCY });
      expect(card.target?.find((field) => field.path === 'amount')?.display?.currencyCode).toBe(NON_BASE_CURRENCY);
    });

    it('leaves a new amount to the account the card moves it to, and keeps the stored one in the stored currency', async () => {
      const { template } = await provisionTemplate();
      const other = await helpers.createAccount({ raw: true });

      const card = await proposedCard({
        toolName: 'update_transaction_template',
        args: { templateId: template.id, amount: 30, accountId: other.id },
      });

      expect(moneyDisplayOf({ card, path: 'amount' })).toEqual({ kind: 'money' });
      expect(card.target?.find((field) => field.path === 'amount')?.display?.currencyCode).toBe(NON_BASE_CURRENCY);
    });

    it('names the stored amount of a template it deletes in that currency', async () => {
      const { template } = await provisionTemplate();

      const card = await proposedCard({ toolName: 'delete_transaction_template', args: { templateId: template.id } });

      expect(card.target?.find((field) => field.path === 'amount')?.display?.currencyCode).toBe(NON_BASE_CURRENCY);
    });
  });

  it('books a subscription payment in the currency of the account of the subscription', async () => {
    const { account } = await helpers.createAccountWithNewCurrency({ currency: NON_BASE_CURRENCY });
    const subscription = await helpers.createSubscription({
      name: 'Netflix',
      expectedAmount: 9.99,
      expectedCurrencyCode: global.BASE_CURRENCY.code,
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: '2026-01-01',
      dueDate: '2026-12-01',
      accountId: account.id,
      raw: true,
    });
    const { periods } = await helpers.getSubscriptionPeriods({ id: subscription.id, raw: true });

    const card = await proposedCard({
      toolName: 'pay_subscription_period',
      args: { subscriptionId: subscription.id, periodId: periods[0]!.id, createTransaction: true, amount: 12 },
    });

    expect(card.canApply).toEqual({ ok: true });
    expect(moneyDisplayOf({ card, path: 'amount' })).toEqual({ kind: 'money', currencyCode: NON_BASE_CURRENCY });
  });

  describe('the destination amount of a transfer', () => {
    it('is in the currency of the stored other leg on an update', async () => {
      const { leg } = await transferTo({ currency: NON_BASE_CURRENCY });

      const { cards } = await proposeCards({ turns: updateTurns({ id: leg.id }) });
      const card = cardFor({ cards, toolName: 'update_transaction' });

      expect(moneyDisplayOf({ card, path: 'destinationAmount' })).toEqual({
        kind: 'money',
        currencyCode: NON_BASE_CURRENCY,
      });
    });

    it('says nothing to a recipient of the currency of a leg on an account they cannot see', async () => {
      const { source, leg } = await transferTo({ currency: NON_BASE_CURRENCY });
      const recipient = await provisionRecipient();
      await shareAccount({ accountId: source.id, recipient });

      const { cards } = await proposeAs({ recipient, turns: updateTurns({ id: leg.id }) });
      const card = cardFor({ cards, toolName: 'update_transaction' });

      expect(moneyDisplayOf({ card, path: 'destinationAmount' })).toEqual({ kind: 'money' });
    });

    it('is left to the row a create links as its other leg, and a call that states one makes no card', async () => {
      const source = await helpers.createAccount({ raw: true });
      const { account: destination } = await helpers.createAccountWithNewCurrency({ currency: NON_BASE_CURRENCY });
      const [income] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: destination.id,
          amount: 90,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });
      const link = {
        accountId: source.id,
        amount: 100,
        time: '2026-10-05T10:00:00.000Z',
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: PAYMENT_TYPES.bankTransfer,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationTransactionId: income.id,
      };

      const stated = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'create_transaction', arguments: { ...link, destinationAmount: 90 } }] },
          { text: 'Done.' },
        ],
      });

      expect(stated.cards).toEqual([]);
      expect(lastToolResult({ script: stated.script })).toMatch(/When "destinationTransactionId" is provided/);

      const { cards } = await proposeCards({
        threadId: stated.threadId,
        turns: [{ toolCalls: [{ name: 'create_transaction', arguments: link }] }, { text: 'Done.' }],
      });
      const card = cardFor({ cards, toolName: 'create_transaction' });

      expect(card.canApply).toEqual({ ok: true });
      expect(card.fields.some((field) => field.path === 'destinationAmount')).toBe(false);
    });
  });

  describe('the limit of a tracker shared with a recipient', () => {
    it('is stated in the base currency of the owner, on the tracker and on a changed line', async () => {
      const { tracker, line, recipient } = await provisionSharedTracker();
      const owners = { kind: 'money', currencyCode: global.BASE_CURRENCY.code };

      const updateTracker = await proposedByRecipient({
        recipient,
        toolName: 'update_tracker',
        args: { trackerId: tracker.id, limitAmount: 600 },
      });
      expect(moneyDisplayOf({ card: updateTracker, path: 'limitAmount' })).toEqual(owners);

      const updateLine = await proposedByRecipient({
        recipient,
        toolName: 'update_tracker_line',
        args: { trackerId: tracker.id, lineId: line.id, limitAmount: 120 },
      });
      expect(moneyDisplayOf({ card: updateLine, path: 'limitAmount' })).toEqual(owners);
    });

    it('shows a new line of the owner in the base currency of the owner', async () => {
      const { tracker, category } = await provisionSharedTracker();

      const card = await proposedCard({
        toolName: 'create_tracker_line',
        args: { trackerId: tracker.id, name: 'Fun', categoryIds: [category.id], limitAmount: 50 },
      });

      expect(card.canApply).toEqual({ ok: true });
      expect(moneyDisplayOf({ card, path: 'limitAmount' })).toEqual({
        kind: 'money',
        currencyCode: global.BASE_CURRENCY.code,
      });
    });
  });

  describe('an amount named by a tool beyond the amount suffixes', () => {
    it('shows the payments of a loan as money in the currency of the loan, and the old ones beside them', async () => {
      await helpers.addUserCurrencies({ currencyCodes: [NON_BASE_CURRENCY], raw: true });
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({ currencyCode: NON_BASE_CURRENCY }),
        raw: true,
      });

      const card = await proposedCard({
        toolName: 'update_loan',
        args: { loanId: loan.id, minPayment: 900, plannedPayment: 1000 },
      });

      const inLoanCurrency = { kind: 'money', currencyCode: NON_BASE_CURRENCY };
      expect(moneyDisplayOf({ card, path: 'minPayment' })).toEqual(inLoanCurrency);
      expect(moneyDisplayOf({ card, path: 'plannedPayment' })).toEqual(inLoanCurrency);
      expect(card.fields.find((field) => field.path === 'minPayment')?.editable).toEqual({ type: 'money' });
      expect(Number(card.fields.find((field) => field.path === 'minPayment')?.before)).toBe(1200);
    });

    it('leaves the amounts of a new loan and a new vehicle to the currency their arguments state', async () => {
      const loan = await proposedCard({
        toolName: 'create_loan',
        args: helpers.buildCreateLoanPayload({ currencyCode: NON_BASE_CURRENCY }),
      });
      for (const path of ['originalPrincipal', 'minPayment', 'plannedPayment']) {
        expect(moneyDisplayOf({ card: loan, path })).toEqual({ kind: 'money' });
      }

      const vehicle = await proposedCard({
        toolName: 'create_vehicle',
        args: {
          name: 'Car',
          make: 'Skoda',
          model: 'Octavia',
          year: 2020,
          vehicleClass: 'sedan',
          currencyCode: NON_BASE_CURRENCY,
          purchasePrice: 20_000,
          purchaseDate: '2021-01-15',
        },
      });
      expect(moneyDisplayOf({ card: vehicle, path: 'purchasePrice' })).toEqual({ kind: 'money' });
    });

    it('shows the expected income of a budget plan in the currency of the plan', async () => {
      const { plan } = await helpers.createBudgetPlan({ raw: true });

      const card = await proposedCard({
        toolName: 'update_budget_plan',
        args: { planId: plan.id, expectedIncome: 5000 },
      });

      expect(moneyDisplayOf({ card, path: 'expectedIncome' })).toEqual({
        kind: 'money',
        currencyCode: plan.currencyCode,
      });
    });

    it('shows every amount of a goal in the currency of the plan, whether the goal exists yet or not', async () => {
      const { plan } = await helpers.createBudgetPlan({ raw: true });
      const category = await helpers.addCustomCategory({ name: 'goal-cat', color: '#00AA00', raw: true });
      const line = await helpers.createBudgetPlanLine({
        planId: plan.id,
        payload: { name: 'Goal line', categoryIds: [category.id] },
        raw: true,
      });

      const card = await proposedCard({
        toolName: 'set_budget_plan_line_goal',
        args: {
          planId: plan.id,
          lineId: line.id,
          frequency: 'every_period',
          behavior: 'refill_up_to',
          amount: 300,
          fundingCap: 100,
        },
      });

      expect(card.canApply).toEqual({ ok: true });
      const inPlanCurrency = { kind: 'money', currencyCode: plan.currencyCode };
      expect(moneyDisplayOf({ card, path: 'amount' })).toEqual(inPlanCurrency);
      expect(moneyDisplayOf({ card, path: 'fundingCap' })).toEqual(inPlanCurrency);
    });

    it('shows the threshold of a tag reminder as money, which the app states in the base currency', async () => {
      const tag = await helpers.createTag({ payload: { name: 'tax', color: '#00AA00' }, raw: true });

      const card = await proposedCard({
        toolName: 'create_tag_reminder',
        args: { tagId: tag.id, type: 'amount_threshold', frequency: 'monthly', amountThreshold: 250 },
      });

      expect(moneyDisplayOf({ card, path: 'amountThreshold' })).toEqual({ kind: 'money' });
    });
  });

  describe('an amount that is not a money argument of a number', () => {
    const INVENTED_ID = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';

    it('reads the decimal strings of a venture event as plain text, with no currency to get wrong', async () => {
      const card = await proposedCard({
        toolName: 'update_venture_event',
        args: { eventId: INVENTED_ID, gpCarryAmount: '12.50', lpNetAmount: '87.50' },
      });

      expect(moneyDisplayOf({ card, path: 'gpCarryAmount' })).toEqual({ kind: 'text' });
      expect(moneyDisplayOf({ card, path: 'lpNetAmount' })).toEqual({ kind: 'text' });
    });

    it('reads the settlement amount of an investment transaction as plain text', async () => {
      const card = await proposedCard({
        toolName: 'update_investment_transaction',
        args: { transactionId: INVENTED_ID, settlementAmount: '12.50' },
      });

      expect(moneyDisplayOf({ card, path: 'settlementAmount' })).toEqual({ kind: 'text' });
    });

    it('makes no card for an original amount of a transaction without its currency', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [transaction] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: account.id }),
          originalAmount: 66.42,
          originalCurrencyCode: NON_BASE_CURRENCY,
        },
        raw: true,
      });

      const { cards, script } = await proposeTool({
        toolName: 'update_transaction',
        args: { id: transaction.id, originalAmount: 70 },
      });

      expect(cards).toEqual([]);
      expect(lastToolResult({ script })).toMatch(/must be set, or cleared, together/);
    });
  });
});

describe('A line of a shared tracker in the chat', () => {
  it('is proposed by a manage recipient with the categories of the owner, named on the card, and applied', async () => {
    const { tracker, category, recipient } = await provisionSharedTracker();

    const card = await proposedByRecipient({
      recipient,
      toolName: 'create_tracker_line',
      args: { trackerId: tracker.id, name: 'Fun', categoryIds: [category.id], limitAmount: 50 },
    });

    expect(card.canApply).toEqual({ ok: true });
    expect(moneyDisplayOf({ card, path: 'limitAmount' })).toEqual({
      kind: 'money',
      currencyCode: global.BASE_CURRENCY.code,
    });
    expect(card.labels?.[`category:${category.id}`]).toBe('trip-food');

    const approved = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.approveChatProposal({ proposalId: card.id, payload: { revision: card.revision }, raw: true }),
    });
    expect(approved.card.status).toBe('applied');

    const shared = await helpers.getTrackerById({ id: tracker.id, raw: true });
    const created = shared!.lines!.find((item) => item.name === 'Fun');
    expect(created?.limitAmount).toBe(50);
    expect(created?.categories?.map((item) => item.id)).toEqual([category.id]);
  });

  it('takes the categories of the owner on an update by a manage recipient', async () => {
    const { tracker, category, line, recipient } = await provisionSharedTracker();

    const card = await proposedByRecipient({
      recipient,
      toolName: 'update_tracker_line',
      args: { trackerId: tracker.id, lineId: line.id, categoryIds: [category.id] },
    });

    expect(card.canApply).toEqual({ ok: true });
    expect(card.labels?.[`category:${category.id}`]).toBe('trip-food');
  });

  it('refuses a category of the recipient, which is not in the tree of the owner', async () => {
    const { tracker, recipient } = await provisionSharedTracker();
    const own = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.addCustomCategory({ name: 'recipient-own', color: '#00AA00', raw: true }),
    });

    const { cards, script } = await proposedRunByRecipient({
      recipient,
      toolName: 'create_tracker_line',
      args: { trackerId: tracker.id, name: 'Fun', categoryIds: [own.id] },
    });

    expect(cards).toEqual([]);
    expect(lastToolResult({ script })).toMatch(new RegExp(`categoryIds: ${own.id} .*get_tracker`));
  });

  it.each([
    [
      'a user without access',
      async () => helpers.provisionSecondUserWithBaseCurrency({ email: 'stranger@test.local' }),
    ],
    ['a read-only recipient', null],
  ])('refuses %s, and says nothing of the categories of the owner', async (_label, stranger) => {
    const { tracker, category, recipient } = await provisionSharedTracker({
      permission: stranger ? SHARE_PERMISSIONS.manage : SHARE_PERMISSIONS.read,
    });
    const caller = stranger ? await stranger() : recipient;

    const { cards, script } = await proposedRunByRecipient({
      recipient: caller,
      toolName: 'create_tracker_line',
      args: { trackerId: tracker.id, name: 'Fun', categoryIds: [category.id] },
    });

    expect(cards).toEqual([]);
    const result = lastToolResult({ script });
    expect(result).toMatch(/trackerId: .*get_trackers/);
    expect(result).not.toContain('trip-food');
    expect(result).not.toContain(category.id);
  });
});

describe('A change of a line of a tracker on its card', () => {
  it('shows the old limit and name of the line, not of the tracker, and names the line as its target', async () => {
    const { tracker, line, recipient } = await provisionSharedTracker();

    const card = await proposedByRecipient({
      recipient,
      toolName: 'update_tracker_line',
      args: { trackerId: tracker.id, lineId: line.id, limitAmount: 120, name: 'Groceries' },
    });

    expect(card.canApply).toEqual({ ok: true });
    expect(Number(card.fields.find((field) => field.path === 'limitAmount')?.before)).toBe(100);
    expect(card.fields.find((field) => field.path === 'name')?.before).toBe('Food');
    expect(card.target?.find((field) => field.path === 'name')?.value).toBe('Food');
    expect(moneyDisplayOf({ card, path: 'limitAmount' })).toEqual({
      kind: 'money',
      currencyCode: global.BASE_CURRENCY.code,
    });
  });

  it('finds no line that is not of the tracker', async () => {
    const { tracker } = await provisionSharedTracker();
    const other = await helpers.createTracker({ name: 'Other', limitAmount: 10, raw: true });
    const category = await helpers.addCustomCategory({ name: 'other-cat', color: '#0000AA', raw: true });
    const foreignLine = await helpers.createTrackerLine({
      trackerId: other.id,
      payload: { name: 'Other line', limitAmount: 7, categoryIds: [category.id] },
      raw: true,
    });

    const card = await proposedCard({
      toolName: 'update_tracker_line',
      args: { trackerId: tracker.id, lineId: foreignLine.id, limitAmount: 120 },
    });

    expect(card.canApply).toEqual({ ok: false, reasonKey: 'chat.cards.previewFailed' });
    expect(JSON.stringify(card)).not.toContain('Other line');
  });
});

const provisionSubscription = ({ expected }: { expected: boolean }) =>
  helpers.createSubscription({
    name: 'Electricity',
    type: SUBSCRIPTION_TYPES.bill,
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: '2026-01-01',
    ...(expected ? { expectedAmount: 9.99, expectedCurrencyCode: global.BASE_CURRENCY.code } : {}),
    raw: true,
  });

describe('An expected amount of a subscription on its card', () => {
  it.each([
    ['with an account', true],
    ['without an account', false],
  ])('makes no card for an amount %s when no currency is stored or passed', async (_label, withAccount) => {
    const account = await helpers.createAccount({ raw: true });
    const subscription = await provisionSubscription({ expected: false });

    const { cards, script } = await proposeTool({
      toolName: 'update_subscription',
      args: { id: subscription.id, expectedAmount: 12, ...(withAccount ? { accountId: account.id } : {}) },
    });

    expect(cards).toEqual([]);
    expect(lastToolResult({ script })).toMatch(/expectedCurrencyCode/);
  });

  it('makes a card that applies when the currency is passed with the amount', async () => {
    const subscription = await provisionSubscription({ expected: false });

    const card = await proposedCard({
      toolName: 'update_subscription',
      args: { id: subscription.id, expectedAmount: 12, expectedCurrencyCode: global.BASE_CURRENCY.code },
    });

    expect(card.canApply).toEqual({ ok: true });
    const approved = await helpers.approveChatProposal({
      proposalId: card.id,
      payload: { revision: card.revision },
      raw: true,
    });
    expect(approved.card.status).toBe('applied');
  });

  it('makes a card for a new amount in the stored currency', async () => {
    const subscription = await provisionSubscription({ expected: true });

    const card = await proposedCard({
      toolName: 'update_subscription',
      args: { id: subscription.id, expectedAmount: 12 },
    });

    expect(card.canApply).toEqual({ ok: true });
  });
});
