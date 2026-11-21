import type { RefundRole } from '@/api/transactions';
import { getCurrencyDecimals, roundToDecimals } from '@/js/helpers/currency-decimals';

import type { RefundWithSplit } from '../types';

export type ConvertAmount = (params: { amount: number; from: string; to: string }) => number | null;

interface RefundShareTarget {
  /** Most the default fill may give this target. `null` = no known bound. */
  cap: number | null;
  /** `cap` is an exchange-rate estimate. */
  isCapApprox?: boolean;
  /** A set share is kept as-is; a missing one gets the default fill. */
  share?: number | null;
}

type RefundShareError = 'nonPositive' | 'exceedsPurchase';

/** One minor unit of the refund currency: the stray amount a rate-rounded cap can leave. */
const orphanUnit = ({ decimals }: { decimals: number }) => 10 ** -decimals;

/** Rounds a share to the refund currency's decimals; `|| 0` turns a NaN share into 0. */
export const roundShare = ({ value, decimals }: { value: number; decimals: number }) =>
  roundToDecimals({ value, decimals }) || 0;

const shareRounder =
  ({ decimals }: { decimals: number }) =>
  ({ value }: { value: number }) =>
    roundShare({ value, decimals });

/**
 * One pass in tick order: each target without a set share takes min(what is left, its cap).
 * The last filled target swallows a stray minor unit left by a rate-rounded cap.
 */
export const fillRefundShares = ({
  targets,
  refundAmount,
  decimals,
}: {
  targets: RefundShareTarget[];
  refundAmount: number;
  /** Decimals of the currency the shares are in. */
  decimals: number;
}): number[] => {
  const round = shareRounder({ decimals });
  const shares = targets.map((target) => (target.share == null ? null : round({ value: target.share })));
  let remaining = round({ value: refundAmount - shares.reduce<number>((sum, share) => sum + (share ?? 0), 0) });
  const fillIndexes = shares.flatMap((share, index) => (share === null ? [index] : []));

  fillIndexes.forEach((index, position) => {
    const { cap, isCapApprox } = targets[index]!;
    const available = Math.max(0, remaining);
    let share = cap === null ? available : Math.min(available, Math.max(0, round({ value: cap })));
    if (
      position === fillIndexes.length - 1 &&
      isCapApprox &&
      round({ value: available - share }) <= orphanUnit({ decimals })
    ) {
      share = available;
    }
    shares[index] = share;
    remaining = round({ value: remaining - share });
  });

  return shares.map((share) => share ?? 0);
};

export const validateRefundShares = ({
  targets,
  refundAmount,
  decimals,
}: {
  targets: { share: number | null | undefined; cap: number | null; isSameCurrency: boolean }[];
  refundAmount: number;
  /** Decimals of the refund currency. */
  decimals: number;
}) => {
  const round = shareRounder({ decimals });
  const errors: (RefundShareError | null)[] = targets.map((target) => {
    if (target.share == null) return 'nonPositive';
    const share = round({ value: target.share });
    if (share <= 0) return 'nonPositive';
    if (target.isSameCurrency && target.cap !== null && share > round({ value: target.cap })) {
      return 'exceedsPurchase';
    }
    return null;
  });
  const warnings = targets.map(
    (target) =>
      !target.isSameCurrency &&
      target.cap !== null &&
      target.share != null &&
      round({ value: target.share - target.cap }) > orphanUnit({ decimals }),
  );
  const assigned = round({ value: targets.reduce((sum, target) => sum + (target.share ?? 0), 0) });
  const isOverAssigned = assigned > round({ value: refundAmount });

  return {
    assigned,
    errors,
    warnings,
    isOverAssigned,
    isValid: !isOverAssigned && errors.every((error) => error === null),
  };
};

export const getRefundTargetBase = ({ link }: { link: RefundWithSplit }) =>
  (link.splitId && link.transaction.splits?.find((split) => split.id === link.splitId)) || link.transaction;

export const refundShareKey = ({ txId, splitId }: { txId: string; splitId?: string | null }) =>
  `${txId}:${splitId ?? ''}`;

/**
 * `cap` is what is left of the purchase (or split), in the refund currency. A split target is
 * also bounded by what is left of the whole purchase, since all its links share that room.
 */
export const getRefundTargetCap = ({
  link,
  refundCurrencyCode,
  decimals,
  savedShares = {},
  convert,
}: {
  link: RefundWithSplit;
  refundCurrencyCode: string | undefined;
  /** Decimals of the refund currency. */
  decimals: number;
  /** This refund's saved shares per `refundShareKey`; `refundedAmount` already includes them. */
  savedShares?: Record<string, number>;
  convert: ConvertAmount;
}) => {
  const round = shareRounder({ decimals });
  const tx = link.transaction;
  const base = getRefundTargetBase({ link });
  const purchaseCurrencyCode = tx.currencyCode;
  const isSameCurrency = purchaseCurrencyCode === refundCurrencyCode;
  const roundPurchase = shareRounder({ decimals: getCurrencyDecimals({ code: purchaseCurrencyCode }) });

  const leftOf = ({
    amount,
    refundedAmount,
    saved,
  }: {
    amount: number;
    refundedAmount?: number | null;
    saved: number;
  }) =>
    Math.max(
      0,
      roundPurchase({ value: amount - Math.max(0, roundPurchase({ value: (refundedAmount ?? 0) - saved })) }),
    );
  // Saving replaces every link of this refund, so all its saved shares on the purchase free room,
  // whichever split is picked now.
  const txSaved = Object.entries(savedShares).reduce(
    (sum, [key, share]) => (key.startsWith(`${tx.id}:`) ? sum + share : sum),
    0,
  );
  const txLeft = leftOf({ amount: tx.amount, refundedAmount: tx.refundedAmount, saved: txSaved });
  const left =
    base === tx
      ? txLeft
      : Math.min(
          txLeft,
          leftOf({
            amount: base.amount,
            refundedAmount: base.refundedAmount,
            saved: savedShares[refundShareKey({ txId: tx.id, splitId: link.splitId })] ?? 0,
          }),
        );
  const shared = {
    isSameCurrency,
    purchaseAmount: base.amount,
    refundedByOthers: roundPurchase({ value: base.amount - left }),
  };

  if (isSameCurrency) return { ...shared, cap: left, isCapApprox: false };

  const converted = refundCurrencyCode
    ? convert({ amount: left, from: purchaseCurrencyCode, to: refundCurrencyCode })
    : null;
  if (converted === null) return { ...shared, cap: null, isCapApprox: true };

  // A remainder that converts below one minor unit must still be tickable.
  return {
    ...shared,
    cap: left > 0 ? Math.max(orphanUnit({ decimals }), round({ value: converted })) : 0,
    isCapApprox: true,
  };
};

/** Unset means "as saved": a saved share is kept, a saved whole-refund link (`null`) is refilled. */
export const isRefundShareAdjusted = ({ link }: { link: RefundWithSplit }) => link.isAdjusted ?? link.amount != null;

export const refillRefundLinks = ({
  links,
  refundAmount,
  refundCurrencyCode,
  decimals,
  savedShares,
  convert,
}: {
  links: RefundWithSplit[];
  refundAmount: number;
  refundCurrencyCode: string | undefined;
  /** Decimals of the refund currency. */
  decimals: number;
  savedShares: Record<string, number>;
  convert: ConvertAmount;
}): RefundWithSplit[] => {
  const shares = fillRefundShares({
    refundAmount,
    decimals,
    targets: links.map((link) => {
      const { cap, isCapApprox } = getRefundTargetCap({
        link,
        refundCurrencyCode,
        decimals,
        savedShares,
        convert,
      });
      return { cap, isCapApprox, share: isRefundShareAdjusted({ link }) ? link.amount : null };
    }),
  });
  return links.map((link, index) => ({ ...link, amount: shares[index]! }));
};

/**
 * Purchase side: same-currency refunds fill the purchase in tick order, each capped by its own
 * amount. Cross-currency ones are never capped, so a freshly ticked one links whole (`undefined`).
 */
export const refillRefundedByLinks = ({
  links,
  purchaseAmount,
  purchaseCurrencyCode,
  decimals,
}: {
  links: RefundWithSplit[];
  purchaseAmount: number;
  purchaseCurrencyCode: string | undefined;
  /** Decimals of the purchase currency. */
  decimals: number;
}): RefundWithSplit[] => {
  const isSameCurrency = ({ link }: { link: RefundWithSplit }) =>
    link.transaction.currencyCode === purchaseCurrencyCode;
  const sameCurrencyLinks = links.filter((link) => isSameCurrency({ link }));
  const shares = fillRefundShares({
    refundAmount: purchaseAmount,
    decimals,
    targets: sameCurrencyLinks.map((link) => ({
      cap: link.transaction.amount,
      share: isRefundShareAdjusted({ link }) ? (link.amount ?? link.transaction.amount) : null,
    })),
  });

  return links.map((link) => {
    if (isRefundShareAdjusted({ link })) return link;
    if (!isSameCurrency({ link })) return link.isAdjusted === false ? { ...link, amount: undefined } : link;
    return { ...link, amount: shares[sameCurrencyLinks.indexOf(link)]! };
  });
};

export const refillRefundSide = ({
  links,
  role,
  amount,
  currencyCode,
  decimals,
  savedShares,
  convert,
}: {
  links: RefundWithSplit[];
  role: RefundRole | null;
  amount: number | null | undefined;
  currencyCode: string | undefined;
  /** Decimals of `currencyCode`, the current transaction's currency. */
  decimals: number;
  savedShares: Record<string, number> | undefined;
  convert: ConvertAmount;
}): RefundWithSplit[] => {
  if (!amount || amount <= 0) return links;
  return role === 'original'
    ? refillRefundedByLinks({ links, purchaseAmount: amount, purchaseCurrencyCode: currencyCode, decimals })
    : refillRefundLinks({
        links,
        refundAmount: amount,
        refundCurrencyCode: currencyCode,
        decimals,
        savedShares: savedShares ?? {},
        convert,
      });
};

/** A single target holding the whole refund is stored as `amount: null`, the API's "whole refund". */
export const finalizeRefundShares = ({
  links,
  refundAmount,
  decimals,
}: {
  links: RefundWithSplit[];
  refundAmount: number | null | undefined;
  /** Decimals of the refund currency. */
  decimals: number;
}): RefundWithSplit[] => {
  const [single] = links;
  if (links.length !== 1 || !single) return links;
  if (
    single.amount == null ||
    (refundAmount != null &&
      roundShare({ value: single.amount, decimals }) === roundShare({ value: refundAmount, decimals }))
  ) {
    return [{ ...single, amount: null }];
  }
  return links;
};
