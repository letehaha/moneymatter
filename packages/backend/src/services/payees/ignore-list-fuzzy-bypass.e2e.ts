import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const enableNoteExtraction = () =>
  helpers.updateUserSettings({
    settings: { locale: 'en', payeeExtractionUsesDescription: true },
  });

describe('Payee ignore list — linking bypasses', () => {
  it('does not fuzzy-link a transaction to an existing Payee when the incoming name is on the ignored list', async () => {
    await enableNoteExtraction();

    const youtube = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: 'YouTube' }),
      raw: true,
    });
    const ignored = await helpers.addIgnoredName({
      rawName: 'payout',
      raw: true,
    });
    expect(ignored.normalizedName).toBe('payout');

    const account = await helpers.createAccount({ raw: true });
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        note: 'payout',
      }),
      raw: true,
    });

    expect(tx!.payeeId).toBeNull();

    const detail = await helpers.getPayeeById({ id: youtube.id, raw: true });
    expect(detail.aliases ?? []).toHaveLength(0);

    const [tx2] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        note: 'payout',
      }),
      raw: true,
    });
    expect(tx2!.payeeId).toBeNull();

    const persisted = await helpers.getTransactionById({
      id: tx!.id,
      raw: true,
    });
    expect(persisted!.payeeId).toBeNull();

    const payees = await helpers.listPayees({ raw: true });
    expect(payees.find((p) => p.id === youtube.id)).toBeDefined();
  });

  it('does not attach an ignored name to a Payee as an auto-written alias on a fuzzy hit', async () => {
    await enableNoteExtraction();

    const youtube = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: 'YouTube' }),
      raw: true,
    });
    await helpers.addIgnoredName({ rawName: 'payout', raw: true });

    const account = await helpers.createAccount({ raw: true });
    const [tx1] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        note: 'payout',
      }),
      raw: true,
    });

    const detail = await helpers.getPayeeById({ id: youtube.id, raw: true });
    expect(detail.aliases?.some((a) => a.normalizedName === 'payout')).toBe(false);
    expect(tx1!.payeeId).toBeNull();

    // No alias was minted, so the fuzzy haystack stays ['YouTube'] and this
    // second generic verb has nothing close enough to match either.
    const [tx2] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        note: 'payin',
      }),
      raw: true,
    });
    expect(tx2!.payeeId).toBeNull();
  });

  it('does not re-link an ignored name onto a surviving Payee after "delete & ignore"', async () => {
    await enableNoteExtraction();

    const youtube = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: 'YouTube' }),
      raw: true,
    });
    const junk = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: 'payout' }),
      raw: true,
    });

    const result = await helpers.deletePayeeAndIgnore({
      id: junk.id,
      raw: true,
    });
    expect(result.ignoredAddedCount).toBe(1);

    const ignored = await helpers.listIgnoredNames({ raw: true });
    expect(ignored.map((r) => r.normalizedName)).toContain('payout');

    const account = await helpers.createAccount({ raw: true });
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        note: 'payout',
      }),
      raw: true,
    });
    expect(tx!.payeeId).toBeNull();

    const detail = await helpers.getPayeeById({ id: youtube.id, raw: true });
    expect(detail.aliases?.some((a) => a.normalizedName === 'payout')).toBe(false);
  });

  it('does not link, alias or tag a synced row from the post-sync note backfill when the note is on the ignored list', async () => {
    // The Monobank mock connects both external accounts, so the row is synced once per
    // account; threshold 3 keeps the counterparty name below occurrence promotion, leaving
    // the ignored note as the only resolver under test.
    await helpers.updateUserSettings({
      settings: {
        locale: 'en',
        payeeExtractionUsesDescription: true,
        payeePromotionThreshold: 3,
      },
    });

    const autoTag = await helpers.createTag({
      payload: helpers.buildTagPayload({ name: 'Streaming' }),
      raw: true,
    });
    const youtube = await helpers.createPayee({
      payload: helpers.buildPayeePayload({
        name: 'YouTube',
        defaultCategoryId: global.DEFAULT_CATEGORY_ID,
        defaultTagIds: [autoTag.id],
      }),
      raw: true,
    });
    const ignored = await helpers.addIgnoredName({
      rawName: 'payout',
      raw: true,
    });
    expect(ignored.normalizedName).toBe('payout');

    const { account } = await helpers.monobank.mockTransactions({
      transactions: [
        {
          counterName: 'CARD OP 7788',
          description: 'payout',
          amount: -15000,
          time: new Date(),
        },
      ],
    });
    const synced = await helpers.getTransactions({
      accountIds: [account.id],
      raw: true,
    });
    expect(synced).toHaveLength(1);
    expect(synced[0]!.payeeId).toBeNull();

    // The mock helper only waits 2s; the note backfill is debounced by 4s.
    await helpers.sleep(6000);

    const [row] = await helpers.getTransactions({
      accountIds: [account.id],
      raw: true,
    });
    expect(row!.payeeId).toBeNull();

    const detail = await helpers.getPayeeById({ id: youtube.id, raw: true });
    expect((detail.aliases ?? []).some((a) => a.normalizedName === 'payout')).toBe(false);

    expect(row!.tags ?? []).toEqual([]);
  }, 30000);
});
