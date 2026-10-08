import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  type ExternalMonobankTransactionResponse,
  RESOURCE_TYPES,
  type RecordId,
  SHARE_PERMISSIONS,
  type SplitInput,
  TRANSACTIONS_WRITE_SCOPES,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import ResourceShares from '@models/resource-shares.model';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import { FixedTransaction, MOCK_IDENTIFICATION_HASH_1 } from '@tests/mocks/enablebanking/data';
import { MONOBANK_URLS_MOCK, getMonobankTransactionsMock } from '@tests/mocks/monobank/mock-api';
import { addDays, format, startOfDay, subDays } from 'date-fns';
import { HttpResponse, http } from 'msw';

import { DOMAIN_EVENTS, eventBus } from '../../common/event-bus';

const unixSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

const readExternalData = async ({ id }: { id: string }) => {
  const row = await Transactions.findByPk(id);
  return (row!.externalData ?? {}) as {
    plannedMerge?: { mergedAt?: string };
    rawTransaction?: { status?: string };
  };
};

const nonDefaultCategoryId = async () => {
  const categories = await helpers.getCategoriesList();
  const other = categories.find((category) => category.id !== global.DEFAULT_CATEGORY_ID);
  if (!other) throw new Error('Expected the test user to have more than one category');
  return other.id;
};

const syncAccount = async ({
  connectionId,
  accountId,
  transactions,
}: {
  connectionId: string;
  accountId: RecordId;
  transactions: ExternalMonobankTransactionResponse[];
}) => {
  global.mswMockServer.use(getMonobankTransactionsMock({ response: transactions }));

  const { jobGroupId } = await helpers.bankDataProviders.syncTransactionsForAccount({
    connectionId,
    accountId,
    raw: true,
  });

  const result = await helpers.bankDataProviders.waitForSyncJobsToComplete({
    connectionId,
    jobGroupId: jobGroupId!,
    timeoutMs: 20000,
  });
  expect(result.status).toBe('completed');
};

const listAccountTransactions = ({ accountId }: { accountId: RecordId }) =>
  helpers.getTransactions({ accountIds: [accountId], raw: true });

/**
 * Matching requires the provider account to already hold one real transaction. A sync into an
 * account without one counts as an initial pull and never merges.
 */
const anchoredAccount = async ({ anchorTime }: { anchorTime: Date }) => {
  const { account } = await helpers.monobank.mockTransactions({
    transactions: [{ amount: -1234, time: anchorTime, description: 'ANCHOR CHARGE' }],
  });

  const { connections } = await helpers.bankDataProviders.listUserConnections({
    raw: true,
  });
  const connectionId = connections.find((connection) => connection.providerType === BANK_PROVIDER_TYPE.MONOBANK)!.id;

  let seeded = await listAccountTransactions({ accountId: account.id });
  for (let attempt = 0; attempt < 10 && seeded.length === 0; attempt += 1) {
    await helpers.sleep(300);
    seeded = await listAccountTransactions({ accountId: account.id });
  }
  expect(seeded).toHaveLength(1);

  return { connectionId, accountId: account.id };
};

const seedHouseholdMember = async ({ ownerUserId }: { ownerUserId: number }) => {
  const member = await helpers.provisionSecondUserWithBaseCurrency();
  const memberApp = await helpers.findAppUserByEmail({ email: member.email });

  await ResourceShares.create({
    ownerUserId,
    sharedWithUserId: memberApp.id,
    resourceType: RESOURCE_TYPES.household,
    resourceId: String(ownerUserId),
    permission: SHARE_PERMISSIONS.write,
    policy: { transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all },
    acceptedAt: new Date(),
  });

  return member;
};

async function setupConnectionWithAccount(): Promise<{
  connectionId: string;
  accountId: RecordId;
}> {
  const connectResult = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
    credentials: helpers.enablebanking.mockCredentials(),
    raw: true,
  });
  const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);
  await helpers.makeRequest({
    method: 'post',
    url: '/bank-data-providers/enablebanking/oauth-callback',
    payload: {
      connectionId: connectResult.connectionId,
      code: helpers.enablebanking.mockAuthCode,
      state,
    },
  });
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId: connectResult.connectionId,
    accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
    raw: true,
  });
  return {
    connectionId: connectResult.connectionId,
    accountId: syncedAccounts[0]!.id,
  };
}

useSelfHost();

describe('Planned transactions – merge on sync', () => {
  describe('Monobank', () => {
    it('merges the incoming bank transaction into the plan, files its balance history and skips the categorization batch', async () => {
      const now = new Date();
      const anchorTime = subDays(startOfDay(now), 10);
      const { connectionId, accountId } = await anchoredAccount({ anchorTime });

      const categoryId = await nonDefaultCategoryId();
      const [plan] = await helpers.createPlannedTransaction({
        payload: {
          accountId,
          amount: 250,
          time: addDays(startOfDay(now), 2).toISOString(),
          note: 'Rent',
          categoryId,
        },
        raw: true,
      });

      const bankBalance = 54321;
      const mergeDay = subDays(startOfDay(now), 1);
      const plainDay = subDays(startOfDay(now), 2);

      const merging = helpers.monobank.buildTransaction({
        amount: -25000,
        balance: bankBalance,
        time: mergeDay,
        description: 'RENT LANDLORD',
      });
      // Reference value: a plain sync row carrying the same bank balance, converted by the
      // same per-transaction layer the merged row has to reach.
      const plain = helpers.monobank.buildTransaction({
        amount: -777,
        balance: bankBalance,
        time: plainDay,
        description: 'COFFEE',
      });

      const emitSpy = jest.spyOn(eventBus, 'emit');
      let syncedIds: string[] = [];
      try {
        await syncAccount({
          connectionId,
          accountId,
          transactions: [merging, plain],
        });

        syncedIds = emitSpy.mock.calls
          .filter((call) => call[0] === DOMAIN_EVENTS.TRANSACTIONS_SYNCED)
          .flatMap((call) => (call[1] as { transactionIds: string[] }).transactionIds);
      } finally {
        emitSpy.mockRestore();
      }

      const rows = await listAccountTransactions({ accountId });
      expect(rows).toHaveLength(3);

      const plainRow = rows.find((row) => row.originalId === plain.id)!;
      expect(syncedIds).toContain(plainRow.id);
      expect(syncedIds).not.toContain(plan.id);

      const merged = rows.find((row) => row.id === plan.id)!;
      expect(merged.isPlanned).toBe(false);
      expect(merged.accountType).toBe(ACCOUNT_TYPES.monobank);
      expect(merged.categoryId).toBe(categoryId);
      expect(merged.originalId).toBe(merging.id);
      expect(merged.amount).toBe(250);
      expect(merged.note).toBe('Rent | RENT LANDLORD');

      const { plannedMerge } = await readExternalData({ id: plan.id });
      expect(typeof plannedMerge?.mergedAt).toBe('string');

      const history = await helpers.getBalanceHistory({ accountId, raw: true });
      const amountOn = ({ day }: { day: Date }) =>
        history.find((entry) => String(entry.date) === format(day, 'yyyy-MM-dd'))?.amount;

      expect(amountOn({ day: plainDay })).toBeGreaterThan(0);
      expect(amountOn({ day: mergeDay })).toBe(amountOn({ day: plainDay }));

      // TRANSACTIONS_SYNCED listeners run after the sync returns; the user's category must
      // survive them.
      await helpers.sleep(1000);
      expect((await helpers.getTransactionById({ id: plan.id, raw: true }))!.categoryId).toBe(categoryId);
    }, 30000);

    it('carries the bank receipt id onto the merged plan', async () => {
      const now = new Date();
      const anchorTime = subDays(startOfDay(now), 10);
      const { connectionId, accountId } = await anchoredAccount({ anchorTime });

      const [plan] = await helpers.createPlannedTransaction({
        payload: {
          accountId,
          amount: 250,
          time: addDays(startOfDay(now), 2).toISOString(),
          note: 'Rent',
        },
        raw: true,
      });

      const incoming = helpers.monobank.buildTransaction({
        amount: -25000,
        time: subDays(startOfDay(now), 1),
        description: 'RENT LANDLORD',
        receiptId: 'MRGE-1111-2222-3333',
      });
      await syncAccount({ connectionId, accountId, transactions: [incoming] });

      const merged = (await listAccountTransactions({ accountId })).find((row) => row.id === plan.id)!;
      expect(merged.isPlanned).toBe(false);
      expect(merged.externalReference).toBe('MRGE-1111-2222-3333');
    });

    it('keeps the reference the user put on the plan over the bank receipt id', async () => {
      const now = new Date();
      const anchorTime = subDays(startOfDay(now), 10);
      const { connectionId, accountId } = await anchoredAccount({ anchorTime });

      const [plan] = await helpers.createPlannedTransaction({
        payload: {
          accountId,
          amount: 250,
          time: addDays(startOfDay(now), 2).toISOString(),
          note: 'Rent',
          externalReference: 'PLAN-REF',
        },
        raw: true,
      });

      const incoming = helpers.monobank.buildTransaction({
        amount: -25000,
        time: subDays(startOfDay(now), 1),
        description: 'RENT LANDLORD',
        receiptId: 'MRGE-4444-5555-6666',
      });
      await syncAccount({ connectionId, accountId, transactions: [incoming] });

      const merged = (await listAccountTransactions({ accountId })).find((row) => row.id === plan.id)!;
      expect(merged.isPlanned).toBe(false);
      expect(merged.externalReference).toBe('PLAN-REF');
    });

    it('anchors the sync window to the newest real transaction, not to a future-dated plan', async () => {
      const now = new Date();
      const anchorTime = subDays(startOfDay(now), 3);
      const { connectionId, accountId } = await anchoredAccount({ anchorTime });

      const planTime = addDays(startOfDay(now), 10);
      await helpers.createPlannedTransaction({
        payload: {
          accountId,
          amount: 250,
          time: planTime.toISOString(),
          note: 'Future rent',
        },
        raw: true,
      });

      const requestedWindowStarts: number[] = [];
      global.mswMockServer.use(
        http.get(MONOBANK_URLS_MOCK.personalStatement, ({ request }) => {
          const segments = new URL(request.url).pathname.split('/');
          requestedWindowStarts.push(Number(segments[segments.length - 2]));
          return HttpResponse.json([]);
        }),
      );

      const { jobGroupId } = await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId,
        raw: true,
      });
      await helpers.bankDataProviders.waitForSyncJobsToComplete({
        connectionId,
        jobGroupId: jobGroupId!,
        timeoutMs: 20000,
      });

      expect(requestedWindowStarts).toContain(unixSeconds(anchorTime));
      for (const start of requestedWindowStarts) {
        expect(start * 1000).toBeLessThan(planTime.getTime());
      }
    });

    it('keeps exactly one row per originalId when the same window syncs twice', async () => {
      const now = new Date();
      const anchorTime = subDays(startOfDay(now), 10);
      const { connectionId, accountId } = await anchoredAccount({ anchorTime });

      const [plan] = await helpers.createPlannedTransaction({
        payload: {
          accountId,
          amount: 250,
          time: addDays(startOfDay(now), 2).toISOString(),
          note: 'Rent',
        },
        raw: true,
      });

      const incoming = helpers.monobank.buildTransaction({
        amount: -25000,
        time: subDays(startOfDay(now), 1),
        description: 'RENT LANDLORD',
      });

      await syncAccount({ connectionId, accountId, transactions: [incoming] });
      await syncAccount({ connectionId, accountId, transactions: [incoming] });

      const rows = await listAccountTransactions({ accountId });
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.originalId === incoming.id)).toHaveLength(1);
      expect(rows.find((row) => row.id === plan.id)!.isPlanned).toBe(false);
    });

    it('does not merge when the historical backfill endpoint loads the period', async () => {
      const now = new Date();
      const anchorTime = subDays(startOfDay(now), 10);
      const { connectionId, accountId } = await anchoredAccount({ anchorTime });

      const [plan] = await helpers.createPlannedTransaction({
        payload: {
          accountId,
          amount: 250,
          time: addDays(startOfDay(now), 2).toISOString(),
          note: 'Rent',
        },
        raw: true,
      });

      const incoming = helpers.monobank.buildTransaction({
        amount: -25000,
        time: subDays(startOfDay(now), 1),
        description: 'RENT LANDLORD',
      });
      global.mswMockServer.use(getMonobankTransactionsMock({ response: [incoming] }));

      const { jobGroupId } = await helpers.bankDataProviders.loadTransactionsForPeriod({
        connectionId,
        accountId,
        from: subDays(startOfDay(now), 5).toISOString(),
        to: now.toISOString(),
        raw: true,
      });
      await helpers.bankDataProviders.waitForSyncJobsToComplete({
        connectionId,
        jobGroupId,
        timeoutMs: 20000,
      });

      const rows = await listAccountTransactions({ accountId });
      expect(rows).toHaveLength(3);
      expect(rows.find((row) => row.id === plan.id)!.isPlanned).toBe(true);
      expect(rows.find((row) => row.originalId === incoming.id)!.id).not.toBe(plan.id);
    });

    describe('shared accounts', () => {
      it('hides the owner plan from a member until the sync turns it into a real row', async () => {
        const now = new Date();
        const anchorTime = subDays(startOfDay(now), 10);
        const { connectionId, accountId } = await anchoredAccount({
          anchorTime,
        });

        const account = await helpers.getAccount({ id: accountId, raw: true });
        const member = await seedHouseholdMember({
          ownerUserId: account.userId,
        });

        const [plan] = await helpers.createPlannedTransaction({
          payload: {
            accountId,
            amount: 250,
            time: addDays(startOfDay(now), 2).toISOString(),
            note: 'Rent',
          },
          raw: true,
        });

        const beforeSync = await helpers.asUser({
          cookies: member.cookies,
          fn: () => listAccountTransactions({ accountId }),
        });
        expect(beforeSync.map((row) => row.id)).not.toContain(plan.id);

        const incoming = helpers.monobank.buildTransaction({
          amount: -25000,
          time: subDays(startOfDay(now), 1),
          description: 'RENT LANDLORD',
        });
        await syncAccount({
          connectionId,
          accountId,
          transactions: [incoming],
        });

        const afterSync = await helpers.asUser({
          cookies: member.cookies,
          fn: () => listAccountTransactions({ accountId }),
        });
        const visible = afterSync.find((row) => row.id === plan.id);
        expect(visible).toBeDefined();
        expect(visible!.isPlanned).toBe(false);
        expect(visible!.originalId).toBe(incoming.id);
      });
    });
  });

  describe('Enable Banking', () => {
    beforeEach(() => {
      helpers.enablebanking.resetSessionCounter();
    });

    afterEach(() => {
      helpers.enablebanking.resetTransactionConfig();
    });

    const CARD = {
      currency: 'EUR',
      isExpense: true,
      counterpartyIban: null,
    } as const;

    const ANCHOR: FixedTransaction = {
      ...CARD,
      status: 'BOOK',
      amount: '99.00',
      bookingDate: '2025-10-01',
      entryReference: 'planned_anchor_ref',
      remittanceInformation: ['ANCHOR CHARGE'],
    };

    // No entry_reference: the card-hold shape Enable Banking's pending-upgrade tier is
    // built for, and the one where the booked copy arrives under a fresh id.
    const PENDING: FixedTransaction = {
      ...CARD,
      status: 'PDNG',
      amount: '50.00',
      transactionDate: '2025-10-20',
      remittanceInformation: ['CARD HOLD'],
    };

    const PLAN_TIME = '2025-10-22T00:00:00.000Z';

    /**
     * One booked row (the anchor that unlocks matching), one plan, then the pending payload
     * that confirms it. Returns the merged row id.
     */
    const mergePendingIntoPlan = async ({ splits }: { splits?: SplitInput[] } = {}) => {
      await helpers.patchUserSettings({ patch: { importPendingBankTransactions: true }, raw: true });
      helpers.enablebanking.setFixedTransactions([ANCHOR]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      expect(await listAccountTransactions({ accountId })).toHaveLength(1);

      const [plan] = await helpers.createPlannedTransaction({
        payload: {
          accountId,
          amount: 50,
          time: PLAN_TIME,
          note: 'Season ticket',
          splits,
        },
        raw: true,
      });

      helpers.enablebanking.setFixedTransactions([PENDING]);
      await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId,
        raw: true,
      });

      const rows = await listAccountTransactions({ accountId });
      expect(rows).toHaveLength(2);
      const merged = rows.find((row) => row.id === plan.id)!;
      expect(merged.isPlanned).toBe(false);
      expect(merged.amount).toBe(50);
      expect((await readExternalData({ id: plan.id })).plannedMerge?.mergedAt).toBeTruthy();

      return { connectionId, accountId, planId: plan.id };
    };

    it('deletes a bare merged row when the bank cancels the pending payment', async () => {
      const { connectionId, accountId, planId } = await mergePendingIntoPlan();

      helpers.enablebanking.setFixedTransactions([{ ...PENDING, status: 'CNCL' }]);
      await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId,
        raw: true,
      });

      expect(await Transactions.findByPk(planId)).toBeNull();
      const rows = await listAccountTransactions({ accountId });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.note).toBe('ANCHOR CHARGE');
    });

    it('keeps a cancelled merged row that carried the plan splits', async () => {
      const categories = await helpers.getCategoriesList();
      const { connectionId, accountId, planId } = await mergePendingIntoPlan({
        splits: [{ categoryId: categories[1]!.id, amount: 20 }],
      });

      helpers.enablebanking.setFixedTransactions([{ ...PENDING, status: 'CNCL' }]);
      await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId,
        raw: true,
      });

      const survivor = await helpers.getTransactionById({
        id: planId,
        includeSplits: true,
        raw: true,
      });
      expect(survivor).not.toBeNull();
      expect(survivor!.isPlanned).toBe(false);
      expect(survivor!.splits).toHaveLength(1);
      expect(await listAccountTransactions({ accountId })).toHaveLength(2);
    });

    it('upgrades the merged row in place when the booked copy arrives', async () => {
      const { connectionId, accountId, planId } = await mergePendingIntoPlan();

      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD,
          status: 'BOOK',
          amount: '50.00',
          bookingDate: '2025-10-21',
          entryReference: 'planned_settled_ref',
          remittanceInformation: ['CARD SETTLED'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId,
        raw: true,
      });

      const rows = await listAccountTransactions({ accountId });
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.id)).toContain(planId);

      const externalData = await readExternalData({ id: planId });
      expect(externalData.rawTransaction?.status).toBe('BOOK');
      expect(externalData.plannedMerge?.mergedAt).toBeTruthy();
    });

    it('lands a booked payment with a different amount as its own row', async () => {
      const { connectionId, accountId, planId } = await mergePendingIntoPlan();

      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD,
          status: 'BOOK',
          amount: '58.50',
          bookingDate: '2025-10-21',
          entryReference: 'planned_booked_ref',
          remittanceInformation: ['CARD CAPTURE'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId,
        raw: true,
      });

      const rows = await listAccountTransactions({ accountId });
      expect(rows).toHaveLength(3);

      const merged = rows.find((row) => row.id === planId)!;
      expect(merged.amount).toBe(50);
      expect(merged.isPlanned).toBe(false);
      expect((await readExternalData({ id: planId })).plannedMerge?.mergedAt).toBeTruthy();

      const booked = rows.find((row) => row.note === 'CARD CAPTURE')!;
      expect(booked.id).not.toBe(planId);
      expect(booked.amount).toBe(58.5);
    });
  });
});
