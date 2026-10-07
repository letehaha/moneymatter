import {
  ACCOUNT_TYPES,
  type RecordId,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTIONS_WRITE_SCOPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ResourceShares from '@models/resource-shares.model';
import * as helpers from '@tests/helpers';
import { addDays, format, subYears } from 'date-fns';

const FUTURE_TIME = () => addDays(new Date(), 5).toISOString();

const createOwnedAccount = ({ initialBalance = 0 }: { initialBalance?: number } = {}) =>
  helpers.createAccount({ payload: helpers.buildAccountPayload({ initialBalance }), raw: true });

const getBalance = async ({ accountId }: { accountId: string }) =>
  (await helpers.getAccount({ id: accountId, raw: true })).currentBalance;

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

const createMonobankAccount = async () => {
  await helpers.monobank.pair();
  const { account } = await helpers.monobank.mockTransactions();
  return account;
};

describe('Planned transactions', () => {
  describe('POST /transactions with isPlanned', () => {
    it('creates a planned transaction without moving any balance', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      const historyBefore = await helpers.getBalanceHistory({ accountId: account.id, raw: true });

      const [tx] = await helpers.createPlannedTransaction({
        payload: { accountId: account.id, amount: 250, time: FUTURE_TIME() },
        raw: true,
      });

      expect(tx.isPlanned).toBe(true);
      expect(await getBalance({ accountId: account.id })).toBe(1000);
      expect(await helpers.getBalanceHistory({ accountId: account.id, raw: true })).toEqual(historyBefore);
    });

    it('rejects every unsupported planned creation', async () => {
      const [source, destination] = await Promise.all([
        createOwnedAccount({ initialBalance: 1000 }),
        createOwnedAccount(),
      ]);
      const [original] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: source.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({ currencyCode: global.BASE_CURRENCY.code }),
        raw: true,
      });
      const vehicle = await helpers.createVehicle({
        name: 'Toyota Camry 2020',
        currencyCode: global.BASE_CURRENCY.code,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        vehicleClass: VEHICLE_CLASS.sedan,
        purchasePrice: 25000,
        purchaseDate: format(subYears(new Date(), 3), 'yyyy-MM-dd'),
        raw: true,
      });

      const transferResponse = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: source.id,
          amount: 100,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: destination.id,
          destinationAmount: 100,
          isPlanned: true,
        }),
      });
      expect(transferResponse.statusCode).toBe(ERROR_CODES.ValidationError);

      const refundResponse = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: source.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
          refundForTxId: original.id,
          isPlanned: true,
        }),
      });
      expect(refundResponse.statusCode).toBe(ERROR_CODES.ValidationError);

      const zeroResponse = await helpers.createPlannedTransaction({
        payload: { accountId: source.id, amount: 0 },
      });
      expect(zeroResponse.statusCode).toBe(ERROR_CODES.ValidationError);

      const negativeResponse = await helpers.createPlannedTransaction({
        payload: { accountId: source.id, amount: -100 },
      });
      expect(negativeResponse.statusCode).toBe(ERROR_CODES.ValidationError);

      const loanResponse = await helpers.createPlannedTransaction({
        payload: { accountId: loan.id as RecordId, amount: 100 },
      });
      expect(loanResponse.statusCode).toBe(ERROR_CODES.ValidationError);

      const vehicleResponse = await helpers.createPlannedTransaction({
        payload: { accountId: vehicle.accountId, amount: 100 },
      });
      expect(vehicleResponse.statusCode).toBe(ERROR_CODES.ValidationError);
    }, 30000);

    it('rejects a full-scope member planning on an account shared with them', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      const member = await seedHouseholdMember({ ownerUserId: account.userId });

      const response = await helpers.asUser({
        cookies: member.cookies,
        fn: () => helpers.createPlannedTransaction({ payload: { accountId: account.id, amount: 100 } }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await getBalance({ accountId: account.id })).toBe(1000);
    });
  });

  describe('PUT /transactions/:id on a provider-linked account', () => {
    it('stamps the provider account type, lets the owner edit the plan, then delete it', async () => {
      const account = await createMonobankAccount();
      const balanceBefore = await getBalance({ accountId: account.id });

      const [planned] = await helpers.createPlannedTransaction({
        payload: { accountId: account.id, amount: 250, time: FUTURE_TIME() },
        raw: true,
      });

      const stored = await helpers.getTransactionById({ id: planned.id, raw: true });
      expect(stored!.accountType).toBe(ACCOUNT_TYPES.monobank);

      const newTime = addDays(new Date(), 9).toISOString();
      const editResponse = await helpers.updateTransaction({
        id: planned.id,
        payload: { amount: 310, time: newTime, note: 'rent' },
      });
      expect(editResponse.statusCode).toBe(200);

      const updated = await helpers.getTransactionById({ id: planned.id, raw: true });
      expect(updated!.amount).toBe(310);
      expect(updated!.note).toBe('rent');
      expect(updated!.isPlanned).toBe(true);

      const deleteResponse = await helpers.deleteTransaction({ id: planned.id });
      expect(deleteResponse.statusCode).toBe(200);
      expect(await helpers.getTransactionById({ id: planned.id, raw: true })).toBe(null);
      expect(await getBalance({ accountId: account.id })).toBe(balanceBefore);
    }, 30000);

    it('rejects every write that would put unconfirmed money on the bank account', async () => {
      const [manualAccount, bankAccount] = await Promise.all([
        createOwnedAccount({ initialBalance: 1000 }),
        createMonobankAccount(),
      ]);
      const bankBalanceBefore = Number(await getBalance({ accountId: bankAccount.id }));

      const createResponse = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: bankAccount.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
        }),
      });
      expect(createResponse.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(Number(await getBalance({ accountId: bankAccount.id }))).toBe(bankBalanceBefore);

      const [planned] = await helpers.createPlannedTransaction({
        payload: {
          accountId: bankAccount.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
          time: FUTURE_TIME(),
        },
        raw: true,
      });

      const uncheckResponse = await helpers.updateTransaction({ id: planned.id, payload: { isPlanned: false } });
      expect(uncheckResponse.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getTransactionById({ id: planned.id, raw: true }))!.isPlanned).toBe(true);
      expect(Number(await getBalance({ accountId: bankAccount.id }))).toBe(bankBalanceBefore);

      const uncheckAndMoveResponse = await helpers.updateTransaction({
        id: planned.id,
        payload: { isPlanned: false, accountId: bankAccount.id },
      });
      expect(uncheckAndMoveResponse.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getTransactionById({ id: planned.id, raw: true }))!.isPlanned).toBe(true);

      // A cross-account move while unchecking bypasses the planned-unflip guard and is
      // judged by the destination check instead, which also rejects bank targets.
      const siblingBankAccount = (await helpers.getAccounts()).find(
        (account) => account.type === ACCOUNT_TYPES.monobank && account.id !== bankAccount.id,
      );
      expect(siblingBankAccount).toBeDefined();
      const uncheckAndCrossMoveResponse = await helpers.updateTransaction({
        id: planned.id,
        payload: { isPlanned: false, accountId: siblingBankAccount!.id },
      });
      expect(uncheckAndCrossMoveResponse.statusCode).toBe(ERROR_CODES.ValidationError);
      const afterCrossMove = await helpers.getTransactionById({ id: planned.id, raw: true });
      expect(afterCrossMove!.isPlanned).toBe(true);
      expect(afterCrossMove!.accountId).toBe(bankAccount.id);

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: manualAccount.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const moveResponse = await helpers.updateTransaction({ id: tx.id, payload: { accountId: bankAccount.id } });
      expect(moveResponse.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getTransactionById({ id: tx.id, raw: true }))!.accountId).toBe(manualAccount.id);
    }, 30000);

    it('accepts unchecking planned when the same request moves the row to a manual account', async () => {
      const [manualAccount, bankAccount] = await Promise.all([
        createOwnedAccount({ initialBalance: 1000 }),
        createMonobankAccount(),
      ]);

      const [planned] = await helpers.createPlannedTransaction({
        payload: {
          accountId: bankAccount.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
          time: FUTURE_TIME(),
        },
        raw: true,
      });

      const response = await helpers.updateTransaction({
        id: planned.id,
        payload: { isPlanned: false, accountId: manualAccount.id, time: new Date().toISOString() },
      });

      expect(response.statusCode).toBe(200);

      const updated = await helpers.getTransactionById({ id: planned.id, raw: true });
      expect(updated!.isPlanned).toBe(false);
      expect(updated!.accountId).toBe(manualAccount.id);
      expect(updated!.accountType).toBe(ACCOUNT_TYPES.system);
      // The row is real money now, so it lands on the manual account it moved to.
      expect(Number(await getBalance({ accountId: manualAccount.id }))).toBeCloseTo(750, 2);
    });
  });

  describe('PUT /transactions/:id on a row that stays planned', () => {
    it('rejects moving a plan onto a loan account', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({ currencyCode: global.BASE_CURRENCY.code }),
        raw: true,
      });
      const loanBalanceBefore = (await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance;

      const [planned] = await helpers.createPlannedTransaction({
        payload: { accountId: account.id, amount: 250, time: FUTURE_TIME() },
        raw: true,
      });

      const response = await helpers.updateTransaction({
        id: planned.id,
        payload: { accountId: loan.id as RecordId },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const untouched = await helpers.getTransactionById({ id: planned.id, raw: true });
      expect(untouched!.accountId).toBe(account.id);
      expect(untouched!.isPlanned).toBe(true);
      expect(await getBalance({ accountId: account.id })).toBe(1000);
      expect((await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance).toBe(loanBalanceBefore);
    });

    it('rejects turning a plan into a transfer and leaves both balances alone', async () => {
      const [source, destination] = await Promise.all([
        createOwnedAccount({ initialBalance: 1000 }),
        createOwnedAccount({ initialBalance: 1000 }),
      ]);

      const [planned] = await helpers.createPlannedTransaction({
        payload: {
          accountId: source.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
          time: FUTURE_TIME(),
        },
        raw: true,
      });

      const response = await helpers.updateTransaction({
        id: planned.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: destination.id,
          destinationAmount: 250,
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const untouched = await helpers.getTransactionById({ id: planned.id, raw: true });
      expect(untouched!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
      expect(untouched!.isPlanned).toBe(true);
      expect(await getBalance({ accountId: source.id })).toBe(1000);
      expect(await getBalance({ accountId: destination.id })).toBe(1000);
    });

    it('rejects linking a plan as a loan payment', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          currencyCode: global.BASE_CURRENCY.code,
          initialBalance: 1000,
          originalPrincipal: 1000,
        }),
        raw: true,
      });

      const [planned] = await helpers.createPlannedTransaction({
        payload: {
          accountId: account.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
          time: FUTURE_TIME(),
        },
        raw: true,
      });

      const response = await helpers.linkLoanPayments({ id: loan.id, transactionIds: [planned.id] });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance).toBe(-1000);

      const untouched = await helpers.getTransactionById({ id: planned.id, raw: true });
      expect(untouched!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
      expect(untouched!.isPlanned).toBe(true);
      expect(await getBalance({ accountId: account.id })).toBe(1000);
    });
  });

  describe('flipping an existing row to planned', () => {
    it('rejects transfer legs and flips that add transfer or loan fields in the same request', async () => {
      const [source, destination] = await Promise.all([
        createOwnedAccount({ initialBalance: 1000 }),
        createOwnedAccount({ initialBalance: 1000 }),
      ]);
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({ currencyCode: global.BASE_CURRENCY.code }),
        raw: true,
      });
      const loanBalanceBefore = (await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance;

      const [ordinaryTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: source.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const [baseTx, oppositeTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: source.id,
          amount: 100,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: destination.id,
          destinationAmount: 100,
        }),
        raw: true,
      });

      for (const leg of [baseTx, oppositeTx!]) {
        const response = await helpers.updateTransaction({ id: leg.id, payload: { isPlanned: true } });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      }

      const withTransferFieldsResponse = await helpers.updateTransaction({
        id: ordinaryTx.id,
        payload: {
          isPlanned: true,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: destination.id,
          destinationAmount: 250,
        },
      });
      expect(withTransferFieldsResponse.statusCode).toBe(ERROR_CODES.ValidationError);

      const afterTransferFields = await helpers.getTransactionById({ id: ordinaryTx.id, raw: true });
      expect(afterTransferFields!.isPlanned).toBe(false);
      expect(afterTransferFields!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);

      const ontoLoanResponse = await helpers.updateTransaction({
        id: ordinaryTx.id,
        payload: { isPlanned: true, accountId: loan.id as RecordId },
      });
      expect(ontoLoanResponse.statusCode).toBe(ERROR_CODES.ValidationError);

      const afterLoanMove = await helpers.getTransactionById({ id: ordinaryTx.id, raw: true });
      expect(afterLoanMove!.isPlanned).toBe(false);
      expect(afterLoanMove!.accountId).toBe(source.id);
      expect((await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance).toBe(loanBalanceBefore);

      // 1000 - 250 expense - 100 transfer out
      expect(await getBalance({ accountId: source.id })).toBe(650);
      expect(await getBalance({ accountId: destination.id })).toBe(1100);
    }, 30000);

    it('rejects a refund-linked row and leaves the balance alone', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });

      const [original] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      const [refund] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });
      await helpers.createSingleRefund({ originalTxId: original.id, refundTxId: refund.id });

      const response = await helpers.updateTransaction({ id: refund.id, payload: { isPlanned: true } });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await getBalance({ accountId: account.id })).toBe(1000);
    });

    it('rejects a flip attempted by a full-scope member', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
        raw: true,
      });
      const member = await seedHouseholdMember({ ownerUserId: account.userId });

      const response = await helpers.asUser({
        cookies: member.cookies,
        fn: () => helpers.updateTransaction({ id: tx.id, payload: { isPlanned: true } }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await getBalance({ accountId: account.id })).toBe(900);
    });

    it('rejects flipping a real row that sits on a bank-linked account', async () => {
      const { account } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      await helpers.lunchflow.linkManualAccount({ accountId: account.id });
      const balanceBefore = await getBalance({ accountId: account.id });

      const response = await helpers.updateTransaction({ id: tx.id, payload: { isPlanned: true } });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      const untouched = await helpers.getTransactionById({ id: tx.id, raw: true });
      expect(untouched!.isPlanned).toBe(false);
      expect(untouched!.accountId).toBe(account.id);
      expect(await getBalance({ accountId: account.id })).toBe(balanceBefore);
    });

    it('applies and reverts the amount as the flag toggles on a manual account', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      expect(await getBalance({ accountId: account.id })).toBe(750);

      await helpers.updateTransaction({ id: tx.id, payload: { isPlanned: true }, raw: true });
      expect(await getBalance({ accountId: account.id })).toBe(1000);

      await helpers.updateTransaction({ id: tx.id, payload: { isPlanned: false }, raw: true });
      expect(await getBalance({ accountId: account.id })).toBe(750);
    });
  });

  describe('owner-only writes on planned rows', () => {
    it('rejects a full-scope member updating and deleting the owner planned row', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      const [planned] = await helpers.createPlannedTransaction({
        payload: { accountId: account.id, amount: 250, time: FUTURE_TIME() },
        raw: true,
      });
      const member = await seedHouseholdMember({ ownerUserId: account.userId });

      const updateResponse = await helpers.asUser({
        cookies: member.cookies,
        fn: () => helpers.updateTransaction({ id: planned.id, payload: { note: 'not yours' } }),
      });
      expect(updateResponse.statusCode).toBe(ERROR_CODES.Forbidden);

      const deleteResponse = await helpers.asUser({
        cookies: member.cookies,
        fn: () => helpers.deleteTransaction({ id: planned.id }),
      });
      expect(deleteResponse.statusCode).toBe(ERROR_CODES.Forbidden);

      expect(await helpers.getTransactionById({ id: planned.id, raw: true })).not.toBe(null);
    });
  });

  describe('GET /transactions', () => {
    it('returns the owner planned rows alongside real ones', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });

      const [real] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
        raw: true,
      });
      const [planned] = await helpers.createPlannedTransaction({
        payload: { accountId: account.id, amount: 250, time: FUTURE_TIME() },
        raw: true,
      });

      const transactions = await helpers.getTransactions({ raw: true });
      const byId = new Map(transactions.map((item) => [item.id, item]));

      expect(byId.get(real.id)!.isPlanned).toBe(false);
      expect(byId.get(planned.id)!.isPlanned).toBe(true);
    });

    it('leaves the balance untouched when a planned row is deleted', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      const [planned] = await helpers.createPlannedTransaction({
        payload: { accountId: account.id, amount: 250, time: FUTURE_TIME() },
        raw: true,
      });

      const response = await helpers.deleteTransaction({ id: planned.id });

      expect(response.statusCode).toBe(200);
      expect(await getBalance({ accountId: account.id })).toBe(1000);
    });
  });
});
