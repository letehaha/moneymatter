<template>
  <div class="@container/toolsets flex flex-col gap-3">
    <p class="text-muted-foreground text-sm">{{ $t('oauth.authorize.toolsets.intro', { name: clientName }) }}</p>

    <div class="flex gap-1">
      <UiButton variant="ghost-primary" size="sm" data-testid="toolsets-add-all" @click="selectAll">
        {{ $t('oauth.authorize.toolsets.add_all') }}
      </UiButton>
      <UiButton variant="ghost-primary" size="sm" data-testid="toolsets-core-only" @click="selectCoreOnly">
        {{ $t('oauth.authorize.toolsets.core_only') }}
      </UiButton>
    </div>

    <div v-if="core" class="bg-muted flex gap-3 rounded-md border p-3 text-sm" data-testid="toolset-core">
      <LockIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-medium">{{ $t(MCP_TOOLSET_LABELS.core.labelKey) }}</span>
          <span class="text-muted-foreground shrink-0 text-xs">
            {{ $t('oauth.authorize.toolsets.always_on', { count: core.toolCount }, core.toolCount) }}
          </span>
        </div>
        <p class="text-muted-foreground mt-1">{{ $t(MCP_TOOLSET_LABELS.core.descriptionKey) }}</p>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-2 @sm/toolsets:grid-cols-2">
      <label
        v-for="toolset in optional"
        :key="toolset.id"
        :class="
          cn(
            'hover:bg-muted/50 flex cursor-pointer gap-3 rounded-md border p-3 text-sm transition-colors',
            isSelected(toolset) && 'border-primary bg-primary/5 hover:bg-primary/5',
          )
        "
        :data-testid="`toolset-${toolset.id}`"
      >
        <Checkbox
          class="mt-0.5"
          :model-value="isSelected(toolset)"
          :aria-label="$t(MCP_TOOLSET_LABELS[toolset.id].labelKey)"
          @update:model-value="(value) => toggle({ toolset, selected: !!value })"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-medium">{{ $t(MCP_TOOLSET_LABELS[toolset.id].labelKey) }}</span>
            <span
              class="text-muted-foreground shrink-0 text-xs"
              :aria-label="$t('oauth.authorize.toolsets.tool_count', { count: toolset.toolCount }, toolset.toolCount)"
            >
              {{ toolset.toolCount }}
            </span>
          </div>
          <p class="text-muted-foreground mt-1">{{ $t(MCP_TOOLSET_LABELS[toolset.id].descriptionKey) }}</p>
        </div>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MCP_TOOLSET_LABELS } from '@/common/const/mcp-toolsets';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { cn } from '@/lib/utils';
import type { McpToolsetSummary } from '@bt/shared/types';
import { LockIcon } from '@lucide/vue';
import { computed } from 'vue';

type OptionalToolset = McpToolsetSummary & { scope: string };

const props = defineProps<{
  /** The toolsets the client may be granted, `core` included. */
  toolsets: McpToolsetSummary[];
  clientName: string;
}>();

/** Scopes of the selected optional toolsets. */
const selectedScopes = defineModel<Set<string>>({ required: true });

const core = computed(() => props.toolsets.find((toolset) => toolset.scope === null));
const optional = computed(() => props.toolsets.filter((toolset): toolset is OptionalToolset => toolset.scope !== null));

const isSelected = (toolset: OptionalToolset) => selectedScopes.value.has(toolset.scope);

function toggle({ toolset, selected }: { toolset: OptionalToolset; selected: boolean }) {
  const next = new Set(selectedScopes.value);
  if (selected) next.add(toolset.scope);
  else next.delete(toolset.scope);
  selectedScopes.value = next;
}

function selectAll() {
  selectedScopes.value = new Set(optional.value.map((toolset) => toolset.scope));
}

function selectCoreOnly() {
  selectedScopes.value = new Set();
}
</script>
