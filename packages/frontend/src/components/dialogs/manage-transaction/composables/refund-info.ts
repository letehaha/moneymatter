import { getRefundsForTransaction } from '@/api/refunds';
import { useNotificationCenter } from '@/components/notification-center';
import { useExchangeRates } from '@/composable/data-queries/currencies';
import { ApiErrorResponseError } from '@/js/errors';
import { TRANSACTION_TYPES, TransactionModel } from '@bt/shared/types';
import { Ref, computed, onMounted, ref, watch } from 'vue';

import { FORM_TYPES, RefundWithSplit, UI_FORM_STRUCT } from '../types';
import {
  finalizeRefundShares,
  refillRefundLinks,
  refillRefundedByLinks,
  refundShareKey,
  round2,
} from '../utils/refund-shares';

type RefundStatus = 'refunds' | 'refunded' | null;

const linksKey = ({ links }: { links: RefundWithSplit[] | null | undefined }) =>
  links
    ? links.map((link) => `${link.transaction.id}:${link.splitId ?? ''}:${link.amount ?? ''}`).join(',')
    : String(links);

export const getRefundInfo = ({
  form,
  initialTransaction,
  onRefundLinkCleared,
}: {
  initialTransaction: TransactionModel | undefined;
  form: Ref<UI_FORM_STRUCT>;
  /** Fired when a stale refund link is dropped because the form's type flipped. */
  onRefundLinkCleared?: () => void;
}) => {
  const { addErrorNotification } = useNotificationCenter();
  const { convert } = useExchangeRates();
  const isInitialRefundsDataLoaded = ref(false);
  const isRefundsLoadFailed = ref(false);
  const initialRefundStatus = ref<RefundStatus>(null);
  const originalRefunds = ref<Awaited<ReturnType<typeof getRefundsForTransaction>>>([]);
  const initialRefundsFormSlice = ref<Pick<UI_FORM_STRUCT, 'refundsTx' | 'refundedByTxs'>>({
    refundsTx: undefined,
    refundedByTxs: undefined,
  });

  const refundTransactionsTypeBasedOnFormType = computed(() =>
    form.value.type === FORM_TYPES.expense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
  );

  const isOriginalRefundsOverriden = computed(
    () =>
      linksKey({ links: initialRefundsFormSlice.value.refundsTx }) !== linksKey({ links: form.value.refundsTx }) ||
      linksKey({ links: initialRefundsFormSlice.value.refundedByTxs }) !==
        linksKey({ links: form.value.refundedByTxs }),
  );

  // External links never enter the form, so they must not make a cleared field `null`:
  // that would send a clear and delete them server-side.
  const hasInAppRefundLinks = computed(() =>
    Boolean(initialRefundsFormSlice.value.refundsTx?.length || initialRefundsFormSlice.value.refundedByTxs?.length),
  );

  // A refund's counterpart must be the opposite type; the backend rejects a
  // same-type link. Drop a link left stale by a type toggle, using the same
  // empty value as manual unlink: `null` when the row had in-app links (edit path
  // clears them server-side), `undefined` otherwise.
  watch(refundTransactionsTypeBasedOnFormType, (expectedType) => {
    const emptyValue = hasInAppRefundLinks.value ? null : undefined;
    let cleared = false;

    if (
      form.value.refundsTx &&
      form.value.refundsTx.some((refund) => refund.transaction.transactionType !== expectedType)
    ) {
      form.value.refundsTx = emptyValue;
      cleared = true;
    }

    if (
      form.value.refundedByTxs &&
      form.value.refundedByTxs.some((refund) => refund.transaction.transactionType !== expectedType)
    ) {
      form.value.refundedByTxs = emptyValue;
      cleared = true;
    }

    if (cleared) onRefundLinkCleared?.();
  });

  const loadInitialRefunds = async ({ transaction }: { transaction: TransactionModel }) => {
    const refunds = await getRefundsForTransaction({
      transactionId: transaction.id,
    });

    originalRefunds.value = refunds;

    const refundedBy = refunds.filter((r) => r.originalTxId === transaction.id);
    const refundsTx = refunds.flatMap(({ originalTransaction, refundTxId, splitId, amount }) =>
      refundTxId === transaction.id && originalTransaction
        ? [{ transaction: originalTransaction, splitId: splitId ?? undefined, amount }]
        : [],
    );

    if (refundedBy.length) {
      initialRefundStatus.value = 'refunded';
      initialRefundsFormSlice.value.refundedByTxs = refundedBy.map((i) => ({
        transaction: i.refundTransaction,
        splitId: i.splitId ?? undefined,
        amount: i.amount,
      }));
    } else if (refundsTx.length) {
      initialRefundStatus.value = 'refunds';
      initialRefundsFormSlice.value.refundsTx = refundsTx;
    }
  };

  // `refundedAmount` sums same-currency links only, so only those shares may be subtracted from it.
  const savedRefundShares = computed<Record<string, number>>(() =>
    Object.fromEntries(
      originalRefunds.value.flatMap((link) =>
        link.refundTxId === initialTransaction?.id &&
        link.originalTxId &&
        link.originalTransaction?.currencyCode === link.refundTransaction.currencyCode
          ? [
              [
                refundShareKey({ txId: link.originalTxId, splitId: link.splitId }),
                link.amount ?? link.refundTransaction.amount,
              ],
            ]
          : [],
      ),
    ),
  );

  // Adjusted shares survive an amount change, so a smaller refund can leave them over the total.
  const isRefundSharesOverAssigned = computed(() => {
    const links = form.value.refundsTx;
    if (!links?.length || !form.value.amount) return false;
    const assigned = round2({ value: links.reduce((sum, link) => sum + (link.amount ?? 0), 0) });
    return assigned > round2({ value: Number(form.value.amount) });
  });

  // Adjusted shares survive an amount change but not a currency change: they are in the old currency.
  watch(
    () => [form.value.amount, form.value.account?.currencyCode] as const,
    ([amount, currencyCode], [prevAmount, prevCurrencyCode]) => {
      if (!amount || !currencyCode || !prevCurrencyCode) return;
      if (amount === prevAmount && currencyCode === prevCurrencyCode) return;

      if (form.value.refundsTx?.length) {
        const links =
          currencyCode === prevCurrencyCode
            ? form.value.refundsTx
            : form.value.refundsTx.map((link) => ({ ...link, isAdjusted: false }));
        form.value.refundsTx = finalizeRefundShares({
          links: refillRefundLinks({
            links,
            refundAmount: amount,
            refundCurrencyCode: currencyCode,
            savedShares: savedRefundShares.value,
            convert,
          }),
          refundAmount: amount,
        });
      }

      if (form.value.refundedByTxs?.length) {
        form.value.refundedByTxs = refillRefundedByLinks({
          links: form.value.refundedByTxs,
          purchaseAmount: amount,
          purchaseCurrencyCode: currencyCode,
        });
      }
    },
  );

  const hasExternalRefundLink = computed(() =>
    originalRefunds.value.some((link) => link.refundTxId === initialTransaction?.id && link.originalTxId === null),
  );

  onMounted(async () => {
    if (initialTransaction) {
      try {
        await loadInitialRefunds({ transaction: initialTransaction });
      } catch (error) {
        isRefundsLoadFailed.value = true;
        if (error instanceof ApiErrorResponseError) {
          addErrorNotification(error.data.message ?? error.message);
        } else {
          // eslint-disable-next-line no-console
          console.error(error);
        }
      }
    }
    isInitialRefundsDataLoaded.value = true;
  });

  return {
    initialRefundStatus,
    originalRefunds,
    hasInAppRefundLinks,
    isRefundsLoadFailed,
    hasExternalRefundLink,
    savedRefundShares,
    isRefundSharesOverAssigned,
    refundTransactionsTypeBasedOnFormType,
    isOriginalRefundsOverriden,
    isInitialRefundsDataLoaded,
    initialRefundsFormSlice,
  };
};
