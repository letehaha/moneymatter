<script setup lang="ts">
import BrandLogo from '@/components/common/brand-logo.vue';
import { cn } from '@/lib/utils';
import {
  getAccountTypeIcon,
  getAccountTypeSolidChipClass,
  getAccountTypeTintedChipClass,
} from '@/pages/accounts/account-type-presentation';
import type { ACCOUNT_CATEGORIES, AccountModel } from '@bt/shared/types';
import { computed, useAttrs } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  account: Pick<AccountModel, 'name' | 'logoDomain' | 'logoInitials' | 'logoColor' | 'accountCategory'>;
  /** Overrides `account.accountCategory` for the fallback chip. */
  category?: ACCOUNT_CATEGORIES;
  /** Opaque fallback chip, for a logo that overlaps other content. */
  solid?: boolean;
}>();

const attrs = useAttrs();

const hasCustomLogo = computed(() => Boolean(props.account.logoDomain || props.account.logoInitials));

const chipCategory = computed(() => props.category ?? props.account.accountCategory);
const chipIcon = computed(() => getAccountTypeIcon({ category: chipCategory.value }));
const chipClass = computed(() =>
  cn(
    'flex shrink-0 items-center justify-center rounded-lg',
    props.solid
      ? getAccountTypeSolidChipClass({ category: chipCategory.value })
      : getAccountTypeTintedChipClass({ category: chipCategory.value }),
    attrs.class as string | undefined,
  ),
);
</script>

<template>
  <BrandLogo
    v-if="hasCustomLogo"
    :domain="account.logoDomain"
    :initials="account.logoInitials"
    :color="account.logoColor"
    :name="account.name"
    :class="attrs.class"
  />
  <div v-else :class="chipClass" aria-hidden="true">
    <component :is="chipIcon" class="size-1/2" stroke-width="2" />
  </div>
</template>
