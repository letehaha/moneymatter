<script setup lang="ts">
/**
 * Import-wide "update account balances from imported transactions" checkbox,
 * shared by the CSV, Budget Bakers Wallet and MS Money wizards. Purely presentational:
 * the parent store owns the value (seeded from the persisted
 * `import.recalculateAccountBalance` user setting and written back on execute).
 */
import DocsLink from '@/components/common/docs-link.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';

const model = defineModel<boolean>({ required: true });

withDefaults(
  defineProps<{
    /** Persisted preference is still loading; the checkbox is disabled so the shown "off" isn't taken as a resolved choice. */
    settingsLoading?: boolean;
    /** Persisted preference failed to load; a non-blocking hint tells the user the fallback is off. */
    settingsLoadFailed?: boolean;
  }>(),
  { settingsLoading: false, settingsLoadFailed: false },
);
</script>

<template>
  <div class="border-border overflow-hidden rounded-md border">
    <label class="hover:bg-hover flex cursor-pointer items-start gap-3 p-4 transition-colors">
      <Checkbox
        :model-value="model"
        :disabled="settingsLoading"
        class="mt-0.5"
        @update:model-value="(value) => (model = !!value)"
      />
      <span class="grid gap-0.5">
        <span class="text-sm font-medium">{{ $t('importShared.recalculateBalance.label') }}</span>
        <span class="text-muted-foreground text-xs">
          {{ $t('importShared.recalculateBalance.hint') }}
          <DocsLink path="/import/import-from-csv/#how-an-import-affects-balances" @click.stop />
        </span>
        <span v-if="settingsLoadFailed" class="text-warning-text text-xs">
          {{ $t('importShared.recalculateBalance.loadFailedHint') }}
        </span>
      </span>
    </label>
  </div>
</template>
