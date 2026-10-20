<script setup lang="ts">
import { AccountGroups } from '@/common/types/models';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useAccountGroupPaths, useLinkAccountsToGroup } from '@/composable/data-queries/account-groups';
import { useAccountsStore } from '@/stores';
import { SearchIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import AddAccountsRow from './add-accounts-row.vue';
import { buildAddAccountsSections, filterAddAccountsSections } from './build-add-accounts-sections';

const props = defineProps<{ group: AccountGroups }>();
const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { accounts } = storeToRefs(useAccountsStore());
const { entries } = useAccountGroupPaths();

const query = ref('');
const selectedIds = ref(new Set<string>());

watch(isOpen, (open) => {
  if (!open) return;
  query.value = '';
  selectedIds.value = new Set();
});

const allSections = computed(() =>
  buildAddAccountsSections({
    accounts: accounts.value ?? [],
    entries: entries.value,
    groupId: props.group.id,
  }),
);
const sections = computed(() => filterAddAccountsSections({ sections: allSections.value, query: query.value }));

// After a partial failure the refetch moves linked accounts into "already in group".
watch(allSections, ({ alreadyInGroup }) => {
  const next = new Set(selectedIds.value);
  for (const account of alreadyInGroup) next.delete(account.id);
  if (next.size !== selectedIds.value.size) selectedIds.value = next;
});
const isEmpty = computed(
  () =>
    !sections.value.ungrouped.length && !sections.value.inOtherGroups.length && !sections.value.alreadyInGroup.length,
);

const toggle = ({ accountId }: { accountId: string }) => {
  const next = new Set(selectedIds.value);
  if (!next.delete(accountId)) next.add(accountId);
  selectedIds.value = next;
};

const selectedCount = computed(() => selectedIds.value.size);

const summary = computed(() => {
  const moves = allSections.value.inOtherGroups.filter(({ account }) => selectedIds.value.has(account.id));
  const selected = selectedCount.value;
  if (!moves.length) return t('settings.accountGroups.dialogs.addAccounts.summary.selected', { selected });

  const sourceGroupIds = new Set(moves.map(({ groupId }) => groupId));
  if (sourceGroupIds.size === 1) {
    return t(
      'settings.accountGroups.dialogs.addAccounts.summary.movesFromGroup',
      { selected, count: moves.length, group: moves[0]!.groupName },
      moves.length,
    );
  }
  return t(
    'settings.accountGroups.dialogs.addAccounts.summary.movesFromOtherGroups',
    { selected, count: moves.length },
    moves.length,
  );
});

const { mutate, isPending } = useLinkAccountsToGroup({
  onSuccess: () => {
    isOpen.value = false;
  },
});

const submit = () => {
  if (!selectedCount.value || isPending.value) return;
  mutate({ accountIds: [...selectedIds.value], groupId: props.group.id });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('settings.accountGroups.dialogs.addAccounts.title', { name: group.name }) }}</template>
    <template #description>{{ $t('settings.accountGroups.dialogs.addAccounts.description') }}</template>

    <div class="flex flex-col gap-3">
      <InputField v-model="query" :placeholder="$t('settings.accountGroups.dialogs.addAccounts.searchPlaceholder')">
        <template #iconLeading>
          <SearchIcon class="text-muted-foreground size-4" />
        </template>
      </InputField>

      <p v-if="isEmpty" class="text-muted-foreground py-6 text-center text-sm">
        {{
          query.trim()
            ? $t('settings.accountGroups.dialogs.addAccounts.noResults')
            : $t('settings.accountGroups.dialogs.addAccounts.noAccounts')
        }}
      </p>

      <ScrollArea v-else class="border-border/60 bg-card max-h-80 rounded-lg border" viewport-class="max-h-80">
        <section v-if="sections.ungrouped.length">
          <h4 class="text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium tracking-wide uppercase">
            {{ $t('settings.accountGroups.dialogs.addAccounts.sections.ungrouped') }}
          </h4>
          <AddAccountsRow
            v-for="account in sections.ungrouped"
            :key="account.id"
            :account="account"
            :checked="selectedIds.has(account.id)"
            @toggle="toggle({ accountId: account.id })"
          />
        </section>

        <section v-if="sections.inOtherGroups.length">
          <h4 class="text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium tracking-wide uppercase">
            {{ $t('settings.accountGroups.dialogs.addAccounts.sections.inOtherGroups') }}
          </h4>
          <AddAccountsRow
            v-for="{ account, path } in sections.inOtherGroups"
            :key="account.id"
            :account="account"
            :caption="$t('settings.accountGroups.dialogs.addAccounts.inGroupCaption', { path })"
            :checked="selectedIds.has(account.id)"
            @toggle="toggle({ accountId: account.id })"
          />
        </section>

        <section v-if="sections.alreadyInGroup.length">
          <h4 class="text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium tracking-wide uppercase">
            {{ $t('settings.accountGroups.dialogs.addAccounts.sections.alreadyInGroup', { name: group.name }) }}
          </h4>
          <AddAccountsRow
            v-for="account in sections.alreadyInGroup"
            :key="account.id"
            :account="account"
            checked
            disabled
          />
        </section>
      </ScrollArea>
    </div>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <p class="text-muted-foreground text-sm">{{ summary }}</p>
        <div class="grid grid-cols-2 gap-2">
          <Button variant="outline" :disabled="isPending" @click="isOpen = false">
            {{ $t('common.actions.cancel') }}
          </Button>
          <Button :disabled="!selectedCount || isPending" @click="submit">
            {{ $t('settings.accountGroups.dialogs.addAccounts.submit', { count: selectedCount }, selectedCount) }}
          </Button>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
