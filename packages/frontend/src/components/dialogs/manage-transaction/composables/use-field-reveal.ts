import type { TransactionOptionalField } from '@bt/shared/types';
import { GlobeIcon, HashIcon, LinkIcon, MapPinIcon, PaperclipIcon, TagIcon, Undo2Icon } from '@lucide/vue';
import { type Component, type MaybeRefOrGetter, computed, ref, toValue, watchEffect } from 'vue';

import type { UI_FORM_STRUCT } from '../types';

export type MountableField = TransactionOptionalField | 'tags' | 'attachments';

const FIELD_CHIPS = {
  tags: { icon: TagIcon, labelKey: 'dialogs.manageTransaction.form.tagsLabel' },
  attachments: { icon: PaperclipIcon, labelKey: 'dialogs.manageTransaction.form.attachments.label' },
  externalUrl: { icon: LinkIcon, labelKey: 'dialogs.manageTransaction.form.externalUrlLabel' },
  externalReference: { icon: HashIcon, labelKey: 'dialogs.manageTransaction.form.externalReferenceLabel' },
  location: { icon: MapPinIcon, labelKey: 'dialogs.manageTransaction.form.location.label' },
  originalAmount: { icon: GlobeIcon, labelKey: 'dialogs.manageTransaction.form.originalAmountLabel' },
} satisfies Record<MountableField, { icon: Component; labelKey: string }>;

const MOUNTABLE_FIELDS = Object.keys(FIELD_CHIPS) as MountableField[];

type AddFieldChip = { key: MountableField | 'refund'; icon: Component; labelKey: string; onClick: () => void };

export const useFieldReveal = ({
  form,
  hasPendingAttachments,
  isMobileView,
  isSavedTransaction,
  isTransferTx,
  isLoanDestination,
  isAttachmentsAvailable,
  isRefundAvailable,
  isRefundLinked,
  isOptionalFieldEnabled,
  onLinkRefund,
  onReveal,
}: {
  form: MaybeRefOrGetter<UI_FORM_STRUCT>;
  hasPendingAttachments: MaybeRefOrGetter<boolean>;
  isMobileView: MaybeRefOrGetter<boolean>;
  isSavedTransaction: MaybeRefOrGetter<boolean>;
  isTransferTx: MaybeRefOrGetter<boolean>;
  isLoanDestination: MaybeRefOrGetter<boolean>;
  isAttachmentsAvailable: MaybeRefOrGetter<boolean>;
  isRefundAvailable: MaybeRefOrGetter<boolean>;
  isRefundLinked: MaybeRefOrGetter<boolean>;
  isOptionalFieldEnabled: (field: TransactionOptionalField) => boolean;
  onLinkRefund: () => void;
  onReveal: ({ field }: { field: MountableField }) => void;
}) => {
  // Fields mount in their fixed template slots, so click order never changes the layout.
  const mounted = ref(new Set<MountableField>());

  // A field that once held a value stays mounted, so clearing it never pulls the field away mid-edit.
  watchEffect(() => {
    const values = toValue(form);
    const hasValue: Record<MountableField, boolean> = {
      tags: !!values.tagIds?.length,
      attachments: toValue(hasPendingAttachments),
      externalUrl: !!values.externalUrl,
      externalReference: !!values.externalReference,
      location: values.latitude != null || values.longitude != null,
      originalAmount: values.originalAmount != null || !!values.originalCurrency,
    };
    for (const field of MOUNTABLE_FIELDS) if (hasValue[field]) mounted.value.add(field);
  });

  const shown = computed<Record<MountableField, boolean>>(() => {
    const isMounted = (field: MountableField) => mounted.value.has(field);
    return {
      tags: !toValue(isMobileView) || isMounted('tags'),
      // A saved row's attachment count is only known once the section itself fetches it.
      attachments: !toValue(isMobileView) || toValue(isSavedTransaction) || isMounted('attachments'),
      externalUrl: isMounted('externalUrl'),
      externalReference: isMounted('externalReference'),
      location: isMounted('location'),
      originalAmount: isMounted('originalAmount'),
    };
  });

  const mount = ({ field }: { field: MountableField }) => {
    mounted.value.add(field);
    onReveal({ field });
  };

  const chips = computed(() => {
    const isOffered: Record<MountableField, boolean> = {
      tags: !toValue(isLoanDestination),
      attachments: toValue(isAttachmentsAvailable),
      externalUrl: isOptionalFieldEnabled('externalUrl'),
      externalReference: isOptionalFieldEnabled('externalReference'),
      location: isOptionalFieldEnabled('location'),
      originalAmount: isOptionalFieldEnabled('originalAmount') && !toValue(isTransferTx),
    };
    const result: AddFieldChip[] = MOUNTABLE_FIELDS.filter((field) => isOffered[field] && !shown.value[field]).map(
      (field) => ({ key: field, ...FIELD_CHIPS[field], onClick: () => mount({ field }) }),
    );
    if (toValue(isRefundAvailable) && !toValue(isRefundLinked)) {
      result.push({
        key: 'refund',
        icon: Undo2Icon,
        labelKey: 'dialogs.manageTransaction.markAsRefund.linkRefund',
        onClick: onLinkRefund,
      });
    }
    return result;
  });

  return { shown, chips, mount };
};
