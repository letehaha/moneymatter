import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import ChatProposals from '@models/chat-proposals.model';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { proposeCards } from '@tests/helpers/chat-cards';
import { failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

const INVENTED_ID = '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a';

const expenseArgs = ({ accountId, ...rest }: { accountId: string } & Record<string, unknown>) => ({
  accountId,
  amount: 18,
  transactionType: TRANSACTION_TYPES.expense,
  paymentType: PAYMENT_TYPES.creditCard,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  ...rest,
});

describe('a card that names a record the user does not have', () => {
  it('is refused with the tool that lists the real ones, so the card never shows the field name as the value', async () => {
    const account = await helpers.createAccount({ raw: true });

    const { threadId, script } = await proposeCards({
      turns: [
        { toolCalls: [{ id: 'call_find', name: 'find_capabilities', arguments: { query: 'create transaction' } }] },
        {
          toolCalls: [
            { name: 'create_transaction', arguments: expenseArgs({ accountId: account.id, categoryId: INVENTED_ID }) },
          ],
        },
        { text: 'I will look the category up.' },
      ],
    });

    expect(await ChatProposals.count({ where: { threadId } })).toBe(0);
    const toolResults = (script.requests[2]!.messages ?? []).filter((message) => message.role === 'tool');
    expect(String(toolResults.at(-1)!.content)).toMatch(/categoryId: .*get_categories/);
  });

  it("is made when the category is one of the user's own", async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: 'Taxi', color: '#FFC107', raw: true });

    const { threadId } = await proposeCards({
      turns: [
        {
          toolCalls: [
            { name: 'create_transaction', arguments: expenseArgs({ accountId: account.id, categoryId: category.id }) },
          ],
        },
        { text: 'Done.' },
      ],
    });

    expect(await ChatProposals.count({ where: { threadId, status: 'pending' } })).toBe(1);
  });
});
