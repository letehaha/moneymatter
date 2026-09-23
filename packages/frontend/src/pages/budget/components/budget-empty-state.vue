<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { WalletIcon } from '@lucide/vue';

defineEmits<{ start: [] }>();
</script>

<template>
  <Card class="mx-auto flex max-w-lg flex-col items-center gap-3 p-8 text-center">
    <div class="bg-primary/10 text-primary-text flex size-12 items-center justify-center rounded-full">
      <WalletIcon class="size-6" />
    </div>
    <h2 class="text-lg font-semibold">{{ $t('budgetPlans.empty.title') }}</h2>
    <p class="text-muted-foreground text-sm">{{ $t('budgetPlans.empty.description') }}</p>
    <Button class="mt-2" @click="$emit('start')">{{ $t('budgetPlans.empty.action') }}</Button>
  </Card>
</template>
