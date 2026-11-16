<script setup lang="ts">
/**
 * Picker for the saved category mappings, shown in the category table header.
 *
 * Built on Popover rather than the DropdownMenu primitive: menu roving focus and
 * typeahead swallow the keystrokes the inline rename input needs.
 */
import InputField from '@/components/fields/input-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import type { CategoryMappingPreset } from '@bt/shared/types';
import { CheckIcon, ChevronDownIcon, HistoryIcon, PencilIcon, Trash2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const MAX_PRESET_NAME_LENGTH = 64;

const props = defineProps<{
  /** Mapping saved for the layout of the file being imported, if any. */
  matchingPreset: CategoryMappingPreset | null;
  /** Named templates, excluding the matching one. */
  namedPresets: CategoryMappingPreset[];
}>();

const emit = defineEmits<{
  apply: [payload: { preset: CategoryMappingPreset }];
  rename: [payload: { fingerprint: string; name: string }];
  delete: [payload: { fingerprint: string }];
}>();

const { t } = useI18n();

const isOpen = ref(false);

const sections = computed(() =>
  [
    {
      key: 'matching',
      label: t('importShared.categoryPreset.currentLayout'),
      presets: props.matchingPreset ? [props.matchingPreset] : [],
    },
    {
      key: 'named',
      label: t('importShared.categoryPreset.savedTemplates'),
      presets: props.namedPresets,
    },
  ].filter((section) => section.presets.length > 0),
);

function displayName({ preset }: { preset: CategoryMappingPreset }): string {
  return preset.name || t('importShared.categoryPreset.lastUsed');
}

// ---- Inline rename ----

const renamingFingerprint = ref<string | null>(null);
const renameValue = ref('');

function startRename({ preset }: { preset: CategoryMappingPreset }) {
  renamingFingerprint.value = preset.fingerprint;
  renameValue.value = preset.name ?? '';
}

function cancelRename() {
  renamingFingerprint.value = null;
}

function commitRename() {
  const fingerprint = renamingFingerprint.value;
  const name = renameValue.value.trim();
  if (fingerprint && name) emit('rename', { fingerprint, name });
  cancelRename();
}

// ---- Open state ----

function onOpenChange({ open }: { open: boolean }) {
  isOpen.value = open;
  if (!open) cancelRename();
}

function applyPreset({ preset }: { preset: CategoryMappingPreset }) {
  emit('apply', { preset });
  onOpenChange({ open: false });
}
</script>

<template>
  <Popover v-if="sections.length > 0" :open="isOpen" @update:open="(open) => onOpenChange({ open })">
    <PopoverTrigger as-child>
      <UiButton variant="secondary" size="sm">
        <HistoryIcon class="size-3.5" />
        {{ $t('importShared.categoryPreset.menuTrigger') }}
        <ChevronDownIcon class="size-3.5" />
      </UiButton>
    </PopoverTrigger>

    <PopoverContent align="end" class="w-72 p-1">
      <template v-for="(section, index) in sections" :key="section.key">
        <div v-if="index > 0" class="bg-muted -mx-1 my-1 h-px" />

        <p class="text-muted-foreground px-2 py-1.5 text-xs font-medium">{{ section.label }}</p>

        <div v-for="preset in section.presets" :key="preset.fingerprint" class="group/preset flex items-center gap-1">
          <template v-if="renamingFingerprint === preset.fingerprint">
            <InputField
              :model-value="renameValue"
              size="xs"
              class="min-w-0 flex-1"
              non-label-wrapper
              autofocus
              :maxlength="MAX_PRESET_NAME_LENGTH"
              :placeholder="$t('importShared.categoryPreset.namePlaceholder')"
              @update:model-value="(value) => (renameValue = String(value ?? ''))"
              @keydown.enter.stop.prevent="commitRename()"
              @keydown.esc.stop="cancelRename()"
            />

            <DesktopOnlyTooltip :content="$t('importShared.categoryPreset.confirmRenameAria')">
              <UiButton
                variant="ghost"
                size="icon-sm"
                :aria-label="$t('importShared.categoryPreset.confirmRenameAria')"
                @click="commitRename()"
              >
                <CheckIcon class="size-4" />
              </UiButton>
            </DesktopOnlyTooltip>
          </template>

          <template v-else>
            <UiButton
              variant="ghost"
              size="xs"
              class="min-w-0 flex-1 justify-start px-2 font-normal"
              @click="applyPreset({ preset })"
            >
              <span v-if="section.key === 'matching'" class="bg-success-text size-1.5 shrink-0 rounded-full" />
              <span class="truncate">{{ displayName({ preset }) }}</span>
            </UiButton>

            <DesktopOnlyTooltip :content="$t('importShared.categoryPreset.renameAria')">
              <UiButton
                variant="ghost"
                size="icon-sm"
                class="opacity-40 transition-opacity group-hover/preset:opacity-100 focus-visible:opacity-100"
                :aria-label="$t('importShared.categoryPreset.renameAria')"
                @click="startRename({ preset })"
              >
                <PencilIcon class="size-3.5" />
              </UiButton>
            </DesktopOnlyTooltip>

            <DesktopOnlyTooltip :content="$t('importShared.categoryPreset.deleteAria')">
              <UiButton
                variant="ghost-destructive"
                size="icon-sm"
                class="opacity-40 transition-opacity group-hover/preset:opacity-100 focus-visible:opacity-100"
                :aria-label="$t('importShared.categoryPreset.deleteAria')"
                @click="emit('delete', { fingerprint: preset.fingerprint })"
              >
                <Trash2Icon class="size-3.5" />
              </UiButton>
            </DesktopOnlyTooltip>
          </template>
        </div>
      </template>
    </PopoverContent>
  </Popover>
</template>
