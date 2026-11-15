import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { cardFor, proposeCards } from '@tests/helpers/chat-cards';
import { failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

const propose = ({ name, args }: { name: string; args: Record<string, unknown> }) =>
  proposeCards({
    turns: [
      { toolCalls: [{ id: 'call_find', name: 'find_capabilities', arguments: { query: name.replace('_', ' ') } }] },
      { toolCalls: [{ id: 'call_goal', name, arguments: args }] },
      { text: 'Done.' },
    ],
  });

describe('goal cards', () => {
  it('shows a new goal with its accounts by id, the share each holds and the progress it starts at', async () => {
    const account = await helpers.createAccount({ raw: true });

    const { cards } = await propose({
      name: 'create_goal',
      args: {
        name: 'Holiday',
        currencyCode: global.BASE_CURRENCY.code,
        targetAmount: 2000,
        accounts: [{ accountId: account.id, sharePercent: 100 }],
      },
    });
    const card = cardFor({ cards, toolName: 'create_goal' });

    expect(card).toMatchObject({ kind: 'create', entity: 'goal', danger: 'none', confirmation: { mode: 'none' } });
    expect(card.target).toBeUndefined();
    expect(card.fields.find((field) => field.path === 'accounts')?.display).toEqual({ kind: 'goalAccounts' });
    expect(card.affected?.rows).toEqual([
      { account: { kind: 'account', id: account.id }, share: 100, fixedAmount: null },
    ]);
    expect(card.goalProgress?.before).toBeNull();
    expect(card.goalProgress?.after).toMatchObject({
      currencyCode: global.BASE_CURRENCY.code,
      targetAmount: 2000,
      currentValue: 0,
    });

    const approved = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: card.revision } });
    expect(approved.statusCode).toBe(200);
    expect((await helpers.listGoals({ raw: true })).map((goal) => goal.name)).toEqual(['Holiday']);
  });

  it('shows an update beside the goal as it is, with the progress before and after, and applies it', async () => {
    const goal = await helpers.createGoal({ payload: { name: 'Holiday', targetAmount: 2000 }, raw: true });

    const { cards } = await propose({ name: 'update_goal', args: { goalId: goal.id, targetAmount: 1000 } });
    const card = cardFor({ cards, toolName: 'update_goal' });

    expect(card).toMatchObject({ kind: 'update', entity: 'goal', danger: 'none' });
    expect(card.target).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'name', value: 'Holiday' })]));
    expect(card.goalProgress?.before?.targetAmount).toBe(2000);
    expect(card.goalProgress?.after?.targetAmount).toBe(1000);
    expect(card.affected?.rows).toHaveLength(1);

    const approved = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: card.revision } });
    expect(approved.statusCode).toBe(200);
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).targetAmount).toBe(1000);
  });

  it('goes stale when the goal changes after the card was made', async () => {
    const goal = await helpers.createGoal({ payload: { name: 'Holiday' }, raw: true });
    const { cards } = await propose({ name: 'update_goal', args: { goalId: goal.id, targetAmount: 1500 } });
    const card = cardFor({ cards, toolName: 'update_goal' });

    await helpers.updateGoal({ goalId: goal.id, payload: { name: 'Trip' }, raw: true });
    const approved = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: card.revision } });

    expect(approved.statusCode).not.toBe(200);
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).targetAmount).toBe(1000);
  });

  it('shows a delete as a red card that asks for one confirmation and keeps the account', async () => {
    const goal = await helpers.createGoal({ payload: { name: 'Holiday' }, raw: true });

    const { cards } = await propose({ name: 'delete_goal', args: { goalId: goal.id } });
    const card = cardFor({ cards, toolName: 'delete_goal' });

    expect(card).toMatchObject({
      kind: 'delete',
      entity: 'goal',
      danger: 'destructive',
      confirmation: { mode: 'confirm' },
    });
    expect(card.goalProgress?.after).toBeNull();
    expect(card.goalProgress?.before).toMatchObject({ targetAmount: 1000 });

    const missing = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: card.revision } });
    expect(missing.statusCode).not.toBe(200);

    const approved = await helpers.approveChatProposal({
      proposalId: card.id,
      payload: { revision: card.revision, confirmation: 'confirm' },
    });
    expect(approved.statusCode).toBe(200);
    expect(await helpers.listGoals({ raw: true })).toEqual([]);
    expect(await helpers.getAccounts()).toHaveLength(1);
  });

  it('cannot be approved when it names an account the user does not have', async () => {
    const { cards } = await propose({
      name: 'create_goal',
      args: {
        name: 'Holiday',
        currencyCode: global.BASE_CURRENCY.code,
        targetAmount: 2000,
        accounts: [{ accountId: '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a', sharePercent: 100 }],
      },
    });

    const card = cardFor({ cards, toolName: 'create_goal' });
    expect(card.canApply).toEqual({ ok: false, reasonKey: 'chat.cards.previewFailed' });
    expect(card.error?.messageKey).toBe('chat.cards.targetNotFound');
    expect(card.affected).toBeUndefined();
  });
});
