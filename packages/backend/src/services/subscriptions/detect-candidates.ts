import { SUBSCRIPTION_CANDIDATE_STATUS, SUBSCRIPTION_LINK_STATUS, TRANSACTION_TYPES } from '@bt/shared/types';
import { logger } from '@js/utils';
import SubscriptionCandidates from '@models/subscription-candidates.model';
import Subscriptions from '@models/subscriptions.model';
import { findTransactions } from '@models/transactions-query';
import { Op, QueryTypes } from 'sequelize';

import {
  TransactionForGrouping,
  TransactionGroup,
  buildGroupingKey,
  computeCV,
  computeConfidenceScore,
  computeIntervals,
  computeMedian,
  findMostCommonNote,
  groupTransactionsBySignature,
  mapIntervalToFrequency,
  normalizeNote,
  splitByAmountBuckets,
} from './detect-candidates-utils';
import { type SerializedCandidate, serializeCandidate } from './serialize-candidate';

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const LOOKBACK_MONTHS = 12;
const MAX_CANDIDATES_PER_RUN = 50;
const MIN_OCCURRENCES = 3;
const AMOUNT_CV_THRESHOLD = 0.2;
const INTERVAL_CV_THRESHOLD = 0.5;
const MAX_SAMPLE_TRANSACTIONS = 10;
// Matches the SubscriptionCandidates.suggestedName column width.
const MAX_SUGGESTED_NAME_LENGTH = 200;

interface DetectCandidatesParams {
  userId: number;
}

interface DetectCandidatesResult {
  candidates: SerializedCandidate[];
  lastRunAt: string | null;
  isFromCache: boolean;
}

/**
 * Detect subscription candidates for a user. Returns cached results if
 * detection ran within the cooldown period, otherwise runs fresh detection.
 */
export async function detectCandidates({ userId }: DetectCandidatesParams): Promise<DetectCandidatesResult> {
  // Check cooldown: find the most recent detectedAt for this user
  const mostRecent = await SubscriptionCandidates.findOne({
    where: { userId },
    order: [['detectedAt', 'DESC']],
    attributes: ['detectedAt'],
  });

  const lastRunAt = mostRecent?.detectedAt ?? null;

  // Fetch user's subscriptions for fuzzy matching
  const userSubscriptions = await Subscriptions.findAll({
    where: { userId },
    attributes: ['id', 'name'],
    raw: true,
  });

  if (lastRunAt && Date.now() - new Date(lastRunAt).getTime() < COOLDOWN_MS) {
    // Return cached candidates
    const cached = await SubscriptionCandidates.findAll({
      where: { userId, status: SUBSCRIPTION_CANDIDATE_STATUS.pending },
      order: [['confidenceScore', 'DESC']],
    });

    return {
      candidates: cached.map((c) => serializeCandidate({ candidate: c, userSubscriptions })),
      lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
      isFromCache: true,
    };
  }

  // Run fresh detection (saves new candidates to DB)
  await runDetection({ userId });

  // Return ALL pending candidates (newly created + previously pending)
  const allPending = await SubscriptionCandidates.findAll({
    where: { userId, status: SUBSCRIPTION_CANDIDATE_STATUS.pending },
    order: [['confidenceScore', 'DESC']],
  });

  return {
    candidates: allPending.map((c) => serializeCandidate({ candidate: c, userSubscriptions })),
    lastRunAt: new Date().toISOString(),
    isFromCache: false,
  };
}

/**
 * Core detection engine: fetches qualifying transactions, groups them,
 * analyzes patterns, and saves candidates.
 */
export async function runDetection({ userId }: { userId: number }): Promise<SubscriptionCandidates[]> {
  // Fetch qualifying transactions (last 12 months)
  const sinceDate = new Date();
  sinceDate.setMonth(sinceDate.getMonth() - LOOKBACK_MONTHS);

  // Get transaction IDs already linked to active subscriptions
  const linkedTxIds: { transactionId: string }[] = await SubscriptionCandidates.sequelize!.query(
    `SELECT "transactionId" FROM "SubscriptionTransactions" WHERE "status" = :status`,
    {
      replacements: { status: SUBSCRIPTION_LINK_STATUS.active },
      type: QueryTypes.SELECT,
    },
  );
  const linkedSet = new Set(linkedTxIds.map((r) => r.transactionId));

  const rawTransactions = await findTransactions({
    where: {
      transactionType: TRANSACTION_TYPES.expense,
      refundLinked: false,
      paymentParentId: null,
      time: { [Op.gte]: sinceDate },
      note: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] },
    },
    planned: 'exclude',
    access: { creator: userId },
    transfers: 'exclude',
    balanceAdjustments: 'include',
    completeness: 'all',
    attributes: ['id', 'amount', 'note', 'time', 'accountId', 'currencyCode'],
    order: [['time', 'ASC']],
  });

  // Map to TransactionForGrouping (amount as cents number) and filter out linked transactions
  const transactions: TransactionForGrouping[] = rawTransactions
    .filter((tx) => !linkedSet.has(tx.id as string))
    .map((tx) => ({
      id: tx.id as string,
      amount: tx.amount.toCents(),
      note: tx.note,
      time: tx.time,
      accountId: tx.accountId as string,
      currencyCode: tx.currencyCode,
    }));

  if (transactions.length === 0) {
    logger.info(`[detect-candidates] No qualifying transactions for user ${userId}`);
    return [];
  }

  // Group by signature
  let groups = groupTransactionsBySignature({
    transactions,
    minOccurrences: MIN_OCCURRENCES,
  });

  if (groups.length === 0) {
    logger.info(`[detect-candidates] No groups with >= ${MIN_OCCURRENCES} transactions for user ${userId}`);
    return [];
  }

  // Check existing candidates and skip known groups
  const existingCandidates = await SubscriptionCandidates.findAll({
    where: { userId },
    attributes: ['suggestedName', 'accountId', 'currencyCode'],
    raw: true,
  });

  const existingKeys = new Set(
    existingCandidates.map((c) =>
      buildGroupingKey({
        normalizedNote: normalizeNote({ note: c.suggestedName }),
        accountId: c.accountId ?? '',
        currencyCode: c.currencyCode,
      }),
    ),
  );

  groups = groups.filter((group) => {
    const key = buildGroupingKey({
      normalizedNote: group.normalizedNote,
      accountId: group.accountId,
      currencyCode: group.currencyCode,
    });
    return !existingKeys.has(key);
  });

  if (groups.length === 0) {
    logger.info(`[detect-candidates] All groups already have existing candidates for user ${userId}`);
    return [];
  }

  // Analyze each group for amount/timing regularity
  const candidateData: Array<{
    group: TransactionGroup;
    transactions: TransactionForGrouping[];
    confidenceScore: number;
    medianIntervalDays: number;
    intervalCV: number;
  }> = [];

  for (const group of groups) {
    const analyzed = analyzeGroup({ group });
    if (analyzed) {
      candidateData.push(analyzed);
    }
  }

  // Sort by confidence and take top N
  candidateData.sort((a, b) => b.confidenceScore - a.confidenceScore);
  const topCandidates = candidateData.slice(0, MAX_CANDIDATES_PER_RUN);

  // Save candidates
  const now = new Date();
  const created: SubscriptionCandidates[] = [];

  for (const candidate of topCandidates) {
    const { group, transactions: txs, confidenceScore, medianIntervalDays } = candidate;

    const amounts = txs.map((tx) => Math.abs(tx.amount));
    const averageAmount = Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length);
    const frequency = mapIntervalToFrequency({ medianDays: medianIntervalDays });
    const suggestedName = findMostCommonNote({ notes: group.rawNotes }).slice(0, MAX_SUGGESTED_NAME_LENGTH);

    // Sort by time descending for sample IDs and lastOccurrenceAt
    const sortedByTime = txs.toSorted((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    const sampleTransactionIds = sortedByTime.slice(0, MAX_SAMPLE_TRANSACTIONS).map((tx) => tx.id);
    const lastOccurrenceAt = sortedByTime[0] ? new Date(sortedByTime[0].time) : now;

    const record = await SubscriptionCandidates.create({
      userId,
      suggestedName,
      detectedFrequency: frequency,
      averageAmount,
      currencyCode: group.currencyCode,
      accountId: group.accountId,
      sampleTransactionIds,
      occurrenceCount: txs.length,
      confidenceScore: Math.round(confidenceScore * 1000) / 1000,
      medianIntervalDays: Math.round(medianIntervalDays * 10) / 10,
      status: SUBSCRIPTION_CANDIDATE_STATUS.pending,
      detectedAt: now,
      lastOccurrenceAt,
    });

    created.push(record);
  }

  logger.info(`[detect-candidates] Created ${created.length} candidates for user ${userId}`);

  return created;
}

/**
 * Analyze a single group: check amount consistency, timing regularity,
 * compute scores. Returns null if the group doesn't qualify.
 */
function analyzeGroup({ group }: { group: TransactionGroup }): {
  group: TransactionGroup;
  transactions: TransactionForGrouping[];
  confidenceScore: number;
  medianIntervalDays: number;
  intervalCV: number;
} | null {
  let txs = group.transactions;

  // Amount consistency check
  const amounts = txs.map((tx) => Math.abs(tx.amount));
  const amountCV = computeCV({ values: amounts });

  if (amountCV > AMOUNT_CV_THRESHOLD) {
    // Split into amount buckets and find the largest qualifying bucket
    const buckets = splitByAmountBuckets({ transactions: txs });
    const qualifyingBuckets = buckets.filter((b) => b.length >= MIN_OCCURRENCES);

    if (qualifyingBuckets.length === 0) return null;

    // Use the largest qualifying bucket
    txs = qualifyingBuckets.toSorted((a, b) => b.length - a.length)[0]!;
  }

  // Timing regularity
  const dates = txs.map((tx) => new Date(tx.time));
  const intervals = computeIntervals({ dates });

  if (intervals.length === 0) return null;

  const medianIntervalDays = computeMedian({ values: intervals });
  const intervalCV = computeCV({ values: intervals });

  if (intervalCV > INTERVAL_CV_THRESHOLD) return null;

  // Compute confidence score
  const confidenceScore = computeConfidenceScore({
    occurrenceCount: txs.length,
    intervalCV,
  });

  return {
    group,
    transactions: txs,
    confidenceScore,
    medianIntervalDays,
    intervalCV,
  };
}
