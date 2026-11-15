import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import ChatProposals from '@models/chat-proposals.model';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { cardFor, proposalRefsIn, proposeCards } from '@tests/helpers/chat-cards';
import { failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

const expenseArgs = ({ accountId, ...rest }: { accountId: string } & Record<string, unknown>) => ({
  accountId,
  amount: 18,
  transactionType: TRANSACTION_TYPES.expense,
  paymentType: PAYMENT_TYPES.creditCard,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  ...rest,
});

describe('editing a card that is still pending', () => {
  it('turns an update of the pending create into a revised create, leaving one approvable card', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: 'Taxi', color: '#FFC107', raw: true });

    const { threadId, cards, script } = await proposeCards({
      turns: [
        {
          toolCalls: [
            {
              name: 'create_transaction',
              arguments: expenseArgs({
                accountId: account.id,
                categoryId: category.id,
                time: '2026-10-21T04:00:00Z',
                note: 'taxi',
              }),
            },
          ],
        },
        (body) => ({
          toolCalls: [
            {
              name: 'update_transaction',
              arguments: { id: proposalRefsIn({ body }).at(-1), time: '2026-10-21T12:25:00Z' },
            },
          ],
        }),
        { text: 'Done.' },
      ],
    });

    const stored = await ChatProposals.findAll({ where: { threadId }, order: [['createdAt', 'ASC']] });
    expect(stored.map((card) => [card.toolName, card.status])).toEqual([
      ['create_transaction', 'superseded'],
      ['create_transaction', 'pending'],
    ]);
    expect(stored[1]!.supersedesId).toBe(stored[0]!.id);
    expect(stored[1]!.args).toMatchObject({ amount: 18, note: 'taxi', time: '2026-10-21T12:25:00Z' });
    expect(stored[1]!.error).toBeNull();
    expect(cards.some((card) => card.toolName === 'update_transaction')).toBe(false);
    expect(script.remaining()).toBe(0);

    const revised = cardFor({ cards, toolName: 'create_transaction', index: 1 });
    expect(revised.canApply).toEqual({ ok: true });

    await helpers.approveChatProposal({ proposalId: revised.id, payload: { revision: 1 } });
    expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);
  });

  it('keeps the pending card and tells the model when its replacement cannot be approved', async () => {
    const { threadId, script } = await proposeCards({
      turns: [
        {
          toolCalls: [
            {
              id: 'call_find',
              name: 'find_capabilities',
              arguments: { query: 'create category delete transaction', limit: 8 },
            },
          ],
        },
        { toolCalls: [{ name: 'create_category', arguments: { name: 'Taxi', color: '#4CAF50' } }] },
        (body) => {
          const ref = proposalRefsIn({ body }).at(-1)!;
          return {
            toolCalls: [
              {
                name: 'delete_transaction',
                arguments: { id: ref, _chat: { replaces: ref.slice('$proposal:'.length) } },
              },
            ],
          };
        },
        { text: 'I will propose it again.' },
      ],
    });

    const stored = await ChatProposals.findAll({ where: { threadId }, order: [['createdAt', 'ASC']] });
    expect(stored.map((card) => [card.toolName, card.status])).toEqual([['create_category', 'pending']]);

    const toolResults = (script.requests[3]!.messages ?? []).filter((message) => message.role === 'tool');
    expect(String(toolResults.at(-1)!.content)).toMatch(/cannot be approved/);
  });
});
