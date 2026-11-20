<template>
  <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
    <span class="text-sm font-medium">
      {{ $t('dashboard.widgets.common.includePlanned') }}
      <ResponsiveTooltip
        :delay-duration="100"
        :content="$t('dashboard.widgets.common.includePlannedTooltip')"
        content-class-name="max-w-60"
      >
        <InfoIcon class="text-muted-foreground inline size-3.5 -translate-y-px cursor-help" @click.prevent.stop />
      </ResponsiveTooltip>
    </span>
    <Switch
      class="shrink-0"
      :model-value="includePlanned"
      :data-testid="`${testIdPrefix}-include-planned-switch`"
      @update:model-value="onToggle"
    />
  </div>
</template>

<script lang="ts" setup>
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { Switch } from '@/components/lib/ui/switch';
import { useIncludePlannedConfig } from '@/components/widgets/use-include-planned-config';
import { InfoIcon } from '@lucide/vue';

const props = withDefaults(
  defineProps<{
    /** Namespaces the data-testid so two widgets on one page stay addressable. */
    testIdPrefix: string;
    defaultValue?: boolean;
  }>(),
  { defaultValue: true },
);

const { includePlanned, setIncludePlanned } = useIncludePlannedConfig({ defaultValue: props.defaultValue });

const onToggle = async (value: boolean) => {
  await setIncludePlanned({ value });
};
</script>
