import { RESOURCE_TYPES, SHARE_PERMISSIONS, TRANSACTIONS_WRITE_SCOPES } from '@bt/shared/types';
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
