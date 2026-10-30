<template>
  <div class="flex max-w-4xl flex-col gap-6">
    <Card>
      <CardHeader class="border-b">
        <h2 class="mb-2 text-2xl font-semibold">{{ $t('settings.general.title') }}</h2>
        <p class="text-sm opacity-80">{{ $t('settings.general.description') }}</p>
      </CardHeader>

      <CardContent class="mt-6 flex flex-col gap-6">
        <PaydayRow />
        <Separator />
        <CreditLimitRow />
        <Separator />
        <BankSyncRows />
        <Separator />
        <CategoryRows />
        <Separator />
        <AccountDropdownRows />
        <Separator />
        <QuickStartRow />
        <Separator />
        <TransactionRows />
        <Separator />
        <UnrealizedLossAlertRows />
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Separator } from '@/components/lib/ui/separator';

import AccountDropdownRows from './rows/account-dropdown-rows.vue';
import BankSyncRows from './rows/bank-sync-rows.vue';
import CategoryRows from './rows/category-rows.vue';
import CreditLimitRow from './rows/credit-limit-row.vue';
import PaydayRow from './rows/payday-row.vue';
import QuickStartRow from './rows/quick-start-row.vue';
import TransactionRows from './rows/transaction-rows.vue';
import UnrealizedLossAlertRows from './rows/unrealized-loss-alert-rows.vue';
</script>
