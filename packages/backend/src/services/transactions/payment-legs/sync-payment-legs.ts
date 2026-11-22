import { ACCOUNT_TYPES, MAX_PAYMENT_LEGS, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { UnexpectedError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import TransactionSplits from '@models/transaction-splits.model';
import TransactionTags from '@models/transaction-tags.model';
import { findOneTransaction } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { isPreBookingRow } from '@services/bank-data-providers/enablebanking/utils/transaction-metadata';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { roundPositiveAmount } from '@services/transactions/round-positive-amount';
import { Op } from 'sequelize';

import { findPaymentRows } from './find-payment-rows';
import { findIdsInPayments, isLinkedLeg } from './in-payment';
import { pickLinkFields, unlinkPaymentLeg } from './unlink-payment-legs';

export type PaymentLegParam =
  | { transactionId: string; accountId?: undefined; amount?: Money; paymentAmount?: Money }
  | { transactionId?: undefined; accountId: string; amount: Money; paymentAmount?: Money };

const invalid = ({ key }: { key: string }) => new ValidationError({ message: t({ key }) });

const ownsAccount = ({ accountId, userId }: { accountId: string; userId: number }) =>
  Accounts.count({ where: { id: accountId, userId } });

const assertMainCanHoldLegs = async ({ main, ownerId }: { main: Transactions.default; ownerId: number | null }) => {
  const [splitsCount, ownsMainAccount] = await Promise.all([
    TransactionSplits.count({ where: { transactionId: main.id } }),
    ownerId === null || ownsAccount({ accountId: main.accountId, userId: ownerId }),
  ]);

  if (
    main.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer ||
    main.isPlanned ||
    (ownerId !== null && main.refundLinked) ||
    main.paymentParentId ||
    isPreBookingRow({ tx: main }) ||
    splitsCount > 0 ||
    !ownsMainAccount
  ) {
    throw invalid({ key: 'transactions.paymentLegsNotAllowed' });
  }
};

const getTagIds = async ({ transactionId }: { transactionId: string }) =>
  (await TransactionTags.findAll({ where: { transactionId }, attributes: ['tagId'], raw: true })).map(
    (row) => row.tagId,
  );

/**
 * The share a cross-currency leg pays, in the main row's currency. The user enters it, so it rounds
 * half-up to that currency's decimals; a stored share is already there and stays as it is.
 */
const resolvePaymentAmount = async ({
  userId,
  main,
  currencyCode,
  paymentAmount,
  storedShare,
}: {
  userId: number;
  main: Transactions.default;
  currencyCode: string;
  paymentAmount: Money | undefined;
  storedShare?: Money | null;
}) => {
  if (currencyCode === main.currencyCode) return null;
  if (paymentAmount) return roundPositiveAmount({ money: paymentAmount, userId, currencyCode: main.currencyCode });
  if (!storedShare) throw invalid({ key: 'transactions.paymentAmountRequired' });
  return storedShare;
};

const legRefAmount = ({
  userId,
  definitionOwnerUserId,
  main,
  amount,
  currencyCode,
}: {
  userId: number;
  definitionOwnerUserId: number;
  main: Transactions.default;
  amount: Money;
  currencyCode: string;
}) =>
  calculateRefAmount({
    userId,
    definitionOwnerUserId,
    amount,
    baseCode: currencyCode,
    quoteCode: main.refCurrencyCode,
    date: main.time,
  });

const createdLegFields = ({ main, amount }: { main: Transactions.default; amount: Money }) => ({
  amount,
  transactionType: main.transactionType,
  categoryId: main.categoryId,
  note: main.note,
  time: main.time,
  location: main.location,
  externalUrl: main.externalUrl,
  externalReference: main.externalReference,
  payeeId: main.payeeId,
  // Keeps background payee linking off the copy, so it can't drift from the main row.
  payeeLocked: true,
  categorizationMeta: main.categorizationMeta,
  excludeFromStats: main.excludeFromStats,
});

const createLeg = async ({
  userId,
  main,
  accountId,
  amount,
  paymentAmount,
}: {
  userId: number;
  main: Transactions.default;
  accountId: string;
  amount: Money;
  paymentAmount?: Money;
}) => {
  const account = await Accounts.findOne({
    where: { id: accountId, userId },
    attributes: ['id', 'type', 'currencyCode', 'defaultPaymentType'],
  });
  if (!account || account.type !== ACCOUNT_TYPES.system || account.id === main.accountId) {
    throw invalid({ key: 'transactions.paymentLegInvalidAccount' });
  }
  const legAmount = await roundPositiveAmount({ money: amount, userId, currencyCode: account.currencyCode });

  const leg = await Transactions.createTransaction({
    ...createdLegFields({ main, amount: legAmount }),
    paymentType: account.defaultPaymentType ?? main.paymentType,
    refAmount: await legRefAmount({
      userId,
      definitionOwnerUserId: userId,
      main,
      amount: legAmount,
      currencyCode: account.currencyCode,
    }),
    userId,
    definitionOwnerUserId: userId,
    accountId,
    currencyCode: account.currencyCode,
    refCurrencyCode: main.refCurrencyCode,
    accountType: account.type,
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    paymentParentId: main.id,
    paymentAmount: await resolvePaymentAmount({ userId, main, currencyCode: account.currencyCode, paymentAmount }),
  });
  await leg!.$set('tags', await getTagIds({ transactionId: main.id }));
};

const linkLeg = async ({
  userId,
  main,
  transactionId,
}: {
  userId: number;
  main: Transactions.default;
  transactionId: string;
}) => {
  // The policies exclude planned rows, transfers, balance adjustments, and soft-deleted or merged rows.
  // The row lock makes a concurrent link of the same row wait, then miss on `paymentParentId: null`.
  const row = await findOneTransaction({
    planned: 'exclude',
    access: { accountOwner: userId },
    balanceAdjustments: 'exclude',
    transfers: 'exclude',
    where: {
      id: { [Op.eq]: transactionId, [Op.ne]: main.id },
      accountId: { [Op.ne]: main.accountId },
      refundLinked: false,
      paymentParentId: null,
      transactionType: main.transactionType,
    },
    lock: true,
  });
  if (!row) throw invalid({ key: 'transactions.paymentLinkNotAllowed' });

  const [splitsCount, idsInPayments] = await Promise.all([
    TransactionSplits.count({ where: { transactionId } }),
    findIdsInPayments({ transactionIds: [transactionId] }),
  ]);
  if (splitsCount || idsInPayments.length || isPreBookingRow({ tx: row })) {
    throw invalid({ key: 'transactions.paymentLinkNotAllowed' });
  }

  return Transactions.updateTransactionById({
    id: row.id,
    userId: row.userId,
    paymentParentId: main.id,
    paymentLinkSnapshot: { ...pickLinkFields({ row }), tagIds: await getTagIds({ transactionId: row.id }) },
  });
};

/** The main row may have moved, so every leg is rechecked against the main account's owner. */
const assertLegAccounts = async ({ main, legs }: { main: Transactions.default; legs: Transactions.default[] }) => {
  const accounts = await Accounts.findAll({
    where: { id: { [Op.in]: [...new Set([main.accountId, ...legs.map((leg) => leg.accountId)])] } },
    attributes: ['id', 'userId'],
  });
  const ownerId = accounts.find((account) => account.id === main.accountId)?.userId;
  if (ownerId === undefined) throw new UnexpectedError({ message: `Account ${main.accountId} does not exist` });
  if (legs.some((leg) => leg.accountId === main.accountId) || accounts.some((account) => account.userId !== ownerId)) {
    throw invalid({ key: 'transactions.paymentLegInvalidAccount' });
  }
  return ownerId;
};

/**
 * Writes the main row's shared fields to existing legs. A created leg takes the full set; a
 * linked leg takes only `PAYMENT_LINK_FIELDS`, so its own amount, time and bank fields stay.
 */
const copyToLegs = async ({
  main,
  legs,
  staleConversions,
}: {
  main: Transactions.default;
  legs: { row: Transactions.default; amount?: Money; paymentAmount?: Money }[];
  /** The main's currency changed, so a stored `paymentAmount` is in the wrong currency and must be resent. */
  staleConversions: boolean;
}) => {
  if (!legs.length) return;
  // A leg's author may be a collaborator; the account owner's definition of the currency rounds its amounts.
  const ownerId = await assertLegAccounts({ main, legs: legs.map(({ row }) => row) });
  const tagIds = await getTagIds({ transactionId: main.id });

  for (const { row, amount: requestedAmount, paymentAmount } of legs) {
    const amount = requestedAmount
      ? await roundPositiveAmount({ money: requestedAmount, userId: ownerId, currencyCode: row.currencyCode })
      : row.amount;
    const isLinked = isLinkedLeg(row);
    if (isLinked && row.transactionType !== main.transactionType) {
      throw invalid({ key: 'transactions.paymentLinkedTypeMismatch' });
    }
    // Recomputed only when its inputs changed, so an unrelated edit never needs a rate lookup.
    const refInputsChanged =
      !amount.equals(row.amount) ||
      row.time.getTime() !== main.time.getTime() ||
      row.refCurrencyCode !== main.refCurrencyCode;

    // A new amount makes the stored share stale too, so a cross-currency leg must resend it.
    const storedShare = staleConversions || !amount.equals(row.amount) ? null : row.paymentAmount;

    const updated = await Transactions.updateTransactionById({
      id: row.id,
      userId: row.userId,
      definitionOwnerUserId: ownerId,
      paymentAmount: await resolvePaymentAmount({
        userId: ownerId,
        main,
        currencyCode: row.currencyCode,
        paymentAmount,
        storedShare,
      }),
      ...(isLinked ? { ...pickLinkFields({ row: main }), payeeLocked: true } : createdLegFields({ main, amount })),
      ...(!isLinked &&
        refInputsChanged && {
          refAmount: await legRefAmount({
            userId: row.userId,
            definitionOwnerUserId: ownerId,
            main,
            amount,
            currencyCode: row.currencyCode,
          }),
          refCurrencyCode: main.refCurrencyCode,
        }),
    });
    await updated.$set('tags', tagIds);
  }
};

/**
 * Brings the other rows of a multi-account payment in line with its main row. `legs` undefined
 * re-copies the shared fields to the current legs; `null` or `[]` removes them all; an array is
 * the full new set, matched to the current legs by `transactionId`. A removed leg the payment
 * created is deleted, a linked one is restored to a standalone row.
 */
export const syncPaymentLegs = withTransaction(
  async ({
    userId,
    mainTxId,
    legs,
    mainCurrencyChanged = false,
  }: {
    userId: number;
    mainTxId: string;
    legs?: PaymentLegParam[] | null;
    mainCurrencyChanged?: boolean;
  }) => {
    const findLegs = ({ ids }: { ids?: string[] } = {}) =>
      findPaymentRows({ where: { paymentParentId: mainTxId, ...(ids && { id: { [Op.in]: ids } }) } });
    const findMain = () =>
      findOrThrowNotFound({
        query: Transactions.default.findByPk(mainTxId),
        message: t({ key: 'transactions.notFound' }),
      });

    const current = await findLegs();

    if (legs === undefined) {
      if (!current.length) return;
      const main = await findMain();
      // A plain re-copy runs on any edit of the main, including a share recipient's.
      await assertMainCanHoldLegs({ main, ownerId: null });
      await copyToLegs({ main, staleConversions: mainCurrencyChanged, legs: current.map((row) => ({ row })) });
      return;
    }

    const desired = legs ?? [];
    if (!current.length && !desired.length) return;
    const keptIds = desired.flatMap((leg) => (leg.transactionId ? [leg.transactionId] : []));

    // Checked before any removal, so only the main account's owner can drop the payment's rows.
    const main = await findMain();
    if (desired.length) {
      await assertMainCanHoldLegs({ main, ownerId: userId });
    } else if (!(await ownsAccount({ accountId: main.accountId, userId }))) {
      throw invalid({ key: 'transactions.paymentLegsNotAllowed' });
    }
    if (desired.length > MAX_PAYMENT_LEGS || new Set(keptIds).size !== keptIds.length) {
      throw invalid({ key: 'transactions.paymentLinkNotAllowed' });
    }
    const createdAccountIds = desired.flatMap((leg) => {
      if (leg.accountId) return [leg.accountId];
      const row = current.find((item) => item.id === leg.transactionId);
      return row && !isLinkedLeg(row) ? [row.accountId] : [];
    });
    if (new Set(createdAccountIds).size !== createdAccountIds.length) {
      throw invalid({ key: 'transactions.paymentLegDuplicateAccount' });
    }

    for (const leg of current) {
      if (keptIds.includes(leg.id)) continue;
      if (isLinkedLeg(leg)) await unlinkPaymentLeg({ leg });
      else await Transactions.deleteTransactionById({ id: leg.id, userId: leg.userId });
    }
    if (!desired.length) return;

    for (const leg of desired) {
      if (leg.transactionId && !current.some((row) => row.id === leg.transactionId)) {
        await linkLeg({ userId, main, transactionId: leg.transactionId });
      }
    }

    const rows = keptIds.length ? await findLegs({ ids: keptIds }) : [];
    await copyToLegs({
      main,
      staleConversions: mainCurrencyChanged,
      legs: rows.map((row) => {
        const input = desired.find((leg) => leg.transactionId === row.id)!;
        if (isLinkedLeg(row) && input.amount && !input.amount.equals(row.amount)) {
          throw invalid({ key: 'transactions.paymentLinkedAmountFixed' });
        }
        return { row, amount: input.amount, paymentAmount: input.paymentAmount };
      }),
    });

    for (const leg of desired) {
      if (leg.accountId) {
        await createLeg({
          userId,
          main,
          accountId: leg.accountId,
          amount: leg.amount,
          paymentAmount: leg.paymentAmount,
        });
      }
    }
  },
);

/** Re-copies the shared fields of each payment among `mainIds`, for writers that change a main row in bulk. */
export const syncLegsOfMains = async ({ mainIds }: { mainIds: string[] }) => {
  if (!mainIds.length) return;
  const legs = await findPaymentRows({
    where: { paymentParentId: { [Op.in]: mainIds } },
    attributes: ['userId', 'paymentParentId'],
  });
  const userIdByMainId = new Map(legs.map((leg) => [leg.paymentParentId!, leg.userId]));
  for (const [mainTxId, userId] of userIdByMainId) {
    await syncPaymentLegs({ userId, mainTxId });
  }
};
