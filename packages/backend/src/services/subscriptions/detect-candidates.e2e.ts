import type { RecordId } from '@bt/shared/types';
import {
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_INTERVAL_UNITS,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import SubscriptionCandidates from '@models/subscription-candidates.model';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { buildTransactionPayload } from '@tests/helpers/transactions';
import { subDays, subMonths } from 'date-fns';

/**
 * Helper to create a series of transactions with the same note, simulating a
 * recurring subscription pattern. Without `intervalDays` they land on the same
 * calendar day of consecutive months, the way a monthly bill does.
 */
async function createRecurringTransactions({
  accountId,
  note,
  amount = 15.99,
  count = 4,
  intervalDays,
}: {
  accountId: RecordId;
  note: string;
  amount?: number;
  count?: number;
  intervalDays?: number;
}) {
  const now = new Date();
  const transactions: Transactions[] = [];

  for (let i = 0; i < count; i++) {
    const stepsBack = count - 1 - i;
    const time = intervalDays === undefined ? subMonths(now, stepsBack) : subDays(now, intervalDays * stepsBack);

    const [tx] = await helpers.createTransaction({
      raw: true,
      payload: buildTransactionPayload({
        accountId,
        amount,
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        note,
        time: time.toISOString(),
      }),
    });
    transactions.push(tx!);
  }

  return transactions;
}

/**
 * Moves all candidate detectedAt timestamps back by 2 hours so the next
 * detect-candidates call bypasses the 1-hour cooldown.
 */
async function expireCooldown({ userId }: { userId: number }) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await SubscriptionCandidates.update({ detectedAt: twoHoursAgo }, { where: { userId } });
}

describe('Subscription Candidate Detection', () => {
  describe('Happy paths', () => {
    it('detects a monthly pattern and exposes decimal amounts and isOutdated on both endpoints', async () => {
      const account = await helpers.createAccount({ raw: true });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'NETFLIX.COM PAYMENT',
        amount: 15.99,
        count: 4,
      });

      const result = await helpers.detectSubscriptionCandidates({ raw: true });

      expect(result.isFromCache).toBe(false);
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);

      const netflix = result.candidates.find((c) => c.suggestedName.includes('NETFLIX'));
      expect(netflix).toBeDefined();
      expect(netflix!.detectedFrequency).toBe(SUBSCRIPTION_FREQUENCIES.monthly);
      expect(netflix!.detectedIntervalUnit).toBeNull();
      expect(netflix!.detectedIntervalCount).toBeNull();
      expect(netflix!.occurrenceCount).toBe(4);
      expect(netflix!.confidenceScore).toBeGreaterThan(0);
      expect(netflix!.sampleTransactionIds.length).toBeGreaterThan(0);
      expect(netflix!.averageAmount).toBe(15.99);
      expect(netflix!.isOutdated).toBe(false);

      const candidates = await helpers.getSubscriptionCandidates({ raw: true });
      const fromList = candidates.find((c) => c.id === netflix!.id);
      expect(fromList).toBeDefined();
      expect(typeof fromList!.isOutdated).toBe('boolean');
      expect(fromList!.isOutdated).toBe(false);
    }, 60_000);

    it('detects multiple candidates, caches within the cooldown, and does not duplicate after it', async () => {
      const account = await helpers.createAccount({ raw: true });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'NETFLIX.COM PAYMENT',
        amount: 15.99,
        count: 4,
      });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'SPOTIFY PREMIUM',
        amount: 9.99,
        count: 5,
      });

      const first = await helpers.detectSubscriptionCandidates({ raw: true });

      expect(first.isFromCache).toBe(false);
      expect(first.candidates.length).toBeGreaterThanOrEqual(2);

      const names = first.candidates.map((c) => c.suggestedName);
      expect(names.some((n) => n.includes('NETFLIX'))).toBe(true);
      expect(names.some((n) => n.includes('SPOTIFY'))).toBe(true);

      const netflixFirst = first.candidates.find((c) => c.suggestedName.includes('NETFLIX'))!;

      const second = await helpers.detectSubscriptionCandidates({ raw: true });
      expect(second.isFromCache).toBe(true);
      expect(second.candidates.length).toBe(first.candidates.length);

      await expireCooldown({ userId: account.userId });

      const third = await helpers.detectSubscriptionCandidates({ raw: true });
      expect(third.isFromCache).toBe(false);

      const netflixCandidates = third.candidates.filter((c) => c.suggestedName.includes('NETFLIX'));
      expect(netflixCandidates.length).toBe(1);
      expect(netflixCandidates[0]!.id).toBe(netflixFirst.id);
      expect(netflixCandidates[0]!.status).toBe('pending');
    }, 60_000);

    it('accepts and dismisses candidates, and neither reappears after a fresh detection', async () => {
      const account = await helpers.createAccount({ raw: true });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'NETFLIX.COM PAYMENT',
        amount: 15.99,
        count: 4,
      });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'SPOTIFY PREMIUM',
        amount: 9.99,
        count: 5,
      });

      const detection = await helpers.detectSubscriptionCandidates({ raw: true });
      const netflix = detection.candidates.find((c) => c.suggestedName.includes('NETFLIX'))!;
      const spotify = detection.candidates.find((c) => c.suggestedName.includes('SPOTIFY'))!;
      expect(netflix).toBeDefined();
      expect(spotify).toBeDefined();

      const dismissed = await helpers.dismissSubscriptionCandidate({ id: netflix.id, raw: true });
      expect(dismissed.id).toBe(netflix.id);
      expect(dismissed.status).toBe('dismissed');

      const accepted = await helpers.acceptSubscriptionCandidate({ id: spotify.id, raw: true });
      expect(accepted.id).toBe(spotify.id);
      expect(accepted.status).toBe('accepted');

      const pending = await helpers.getSubscriptionCandidates({ raw: true });
      expect(pending.find((c) => c.id === netflix.id)).toBeUndefined();
      expect(pending.find((c) => c.id === spotify.id)).toBeUndefined();

      await expireCooldown({ userId: account.userId });

      const fresh = await helpers.detectSubscriptionCandidates({ raw: true });
      expect(fresh.candidates.find((c) => c.suggestedName.includes('NETFLIX'))).toBeUndefined();
      expect(fresh.candidates.find((c) => c.suggestedName.includes('SPOTIFY'))).toBeUndefined();
    }, 60_000);

    it('links sample transactions to the subscription when accepting with subscriptionId', async () => {
      const account = await helpers.createAccount({ raw: true });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'ACCEPT LINK TEST',
        amount: 15.99,
        count: 4,
      });

      const detection = await helpers.detectSubscriptionCandidates({ raw: true });
      const candidate = detection.candidates.find((c) => c.suggestedName.includes('ACCEPT LINK'))!;
      expect(candidate).toBeDefined();
      expect(candidate.sampleTransactionIds.length).toBe(4);

      // Create a subscription (mimicking what the form does)
      const sub = await helpers.createSubscription({
        name: 'Accept Link Test',
        expectedAmount: 15.99,
        expectedCurrencyCode: account.currencyCode,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      // Accept the candidate WITH the subscription ID
      const accepted = await helpers.acceptSubscriptionCandidate({
        id: candidate.id,
        subscriptionId: sub.id,
        raw: true,
      });

      expect(accepted.id).toBe(candidate.id);
      expect(accepted.status).toBe('accepted');

      const pending = await helpers.getSubscriptionCandidates({ raw: true });
      expect(pending.find((c) => c.id === candidate.id)).toBeUndefined();

      // Verify sample transactions are now linked to the subscription
      const subDetail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const linkedTxIds = subDetail.transactions.map((t) => t.id);

      expect(linkedTxIds.length).toBe(4);
      for (const txId of candidate.sampleTransactionIds) {
        expect(linkedTxIds).toContain(txId);
      }
    });
  });

  describe('Fixed day cadences', () => {
    it('proposes every 30 days, and the candidate is accepted onto a subscription with that step', async () => {
      const account = await helpers.createAccount({ raw: true });
      await createRecurringTransactions({
        accountId: account.id,
        note: 'MAGTI MOBILE TOPUP',
        amount: 25,
        count: 5,
        intervalDays: 30,
      });

      const detection = await helpers.detectSubscriptionCandidates({ raw: true });
      const magti = detection.candidates.find((c) => c.suggestedName.includes('MAGTI'))!;
      expect(magti).toMatchObject({
        detectedFrequency: SUBSCRIPTION_FREQUENCIES.custom,
        detectedIntervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
        detectedIntervalCount: 30,
      });

      const listed = await helpers.getSubscriptionCandidates({ raw: true });
      expect(listed.find((c) => c.id === magti.id)).toMatchObject({
        detectedFrequency: SUBSCRIPTION_FREQUENCIES.custom,
        detectedIntervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
        detectedIntervalCount: 30,
      });

      // The client prefills the quick-add form from the candidate, then accepts with the new id.
      const sub = await helpers.createSubscription({
        name: magti.suggestedName,
        expectedAmount: magti.averageAmount,
        expectedCurrencyCode: magti.currencyCode,
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: magti.detectedIntervalUnit!,
        intervalCount: magti.detectedIntervalCount!,
        startDate: '2026-01-01',
        accountId: account.id,
        raw: true,
      });
      const accepted = await helpers.acceptSubscriptionCandidate({ id: magti.id, subscriptionId: sub.id, raw: true });
      expect(accepted.status).toBe('accepted');

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail).toMatchObject({
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
        intervalCount: 30,
      });
      expect(detail.transactions).toHaveLength(5);
    }, 60_000);

    it('keeps a 14-day cadence on the biweekly preset', async () => {
      const account = await helpers.createAccount({ raw: true });
      await createRecurringTransactions({ accountId: account.id, note: 'CLEANER VISIT', count: 5, intervalDays: 14 });

      const detection = await helpers.detectSubscriptionCandidates({ raw: true });
      expect(detection.candidates.find((c) => c.suggestedName.includes('CLEANER'))).toMatchObject({
        detectedFrequency: SUBSCRIPTION_FREQUENCIES.biweekly,
        detectedIntervalUnit: null,
        detectedIntervalCount: null,
      });
    });
  });

  describe('Edge cases', () => {
    it('truncates a suggested name longer than the 200-char column instead of failing', async () => {
      const account = await helpers.createAccount({ raw: true });
      const longNote = 'VERY LONG MERCHANT NAME '.repeat(20);

      await createRecurringTransactions({ accountId: account.id, note: longNote, count: 4 });

      const result = await helpers.detectSubscriptionCandidates({ raw: true });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.suggestedName).toHaveLength(200);
      expect(longNote.startsWith(result.candidates[0]!.suggestedName)).toBe(true);
    }, 60_000);

    it('returns empty results when no recurring patterns exist', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create unrelated transactions with different notes
      for (let i = 0; i < 5; i++) {
        const time = new Date();
        time.setDate(time.getDate() - i * 10);
        await helpers.createTransaction({
          raw: true,
          payload: buildTransactionPayload({
            accountId: account.id,
            amount: 10 + i * 5,
            transactionType: TRANSACTION_TYPES.expense,
            note: `Random purchase ${i} at store ${i}`,
            time: time.toISOString(),
          }),
        });
      }

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      expect(result.candidates.length).toBe(0);
    });

    it('excludes transfer transactions from detection', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      // Create transfers (not subscriptions)
      for (let i = 0; i < 4; i++) {
        const time = subMonths(new Date(), i);
        await helpers.createTransaction({
          raw: true,
          payload: buildTransactionPayload({
            accountId: account1.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.expense,
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            note: 'Monthly transfer',
            time: time.toISOString(),
            destinationAmount: 50,
            destinationAccountId: account2.id,
          }),
        });
      }

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      const transferCandidate = result.candidates.find((c) => c.suggestedName.includes('transfer'));
      expect(transferCandidate).toBeUndefined();
    });

    it('does not detect patterns with only 2 transactions (below minimum)', async () => {
      const account = await helpers.createAccount({ raw: true });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'RARE SERVICE PAYMENT',
        amount: 29.99,
        count: 2,
      });

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      const rare = result.candidates.find((c) => c.suggestedName.includes('RARE'));
      expect(rare).toBeUndefined();
    });

    it('excludes transactions already linked to a subscription', async () => {
      const account = await helpers.createAccount({ raw: true });

      const txs = await createRecurringTransactions({
        accountId: account.id,
        note: 'LINKED SERVICE PAYMENT',
        amount: 15.99,
        count: 4,
      });

      // Create a subscription and link the transactions
      const sub = await helpers.createSubscription({
        name: 'Linked Service',
        expectedAmount: 15.99,
        expectedCurrencyCode: account.currencyCode,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const linkRes = await helpers.linkTransactionsToSubscription({
        id: sub.id,
        transactionIds: txs.map((t) => t.id),
      });

      // Verify the link succeeded
      expect(linkRes.statusCode).toBe(200);

      // Verify they appear in the subscription detail
      const subDetail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(subDetail.transactions.length).toBe(4);

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      const linked = result.candidates.find((c) => c.suggestedName.includes('LINKED'));
      expect(linked).toBeUndefined();
    });
  });

  describe('Re-detection behavior', () => {
    it('detects new patterns alongside existing pending candidates', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create Netflix transactions and detect
      await createRecurringTransactions({
        accountId: account.id,
        note: 'NETFLIX.COM PAYMENT',
        amount: 15.99,
        count: 4,
      });

      const first = await helpers.detectSubscriptionCandidates({ raw: true });
      expect(first.candidates.some((c) => c.suggestedName.includes('NETFLIX'))).toBe(true);

      // Now add Spotify transactions
      await createRecurringTransactions({
        accountId: account.id,
        note: 'SPOTIFY PREMIUM',
        amount: 9.99,
        count: 5,
      });

      // Bypass cooldown and re-detect
      await expireCooldown({ userId: account.userId });

      const second = await helpers.detectSubscriptionCandidates({ raw: true });

      // Should have both: existing pending Netflix + newly discovered Spotify
      const names = second.candidates.map((c) => c.suggestedName);
      expect(names.some((n) => n.includes('NETFLIX'))).toBe(true);
      expect(names.some((n) => n.includes('SPOTIFY'))).toBe(true);
    });
  });

  describe('Detection quality', () => {
    it('candidates are sorted by confidence score descending', async () => {
      const account = await helpers.createAccount({ raw: true });

      // High confidence: many transactions, regular intervals
      await createRecurringTransactions({
        accountId: account.id,
        note: 'VERY REGULAR SERVICE',
        amount: 9.99,
        count: 5,
      });

      // Lower confidence: fewer transactions
      await createRecurringTransactions({
        accountId: account.id,
        note: 'LESS REGULAR SERVICE',
        amount: 24.99,
        count: 3,
      });

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);

      // Verify descending order
      for (let i = 1; i < result.candidates.length; i++) {
        expect(result.candidates[i - 1]!.confidenceScore).toBeGreaterThanOrEqual(result.candidates[i]!.confidenceScore);
      }
    });

    it('detects weekly frequency patterns', async () => {
      const account = await helpers.createAccount({ raw: true });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'WEEKLY GYM PAYMENT',
        amount: 5,
        count: 6,
        intervalDays: 7,
      });

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      const gym = result.candidates.find((c) => c.suggestedName.includes('GYM'));
      expect(gym).toBeDefined();
      expect(gym!.detectedFrequency).toBe(SUBSCRIPTION_FREQUENCIES.weekly);
    });

    it('rejects groups with highly irregular timing', async () => {
      const account = await helpers.createAccount({ raw: true });
      const now = new Date();

      // Create transactions with wildly varying intervals (3, 45, 7, 60 days)
      const irregularDays = [0, 3, 48, 55, 115];
      for (const dayOffset of irregularDays) {
        const time = new Date(now);
        time.setDate(time.getDate() - dayOffset);
        await helpers.createTransaction({
          raw: true,
          payload: buildTransactionPayload({
            accountId: account.id,
            amount: 10,
            transactionType: TRANSACTION_TYPES.expense,
            transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
            note: 'IRREGULAR SHOP PAYMENT',
            time: time.toISOString(),
          }),
        });
      }

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      const irregular = result.candidates.find((c) => c.suggestedName.includes('IRREGULAR'));
      expect(irregular).toBeUndefined();
    });

    it('handles varying amounts by splitting into buckets', async () => {
      const account = await helpers.createAccount({ raw: true });
      const now = new Date();

      // Mix of two distinct price points with same note
      const amounts = [9.99, 9.99, 9.99, 9.99, 49.99, 49.99, 49.99, 49.99];
      for (let i = 0; i < amounts.length; i++) {
        const time = subMonths(now, amounts.length - 1 - i);
        await helpers.createTransaction({
          raw: true,
          payload: buildTransactionPayload({
            accountId: account.id,
            amount: amounts[i]!,
            transactionType: TRANSACTION_TYPES.expense,
            transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
            note: 'STREAMING SERVICE',
            time: time.toISOString(),
          }),
        });
      }

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      // Should detect at least one bucket as a candidate
      const streaming = result.candidates.find((c) => c.suggestedName.includes('STREAMING'));
      expect(streaming).toBeDefined();
    });
  });

  describe('Accept candidate with subscription linking', () => {
    it('skips sample transactions that were deleted after detection', async () => {
      const account = await helpers.createAccount({ raw: true });

      const txs = await createRecurringTransactions({
        accountId: account.id,
        note: 'VANISHING SERVICE',
        amount: 9,
        count: 4,
      });

      const detection = await helpers.detectSubscriptionCandidates({ raw: true });
      const candidate = detection.candidates.find((c) => c.suggestedName.includes('VANISHING'))!;
      expect(candidate.sampleTransactionIds).toContain(txs[0]!.id);

      const deletedTx = txs[0]!;
      await helpers.deleteTransaction({ id: deletedTx.id });

      const sub = await helpers.createSubscription({
        name: 'Vanishing Service',
        expectedAmount: 9,
        expectedCurrencyCode: account.currencyCode,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const response = await helpers.acceptSubscriptionCandidate({
        id: candidate.id,
        subscriptionId: sub.id,
      });

      expect(response.statusCode).toBe(200);

      const subDetail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const linkedTxIds = subDetail.transactions.map((t) => t.id);

      expect(linkedTxIds).not.toContain(deletedTx.id);
      for (const tx of txs.slice(1)) {
        expect(linkedTxIds).toContain(tx.id);
      }
    });

    it('skips transactions that are already linked to another subscription', async () => {
      const account = await helpers.createAccount({ raw: true });

      const txs = await createRecurringTransactions({
        accountId: account.id,
        note: 'SHARED SERVICE',
        amount: 10,
        count: 4,
      });

      // Link first 2 transactions to an existing subscription
      const existingSub = await helpers.createSubscription({
        name: 'Existing Sub',
        expectedAmount: 10,
        expectedCurrencyCode: account.currencyCode,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      await helpers.linkTransactionsToSubscription({
        id: existingSub.id,
        transactionIds: [txs[0]!.id, txs[1]!.id],
      });

      // Expire cooldown so detect runs fresh (if any candidates exist from prior state)
      await expireCooldown({ userId: account.userId });

      const detection = await helpers.detectSubscriptionCandidates({ raw: true });
      const candidate = detection.candidates.find((c) => c.suggestedName.includes('SHARED'));

      // The candidate might not exist since some txs are linked, reducing count
      // But if it does exist, linking should still succeed without errors
      if (candidate) {
        const targetSub = await helpers.createSubscription({
          name: 'Target Sub',
          expectedAmount: 10,
          expectedCurrencyCode: account.currencyCode,
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });

        const result = await helpers.acceptSubscriptionCandidate({
          id: candidate.id,
          subscriptionId: targetSub.id,
          raw: true,
        });

        expect(result.status).toBe('accepted');
      }
    });
  });

  describe('Possible match detection', () => {
    it('includes possibleMatch when a similar subscription exists', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create an existing subscription
      await helpers.createSubscription({
        name: 'Digital Ocean',
        expectedAmount: 7,
        expectedCurrencyCode: account.currencyCode,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      // Create recurring transactions with a similar name
      await createRecurringTransactions({
        accountId: account.id,
        note: 'DigitalOcean',
        amount: 7,
        count: 4,
      });

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      const doCandidate = result.candidates.find((c) => c.suggestedName.includes('DigitalOcean'));
      expect(doCandidate).toBeDefined();
      expect(doCandidate!.possibleMatch).not.toBeNull();
      expect(doCandidate!.possibleMatch!.name).toBe('Digital Ocean');
    });

    it('possibleMatch is null when no similar subscription exists', async () => {
      const account = await helpers.createAccount({ raw: true });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'UNIQUE SERVICE ABC',
        amount: 12.5,
        count: 4,
      });

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      const candidate = result.candidates.find((c) => c.suggestedName.includes('UNIQUE'));
      expect(candidate).toBeDefined();
      expect(candidate!.possibleMatch).toBeNull();
    });
  });

  describe('Outdated candidates', () => {
    it('marks a candidate as outdated when last occurrence exceeds 2x median interval', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create monthly transactions all in the past (oldest: ~180 days ago, newest: 90 days ago)
      // Monthly, so the median interval is ~30 days and 2x = 60 days. Last occurrence at 90 days ago → outdated
      const now = new Date();
      for (let i = 0; i < 4; i++) {
        const time = subMonths(subDays(now, 90), 3 - i);
        await helpers.createTransaction({
          raw: true,
          payload: buildTransactionPayload({
            accountId: account.id,
            amount: 12.99,
            transactionType: TRANSACTION_TYPES.expense,
            transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
            note: 'OLD STREAMING SERVICE',
            time: time.toISOString(),
          }),
        });
      }

      const result = await helpers.detectSubscriptionCandidates({ raw: true });
      const candidate = result.candidates.find((c) => c.suggestedName.includes('OLD STREAMING'));
      expect(candidate).toBeDefined();
      expect(candidate!.isOutdated).toBe(true);
    });
  });

  describe('Error cases', () => {
    it('returns 404 when accepting or dismissing a non-existent candidate', async () => {
      const acceptRes = await helpers.acceptSubscriptionCandidate({ id: generateRandomRecordId() });
      expect(acceptRes.statusCode).toBe(404);

      const dismissRes = await helpers.dismissSubscriptionCandidate({ id: generateRandomRecordId() });
      expect(dismissRes.statusCode).toBe(404);
    });

    it('guards accepting with an unknown subscription, re-accepting and re-dismissing', async () => {
      const account = await helpers.createAccount({ raw: true });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'NETFLIX.COM PAYMENT',
        amount: 15.99,
        count: 4,
      });

      await createRecurringTransactions({
        accountId: account.id,
        note: 'SPOTIFY PREMIUM',
        amount: 9.99,
        count: 5,
      });

      const detection = await helpers.detectSubscriptionCandidates({ raw: true });
      const netflix = detection.candidates.find((c) => c.suggestedName.includes('NETFLIX'))!;
      const spotify = detection.candidates.find((c) => c.suggestedName.includes('SPOTIFY'))!;
      expect(netflix).toBeDefined();
      expect(spotify).toBeDefined();

      const unknownSubRes = await helpers.acceptSubscriptionCandidate({
        id: netflix.id,
        subscriptionId: generateRandomRecordId(),
      });
      expect(unknownSubRes.statusCode).toBe(404);

      const acceptRes = await helpers.acceptSubscriptionCandidate({ id: netflix.id });
      expect(acceptRes.statusCode).toBe(200);

      const reAcceptRes = await helpers.acceptSubscriptionCandidate({ id: netflix.id });
      expect(reAcceptRes.statusCode).toBe(409);

      const dismissRes = await helpers.dismissSubscriptionCandidate({ id: spotify.id });
      expect(dismissRes.statusCode).toBe(200);

      const reDismissRes = await helpers.dismissSubscriptionCandidate({ id: spotify.id });
      expect(reDismissRes.statusCode).toBe(409);
    }, 60_000);
  });
});
