<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { StatusBadge, type Variant as StatusBadgeVariant } from '@/components/lib/ui/status-badge';
import { useNotificationCenter } from '@/components/notification-center';
import { useChatCardActions } from '@/composable/data-queries/chat';
import { ApiErrorResponseError } from '@/js/errors';
import { cn } from '@/lib/utils';
import type {
  ChatCardConflictDetails,
  ChatCardKind,
  ChatProposalCard,
  ChatProposalStatus,
  ChatSendMessageResponse,
} from '@bt/shared/types';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  LayersIcon,
  LinkIcon,
  MergeIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  ZapIcon,
} from '@lucide/vue';
import type { Component } from 'vue';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useChatText } from '../chat-text';
import { chatEntityRoute } from '../entity-route';
import CardDependencies from './card-dependencies.vue';
import CardFieldEditor from './card-field-editor.vue';
import CardField from './card-field.vue';
import CardSources from './card-sources.vue';
import GoalProgress from './goal-progress.vue';
import {
  collectPendingParents,
  confirmationFor,
  isTypedConfirmationMet,
  parentRevisionsOf,
  requirementOfChain,
} from './card-chain';
import { buildCardRows } from './card-diff';
import { startsFolded } from './card-fold';
import { summaryFields } from './card-summary';
import { buildEditedArgs, cardArgsOf, moneyCurrencyOf, replaceArg } from './card-values';
import ProposalCardDanger from './proposal-card-danger.vue';
import { useCardFieldText } from './use-card-field-text';
import { useCardLookups } from './use-card-lookups';

const props = withDefaults(
  defineProps<{
    card: ChatProposalCard;
    /** Every card of the thread page, to find the parents of this one (and theirs). */
    cards?: Record<string, ChatProposalCard>;
  }>(),
  { cards: () => ({}) },
);

const emit = defineEmits<{
  /** A comment starts a run; follow it with the run id. */
  commented: [response: ChatSendMessageResponse];
}>();

const { t } = useI18n();
const { keyText, titleText, entityLabel } = useChatText();
const { addSuccessNotification } = useNotificationCenter();
const actions = useChatCardActions();
const lookups = useCardLookups({ card: () => props.card });
const { valueParts } = useCardFieldText();
// One list for an update: the record it targets and the card's own fields, each field once.
const rows = computed(() => buildCardRows({ card: props.card }));

const KIND_ICONS: Record<ChatCardKind, Component> = {
  create: PlusIcon,
  update: PencilIcon,
  delete: Trash2Icon,
  bulk: LayersIcon,
  merge: MergeIcon,
  link: LinkIcon,
  action: ZapIcon,
};

// The accent marks what waits on the owner; a rejected card reads as red as a failed one.
const STATUS_BADGE: Record<ChatProposalStatus, StatusBadgeVariant> = {
  pending: 'info',
  applying: 'info',
  applied: 'success',
  rejected: 'destructive',
  failed: 'destructive',
  stale: 'warning',
  blocked: 'neutral',
  superseded: 'neutral',
  expired: 'neutral',
  unknown: 'warning',
};

/** The statuses in which the user can still do something with the card. */
const OPEN_STATUSES: readonly ChatProposalStatus[] = ['pending', 'stale', 'failed'];
const CONFLICT_REASONS = ['revision', 'notPending', 'blocked', 'expired', 'stale', 'unavailable'] as const;
type ConflictReason = (typeof CONFLICT_REASONS)[number];

const isOpen = computed(() => OPEN_STATUSES.includes(props.card.status));
const isPending = computed(() => props.card.status === 'pending');
const canRefresh = computed(() => props.card.status === 'stale' || props.card.status === 'failed');

const parents = computed(() => collectPendingParents({ card: props.card, cards: props.cards }));
const requirement = computed(() => requirementOfChain({ card: props.card, parents: parents.value }));
const needsDialog = computed(() => requirement.value.mode === 'confirm' || requirement.value.mode === 'host');
const hostToConfirm = computed(() => (requirement.value.mode === 'host' ? requirement.value.expected : ''));

const typed = ref('');
const isConfirmOpen = ref(false);
const conflictReason = ref<ConflictReason | null>(null);

const isBusy = computed(
  () =>
    actions.approve.isPending.value ||
    actions.reject.isPending.value ||
    actions.edit.isPending.value ||
    actions.refresh.isPending.value,
);

const approveDisabled = computed(
  () =>
    !props.card.canApply.ok ||
    isBusy.value ||
    !isTypedConfirmationMet({ requirement: requirement.value, typed: typed.value }),
);

const cannotApplyText = computed(() =>
  props.card.canApply.ok ? null : keyText({ key: props.card.canApply.reasonKey, fallbackKey: 'chat.cards.notPending' }),
);

const title = computed(() => titleText({ title: props.card.title }));
const statusText = computed(() => keyText({ key: `chat.cards.status.${props.card.status}` }) ?? props.card.status);
const statusDetail = computed(() => keyText({ key: `chat.cards.statusDetail.${props.card.status}` }));

const statusLabel = ({ value }: { value: unknown }): string => {
  if (value === null || value === undefined) return '—';
  return keyText({ key: `chat.cards.status.${String(value)}` }) ?? String(value);
};

const staleText = computed(() => {
  const stale = props.card.stale;
  if (!stale) return null;

  return keyText({
    key: stale.reasonKey,
    params: { before: statusLabel({ value: stale.before }), after: statusLabel({ value: stale.after }) },
    fallbackKey: 'chat.cards.stale',
  });
});

const errorText = computed(() => {
  const error = props.card.error;
  if (!error) return null;
  return (error.messageKey ? keyText({ key: error.messageKey }) : null) ?? error.message ?? null;
});

const warningTexts = computed(() =>
  props.card.warnings
    // The egress callout above the fields already says it, with the full URL.
    .filter((warning) => !(props.card.egress && warning.key === 'chat.warnings.egress'))
    .flatMap((warning) => {
      const text = keyText({ key: warning.key, params: warning.params });
      return text ? [text] : [];
    }),
);

const conflictText = computed(() => {
  if (!conflictReason.value) return null;
  // The card's own stale callout already says this one.
  if (conflictReason.value === 'stale' && props.card.stale) return null;
  return keyText({ key: `chat.cards.${conflictReason.value}`, fallbackKey: 'chat.cards.notPending' });
});

const alsoAppliedTitles = computed(() => {
  const applied = new Set(props.card.result?.alsoApplied ?? []);
  return props.card.dependsOn
    .filter((dependency) => applied.has(dependency.id))
    .map((dependency) => titleText({ title: dependency.title }));
});

const resultLinks = computed(() =>
  (props.card.result?.refs ?? []).flatMap((resultRef) => {
    const to = chatEntityRoute({ entity: resultRef });
    if (!to) return [];
    return [
      {
        key: `${resultRef.kind}:${resultRef.id}`,
        to,
        text: lookups.entityName({ kind: resultRef.kind, id: resultRef.id }) ?? entityLabel({ kind: resultRef.kind }),
      },
    ];
  }),
);

const currencyOf = ({ path, values }: { path: string; values?: Record<string, unknown> }) =>
  moneyCurrencyOf({
    card: props.card,
    values,
    path,
    accountCurrency: lookups.accountCurrency,
    baseCurrencyCode: lookups.baseCurrencyCode(),
  });

// --- Approve ---

const conflictReasonOf = ({ error }: { error: unknown }): ConflictReason | null => {
  if (!(error instanceof ApiErrorResponseError)) return null;
  const reason = (error.data?.details as Partial<ChatCardConflictDetails> | undefined)?.reason;
  return CONFLICT_REASONS.find((known) => known === reason) ?? null;
};

const submitApprove = () => {
  isConfirmOpen.value = false;
  conflictReason.value = null;

  const confirmation = confirmationFor({ requirement: requirement.value, typed: typed.value });
  const parentRevisions = parentRevisionsOf({ parents: parents.value });

  actions.approve.mutate(
    {
      proposalId: props.card.id,
      payload: {
        revision: props.card.revision,
        ...(Object.keys(parentRevisions).length > 0 ? { parentRevisions } : {}),
        ...(confirmation !== undefined ? { confirmation } : {}),
      },
    },
    {
      onSuccess: ({ card }) => {
        typed.value = '';
        if (card.status === 'applied') addSuccessNotification(t('chat.cards.appliedToast'));
      },
      onError: (error) => {
        typed.value = '';
        conflictReason.value = conflictReasonOf({ error });
      },
    },
  );
};

const onRefresh = () => {
  actions.refresh.mutate(
    { proposalId: props.card.id },
    {
      onSuccess: () => {
        conflictReason.value = null;
      },
    },
  );
};

const onApprove = () => {
  if (needsDialog.value) isConfirmOpen.value = true;
  else submitApprove();
};

// --- Edit ---

const isEditing = ref(false);
const draft = ref<Record<string, unknown>>({});
const edited = computed(() => buildEditedArgs({ card: props.card, draft: draft.value }));
const hasEditableFields = computed(() => props.card.fields.some((field) => field.editable));

const startEdit = () => {
  draft.value = cardArgsOf({ card: props.card });
  isEditing.value = true;
};

const saveEdit = () => {
  actions.edit.mutate(
    { proposalId: props.card.id, payload: { revision: props.card.revision, args: edited.value.args } },
    { onSuccess: () => (isEditing.value = false) },
  );
};

const chooseAlternative = ({ path, value }: { path: string; value: unknown }) => {
  actions.edit.mutate({
    proposalId: props.card.id,
    payload: { revision: props.card.revision, args: replaceArg({ card: props.card, path, value }) },
  });
};

// A newer version of the card (another tab, a refused approval) replaces what the user was editing.
watch(
  () => props.card.revision,
  () => {
    isEditing.value = false;
  },
);

// --- Comment ---

const isCommenting = ref(false);
const commentText = ref('');
const trimmedComment = computed(() => commentText.value.trim());

const sendComment = () => {
  actions.comment.mutate(
    { proposalId: props.card.id, text: trimmedComment.value },
    {
      onSuccess: (response) => {
        commentText.value = '';
        isCommenting.value = false;
        emit('commented', response);
      },
    },
  );
};

const isDetailsOpen = ref(false);

// --- Fold ---

// Decided once, when the card first shows: a card the owner just approved stays open with its result, and a card in
// an open status always shows its action row.
const isExpanded = ref(!startsFolded({ status: props.card.status, offersAction: isOpen.value }));
const bodyId = useId();

const summaryText = computed(() =>
  summaryFields({ card: props.card })
    .map((field) =>
      valueParts({
        field,
        value: field.value,
        current: true,
        lookups,
        currencyCode: currencyOf({ path: field.path }),
        dependsOn: props.card.dependsOn,
      })
        .map((part) => part.text)
        .join(', '),
    )
    .join(' · '),
);
</script>

<template>
  <article
    data-testid="proposal-card"
    :class="
      cn(
        'bg-card flex min-w-0 flex-col gap-3 rounded-xl border p-4',
        isOpen && card.danger !== 'none' && 'border-destructive/40',
        isOpen && card.egress && 'border-warning/40',
      )
    "
  >
    <header class="flex flex-col gap-1">
      <h3 class="text-sm font-semibold">
        <button
          type="button"
          class="focus-visible:ring-ring -m-1 flex w-[calc(100%+0.5rem)] items-start justify-between gap-3 rounded-md p-1 text-left outline-hidden focus-visible:ring-2"
          data-testid="card-fold-toggle"
          :aria-expanded="isExpanded"
          :aria-controls="bodyId"
          @click="isExpanded = !isExpanded"
        >
          <span class="flex min-w-0 items-center gap-2">
            <component :is="KIND_ICONS[card.kind]" class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <span class="wrap-anywhere">{{ title }}</span>
          </span>
          <span class="flex shrink-0 items-center gap-1.5">
            <StatusBadge
              :variant="STATUS_BADGE[card.status]"
              :data-variant="STATUS_BADGE[card.status]"
              data-testid="card-status"
            >
              {{ statusText }}
            </StatusBadge>
            <ChevronDownIcon
              :class="cn('text-muted-foreground size-4 transition-transform', isExpanded && 'rotate-180')"
              aria-hidden="true"
            />
          </span>
        </button>
      </h3>
      <p v-if="!isExpanded && summaryText" class="text-muted-foreground truncate text-sm" data-testid="card-summary">
        {{ summaryText }}
      </p>
    </header>

    <div v-if="isExpanded" :id="bodyId" class="flex min-w-0 flex-col gap-3" data-testid="card-body">
      <p v-if="statusDetail && !isPending && card.status !== 'stale'" class="text-muted-foreground text-sm">
        {{ statusDetail }}
      </p>

      <Callout v-if="card.stale" variant="warning" data-testid="stale">
        <p>{{ statusDetail }}</p>
        <p v-if="staleText" class="mt-1">{{ staleText }}</p>
      </Callout>

      <Callout v-if="conflictText" variant="info" data-testid="conflict" :title="$t('chat.cards.conflict.title')">
        <p>{{ conflictText }}</p>
        <p v-if="isPending">{{ $t('chat.cards.conflict.askAgain') }}</p>
      </Callout>

      <p v-if="errorText" class="text-destructive-text text-sm wrap-anywhere" data-testid="card-error">
        {{ errorText }}
      </p>

      <CardDependencies v-if="isOpen" :parents="parents" />

      <ul v-if="warningTexts.length > 0" class="flex flex-col gap-1.5">
        <li v-for="(warning, index) in warningTexts" :key="index">
          <Callout variant="warning">{{ warning }}</Callout>
        </li>
      </ul>

      <ProposalCardDanger
        v-if="isOpen"
        :card="card"
        :requirement="requirement"
        :typed="typed"
        :lookups="lookups"
        @update:typed="typed = $event"
      />

      <GoalProgress v-if="card.goalProgress" :change="card.goalProgress" />

      <dl v-if="!isEditing" class="flex flex-col gap-0.5">
        <CardField
          v-for="row in rows"
          :key="row.field.path"
          :field="row.field"
          :tone="row.tone"
          :lookups="lookups"
          :currency-code="currencyOf({ path: row.field.path })"
          :before-currency-code="row.beforeCurrencyCode"
          :depends-on="card.dependsOn"
          :disabled="!isOpen || isBusy"
          @choose="chooseAlternative({ path: row.field.path, value: $event })"
        />
      </dl>
      <div v-else class="flex flex-col gap-3">
        <p class="text-sm font-medium">{{ $t('chat.cards.edit.title') }}</p>
        <div v-for="field in card.fields" :key="field.path" :data-testid="`field-editor-${field.path}`">
          <CardFieldEditor
            v-model="draft[field.path]"
            :field="field"
            :lookups="lookups"
            :currency-code="currencyOf({ path: field.path, values: draft })"
            :depends-on="card.dependsOn"
          />
        </div>
        <p v-if="edited.changed.length === 0" class="text-muted-foreground text-xs">
          {{ $t('chat.cards.edit.nothingChanged') }}
        </p>
        <div class="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="cancel-edit" @click="isEditing = false">
            {{ $t('chat.cards.actions.cancelEdit') }}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="save-edit"
            :disabled="edited.changed.length === 0 || actions.edit.isPending.value"
            @click="saveEdit"
          >
            {{ $t('chat.cards.actions.save') }}
          </Button>
        </div>
      </div>

      <div v-if="card.status === 'applied'" class="flex flex-col gap-1 text-sm">
        <p v-if="alsoAppliedTitles.length > 0" class="text-muted-foreground">
          {{ $t('chat.cards.dependencies.alsoApplied', { titles: alsoAppliedTitles.join(', ') }) }}
        </p>
        <div v-if="resultLinks.length > 0" class="flex flex-wrap gap-x-3 gap-y-1">
          <RouterLink
            v-for="link in resultLinks"
            :key="link.key"
            :to="link.to"
            class="text-primary-text hover:underline"
          >
            {{ $t('chat.cards.result.open') }}: {{ link.text }}
          </RouterLink>
        </div>
      </div>

      <p v-if="cannotApplyText && isPending" class="text-muted-foreground text-sm" data-testid="cannot-apply">
        {{ cannotApplyText }}
      </p>

      <div v-if="isOpen && !isEditing" class="flex flex-wrap items-center gap-2">
        <Button v-if="isPending" size="sm" data-testid="approve" :disabled="approveDisabled" @click="onApprove">
          {{ actions.approve.isPending.value ? $t('chat.cards.actions.approving') : $t('chat.cards.actions.approve') }}
        </Button>
        <Button v-if="canRefresh" size="sm" data-testid="refresh" :disabled="isBusy" @click="onRefresh">
          {{ $t('chat.cards.actions.refresh') }}
        </Button>
        <Button
          v-if="hasEditableFields"
          variant="outline"
          size="sm"
          data-testid="edit"
          :disabled="isBusy"
          @click="startEdit"
        >
          {{ $t('chat.cards.actions.edit') }}
        </Button>
        <Button
          variant="ghost-destructive"
          size="sm"
          data-testid="reject"
          :disabled="isBusy"
          @click="actions.reject.mutate({ proposalId: card.id })"
        >
          {{ $t('chat.cards.actions.reject') }}
        </Button>
        <Button variant="ghost" size="sm" data-testid="comment-toggle" @click="isCommenting = !isCommenting">
          {{ $t('chat.cards.actions.comment') }}
        </Button>
      </div>

      <div v-if="isOpen && isCommenting" class="flex flex-col gap-2">
        <div data-testid="comment-input">
          <TextareaField
            v-model="commentText"
            :label="$t('chat.cards.comment.label')"
            :placeholder="$t('chat.cards.comment.placeholder')"
          />
        </div>
        <p class="text-muted-foreground text-xs">{{ $t('chat.cards.comment.hint') }}</p>
        <div class="flex justify-end">
          <Button
            type="button"
            size="sm"
            data-testid="comment-send"
            :disabled="trimmedComment === '' || actions.comment.isPending.value"
            @click="sendComment"
          >
            {{ $t('chat.cards.actions.sendComment') }}
          </Button>
        </div>
      </div>

      <div class="border-t pt-2">
        <Button
          variant="link"
          size="sm"
          class="h-auto p-0"
          data-testid="details-toggle"
          :aria-expanded="isDetailsOpen"
          @click="isDetailsOpen = !isDetailsOpen"
        >
          {{ isDetailsOpen ? $t('chat.cards.actions.hideDetails') : $t('chat.cards.actions.details') }}
          <component :is="isDetailsOpen ? ChevronUpIcon : ChevronDownIcon" class="size-4" aria-hidden="true" />
        </Button>
        <div v-if="isDetailsOpen" class="mt-2">
          <CardSources :sources="card.sources" />
        </div>
      </div>
    </div>

    <ResponsiveAlertDialog
      v-model:open="isConfirmOpen"
      :confirm-variant="card.danger !== 'none' ? 'destructive' : 'default'"
      :confirm-label="$t('chat.cards.confirm.approve')"
      @confirm="submitApprove"
    >
      <template #title>
        {{
          hostToConfirm ? $t('chat.cards.confirm.hostTitle', { host: hostToConfirm }) : $t('chat.cards.confirm.title')
        }}
      </template>
      <template #description>
        {{
          hostToConfirm
            ? $t('chat.cards.confirm.hostDescription', { host: hostToConfirm })
            : $t('chat.cards.confirm.description')
        }}
      </template>
    </ResponsiveAlertDialog>
  </article>
</template>
