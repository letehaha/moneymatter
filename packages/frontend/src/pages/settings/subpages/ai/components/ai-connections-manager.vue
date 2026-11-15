<template>
  <div class="@container/ai-connections space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-1">
          <h3 class="text-lg font-medium">{{ $t('settings.ai.connections.title') }}</h3>
          <Popover>
            <PopoverTrigger as-child>
              <Button variant="ghost" size="icon-sm" :aria-label="$t('settings.ai.connections.tip.ariaLabel')">
                <InfoIcon class="text-muted-foreground size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-80 text-sm" align="start">
              {{ $t('settings.ai.connections.tip.text') }}
            </PopoverContent>
          </Popover>
        </div>
        <p class="text-muted-foreground text-sm">{{ $t('settings.ai.connections.description') }}</p>
      </div>

      <Button v-if="hasConnections" :disabled="isAtCap" @click="openAddDialog">
        <PlusIcon class="size-4" />
        {{ $t('settings.ai.connections.addButton') }}
      </Button>
    </div>

    <p v-if="isAtCap" class="text-muted-foreground text-xs">
      {{ $t('settings.ai.connections.capReached', { max: MAX_AI_CONNECTIONS }) }}
    </p>

    <div v-if="isLoadingConnections" class="space-y-2">
      <div v-for="i in 2" :key="i" class="flex items-start gap-3 rounded-lg border p-3">
        <div class="bg-muted size-5 animate-pulse rounded-full" />
        <div class="flex-1 space-y-2">
          <div class="bg-muted h-4 w-40 animate-pulse rounded" />
          <div class="bg-muted/60 h-3 w-56 animate-pulse rounded" />
        </div>
      </div>
    </div>

    <!-- Ahead of the empty state: a failed fetch would otherwise say "no models yet"
    and invite re-adding ones that are still saved. -->
    <div
      v-else-if="isConnectionsError"
      class="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center"
    >
      <TriangleAlertIcon class="text-destructive-text size-8" aria-hidden="true" />
      <h4 class="font-medium">{{ $t('settings.ai.connections.loadError.title') }}</h4>
      <p class="text-muted-foreground max-w-md text-sm">
        {{ $t('settings.ai.connections.loadError.description') }}
      </p>
      <Button
        type="button"
        variant="outline"
        class="mt-2"
        :disabled="isFetchingConnections"
        @click="refetchConnections()"
      >
        <RotateCwIcon class="size-4" />
        {{ $t('common.actions.retry') }}
      </Button>
    </div>

    <div v-else-if="hasConnections" class="space-y-2">
      <AiConnectionRow
        v-for="(connection, index) in connections"
        :key="connection.id"
        :connection="connection"
        :is-default="index === 0"
        :can-duplicate="!isAtCap"
        :pinned-feature-names="pinnedFeatureNames[connection.id] ?? []"
        @edit="openEditDialog({ id: connection.id })"
        @duplicate="openDuplicateDialog({ id: connection.id })"
      />
    </div>

    <div v-else class="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
      <BrainIcon class="text-muted-foreground size-8" />
      <h4 class="font-medium">{{ $t('settings.ai.connections.empty.title') }}</h4>
      <p class="text-muted-foreground max-w-md text-sm">
        {{ $t('settings.ai.connections.empty.description') }}
      </p>
      <Button class="mt-2" @click="openAddDialog">
        <PlusIcon class="size-4" />
        {{ $t('settings.ai.connections.addButton') }}
      </Button>
    </div>

    <AiConnectionDialog v-model:open="isDialogOpen" :connection="editedConnection" :source="duplicateSource" />
  </div>
</template>

<script setup lang="ts">
import { getAIFeatureDisplayInfo } from '@/common/const';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { useNotificationCenter } from '@/components/notification-center';
import { useAiSettings } from '@/composable/data-queries/ai-settings';
import { useAiConnectionsList } from '@/composable/data-queries/use-ai-connections';
import { MAX_AI_CONNECTIONS } from '@bt/shared/types';
import { BrainIcon, InfoIcon, PlusIcon, RotateCwIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import AiConnectionDialog from './ai-connection-dialog.vue';
import AiConnectionRow from './ai-connection-row.vue';

const { t } = useI18n();
const { addInfoNotification } = useNotificationCenter();

const { connections, isLoadingConnections, isConnectionsError, isFetchingConnections, refetchConnections } =
  useAiConnectionsList();
const { configurableFeaturesStatus } = useAiSettings();

const isDialogOpen = ref(false);
// Held as ids, not objects, so the dialog keeps seeing the live copy after a write invalidates the list.
const editedConnectionId = ref<string | null>(null);
const duplicateSourceId = ref<string | null>(null);

const hasConnections = computed(() => connections.value.length > 0);
const isAtCap = computed(() => connections.value.length >= MAX_AI_CONNECTIONS);

const findConnection = ({ id }: { id: string | null }) =>
  connections.value.find((connection) => connection.id === id) ?? null;
const editedConnection = computed(() => findConnection({ id: editedConnectionId.value }));
const duplicateSource = computed(() => findConnection({ id: duplicateSourceId.value }));

/** Features pinned to each connection; removing it switches them to automatic. */
const pinnedFeatureNames = computed(() => {
  const byConnection: Record<string, string[]> = {};
  for (const status of configurableFeaturesStatus.value) {
    const id = status.isConfigured ? status.configuredConnectionId : null;
    if (!id) continue;
    (byConnection[id] ??= []).push(t(getAIFeatureDisplayInfo({ feature: status.feature }).nameKey));
  }
  return byConnection;
});

// A connection deleted elsewhere leaves the dialog editing nothing, and saving would create a
// duplicate. Closing it needs a reason, or it reads as the form losing the user's work.
watch(editedConnection, (connection) => {
  if (isDialogOpen.value && editedConnectionId.value && !connection) {
    isDialogOpen.value = false;
    addInfoNotification(t('settings.ai.connections.notifications.editedConnectionGone'));
  }
});

const openDialog = ({ editId, sourceId }: { editId: string | null; sourceId: string | null }) => {
  editedConnectionId.value = editId;
  duplicateSourceId.value = sourceId;
  isDialogOpen.value = true;
};

const openAddDialog = () => openDialog({ editId: null, sourceId: null });
const openEditDialog = ({ id }: { id: string }) => openDialog({ editId: id, sourceId: null });
const openDuplicateDialog = ({ id }: { id: string }) => openDialog({ editId: null, sourceId: id });
</script>
