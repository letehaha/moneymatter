<template>
  <div class="max-w-150">
    <Card class="px-2 py-4">
      <div class="relative mb-4 flex items-center justify-between px-4 py-2">
        <h3 class="text-lg font-semibold">{{ $t('settings.tags.title') }}</h3>

        <Button variant="outline" size="sm" class="gap-1.5" @click="openCreateDialog">
          <PlusIcon class="size-4" />
          {{ $t('settings.tags.addButton') }}
        </Button>
      </div>

      <div class="mt-4 grid px-4 sm:gap-2">
        <template v-if="isLoading">
          <div class="text-muted-foreground py-8 text-center">
            {{ $t('common.actions.loading') }}
          </div>
        </template>
        <template v-else-if="tags.length">
          <div
            v-for="tag in tags"
            :key="tag.id"
            class="hover:bg-hover flex cursor-pointer items-center gap-3 rounded-md py-2 transition-colors sm:px-3"
            @click="openEditDialog(tag)"
          >
            <div
              class="mt-0.5 mb-auto flex size-6 shrink-0 items-center justify-center rounded-full"
              :style="{ backgroundColor: tag.color }"
            >
              <TagIcon v-if="tag.icon" :name="tag.icon" class="size-3 shrink-0 text-white" />
            </div>
            <div class="min-w-0 flex-1">
              <span class="font-medium">{{ tag.name }}</span>
              <p v-if="tag.description" class="text-muted-foreground line-clamp-2 text-xs">
                {{ tag.description }}
              </p>
            </div>
            <div
              v-if="tag.remindersCount && tag.remindersCount > 0"
              class="text-muted-foreground flex shrink-0 items-center gap-1 text-xs"
            >
              <BellIcon class="size-3.5" />
              <span>{{ tag.remindersCount }}</span>
            </div>
            <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
          </div>
        </template>
        <template v-else>
          <div class="text-muted-foreground py-8 text-center">
            {{ $t('settings.tags.empty') }}
          </div>
        </template>
      </div>
    </Card>

    <TagFormDialog
      v-model:open="dialogState.isOpen"
      :key="dialogState.key"
      :tag="dialogState.tag"
      @saved="handleTagSaved"
      @deleted="handleTagDeleted"
    />
  </div>
</template>

<script setup lang="ts">
import TagIcon from '@/components/common/icons/tag-icon.vue';
import TagFormDialog from '@/components/dialogs/tag-form-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { useTagsStore } from '@/stores';
import { TagModel } from '@bt/shared/types';
import { BellIcon, ChevronRightIcon, PlusIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { onMounted, reactive } from 'vue';

defineOptions({
  name: 'settings-tags',
});

const tagsStore = useTagsStore();
const { tags, isLoading } = storeToRefs(tagsStore);

const dialogState = reactive<{
  isOpen: boolean;
  key: number;
  tag?: TagModel;
}>({
  isOpen: false,
  key: 0,
  tag: undefined,
});

const openCreateDialog = () => {
  dialogState.tag = undefined;
  dialogState.key++;
  dialogState.isOpen = true;
};

const openEditDialog = (tag: TagModel) => {
  dialogState.tag = tag;
  dialogState.key++;
  dialogState.isOpen = true;
};

const handleTagSaved = () => {
  dialogState.isOpen = false;
};

const handleTagDeleted = () => {
  dialogState.isOpen = false;
};

onMounted(async () => {
  if (tags.value.length === 0) {
    await tagsStore.loadTags();
  }
});
</script>
