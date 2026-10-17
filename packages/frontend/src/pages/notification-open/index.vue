<script setup lang="ts">
import { useOpenNotification } from '@/composable/use-open-notification';
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const { openNotificationById } = useOpenNotification();

onMounted(() => {
  // `replace`: the back button must not return to this resolver page.
  void openNotificationById({ id: String(route.params.id), replace: true });
});
</script>

<template>
  <div class="flex flex-col gap-4 p-6" role="status" aria-busy="true">
    <div class="bg-muted h-6 w-1/3 animate-pulse rounded-md" />
    <div class="bg-muted h-4 w-2/3 animate-pulse rounded-md" />
    <div class="bg-muted h-4 w-1/2 animate-pulse rounded-md" />
  </div>
</template>
