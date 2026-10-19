<script setup lang="ts">
import { LogoImageTooLargeError, LogoImageUnreadableError, cropLogoImage } from '@/common/utils/crop-logo-image';
import { getLogoImageUrl } from '@/common/utils/logo-url';
import BrandLogo from '@/components/common/brand-logo.vue';
import { type LogoSelection, toLogoDisplayProps } from '@/components/common/logo-selection';
import { Button } from '@/components/lib/ui/button';
import { captureException } from '@/lib/sentry';
import { ImageUpIcon } from '@lucide/vue';
import { computed, ref, useId } from 'vue';

const props = defineProps<{
  selection: LogoSelection | null;
  name: string;
}>();

const emit = defineEmits<{
  (e: 'select', value: LogoSelection): void;
}>();

const storedImage = props.selection?.kind === 'image' ? props.selection : null;
const initialDataUrl = props.selection?.kind === 'image-upload' ? props.selection.dataUrl : null;

const fileInput = ref<HTMLInputElement | null>(null);
const dataUrl = ref<string | null>(initialDataUrl);
const errorKey = ref<'common.logo.imageTooLarge' | 'common.logo.imageUnreadable' | null>(null);
const isProcessing = ref(false);
const errorId = useId();

const preview = computed(() =>
  toLogoDisplayProps({ selection: dataUrl.value ? { kind: 'image-upload', dataUrl: dataUrl.value } : storedImage }),
);
const fullSizeSrc = computed(
  () => dataUrl.value ?? (storedImage ? getLogoImageUrl({ id: storedImage.imageId }) : null),
);
const hasImage = computed(() => Boolean(fullSizeSrc.value));
const canApply = computed(() => Boolean(dataUrl.value) && dataUrl.value !== initialDataUrl);

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  isProcessing.value = true;
  errorKey.value = null;
  try {
    dataUrl.value = await cropLogoImage({ file });
  } catch (error) {
    dataUrl.value = null;
    if (error instanceof LogoImageTooLargeError) {
      errorKey.value = 'common.logo.imageTooLarge';
    } else {
      errorKey.value = 'common.logo.imageUnreadable';
      if (!(error instanceof LogoImageUnreadableError)) {
        captureException({ error, context: { flow: 'logo-image-crop' } });
      }
    }
  } finally {
    isProcessing.value = false;
  }
}

function apply() {
  if (dataUrl.value) emit('select', { kind: 'image-upload', dataUrl: dataUrl.value });
}
</script>

<template>
  <div class="flex flex-col gap-4 p-3">
    <div class="flex items-center gap-3">
      <BrandLogo v-bind="preview" :name="name" class="size-12 text-lg" />
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          class="hidden"
          data-test="logo-image-input"
          @change="handleFileChange"
        />
        <Button
          type="button"
          variant="outline"
          :disabled="isProcessing"
          :aria-describedby="errorKey ? errorId : undefined"
          data-test="logo-image-choose"
          @click="fileInput?.click()"
        >
          <ImageUpIcon class="size-4" />
          {{ hasImage ? $t('common.logo.replaceImage') : $t('common.logo.chooseImage') }}
        </Button>
      </div>
    </div>

    <div v-if="fullSizeSrc" class="ring-primary/15 size-[200px] overflow-hidden rounded-xl ring-1">
      <img :src="fullSizeSrc" class="size-full object-cover" alt="" />
    </div>

    <p v-if="errorKey" :id="errorId" role="alert" class="text-destructive-text text-xs" data-test="logo-image-error">
      {{ $t(errorKey) }}
    </p>
    <p v-else class="text-muted-foreground text-xs">{{ $t('common.logo.imageHint') }}</p>

    <Button type="button" :disabled="!canApply" data-test="logo-image-apply" @click="apply">
      {{ $t('common.actions.apply') }}
    </Button>
  </div>
</template>
