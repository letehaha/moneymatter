<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { TrashEntry } from '@bt/shared/types';
import { CheckIcon, Loader2Icon, Trash2Icon, Undo2Icon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { isTrashExpiringSoon } from '../helpers';
import type { TrashEntryDisplay } from '../use-transactions-trash';

const props = defineProps<{
  entry: TrashEntry;
  display: TrashEntryDisplay;
  daysLeft: number;
  /** Demo users get a read-only view. */
  readonly: boolean;
  isRestoring: boolean;
  isDeleting: boolean;
  /** Bottom-sheet layout: stacked, taller buttons. */
  stacked?: boolean;
}>();

defineEmits<{ restore: []; delete: [] }>();

const { t } = useI18n();
const { format } = useDateLocale();

const isSoon = computed(() => isTrashExpiringSoon({ daysLeft: props.daysLeft }));
const isBusy = computed(() => props.isRestoring || props.isDeleting);

interface ComesBackItem {
  key: string;
  text: string;
  note?: string;
}

const items = computed<ComesBackItem[]>(() => {
  const { kept, links } = props.entry;
  const result: ComesBackItem[] = [{ key: 'basics', text: t('transactions.trashPage.comesBack.basics') }];
  if (kept.splits) {
    result.push({ key: 'splits', text: t('transactions.trashPage.comesBack.splits', kept.splits) });
  }
  if (kept.tags) result.push({ key: 'tags', text: t('transactions.trashPage.comesBack.tags', kept.tags) });
  if (kept.attachments) {
    result.push({ key: 'attachments', text: t('transactions.trashPage.comesBack.attachments', kept.attachments) });
  }
  if (props.display.otherLeg) {
    result.push({ key: 'otherLeg', text: t('transactions.trashPage.comesBack.otherLeg', props.display.otherLeg) });
  }
  links.forEach((link, index) => {
    const label =
      link.kind === 'subscriptionPeriod' && link.label ? format(parseISO(link.label), 'd MMM yyyy') : link.label;
    result.push({
      key: `link-${index}`,
      text: t(`transactions.trashPage.comesBack.links.${link.kind}`, {
        name: label ?? t('transactions.trashPage.comesBack.links.unnamed'),
      }),
      note: link.counterpartInTrash ? t('transactions.trashPage.comesBack.counterpartInTrash') : undefined,
    });
  });
  if (!props.display.isPlanned) {
    result.push({
      key: 'balance',
      text: props.display.otherLeg
        ? t('transactions.trashPage.comesBack.balances')
        : t('transactions.trashPage.comesBack.balance'),
    });
  }
  return result;
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-1">
      <span class="text-muted-foreground text-sm">{{ display.title }} · {{ display.accountName }}</span>
      <span :class="cn('text-amount text-3xl font-bold', display.amountClass)">{{ display.amountText }}</span>
      <span class="text-muted-foreground text-sm">
        {{ format(display.time, 'd MMM yyyy') }} ·
        {{ $t('transactions.trashPage.deletedOn', { date: format(entry.deletedAt, 'd MMM') }) }} ·
        <b :class="isSoon ? 'text-warning-text' : 'text-foreground'">
          {{ $t('transactions.trashPage.daysLeft', { count: daysLeft }, daysLeft) }}
        </b>
      </span>
    </div>

    <div class="flex flex-col gap-2.5">
      <h2 class="text-muted-foreground text-xs font-bold tracking-wider uppercase">
        {{ $t('transactions.trashPage.comesBack.title') }}
      </h2>
      <ul class="flex flex-col gap-2.5 text-sm">
        <li v-for="item in items" :key="item.key" class="flex items-start gap-2.5">
          <CheckIcon class="text-success-text mt-0.5 size-4 flex-none" />
          <span class="flex flex-col gap-0.5">
            <span>{{ item.text }}</span>
            <span v-if="item.note" class="text-muted-foreground text-xs">{{ item.note }}</span>
          </span>
        </li>
      </ul>
    </div>

    <div v-if="!readonly" :class="cn('flex gap-2', stacked ? 'flex-col' : 'flex-wrap')">
      <Button :size="stacked ? 'lg' : 'default'" class="flex-[1_1_140px]" :disabled="isBusy" @click="$emit('restore')">
        <Loader2Icon v-if="isRestoring" class="size-4 animate-spin" />
        <Undo2Icon v-else class="size-4" />
        {{ $t('transactions.trashPage.restore') }}
      </Button>
      <Button
        variant="soft-destructive"
        :size="stacked ? 'lg' : 'default'"
        class="flex-[1_1_140px]"
        :disabled="isBusy"
        @click="$emit('delete')"
      >
        <Loader2Icon v-if="isDeleting" class="size-4 animate-spin" />
        <Trash2Icon v-else class="size-4" />
        {{ $t('transactions.trashPage.deletePermanently') }}
      </Button>
    </div>
  </div>
</template>
