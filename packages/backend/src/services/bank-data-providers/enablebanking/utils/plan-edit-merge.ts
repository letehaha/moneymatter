import { CATEGORIZATION_SOURCE, type CategorizationMeta, PAYMENT_TYPES } from '@bt/shared/types';

/**
 * User-mutable scalars the merge policy reads. Declared locally so this module
 * stays free of model imports and remains unit-testable.
 */
export interface EditMergeSide {
  note: string | null;
  categoryId: string;
  paymentType: PAYMENT_TYPES;
  payeeId: string | null;
  payeeLocked: boolean;
  categorizationMeta: CategorizationMeta | null;
}

type EditMergeValues = Partial<{
  note: string;
  categoryId: string;
  paymentType: PAYMENT_TYPES;
  payeeId: string | null;
  payeeLocked: boolean;
  categorizationMeta: CategorizationMeta | null;
}>;

export type EditMergeSkipReason =
  | 'note_conflict'
  | 'category_conflict'
  | 'legacy_category_conflict'
  | 'payment_type_conflict'
  | 'payee_conflict';

type EditMergePlan =
  | { action: 'merge'; valuesToMove: EditMergeValues }
  | { action: 'skip'; reason: EditMergeSkipReason };

/**
 * How strong the "a human picked this category" evidence on one side is.
 * `legacy` is the null-stamp heuristic – payee-hint auto-categorization also
 * writes a non-default category with no stamp, so it is weaker evidence: it is
 * still moved when the other side is uncontested, but two legacy sides that
 * disagree yield `legacy_category_conflict` rather than `category_conflict`.
 */
type CategorizationSignal = 'manual' | 'legacy' | 'none';

function categorizationSignal({
  side,
  defaultCategoryId,
}: {
  side: EditMergeSide;
  defaultCategoryId: string;
}): CategorizationSignal {
  if (side.categorizationMeta) {
    return side.categorizationMeta.source === CATEGORIZATION_SOURCE.manual ? 'manual' : 'none';
  }
  return side.categoryId !== defaultCategoryId ? 'legacy' : 'none';
}

/** Sync writes the account default, or `bankTransfer` on rows synced before the default was set/changed. */
export function isSyncPaymentType({
  paymentType,
  defaultPaymentType,
}: {
  paymentType: PAYMENT_TYPES;
  defaultPaymentType: PAYMENT_TYPES | null;
}): boolean {
  return paymentType === PAYMENT_TYPES.bankTransfer || paymentType === defaultPaymentType;
}

export function hasManualStamp({ meta }: { meta: CategorizationMeta | null }): boolean {
  return meta?.source === CATEGORIZATION_SOURCE.manual;
}

/**
 * Decides which of a duplicate row's user edits move onto the survivor before
 * it is deleted. Edits only ever move off the orphan; when both sides were
 * edited to different values there is no winner to pick, so the pair is skipped.
 *
 * The survivor never ends up with a weaker categorization stamp than either
 * side had: a manual stamp on the canonical is never overwritten, and a moved
 * category always arrives with a manual stamp so the next AI run leaves it alone.
 */
export function planEditMerge({
  orphan,
  canonical,
  orphanSyncNote,
  canonicalSyncNote,
  defaultCategoryId,
  defaultPaymentType,
  now,
}: {
  orphan: EditMergeSide;
  canonical: EditMergeSide;
  orphanSyncNote: string | null;
  canonicalSyncNote: string | null;
  defaultCategoryId: string;
  defaultPaymentType: PAYMENT_TYPES | null;
  now: Date;
}): EditMergePlan {
  const valuesToMove: EditMergeValues = {};

  // Null/empty note counts as "not set" so a sync-default empty note never blocks.
  const orphanNote = orphan.note ?? '';
  const canonicalNote = canonical.note ?? '';
  if (orphanNote !== canonicalNote) {
    const orphanEdited = orphanNote !== '' && orphanNote !== orphanSyncNote;
    const canonicalEdited = canonicalNote !== '' && canonicalNote !== canonicalSyncNote;
    if (orphanEdited && canonicalEdited) return { action: 'skip', reason: 'note_conflict' };
    if (orphanEdited) valuesToMove.note = orphanNote;
  }

  const orphanCategorization = categorizationSignal({ side: orphan, defaultCategoryId });
  const canonicalCategorization = categorizationSignal({ side: canonical, defaultCategoryId });

  if (orphan.categoryId !== canonical.categoryId) {
    if (orphanCategorization !== 'none' && canonicalCategorization !== 'none') {
      const anyManual = orphanCategorization === 'manual' || canonicalCategorization === 'manual';
      return { action: 'skip', reason: anyManual ? 'category_conflict' : 'legacy_category_conflict' };
    }
    if (orphanCategorization !== 'none') {
      valuesToMove.categoryId = orphan.categoryId;
      // Without a stamp the survivor stays an AI-categorization candidate and the
      // next run overwrites the category that was just moved onto it. A legacy
      // orphan has no stamp to carry, so state the manual intent explicitly.
      valuesToMove.categorizationMeta = orphan.categorizationMeta ?? {
        source: CATEGORIZATION_SOURCE.manual,
        categorizedAt: now.toISOString(),
      };
    }
  } else if (
    hasManualStamp({ meta: orphan.categorizationMeta }) &&
    !hasManualStamp({ meta: canonical.categorizationMeta })
  ) {
    // Same category, but only the orphan proves a human chose it. Losing that
    // stamp would put the survivor back in the AI queue.
    valuesToMove.categorizationMeta = orphan.categorizationMeta;
  }

  if (orphan.paymentType !== canonical.paymentType) {
    const orphanEdited = !isSyncPaymentType({ paymentType: orphan.paymentType, defaultPaymentType });
    const canonicalEdited = !isSyncPaymentType({ paymentType: canonical.paymentType, defaultPaymentType });
    if (orphanEdited && canonicalEdited) return { action: 'skip', reason: 'payment_type_conflict' };
    if (orphanEdited) valuesToMove.paymentType = orphan.paymentType;
  }

  // payeeLocked is the model's marker for "user explicitly assigned or cleared payeeId".
  if (orphan.payeeLocked) {
    if (canonical.payeeLocked) {
      if (orphan.payeeId !== canonical.payeeId) return { action: 'skip', reason: 'payee_conflict' };
    } else {
      valuesToMove.payeeId = orphan.payeeId;
      valuesToMove.payeeLocked = true;
    }
  }

  return { action: 'merge', valuesToMove };
}
