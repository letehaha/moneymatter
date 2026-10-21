import {
  ACCOUNT_TYPES,
  API_ERROR_CODES,
  BANK_PROVIDER_TYPE,
  type ExternalMonobankTransactionResponse,
  type LinkResidualTarget,
  type RecordId,
  SUBSCRIPTION_FREQUENCIES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
  asCents,
  asDecimal,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import Transactions from '@models/transactions.model';
import { redisClient } from '@root/redis-client';
import { REDIS_KEYS, SyncStatus } from '@services/bank-data-providers/sync/sync-status-tracker';
import * as helpers from '@tests/helpers';
import { getMockedLunchFlowTransactions } from '@tests/mocks/lunchflow/data';
import {
  VALID_LUNCHFLOW_API_KEY,
  getLunchFlowBalanceMock,
  getLunchFlowTransactionsMock,
} from '@tests/mocks/lunchflow/mock-api';
import { MONOBANK_URLS_MOCK, getMonobankTransactionsMock } from '@tests/mocks/monobank/mock-api';
import { format, subDays, subMinutes, subYears } from 'date-fns';
import { HttpResponse, http } from 'msw';
import { Op } from 'sequelize';

/**
 * Linking force-writes the bank balance and, by default, moves the unexplained
 * residual into the opening balance without minting a "Balance adjustment" row.
 * With `residualTarget: 'adjustment'` one such row dated at the link carries the
 * residual instead and the opening balance stays put. Forward-only rule:
 * pre-link statement rows are never imported over manual history, whose bank
 * copies dedup cannot recognize. Only an account with no rows backfills.
 * Invariant checked throughout: initialBalance + Σsigned(tx) === currentBalance.
 */

const LUNCHFLOW_EXTERNAL_ACCOUNT_ID = '1001';

const extractError = (response: unknown) =>
  (response as helpers.CustomResponse<unknown>).body.response as unknown as { code: string; message: string };

/** Bank-reported balance, in dollars (LunchFlow account 1001 is USD). */
const mockBankBalance = ({ amount }: { amount: number }) =>
  getLunchFlowBalanceMock({
    accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
    response: { balance: { amount: asDecimal(amount), currency: 'USD' } },
  });

// The list reads raw rows, so `amount` is the DECIMAL column's exact string.
const sumSignedCents = (transactions: Transactions[]) =>
  transactions.reduce((acc, tx) => {
    const cents = Money.fromDecimal(tx.amount as unknown as string).toCents();
    return acc + (tx.transactionType === 'income' ? cents : -cents);
  }, 0);

const filterBalanceAdjustments = (transactions: Transactions[]) =>
  transactions.filter((tx) => (tx.externalData as { balanceAdjustment?: boolean } | null)?.balanceAdjustment === true);

const readReconciliation = (account: Accounts) => account.externalData!.bankConnection!.balanceReconciliation;

const readPreTodayBalanceRows = async ({ accountId }: { accountId: string }) => {
  const rows = await Balances.findAll({
    where: { accountId, date: { [Op.lt]: format(new Date(), 'yyyy-MM-dd') } },
    order: [['date', 'ASC']],
  });
  return rows.map((row) => ({ date: new Date(row.date).toISOString(), amountCents: row.amount.toCents() }));
};

/** Seeds a manual expense 10 days back so the account has Balances history before the link day. */
const seedManualHistory = async ({ accountId, amount }: { accountId: RecordId; amount: number }) => {
  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount,
      transactionType: TRANSACTION_TYPES.expense,
      time: subDays(new Date(), 10).toISOString(),
    }),
    raw: true,
  });
  return readPreTodayBalanceRows({ accountId });
};

const setupLinkedScenario = async ({
  initialBalance,
  bankBalance,
  bankTransactions,
  beforeLink,
  residualTarget,
}: {
  initialBalance: number;
  bankBalance: number;
  bankTransactions: ReturnType<typeof getMockedLunchFlowTransactions>;
  residualTarget?: LinkResidualTarget;
  /** Seeds account state (e.g. manual transactions) between creation and linking. */
  beforeLink?: ({ accountId }: { accountId: Accounts['id'] }) => Promise<void>;
}) => {
  await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });

  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({
      name: 'Linkable system account',
      currencyCode: 'USD',
      initialBalance,
    }),
    raw: true,
  });

  if (beforeLink) await beforeLink({ accountId: account.id });

  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
    credentials: { apiKey: VALID_LUNCHFLOW_API_KEY },
    raw: true,
  });

  global.mswMockServer.use(
    getLunchFlowTransactionsMock({ response: bankTransactions, accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID }),
    mockBankBalance({ amount: bankBalance }),
  );

  const preLinkAccount = (await Accounts.findByPk(account.id))!;

  const linkResponse = await helpers.linkAccountToBankConnection({
    id: account.id,
    connectionId,
    externalAccountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
    residualTarget,
    raw: false,
  });
  expect(linkResponse.statusCode).toBe(200);

  return { account, preLinkAccount, connectionId };
};

const readTodayBalanceRow = async ({ accountId }: { accountId: string }) =>
  Balances.findOne({ where: { accountId, date: format(new Date(), 'yyyy-MM-dd') } });

describe('Balance reconciliation when linking account to a bank connection', () => {
  it('does not create an adjustment transaction when the gap is fully explained by synced transactions', async () => {
    // Bank: 1000 (matches system balance) + 100 income from the gap = 1100.
    const bankTransactions = getMockedLunchFlowTransactions(1);
    bankTransactions.transactions[0]!.amount = asDecimal(100);
    bankTransactions.transactions[0]!.date = subDays(new Date(), 1).toISOString();

    const { account } = await setupLinkedScenario({
      initialBalance: 1000,
      bankBalance: 1100,
      bankTransactions,
    });

    const updatedAccount = (await Accounts.findByPk(account.id))!;
    const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

    // The gap income must be synced exactly once.
    const syncedIncomes = transactions.filter((tx) => tx.originalId !== null);
    expect(syncedIncomes.length).toBe(1);

    const adjustments = transactions.filter(
      (tx) => tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    );
    expect(adjustments.length).toBe(0);

    expect(updatedAccount.currentBalance.toNumber()).toBe(1100);
    expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
      updatedAccount.currentBalance.toCents(),
    );
  });

  it('absorbs a residual difference into initialBalance when the bank returns no transactions', async () => {
    const { account, preLinkAccount } = await setupLinkedScenario({
      initialBalance: 1000,
      bankBalance: 1100,
      bankTransactions: { transactions: [], total: 0 },
    });

    const updatedAccount = (await Accounts.findByPk(account.id))!;
    const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

    const adjustments = transactions.filter(
      (tx) => tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    );
    expect(adjustments.length).toBe(0);

    expect(readReconciliation(updatedAccount).residualTarget).toBe('opening-balance');
    expect(updatedAccount.currentBalance.toNumber()).toBe(1100);
    // The unexplainable +100 must land in initialBalance, not in a visible row.
    expect(updatedAccount.initialBalance.toNumber()).toBe(1100);
    expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
      updatedAccount.currentBalance.toCents(),
    );

    // The USD opening balance moved, so its base-currency stamp must be re-derived
    // rather than left on the pre-link value.
    expect(updatedAccount.refInitialBalance).not.toBeNull();
    expect(updatedAccount.refInitialBalance.toCents()).not.toBe(preLinkAccount.refInitialBalance.toCents());
    expect(updatedAccount.refInitialBalance.toCents()).toBeGreaterThan(preLinkAccount.refInitialBalance.toCents());

    // The restamp cascade shifts every Balances row, including today's, which
    // the sync pinned to the bank's authoritative balance. It must stay pinned.
    const todayRow = await readTodayBalanceRow({ accountId: account.id });
    expect(todayRow).not.toBeNull();
    expect(todayRow!.amount.toCents()).toBe(updatedAccount.refCurrentBalance.toCents());
  });

  it('absorbs the whole pre-link gap without importing pre-link bank history over manual rows', async () => {
    // Manual history: 1000 opening − 200 expense + 50 income = 850 tracked.
    // The bank reports 1200 plus a +100 row from yesterday. Forward-only
    // linking must not import that pre-link row (the manual ledger owns
    // pre-link history, whose bank copies dedup cannot recognize), so the
    // full 350 gap moves to the opening balance.
    let manualRowsBefore: Transactions[] = [];

    const bankTransactions = getMockedLunchFlowTransactions(1);
    bankTransactions.transactions[0]!.amount = asDecimal(100);
    bankTransactions.transactions[0]!.date = subDays(new Date(), 1).toISOString();

    const { account } = await setupLinkedScenario({
      initialBalance: 1000,
      bankBalance: 1200,
      bankTransactions,
      beforeLink: async ({ accountId }) => {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId,
            amount: 200,
            transactionType: TRANSACTION_TYPES.expense,
            time: subDays(new Date(), 10).toISOString(),
          }),
          raw: true,
        });
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId,
            amount: 50,
            transactionType: TRANSACTION_TYPES.income,
            time: subDays(new Date(), 5).toISOString(),
          }),
          raw: true,
        });
        manualRowsBefore = await Transactions.findAll({ where: { accountId }, raw: true });
      },
    });

    const updatedAccount = (await Accounts.findByPk(account.id))!;
    const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

    const syncedRows = transactions.filter((tx) => tx.originalId !== null);
    expect(syncedRows.length).toBe(0);

    // The manual rows must survive the link untouched.
    const manualRowsAfter = transactions.filter((tx) => tx.originalId === null);
    expect(manualRowsAfter.length).toBe(2);
    expect(manualRowsBefore.length).toBe(2);
    for (const before of manualRowsBefore) {
      const after = manualRowsAfter.find((tx) => tx.id === before.id);
      expect(after).toBeDefined();
      expect(after!.time).toEqual(before.time);
      expect(Number(after!.amount)).toBe(Number(before.amount));
      expect(after!.transactionType).toBe(before.transactionType);
      expect(after!.transferNature).toBe(before.transferNature);
    }

    expect(updatedAccount.currentBalance.toNumber()).toBe(1200);
    expect(updatedAccount.initialBalance.toNumber()).toBe(1350);
    expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
      updatedAccount.currentBalance.toCents(),
    );
  });

  it('does not duplicate a manually-logged purchase whose bank timestamp falls inside the pre-link window', async () => {
    // The user logged the purchase at T; the bank stamped its copy at T+30m
    // (backdated entry or settlement delay). Forward-only linking must not
    // re-import the bank's copy: the pre-link gap belongs to the opening
    // balance, not to a duplicated row.
    const manualTime = subMinutes(new Date(), 180);
    const bankTime = subMinutes(new Date(), 150);

    const bankTransactions = getMockedLunchFlowTransactions(1);
    bankTransactions.transactions[0]!.amount = asDecimal(-30);
    bankTransactions.transactions[0]!.date = bankTime.toISOString();

    const { account } = await setupLinkedScenario({
      initialBalance: 1000,
      bankBalance: 1200,
      bankTransactions,
      beforeLink: async ({ accountId }) => {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId,
            amount: 30,
            transactionType: TRANSACTION_TYPES.expense,
            time: manualTime.toISOString(),
          }),
          raw: true,
        });
      },
    });

    const updatedAccount = (await Accounts.findByPk(account.id))!;
    const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

    // Only the manual row must exist: the bank's copy of the same purchase
    // must not have been imported as a second row.
    expect(transactions.length).toBe(1);
    expect(transactions.filter((tx) => tx.originalId !== null).length).toBe(0);

    expect(updatedAccount.currentBalance.toNumber()).toBe(1200);
    // Tracked state was 1000 − 30 = 970, bank says 1200: the whole 230 gap is
    // opening-balance history the provider never handed us.
    expect(updatedAccount.initialBalance.toNumber()).toBe(1230);
    expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
      updatedAccount.currentBalance.toCents(),
    );
  });

  it('keeps the ledger intact across an unlink → relink cycle with unchanged bank state', async () => {
    const bankTransactions = getMockedLunchFlowTransactions(1);
    bankTransactions.transactions[0]!.amount = asDecimal(100);
    bankTransactions.transactions[0]!.date = subDays(new Date(), 1).toISOString();

    const { account } = await setupLinkedScenario({
      initialBalance: 1000,
      bankBalance: 1100,
      bankTransactions,
    });

    await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: true });

    const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
    global.mswMockServer.use(
      getLunchFlowTransactionsMock({ response: bankTransactions, accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID }),
      mockBankBalance({ amount: 1100 }),
    );

    const relinkResponse = await helpers.linkAccountToBankConnection({
      id: account.id,
      connectionId: connections[0]!.id,
      externalAccountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
      raw: false,
    });
    expect(relinkResponse.statusCode).toBe(200);

    const updatedAccount = (await Accounts.findByPk(account.id))!;
    const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

    const adjustments = transactions.filter(
      (tx) => tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    );
    expect(adjustments.length).toBe(0);

    // The gap income must not be duplicated by the relink sync.
    const nonAdjustment = transactions.filter(
      (tx) => tx.transferNature !== TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    );
    expect(nonAdjustment.length).toBe(1);

    expect(updatedAccount.currentBalance.toNumber()).toBe(1100);
    expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
      updatedAccount.currentBalance.toCents(),
    );
  });

  it('turns off auto-record on subscriptions booked to the linked account', async () => {
    let subscriptionId = '';
    await setupLinkedScenario({
      initialBalance: 1000,
      bankBalance: 1000,
      bankTransactions: { transactions: [], total: 0 },
      beforeLink: async ({ accountId }) => {
        const today = format(new Date(), 'yyyy-MM-dd');
        const subscription = await helpers.createSubscription({
          name: 'Auto-recorded',
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: today,
          dueDate: today,
          accountId,
          expectedAmount: 10,
          expectedCurrencyCode: 'USD',
          autoRecord: true,
          raw: true,
        });
        expect(subscription.autoRecord).toBe(true);
        subscriptionId = subscription.id;
      },
    });

    const subscription = await helpers.getSubscriptionById({ id: subscriptionId, raw: true });
    expect(subscription.autoRecord).toBe(false);
  });

  describe("residualTarget: 'adjustment'", () => {
    it('records the residual as one adjustment row at the link time and leaves the opening balance alone', async () => {
      // Tracked 1000 − 50 = 950, bank says 900: a −50 residual the sync cannot explain.
      let preLinkBalanceRows: Awaited<ReturnType<typeof readPreTodayBalanceRows>> = [];

      const { account } = await setupLinkedScenario({
        initialBalance: 1000,
        bankBalance: 900,
        bankTransactions: { transactions: [], total: 0 },
        residualTarget: 'adjustment',
        beforeLink: async ({ accountId }) => {
          preLinkBalanceRows = await seedManualHistory({ accountId, amount: 50 });
        },
      });

      const updatedAccount = (await Accounts.findByPk(account.id))!;
      const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });
      const reconciliation = readReconciliation(updatedAccount);

      const adjustments = filterBalanceAdjustments(transactions);
      expect(adjustments.length).toBe(1);
      const adjustment = adjustments[0]!;
      expect(adjustment.transactionType).toBe(TRANSACTION_TYPES.expense);
      expect(Money.fromDecimal(adjustment.amount as unknown as string).toCents()).toBe(5_000);
      expect(adjustment.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
      expect(new Date(adjustment.time).toISOString()).toBe(updatedAccount.externalData!.bankConnection!.linkedAt);

      expect(reconciliation.residualTarget).toBe('adjustment');
      expect(reconciliation.adjustmentTransactionId).toBe(adjustment.id);
      expect(reconciliation).not.toHaveProperty('absorbedResidual');

      expect(updatedAccount.initialBalance.toNumber()).toBe(1000);
      expect(updatedAccount.currentBalance.toNumber()).toBe(900);
      expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
        updatedAccount.currentBalance.toCents(),
      );

      expect(preLinkBalanceRows.length).toBeGreaterThan(0);
      expect(await readPreTodayBalanceRows({ accountId: account.id })).toEqual(
        expect.arrayContaining(preLinkBalanceRows),
      );

      const todayRow = await readTodayBalanceRow({ accountId: account.id });
      expect(todayRow!.amount.toCents()).toBe(updatedAccount.refCurrentBalance.toCents());
    });

    it('creates no adjustment row when the synced transactions explain the whole gap', async () => {
      const bankTransactions = getMockedLunchFlowTransactions(1);
      bankTransactions.transactions[0]!.amount = asDecimal(100);
      bankTransactions.transactions[0]!.date = subDays(new Date(), 1).toISOString();

      const { account } = await setupLinkedScenario({
        initialBalance: 1000,
        bankBalance: 1100,
        bankTransactions,
        residualTarget: 'adjustment',
      });

      const updatedAccount = (await Accounts.findByPk(account.id))!;
      const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });
      const reconciliation = readReconciliation(updatedAccount);

      expect(transactions.filter((tx) => tx.originalId !== null).length).toBe(1);
      expect(filterBalanceAdjustments(transactions).length).toBe(0);
      expect(reconciliation.residualTarget).toBe('adjustment');
      expect(reconciliation.adjustmentTransactionId).toBeNull();

      expect(updatedAccount.initialBalance.toNumber()).toBe(1000);
      expect(updatedAccount.currentBalance.toNumber()).toBe(1100);
      expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
        updatedAccount.currentBalance.toCents(),
      );
    });

    it('keeps exactly one adjustment row across an unlink → relink cycle with unchanged bank state', async () => {
      const { account } = await setupLinkedScenario({
        initialBalance: 1000,
        bankBalance: 1100,
        bankTransactions: { transactions: [], total: 0 },
        residualTarget: 'adjustment',
      });

      await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: true });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      global.mswMockServer.use(
        getLunchFlowTransactionsMock({
          response: { transactions: [], total: 0 },
          accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
        }),
        mockBankBalance({ amount: 1100 }),
      );

      const relinkResponse = await helpers.linkAccountToBankConnection({
        id: account.id,
        connectionId: connections[0]!.id,
        externalAccountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
        residualTarget: 'adjustment',
        raw: false,
      });
      expect(relinkResponse.statusCode).toBe(200);

      const updatedAccount = (await Accounts.findByPk(account.id))!;
      const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

      const adjustments = filterBalanceAdjustments(transactions);
      expect(adjustments.length).toBe(1);
      expect(adjustments[0]!.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(Money.fromDecimal(adjustments[0]!.amount as unknown as string).toCents()).toBe(10_000);
      expect(readReconciliation(updatedAccount).adjustmentTransactionId).toBeNull();

      expect(updatedAccount.initialBalance.toNumber()).toBe(1000);
      expect(updatedAccount.currentBalance.toNumber()).toBe(1100);
      expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
        updatedAccount.currentBalance.toCents(),
      );
    });

    it('rejects an unknown residualTarget and leaves the account unlinked', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'USD', initialBalance: 1000 }),
        raw: true,
      });
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
        credentials: { apiKey: VALID_LUNCHFLOW_API_KEY },
        raw: true,
      });

      const response = await helpers.linkAccountToBankConnection({
        id: account.id,
        connectionId,
        externalAccountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
        residualTarget: 'foo' as LinkResidualTarget,
        raw: false,
      });

      expect(response.statusCode).toBe(422);
      expect(extractError(response).code).toBe(API_ERROR_CODES.validationError);

      const unchanged = await helpers.getAccount({ id: account.id, raw: true });
      expect(unchanged.type).toBe(ACCOUNT_TYPES.system);
      expect(unchanged.bankDataProviderConnectionId).toBeNull();

      const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });
      expect(filterBalanceAdjustments(transactions).length).toBe(0);
    });
  });

  // Monobank linking enqueues a BullMQ job and returns, so the reconciliation
  // contract must hold across the async boundary: bank balance at link time,
  // residual absorb after the worker finishes.
  describe('queued provider (Monobank)', () => {
    const MONOBANK_EXTERNAL_ID = 'linkable-mono-account';

    /** UAH client-info override with a controlled bank balance, in cents. */
    const mockMonobankClientInfo = ({
      balanceCents,
      creditLimitCents = 0,
    }: {
      balanceCents: number;
      creditLimitCents?: number;
    }) =>
      http.get(MONOBANK_URLS_MOCK.clientInfo, () =>
        HttpResponse.json({
          clientId: 'link-test-client',
          name: 'Link Test User',
          webHookUrl: '',
          permissions: '',
          accounts: [
            {
              id: MONOBANK_EXTERNAL_ID,
              sendId: 'link-test-send-id',
              balance: asCents(balanceCents),
              creditLimit: asCents(creditLimitCents),
              type: 'black',
              currencyCode: 980,
              cashbackType: 'Miles',
              maskedPan: [],
              iban: 'UA000000000000000000000000000',
            },
          ],
          jars: [],
        }),
      );

    const buildBankStatementTx = ({
      id,
      time,
      amountCents,
      balanceCents,
    }: {
      id: string;
      time: Date;
      amountCents: number;
      balanceCents: number;
    }): ExternalMonobankTransactionResponse => ({
      id,
      time: Math.floor(time.getTime() / 1000),
      description: 'Statement row',
      mcc: 4829,
      originalMcc: 4829,
      hold: false,
      amount: asCents(amountCents),
      operationAmount: asCents(amountCents),
      currencyCode: 980,
      commissionRate: asCents(0),
      cashbackAmount: asCents(0),
      balance: asCents(balanceCents),
      comment: '',
      receiptId: '',
      invoiceId: '',
      counterEdrpou: '',
      counterIban: '',
      counterName: 'Link Test Counterparty',
    });

    /** The queued sync settles out-of-request; poll Redis for a terminal status. */
    const waitForQueuedSyncToSettle = async ({
      accountId,
      timeoutMs = 15_000,
    }: {
      accountId: string;
      timeoutMs?: number;
    }): Promise<SyncStatus> => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const raw = await redisClient.get(REDIS_KEYS.accountSyncStatus(accountId));
        if (raw) {
          const { status } = JSON.parse(raw) as { status: SyncStatus };
          if (status === SyncStatus.COMPLETED || status === SyncStatus.FAILED) return status;
        }
        await helpers.sleep(150);
      }
      throw new Error(`Queued Monobank sync did not settle within ${timeoutMs}ms for account ${accountId}`);
    };

    const setupMonobankLink = async ({
      initialBalance,
      creditLimit = 0,
      bankBalanceCents,
      bankCreditLimitCents = 0,
      bankStatement,
      apiToken,
      beforeLink,
      residualTarget,
    }: {
      initialBalance: number;
      creditLimit?: number;
      bankBalanceCents: number;
      bankCreditLimitCents?: number;
      bankStatement: ExternalMonobankTransactionResponse[];
      residualTarget?: LinkResidualTarget;
      /** Unique per test: token hash keys the BullMQ queue lane and the client-info cache. */
      apiToken: string;
      beforeLink?: ({ accountId }: { accountId: Accounts['id'] }) => Promise<void>;
    }) => {
      await helpers.addUserCurrencies({ currencyCodes: ['UAH'], raw: true });

      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          name: 'Linkable Monobank account',
          currencyCode: 'UAH',
          initialBalance,
          creditLimit,
        }),
        raw: true,
      });

      if (beforeLink) await beforeLink({ accountId: account.id });

      global.mswMockServer.use(
        mockMonobankClientInfo({ balanceCents: bankBalanceCents, creditLimitCents: bankCreditLimitCents }),
        getMonobankTransactionsMock({ response: bankStatement, respectDateRange: true }),
      );

      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken },
        raw: true,
      });

      const linkResponse = await helpers.linkAccountToBankConnection({
        id: account.id,
        connectionId,
        externalAccountId: MONOBANK_EXTERNAL_ID,
        residualTarget,
        raw: false,
      });
      expect(linkResponse.statusCode).toBe(200);

      const settled = await waitForQueuedSyncToSettle({ accountId: account.id });
      expect(settled).toBe(SyncStatus.COMPLETED);

      return { account };
    };

    it('updates the balance to the bank figure when the sync window returns no transactions', async () => {
      // Dormant account: the statement window returns zero rows, and the bank
      // balance must still land.
      const { account } = await setupMonobankLink({
        initialBalance: 900,
        bankBalanceCents: 100_000,
        bankStatement: [],
        apiToken: 'link-mono-token-stale-balance',
      });

      const updatedAccount = (await Accounts.findByPk(account.id))!;
      const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

      expect(transactions.length).toBe(0);
      expect(updatedAccount.currentBalance.toNumber()).toBe(1000);
      // The unexplainable +100 must land in the opening balance.
      expect(updatedAccount.initialBalance.toNumber()).toBe(1000);
      expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
        updatedAccount.currentBalance.toCents(),
      );
    });

    it('does not re-import a manually-logged purchase whose bank timestamp falls inside the pre-link window', async () => {
      // Manual row at T, the bank's copy stamped T+30m. Dedup by originalId
      // cannot catch it (manual rows have none), so the sync window must not
      // reach back past the link.
      const manualTime = subMinutes(new Date(), 180);
      const bankTime = subMinutes(new Date(), 150);

      const { account } = await setupMonobankLink({
        initialBalance: 1000,
        bankBalanceCents: 120_000,
        bankStatement: [
          buildBankStatementTx({
            id: 'bank-copy-of-manual-row',
            time: bankTime,
            amountCents: -5_000,
            balanceCents: 120_000,
          }),
        ],
        apiToken: 'link-mono-token-duplicates',
        beforeLink: async ({ accountId }) => {
          await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId,
              amount: 50,
              transactionType: TRANSACTION_TYPES.expense,
              time: manualTime.toISOString(),
            }),
            raw: true,
          });
        },
      });

      const updatedAccount = (await Accounts.findByPk(account.id))!;
      const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

      expect(transactions.length).toBe(1);
      expect(transactions.filter((tx) => tx.originalId !== null).length).toBe(0);

      expect(updatedAccount.currentBalance.toNumber()).toBe(1200);
      // Tracked 1000 − 50 = 950 against the bank's 1200: the 250 gap is
      // pre-link history, absorbed into the opening balance.
      expect(updatedAccount.initialBalance.toNumber()).toBe(1250);
      expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
        updatedAccount.currentBalance.toCents(),
      );
    });

    it('keeps the ledger identity when the backfill imports transactions on an empty account', async () => {
      // Empty account: the sync backfills history and force-writes the bank
      // balance from the newest row; the absorb must then explain the rest via
      // the opening balance after the worker finishes, not before.
      const { account } = await setupMonobankLink({
        initialBalance: 500,
        bankBalanceCents: 100_000,
        bankStatement: [
          buildBankStatementTx({
            id: 'backfilled-income',
            time: subDays(new Date(), 5),
            amountCents: 20_000,
            balanceCents: 100_000,
          }),
        ],
        apiToken: 'link-mono-token-backfill',
      });

      const updatedAccount = (await Accounts.findByPk(account.id))!;
      const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

      expect(transactions.length).toBe(1);
      expect(transactions[0]!.originalId).toBe('backfilled-income');

      expect(updatedAccount.currentBalance.toNumber()).toBe(1000);
      // 1000 bank − 200 imported = 800 of opening-balance history.
      expect(updatedAccount.initialBalance.toNumber()).toBe(800);
      expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
        updatedAccount.currentBalance.toCents(),
      );
    });

    it("records the residual as one adjustment row once the queue finishes when residualTarget is 'adjustment'", async () => {
      // Tracked 1000 − 50 = 950, bank says 1000: a +50 residual.
      let preLinkBalanceRows: Awaited<ReturnType<typeof readPreTodayBalanceRows>> = [];

      const { account } = await setupMonobankLink({
        initialBalance: 1000,
        bankBalanceCents: 100_000,
        bankStatement: [],
        apiToken: 'link-mono-token-adjustment',
        residualTarget: 'adjustment',
        beforeLink: async ({ accountId }) => {
          preLinkBalanceRows = await seedManualHistory({ accountId, amount: 50 });
        },
      });

      const updatedAccount = (await Accounts.findByPk(account.id))!;
      const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });
      const reconciliation = readReconciliation(updatedAccount);

      const adjustments = filterBalanceAdjustments(transactions);
      expect(adjustments.length).toBe(1);
      expect(adjustments[0]!.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(Money.fromDecimal(adjustments[0]!.amount as unknown as string).toCents()).toBe(5_000);
      expect(new Date(adjustments[0]!.time).toISOString()).toBe(updatedAccount.externalData!.bankConnection!.linkedAt);

      expect(reconciliation.pendingAbsorb).toBe(false);
      expect(reconciliation.adjustmentTransactionId).toBe(adjustments[0]!.id);
      expect(reconciliation).not.toHaveProperty('absorbedResidual');

      expect(updatedAccount.initialBalance.toNumber()).toBe(1000);
      expect(updatedAccount.currentBalance.toNumber()).toBe(1000);
      expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
        updatedAccount.currentBalance.toCents(),
      );

      expect(preLinkBalanceRows.length).toBeGreaterThan(0);
      expect(await readPreTodayBalanceRows({ accountId: account.id })).toEqual(
        expect.arrayContaining(preLinkBalanceRows),
      );

      const todayRow = await readTodayBalanceRow({ accountId: account.id });
      expect(todayRow!.amount.toCents()).toBe(updatedAccount.refCurrentBalance.toCents());
    });
    // Stored balances include the credit limit, so linking adopts the bank's
    // limit and rebases the stored balance before comparing own funds.
    describe('credit limit adoption', () => {
      it('drops the system limit when the bank card has none and records the own-funds residual as an adjustment', async () => {
        // Stored 20,000 − 4,497.52 = 15,502.48 with a 50,000 limit (−34,497.52 own funds); bank own funds 0.
        const { account } = await setupMonobankLink({
          initialBalance: 20_000,
          creditLimit: 50_000,
          bankBalanceCents: 0,
          bankStatement: [],
          apiToken: 'link-mono-token-drop-credit-limit',
          residualTarget: 'adjustment',
          beforeLink: async ({ accountId }) => {
            await seedManualHistory({ accountId, amount: 4_497.52 });
          },
        });

        const updatedAccount = (await Accounts.findByPk(account.id))!;
        const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

        const adjustments = filterBalanceAdjustments(transactions);
        expect(adjustments.length).toBe(1);
        expect(adjustments[0]!.transactionType).toBe(TRANSACTION_TYPES.income);
        expect(Money.fromDecimal(adjustments[0]!.amount as unknown as string).toCents()).toBe(3_449_752);

        expect(updatedAccount.creditLimit.toNumber()).toBe(0);
        expect(updatedAccount.currentBalance.toNumber()).toBe(0);
        expect(updatedAccount.initialBalance.toNumber()).toBe(-30_000);
        expect(readReconciliation(updatedAccount).difference).toBe(3_449_752);
        expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
          updatedAccount.currentBalance.toCents(),
        );
      });

      it("adopts the bank card's limit and records only the own-funds gap as an adjustment", async () => {
        // System own funds 4,000 with no limit; bank 60,000 with a 50,000 limit → 10,000 own funds.
        const { account } = await setupMonobankLink({
          initialBalance: 4_000,
          bankBalanceCents: 6_000_000,
          bankCreditLimitCents: 5_000_000,
          bankStatement: [],
          apiToken: 'link-mono-token-adopt-credit-limit',
          residualTarget: 'adjustment',
        });

        const updatedAccount = (await Accounts.findByPk(account.id))!;
        const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

        const adjustments = filterBalanceAdjustments(transactions);
        expect(adjustments.length).toBe(1);
        expect(adjustments[0]!.transactionType).toBe(TRANSACTION_TYPES.income);
        expect(Money.fromDecimal(adjustments[0]!.amount as unknown as string).toCents()).toBe(600_000);

        expect(updatedAccount.creditLimit.toNumber()).toBe(50_000);
        expect(updatedAccount.currentBalance.toNumber()).toBe(60_000);
        expect(updatedAccount.initialBalance.toNumber()).toBe(54_000);
        expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
          updatedAccount.currentBalance.toCents(),
        );
      });

      it('absorbs the own-funds residual into the opening balance by default when the limit changes', async () => {
        const { account } = await setupMonobankLink({
          initialBalance: 20_000,
          creditLimit: 50_000,
          bankBalanceCents: 0,
          bankStatement: [],
          apiToken: 'link-mono-token-credit-limit-opening',
          beforeLink: async ({ accountId }) => {
            await seedManualHistory({ accountId, amount: 4_497.52 });
          },
        });

        const updatedAccount = (await Accounts.findByPk(account.id))!;
        const transactions = await Transactions.findAll({ where: { accountId: account.id }, raw: true });

        expect(filterBalanceAdjustments(transactions).length).toBe(0);
        expect(updatedAccount.creditLimit.toNumber()).toBe(0);
        expect(updatedAccount.currentBalance.toNumber()).toBe(0);
        expect(updatedAccount.initialBalance.toNumber()).toBe(4_497.52);
        expect(updatedAccount.initialBalance.toCents() + sumSignedCents(transactions)).toBe(
          updatedAccount.currentBalance.toCents(),
        );
      });
    });
  });

  // Loan and vehicle balances are owned by their dedicated flows, so a bank sync
  // force-writing `currentBalance` would desync the managed anchor.
  describe('dedicated-flow accounts are rejected up front', () => {
    const connectLunchFlow = async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
        credentials: { apiKey: VALID_LUNCHFLOW_API_KEY },
        raw: true,
      });
      return connectionId;
    };

    const expectLinkRejected = async ({ accountId, connectionId }: { accountId: string; connectionId: string }) => {
      const response = await helpers.linkAccountToBankConnection({
        id: accountId,
        connectionId,
        externalAccountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
        raw: false,
      });

      expect(response.statusCode).toBe(422);
      expect(extractError(response).code).toBe(API_ERROR_CODES.validationError);
    };

    it('rejects linking a loan-category account', async () => {
      const connectionId = await connectLunchFlow();
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          currencyCode: 'USD',
          initialBalance: 1_000,
          originalPrincipal: 1_000,
        }),
        raw: true,
      });

      await expectLinkRejected({ accountId: loan.id, connectionId });
    });

    it('rejects linking a vehicle-category account', async () => {
      const connectionId = await connectLunchFlow();
      const vehicle = await helpers.createVehicle({
        name: 'Toyota Camry 2020',
        currencyCode: 'USD',
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        vehicleClass: VEHICLE_CLASS.sedan,
        purchasePrice: 25_000,
        purchaseDate: format(subYears(new Date(), 3), 'yyyy-MM-dd'),
        raw: true,
      });

      await expectLinkRejected({ accountId: vehicle.accountId, connectionId });
    });
  });
});
