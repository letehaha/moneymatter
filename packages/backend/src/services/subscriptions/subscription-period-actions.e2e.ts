import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_PERIOD_STATUSES, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import SubscriptionPeriods from '@models/subscription-periods.model';
import * as helpers from '@tests/helpers';
import { addMonths, format } from 'date-fns';

/** Returns a date string N months from today, on the given day-of-month. */
function futureDate({ monthsAhead, day }: { monthsAhead: number; day: number }): string {
  const d = addMonths(new Date(), monthsAhead);
  d.setDate(day);
  return format(d, 'yyyy-MM-dd');
}

/** Returns a date string in the past (N months ago). */
function pastDate({ monthsAgo, day }: { monthsAgo: number; day: number }): string {
  const d = addMonths(new Date(), -monthsAgo);
  d.setDate(day);
  return format(d, 'yyyy-MM-dd');
}

/**
 * Creates a basic monthly subscription with an account and a due date,
 * then returns the subscription and its first upcoming period.
 */
async function createSubWithPeriod({ dueDate }: { dueDate: string }) {
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
    raw: true,
  });
  const sub = await helpers.createSubscription({
    name: 'Test Sub',
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: dueDate,
    dueDate,
    accountId: account.id,
    categoryId: global.DEFAULT_CATEGORY_ID,
    expectedAmount: 20,
    expectedCurrencyCode: global.BASE_CURRENCY.code,
    raw: true,
  });
  const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
  const upcomingPeriod = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
  return { account, sub, period: upcomingPeriod! };
}

// ---------------------------------------------------------------------------
// Skip
// ---------------------------------------------------------------------------

describe('POST /subscriptions/:id/periods/:periodId/skip', () => {
  it('skips a period, generates the next one, and rejects skipping a skipped or paid period', async () => {
    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const { sub, period } = await createSubWithPeriod({ dueDate });

    const skipped = await helpers.skipSubscriptionPeriod({
      id: sub.id,
      periodId: period.id,
      raw: true,
    });

    expect(skipped.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.skipped);

    const periodsResult = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });
    const nextUpcoming = periodsResult.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
    expect(nextUpcoming).toBeDefined();
    const expectedNext = format(addMonths(new Date(dueDate + 'T00:00:00Z'), 1), 'yyyy-MM-dd');
    expect(nextUpcoming!.dueDate).toBe(expectedNext);

    const reSkipRes = await helpers.skipSubscriptionPeriod({
      id: sub.id,
      periodId: period.id,
      raw: false,
    });
    expect(reSkipRes.statusCode).toBe(409);

    await helpers.markSubscriptionPeriodPaid({ id: sub.id, periodId: nextUpcoming!.id, raw: true });

    const skipPaidRes = await helpers.skipSubscriptionPeriod({
      id: sub.id,
      periodId: nextUpcoming!.id,
      raw: false,
    });
    expect(skipPaidRes.statusCode).toBe(409);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Unlink
// ---------------------------------------------------------------------------

describe('POST /subscriptions/:id/periods/:periodId/unlink', () => {
  it('clears the transaction link on the period but leaves the transaction and the paid status intact', async () => {
    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const { sub, period, account } = await createSubWithPeriod({ dueDate });

    // Pay in create-mode so a transaction is auto-generated and linked.
    const paid = await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: period.id,
      createTransaction: true,
      raw: true,
    });

    expect(paid.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(paid.transactionId).toBeTruthy();
    const generatedTxId = paid.transactionId!;

    // Unlink the transaction.
    const unlinked = await helpers.unlinkSubscriptionPeriodTransaction({
      id: sub.id,
      periodId: period.id,
      raw: true,
    });

    // Period no longer points at the transaction, flag is cleared.
    expect(unlinked.transactionId).toBeNull();
    expect(unlinked.transactionAutoCreated).toBe(false);
    // Status is unchanged — unlink does not revert the payment.
    expect(unlinked.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);

    // The generated transaction still exists in the database.
    const tx = await helpers.getTransactionById({ id: generatedTxId, raw: true });
    expect(tx).not.toBeNull();
    expect(tx!.transactionType).toBe(TRANSACTION_TYPES.expense);
    expect(tx!.accountId).toBe(account.id);

    const secondUnlinkRes = await helpers.unlinkSubscriptionPeriodTransaction({
      id: sub.id,
      periodId: period.id,
      raw: false,
    });
    expect(secondUnlinkRes.statusCode).toBe(200);
    expect(secondUnlinkRes.body.response.transactionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Revert (create-mode)
// ---------------------------------------------------------------------------

describe('POST /subscriptions/:id/periods/:periodId/revert (create-mode)', () => {
  it('deletes the auto-created transaction, restores the account balance, and removes the auto-generated next period', async () => {
    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const { sub, period, account } = await createSubWithPeriod({ dueDate });

    expect(account.currentBalance).toBe(1000);

    // Pay in create-mode: generates an expense and the next upcoming period.
    const paid = await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: period.id,
      createTransaction: true,
      raw: true,
    });

    expect(paid.transactionAutoCreated).toBe(true);
    const generatedTxId = paid.transactionId!;

    // Balance reduced by $20 (the subscription's expectedAmount).
    const afterPay = await helpers.getAccount({ id: account.id, raw: true });
    expect(afterPay.currentBalance).toBe(980);

    // Confirm a next upcoming period was generated.
    const beforeRevert = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });
    expect(beforeRevert.periods.filter((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming)).toHaveLength(1);

    // Revert the payment.
    const reverted = await helpers.revertSubscriptionPeriod({
      id: sub.id,
      periodId: period.id,
      raw: true,
    });

    // (a) Period is active again with status upcoming or overdue (future date → upcoming).
    expect([SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue]).toContain(reverted.status);
    expect(reverted.paidAt).toBeNull();
    expect(reverted.transactionId).toBeNull();
    expect(reverted.transactionAutoCreated).toBe(false);

    // (b) The auto-created transaction is deleted.
    const txAfter = await helpers.getTransactionById({ id: generatedTxId, raw: true });
    expect(txAfter).toBeNull();

    // (c) Account balance is restored.
    const accountAfter = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfter.currentBalance).toBe(1000);

    // (d) The auto-generated next upcoming period was removed — only the reverted period remains active.
    const afterRevert = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });
    const activeAfter = afterRevert.periods.filter(
      (p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming || p.status === SUBSCRIPTION_PERIOD_STATUSES.overdue,
    );
    expect(activeAfter).toHaveLength(1);
    expect(activeAfter[0]!.id).toBe(period.id);
  });

  it('succeeds even when the generated transaction was already deleted by the user', async () => {
    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const { sub, period, account } = await createSubWithPeriod({ dueDate });

    const paid = await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: period.id,
      createTransaction: true,
      raw: true,
    });

    const generatedTxId = paid.transactionId!;

    // User deletes the generated transaction themselves.
    const deleteRes = await helpers.deleteTransaction({ id: generatedTxId });
    expect(deleteRes.statusCode).toBe(200);

    // Balance already restored by the manual deletion.
    expect((await helpers.getAccount({ id: account.id, raw: true })).currentBalance).toBe(1000);

    // Revert must not 500 — treats missing transaction as a no-op.
    const reverted = await helpers.revertSubscriptionPeriod({
      id: sub.id,
      periodId: period.id,
      raw: true,
    });

    expect([SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue]).toContain(reverted.status);
    expect(reverted.transactionId).toBeNull();

    // Balance not double-restored.
    const accountAfter = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfter.currentBalance).toBe(1000);
  });

  it('keeps the auto-created transaction, detached, when its account is bank-linked', async () => {
    const { account } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const sub = await helpers.createSubscription({
      name: 'Bank-linked Sub',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: dueDate,
      dueDate,
      accountId: account.id,
      categoryId: global.DEFAULT_CATEGORY_ID,
      expectedAmount: 20,
      expectedCurrencyCode: 'USD',
      raw: true,
    });
    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    const period = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming)!;

    const paid = await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: period.id,
      createTransaction: true,
      raw: true,
    });
    expect(paid.transactionAutoCreated).toBe(true);
    const generatedTxId = paid.transactionId!;

    await helpers.lunchflow.linkManualAccount({ accountId: account.id });
    const txBefore = await helpers.getTransactionById({ id: generatedTxId, raw: true });

    const revertRes = await helpers.revertSubscriptionPeriod({
      id: sub.id,
      periodId: period.id,
      raw: false,
    });

    expect(revertRes.statusCode).toBe(200);
    const reverted = revertRes.body.response;
    expect([SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue]).toContain(reverted.status);
    expect(reverted.paidAt).toBeNull();
    expect(reverted.transactionId).toBeNull();
    expect(reverted.transactionAutoCreated).toBe(false);

    const txAfter = await helpers.getTransactionById({ id: generatedTxId, raw: true });
    expect(txAfter).not.toBeNull();
    expect(txAfter!.accountId).toBe(account.id);
    expect(txAfter!.amount).toBe(txBefore!.amount);
    expect(txAfter!.transactionType).toBe(TRANSACTION_TYPES.expense);
    expect(txAfter!.time).toBe(txBefore!.time);
  });
});

// ---------------------------------------------------------------------------
// Revert (link-mode)
// ---------------------------------------------------------------------------

describe('POST /subscriptions/:id/periods/:periodId/revert (link-mode)', () => {
  it('clears the period link but does NOT delete the user-supplied transaction', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
      raw: true,
    });

    // User creates their own transaction.
    const [manualTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 20 }),
      raw: true,
    });

    const balanceAfterManual = (await helpers.getAccount({ id: account.id, raw: true })).currentBalance;

    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const sub = await helpers.createSubscription({
      name: 'Link Mode Sub',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: dueDate,
      dueDate,
      accountId: account.id,
      categoryId: global.DEFAULT_CATEGORY_ID,
      expectedAmount: 20,
      expectedCurrencyCode: global.BASE_CURRENCY.code,
      raw: true,
    });
    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    const period = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming)!;

    // Pay by linking the user's own transaction.
    const paid = await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: period.id,
      transactionId: manualTx!.id,
      raw: true,
    });
    expect(paid.transactionId).toBe(manualTx!.id);
    expect(paid.transactionAutoCreated).toBe(false);

    // Revert the period.
    const reverted = await helpers.revertSubscriptionPeriod({
      id: sub.id,
      periodId: period.id,
      raw: true,
    });

    // Period link cleared.
    expect(reverted.transactionId).toBeNull();
    expect(reverted.transactionAutoCreated).toBe(false);
    expect([SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue]).toContain(reverted.status);

    // User's transaction still exists and is unchanged.
    const txAfter = await helpers.getTransactionById({ id: manualTx!.id, raw: true });
    expect(txAfter).not.toBeNull();
    expect(txAfter!.amount).toBe(20);

    // Balance reflects only the manual transaction, not double-affected.
    const accountAfter = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfter.currentBalance).toBe(balanceAfterManual);
  });
});

// ---------------------------------------------------------------------------
// Revert error cases
// ---------------------------------------------------------------------------

describe('POST /subscriptions/:id/periods/:periodId/revert (error cases)', () => {
  it('returns 409 when reverting an active period, future-dated or past-dated', async () => {
    const { sub: futureSub, period: futurePeriod } = await createSubWithPeriod({
      dueDate: futureDate({ monthsAhead: 1, day: 15 }),
    });

    const futureRes = await helpers.revertSubscriptionPeriod({
      id: futureSub.id,
      periodId: futurePeriod.id,
      raw: false,
    });
    expect(futureRes.statusCode).toBe(409);

    const { sub: pastSub } = await createSubWithPeriod({ dueDate: pastDate({ monthsAgo: 1, day: 15 }) });
    const pastDetail = await helpers.getSubscriptionById({ id: pastSub.id, raw: true });
    // Period may be overdue (past date) or upcoming depending on scheduler timing;
    // either way, an active period cannot be reverted.
    const activePeriod = pastDetail.periods.find(
      (p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming || p.status === SUBSCRIPTION_PERIOD_STATUSES.overdue,
    )!;

    const pastRes = await helpers.revertSubscriptionPeriod({
      id: pastSub.id,
      periodId: activePeriod.id,
      raw: false,
    });
    expect(pastRes.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Revert — paused subscription must NOT be auto-resumed
// ---------------------------------------------------------------------------

describe('POST /subscriptions/:id/periods/:periodId/revert (paused subscription)', () => {
  it('does not reactivate a paused subscription when a period is reverted', async () => {
    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const { sub, period } = await createSubWithPeriod({ dueDate });

    // Pay the period.
    await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: period.id,
      raw: true,
    });

    // User manually pauses the subscription.
    await helpers.toggleSubscriptionActive({ id: sub.id, isActive: false, raw: true });
    const paused = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(paused.isActive).toBe(false);

    // Revert the paid period.
    await helpers.revertSubscriptionPeriod({ id: sub.id, periodId: period.id, raw: true });

    // Subscription must remain paused — revert must not auto-resume it.
    const after = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(after.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Revert — must not destroy a future period that belongs to a later consumed period
// ---------------------------------------------------------------------------

describe('POST /subscriptions/:id/periods/:periodId/revert (earlier period, later one already consumed)', () => {
  it('keeps the future upcoming period when reverting an earlier period that a later paid period followed', async () => {
    // Timeline: skip A → B auto-created → pay B (create-mode) → C auto-created → revert A.
    // The current upcoming (C) belongs to the LATEST consumed period (B), so reverting the
    // earlier A must leave C untouched and re-open A — the schedule must not stall.
    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const { sub, period: periodA } = await createSubWithPeriod({ dueDate });

    // Skip A → auto-creates the next upcoming period B.
    const skippedA = await helpers.skipSubscriptionPeriod({ id: sub.id, periodId: periodA.id, raw: true });
    expect(skippedA.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.skipped);

    const afterSkip = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });
    const periodB = afterSkip.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
    expect(periodB).toBeDefined();
    expect(periodB!.dueDate > periodA.dueDate).toBe(true);

    // Pay B in create-mode → auto-creates the next upcoming period C.
    const paidB = await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: periodB!.id,
      createTransaction: true,
      raw: true,
    });
    expect(paidB.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);

    const afterPayB = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });
    const periodC = afterPayB.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
    expect(periodC).toBeDefined();
    expect(periodC!.dueDate > periodB!.dueDate).toBe(true);

    // Three periods exist before the revert: A (skipped), B (paid), C (upcoming).
    const countBefore = afterPayB.periods.length;
    expect(countBefore).toBe(3);

    // Revert A — the earlier, skipped period.
    const revertedA = await helpers.revertSubscriptionPeriod({ id: sub.id, periodId: periodA.id, raw: true });

    // A is re-opened (future date → upcoming, otherwise overdue), no longer skipped.
    expect([SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue]).toContain(revertedA.status);

    const afterRevert = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });

    // C must still exist — reverting A must NOT destroy the future upcoming that follows B.
    const cAfter = afterRevert.periods.find((p) => p.id === periodC!.id);
    expect(cAfter).toBeDefined();
    expect(cAfter!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.upcoming);

    // B stays paid.
    const bAfter = afterRevert.periods.find((p) => p.id === periodB!.id);
    expect(bAfter).toBeDefined();
    expect(bAfter!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);

    // No period was destroyed — still three rows (A re-opened, B paid, C upcoming).
    expect(afterRevert.periods.length).toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// Revert — re-opened status derives from the due date
// ---------------------------------------------------------------------------

describe('POST /subscriptions/:id/periods/:periodId/revert (status from due date)', () => {
  it('re-opens a paid period as overdue when its due date is in the past', async () => {
    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const { sub, period } = await createSubWithPeriod({ dueDate });

    // Pay the period.
    const paid = await helpers.markSubscriptionPeriodPaid({ id: sub.id, periodId: period.id, raw: true });
    expect(paid.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);

    // Backdate the paid period's due date to the past via the ORM — the pay endpoint
    // keeps the original future date, and revert must derive `overdue` from it.
    const past = pastDate({ monthsAgo: 2, day: 10 });
    await SubscriptionPeriods.update({ dueDate: past }, { where: { id: period.id } });

    const reverted = await helpers.revertSubscriptionPeriod({ id: sub.id, periodId: period.id, raw: true });

    expect(reverted.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.overdue);
    expect(reverted.paidAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Revert — undo a skipped period
// ---------------------------------------------------------------------------

describe('POST /subscriptions/:id/periods/:periodId/revert (skipped period)', () => {
  it('returns a skipped period to active and clears the skipped status', async () => {
    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const { sub, period } = await createSubWithPeriod({ dueDate });

    const skipped = await helpers.skipSubscriptionPeriod({ id: sub.id, periodId: period.id, raw: true });
    expect(skipped.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.skipped);

    const reverted = await helpers.revertSubscriptionPeriod({ id: sub.id, periodId: period.id, raw: true });

    // Re-opened (future date → upcoming, otherwise overdue) and no longer skipped.
    expect([SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue]).toContain(reverted.status);
    expect(reverted.status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.skipped);
  });
});

// ---------------------------------------------------------------------------
// Period ownership — actions must 404 across subscriptions
// ---------------------------------------------------------------------------

describe('Subscription period actions reject a periodId that belongs to another subscription', () => {
  it('returns 404 for skip, revert, and unlink when the period belongs to a different subscription', async () => {
    const dueDateS1 = futureDate({ monthsAhead: 1, day: 15 });
    const { sub: s1 } = await createSubWithPeriod({ dueDate: dueDateS1 });

    const dueDateS2 = futureDate({ monthsAhead: 2, day: 20 });
    const { sub: s2, period: periodS2 } = await createSubWithPeriod({ dueDate: dueDateS2 });

    // S2's period is a real, valid period — but it does not belong to S1.
    const skipRes = await helpers.skipSubscriptionPeriod({ id: s1.id, periodId: periodS2.id, raw: false });
    expect(skipRes.statusCode).toBe(404);

    const revertRes = await helpers.revertSubscriptionPeriod({ id: s1.id, periodId: periodS2.id, raw: false });
    expect(revertRes.statusCode).toBe(404);

    const unlinkRes = await helpers.unlinkSubscriptionPeriodTransaction({
      id: s1.id,
      periodId: periodS2.id,
      raw: false,
    });
    expect(unlinkRes.statusCode).toBe(404);

    // Sanity: S2 still owns its period (no cross-subscription mutation happened).
    const s2Periods = await helpers.getSubscriptionPeriods({ id: s2.id, raw: true });
    expect(s2Periods.periods.find((p) => p.id === periodS2.id)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Get periods
// ---------------------------------------------------------------------------

describe('GET /subscriptions/:id/periods', () => {
  it('hydrates transactions for paid periods, nulls them elsewhere, orders by dueDate DESC and pages', async () => {
    const dueDate = futureDate({ monthsAhead: 1, day: 15 });
    const { sub, period } = await createSubWithPeriod({ dueDate });

    const paid = await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: period.id,
      createTransaction: true,
      raw: true,
    });

    const afterPay = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });
    const second = afterPay.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming)!;

    await helpers.skipSubscriptionPeriod({ id: sub.id, periodId: second.id, raw: true });

    const afterSkip = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });
    const third = afterSkip.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming)!;
    await helpers.markSubscriptionPeriodPaid({ id: sub.id, periodId: third.id, raw: true });

    const result = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });
    expect(Array.isArray(result.periods)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(4);

    const paidEntry = result.periods.find((p) => p.id === paid.id);
    expect(paidEntry).toBeDefined();
    expect(paidEntry!.transaction).not.toBeNull();
    expect(paidEntry!.transaction!.id).toBe(paid.transactionId);
    expect(typeof paidEntry!.transaction!.amount).toBe('number');

    const skippedEntry = result.periods.find((p) => p.id === second.id);
    expect(skippedEntry).toBeDefined();
    expect(skippedEntry!.transaction).toBeNull();

    for (let i = 0; i < result.periods.length - 1; i++) {
      expect(result.periods[i]!.dueDate >= result.periods[i + 1]!.dueDate).toBe(true);
    }

    const page1 = await helpers.getSubscriptionPeriods({ id: sub.id, limit: 2, offset: 0, raw: true });
    expect(page1.periods).toHaveLength(2);
    expect(page1.total).toBe(result.total);

    const page2 = await helpers.getSubscriptionPeriods({ id: sub.id, limit: 2, offset: 2, raw: true });
    expect(page2.periods).toHaveLength(2);
    const page1Ids = new Set(page1.periods.map((p) => p.id));
    page2.periods.forEach((p) => expect(page1Ids.has(p.id)).toBe(false));
  }, 60_000);
});
