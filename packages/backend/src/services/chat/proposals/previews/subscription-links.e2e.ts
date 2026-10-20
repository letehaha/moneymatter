import { SUBSCRIPTION_FREQUENCIES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { cardFor, proposeCards } from '@tests/helpers/chat-cards';
import { failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

const subscriptionPayload = ({ name, ...rest }: { name: string } & Record<string, unknown>) => ({
  name,
  expectedAmount: 9.99,
  expectedCurrencyCode: global.BASE_CURRENCY.code,
  frequency: SUBSCRIPTION_FREQUENCIES.monthly,
  startDate: '2026-01-01',
  raw: true as const,
  ...rest,
});

/** The subscription tools are not core: the model asks `find_capabilities` for them first. */
const propose = ({ toolName, args }: { toolName: string; args: Record<string, unknown> }) =>
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

describe('Chat cards that link transactions to a subscription', () => {
  it('names the subscription and lists each transaction with the subscription it is linked to', async () => {
    const account = await helpers.createAccount({ raw: true });
    const payee = await helpers.createPayee({ payload: { name: 'Netflix Inc' }, raw: true });
    const netflix = await helpers.createSubscription(subscriptionPayload({ name: 'Netflix' }));
    const spotify = await helpers.createSubscription(subscriptionPayload({ name: 'Spotify' }));
    const [free] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 9.99,
        payeeId: payee.id,
        time: '2026-10-05T00:00:00.000Z',
      }),
      raw: true,
    });
    const [taken] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 7,
        note: 'SPOTIFY AB',
        time: '2026-10-06T00:00:00.000Z',
      }),
      raw: true,
    });
    await helpers.linkTransactionsToSubscription({ id: spotify.id, transactionIds: [taken.id], raw: true });

    const { cards } = await propose({
      toolName: 'link_transactions_to_subscription',
      args: { subscriptionId: netflix.id, transactionIds: [free.id, taken.id], matchSource: 'manual' },
    });
    const card = cardFor({ cards, toolName: 'link_transactions_to_subscription' });

    expect(card.labels?.[`subscription:${netflix.id}`]).toBe('Netflix');
    expect(card.labels?.[`transaction:${free.id}`]).toBe(
      `2026-10-05 · -9.99 ${global.BASE_CURRENCY.code} · Netflix Inc · ${account.name}`,
    );
    expect(card.labels?.[`transaction:${taken.id}`]).toContain('SPOTIFY AB');
    expect(card.affected).toMatchObject({ count: 2, truncated: false });
    expect(card.affected!.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 9.99, payee: { kind: 'payee', id: payee.id }, linkedTo: null }),
        expect.objectContaining({ amount: 7, note: 'SPOTIFY AB', linkedTo: 'Spotify' }),
      ]),
    );
    expect(card.warnings).toEqual([{ key: 'chat.warnings.subscriptionAlreadyLinked', params: { count: 1 } }]);
    expect(card.canApply).toEqual({ ok: true });
  });

  it('refuses a subscription that is not there, with a key the card translates', async () => {
    const { cards } = await propose({
      toolName: 'link_transactions_to_subscription',
      args: {
        subscriptionId: '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11',
        transactionIds: ['9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20'],
        matchSource: 'manual',
      },
    });
    const card = cardFor({ cards, toolName: 'link_transactions_to_subscription' });

    expect(card.error).toMatchObject({ messageKey: 'chat.cards.targetNotFound' });
    expect(card.canApply).toMatchObject({ ok: false });
  });

  it('lists the transactions an unlink takes off the subscription and warns about the others', async () => {
    const account = await helpers.createAccount({ raw: true });
    const netflix = await helpers.createSubscription(subscriptionPayload({ name: 'Netflix' }));
    const [linked] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 9.99, note: 'NFLX' }),
      raw: true,
    });
    const [loose] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 3, note: 'COFFEE' }),
      raw: true,
    });
    await helpers.linkTransactionsToSubscription({ id: netflix.id, transactionIds: [linked.id], raw: true });

    const { cards } = await propose({
      toolName: 'unlink_transactions_from_subscription',
      args: { subscriptionId: netflix.id, transactionIds: [linked.id, loose.id] },
    });
    const card = cardFor({ cards, toolName: 'unlink_transactions_from_subscription' });

    expect(card.labels?.[`subscription:${netflix.id}`]).toBe('Netflix');
    expect(card.affected).toMatchObject({ count: 1 });
    expect(card.affected!.rows[0]).toMatchObject({ note: 'NFLX', amount: 9.99 });
    expect(card.warnings).toEqual([{ key: 'chat.warnings.subscriptionNotLinked', params: { count: 1 } }]);
  });
});

describe('Chat card of a subscription update', () => {
  it('shows the matching rules and the tags it replaces beside the new ones', async () => {
    const tag = await helpers.createTag({ payload: { name: 'streaming', color: '#00AA00', icon: null }, raw: true });
    const rules = { rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }] };
    const netflix = await helpers.createSubscription(
      subscriptionPayload({ name: 'Netflix', matchingRules: rules, tagIds: [tag.id] }),
    );

    const { cards } = await propose({
      toolName: 'update_subscription',
      args: { id: netflix.id, matchingRules: { rules: [] }, tagIds: [] },
    });
    const card = cardFor({ cards, toolName: 'update_subscription' });
    const field = ({ path }: { path: string }) => card.fields.find((candidate) => candidate.path === path);

    expect(field({ path: 'matchingRules' })).toMatchObject({
      display: { kind: 'matchingRules' },
      before: rules,
      value: { rules: [] },
    });
    expect(field({ path: 'tagIds' })?.before).toEqual([tag.id]);
    expect(card.target?.some((target) => target.value === 'Netflix')).toBe(true);
  });
});
