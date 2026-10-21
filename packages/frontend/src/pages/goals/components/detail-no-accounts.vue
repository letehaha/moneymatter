<script setup lang="ts">
import { WalletIcon } from '@lucide/vue';
</script>

<template>
  <div class="flex flex-col items-center px-4 py-12 text-center">
    <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
      <WalletIcon class="text-muted-foreground size-6" />
    </div>
    <h3 class="mb-2 text-lg font-semibold">{{ $t('goals.status.noAccounts') }}</h3>
    <p class="text-muted-foreground max-w-md text-sm">{{ $t('goals.details.accounts.emptyDescription') }}</p>
  </div>
</template>
