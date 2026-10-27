import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import * as Transactions from '@models/transactions.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import {
  assertNotAlreadyLinked,
  restampForExistingTransaction,
  snapshotOriginalTransactionState,
} from '@services/common/transaction-linking';
import { withTransaction } from '@services/common/with-transaction';
import { assertNotInPayment } from '@services/transactions/payment-legs';
import Big from 'big.js';

import { findVentureEventOrThrow } from '../helpers';

interface LinkTxsToEventParams {
  userId: number;
  eventId: string;
  transactionIds: string[];
}

const linkTxsToEventImpl = async ({ userId, eventId, transactionIds }: LinkTxsToEventParams) => {
  if (transactionIds.length === 0) {
    throw new ValidationError({ message: 'At least one transaction must be linked' });
  }
  if (new Set(transactionIds).size !== transactionIds.length) {
    throw new ValidationError({ message: 'Duplicate transaction ids in link request' });
  }

  const event = await findVentureEventOrThrow({ id: eventId, userId });

  if (event.lpNetAmount === null) {
    throw new ValidationError({
      message: 'Cannot link transactions to an event that has no LP net amount',
    });
  }

  const expectedSum = new Big(event.lpNetAmount.toDecimalString(10));
  const eventCurrency = event.currencyCode;

  // Load all txs in one pass
  const txs = await Promise.all(
    transactionIds.map((id) =>
      findOrThrowNotFound({
        query: Transactions.getTransactionById({ id, userId }),
        message: t({ key: 'transactions.notFound' }),
      }),
    ),
  );

  // Validate currencies all match event currency
  const wrongCurrencyTx = txs.find((tx) => tx.currencyCode !== eventCurrency);
  if (wrongCurrencyTx) {
    throw new ValidationError({
      message: `Transaction currency ${wrongCurrencyTx.currencyCode} does not match event currency ${eventCurrency}`,
    });
  }

  // Validate each tx is not already attached to a tracked entity
  for (const tx of txs) {
    await assertNotAlreadyLinked({ tx });
  }
  await assertNotInPayment({ transactionIds });

  // Validate sum-of-amounts matches expected lpNetAmount (using absolute values
  // because tx amount sign depends on transactionType; the link records the
  // magnitude of cash movement).
  const sum = txs.reduce((acc, tx) => acc.plus(new Big(tx.amount.toDecimalString(10)).abs()), new Big(0));
  if (!sum.eq(expectedSum)) {
    throw new ValidationError({
      message: `Sum of linked transactions (${sum.toFixed(2)}) does not match event LP net amount (${expectedSum.toFixed(2)})`,
    });
  }

  // Persist link rows + restamp each tx
  const links: VentureEventLinks[] = [];
  for (const tx of txs) {
    const { refCurrencyCode, refAmount } = await restampForExistingTransaction({ tx, userId });
    const snapshot = snapshotOriginalTransactionState(tx);

    await Transactions.updateTransactionById({
      id: tx.id,
      userId,
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_venture,
      refCurrencyCode,
      refAmount,
    });

    const link = await VentureEventLinks.create({
      ventureEventId: eventId,
      transactionId: tx.id,
      amount: tx.amount.abs(),
      currencyCode: tx.currencyCode,
      linkedAt: new Date(),
      metaData: {
        originalTransactionState: snapshot,
      },
    });

    links.push(link);
  }

  return links;
};

export const linkTxsToEvent = withTransaction(linkTxsToEventImpl);
