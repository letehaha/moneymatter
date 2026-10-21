<template>
  <Card class="@container/currencies max-w-4xl">
    <CardHeader class="flex flex-col gap-2 border-b">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="min-w-0 text-2xl font-semibold">{{ $t('settings.currencies.page.title') }}</h2>

        <div class="flex flex-wrap items-center gap-2">
          <AddCustomCurrency />
          <AddNewCurrency />
        </div>
      </div>

      <p class="text-sm opacity-80">
        {{ $t('settings.currencies.page.description') }}
        <HowItWorksPopover />
      </p>
    </CardHeader>

    <CardContent class="mt-6">
      <CurrenciesList />
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';

import AddCustomCurrency from './add-custom-currency.vue';
import AddNewCurrency from './add-new-currency.vue';
import HowItWorksPopover from './how-it-works-popover.vue';
import CurrenciesList from './list.vue';
</script>
