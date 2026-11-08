import type { RefundRole } from '@/api/transactions';

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

const ORPHAN_CENT = 0.01;

export const round2 = ({ value }: { value: number }) => Math.round(value * 100) / 100 || 0;

/**
 * One pass in tick order: each target without a set share takes min(what is left, its cap).
 * The last filled target swallows a stray cent left by a rate-rounded cap.
 */
export const fillRefundShares = ({
  targets,
  refundAmount,
}: {
  targets: RefundShareTarget[];
  refundAmount: number;
}): number[] => {
  const shares = targets.map((target) => (target.share == null ? null : round2({ value: target.share })));
  let remaining = round2({ value: refundAmount - shares.reduce<number>((sum, share) => sum + (share ?? 0), 0) });
  const fillIndexes = shares.flatMap((share, index) => (share === null ? [index] : []));

  fillIndexes.forEach((index, position) => {
    const { cap, isCapApprox } = targets[index]!;
    const available = Math.max(0, remaining);
    let share = cap === null ? available : Math.min(available, Math.max(0, round2({ value: cap })));
    if (position === fillIndexes.length - 1 && isCapApprox && round2({ value: available - share }) <= ORPHAN_CENT) {
      share = available;
    }
    shares[index] = share;
    remaining = round2({ value: remaining - share });
  });

  return shares.map((share) => share ?? 0);
};

export const validateRefundShares = ({
  targets,
  refundAmount,
}: {
  targets: { share: number | null | undefined; cap: number | null; isSameCurrency: boolean }[];
  refundAmount: number;
}) => {
  const errors: (RefundShareError | null)[] = targets.map((target) => {
    if (target.share == null) return 'nonPositive';
    const share = round2({ value: target.share });
    if (share <= 0) return 'nonPositive';
    if (target.isSameCurrency && target.cap !== null && share > round2({ value: target.cap })) {
      return 'exceedsPurchase';
    }
    return null;
  });
  const warnings = targets.map(
    (target) =>
      !target.isSameCurrency &&
      target.cap !== null &&
      target.share != null &&
      round2({ value: target.share - target.cap }) > ORPHAN_CENT,
  );
  const assigned = round2({ value: targets.reduce((sum, target) => sum + (target.share ?? 0), 0) });
  const isOverAssigned = assigned > round2({ value: refundAmount });

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
  savedShares = {},
  convert,
}: {
  link: RefundWithSplit;
  refundCurrencyCode: string | undefined;
  /** This refund's saved shares per `refundShareKey`; `refundedAmount` already includes them. */
  savedShares?: Record<string, number>;
  convert: ConvertAmount;
}) => {
  const tx = link.transaction;
  const base = getRefundTargetBase({ link });
  const purchaseCurrencyCode = tx.currencyCode;
  const isSameCurrency = purchaseCurrencyCode === refundCurrencyCode;

  const leftOf = ({
    amount,
    refundedAmount,
    saved,
  }: {
    amount: number;
    refundedAmount?: number | null;
    saved: number;
  }) => Math.max(0, round2({ value: amount - Math.max(0, round2({ value: (refundedAmount ?? 0) - saved })) }));
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
    refundedByOthers: round2({ value: base.amount - left }),
  };

  if (isSameCurrency) return { ...shared, cap: left, isCapApprox: false };

  const converted = refundCurrencyCode
    ? convert({ amount: left, from: purchaseCurrencyCode, to: refundCurrencyCode })
    : null;
  if (converted === null) return { ...shared, cap: null, isCapApprox: true };

  // A remainder that converts below one cent must still be tickable.
  return { ...shared, cap: left > 0 ? Math.max(ORPHAN_CENT, round2({ value: converted })) : 0, isCapApprox: true };
};

/** Unset means "as saved": a saved share is kept, a saved whole-refund link (`null`) is refilled. */
export const isRefundShareAdjusted = ({ link }: { link: RefundWithSplit }) => link.isAdjusted ?? link.amount != null;

export const refillRefundLinks = ({
  links,
  refundAmount,
  refundCurrencyCode,
  savedShares,
  convert,
}: {
  links: RefundWithSplit[];
  refundAmount: number;
  refundCurrencyCode: string | undefined;
  savedShares: Record<string, number>;
  convert: ConvertAmount;
}): RefundWithSplit[] => {
  const shares = fillRefundShares({
    refundAmount,
    targets: links.map((link) => {
      const { cap, isCapApprox } = getRefundTargetCap({
        link,
        refundCurrencyCode,
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
}: {
  links: RefundWithSplit[];
  purchaseAmount: number;
  purchaseCurrencyCode: string | undefined;
}): RefundWithSplit[] => {
  const isSameCurrency = ({ link }: { link: RefundWithSplit }) =>
    link.transaction.currencyCode === purchaseCurrencyCode;
  const sameCurrencyLinks = links.filter((link) => isSameCurrency({ link }));
  const shares = fillRefundShares({
    refundAmount: purchaseAmount,
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
  savedShares,
  convert,
}: {
  links: RefundWithSplit[];
  role: RefundRole | null;
  amount: number | null | undefined;
  currencyCode: string | undefined;
  savedShares: Record<string, number> | undefined;
  convert: ConvertAmount;
}): RefundWithSplit[] => {
  if (!amount || amount <= 0) return links;
  return role === 'original'
    ? refillRefundedByLinks({ links, purchaseAmount: amount, purchaseCurrencyCode: currencyCode })
    : refillRefundLinks({
        links,
        refundAmount: amount,
        refundCurrencyCode: currencyCode,
        savedShares: savedShares ?? {},
        convert,
      });
};

/** A single target holding the whole refund is stored as `amount: null`, the API's "whole refund". */
export const finalizeRefundShares = ({
  links,
  refundAmount,
}: {
  links: RefundWithSplit[];
  refundAmount: number | null | undefined;
}): RefundWithSplit[] => {
  const [single] = links;
  if (links.length !== 1 || !single) return links;
  if (
    single.amount == null ||
    (refundAmount != null && round2({ value: single.amount }) === round2({ value: refundAmount }))
  ) {
    return [{ ...single, amount: null }];
  }
  return links;
};
