<script setup lang="ts">
import { bulkUploadPrices, getPriceUploadInfo, searchSecurities } from '@/api/securities';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import SecurityLogo from '@/components/common/security-logo.vue';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import * as Tooltip from '@/components/lib/ui/tooltip';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useIsAdmin } from '@/composable';
import type { SecuritySearchResult } from '@bt/shared/types/investments';
import { useQuery } from '@tanstack/vue-query';
import { format, parse } from 'date-fns';
import { InfoIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ExistingPrice } from './composables/use-price-comparison';
import type { PreviewRow } from './composables/use-price-comparison';
import DataPreviewTable from './data-preview-table.vue';
import FieldMapper from './field-mapper.vue';
import FileUpload from './file-upload.vue';

const { isAdmin } = useIsAdmin();
const { addNotification } = useNotificationCenter();
const { t } = useI18n();

const isOpen = ref(false);
const currentStep = ref<'select' | 'upload' | 'map' | 'preview' | 'options' | 'result'>('select');

// Step 1: Security Selection
const selectedSecurity = ref<SecuritySearchResult | null>(null);
const searchTerm = ref('');
const debounced = ref('');
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchTerm, (v) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounced.value = v.trim();
  }, 300);
});

const query = useQuery({
  queryKey: ['sec-search-admin', debounced],
  queryFn: () => searchSecurities({ query: debounced.value }),
  enabled: () => debounced.value.length >= 1,
});

function selectSecurity(searchResult: SecuritySearchResult) {
  selectedSecurity.value = searchResult;
  searchTerm.value = '';
  currentStep.value = 'upload';
}

const securityPriceUploadInfo = useQuery({
  queryKey: ['security-price-upload-info', selectedSecurity],
  queryFn: () => getPriceUploadInfo(selectedSecurity.value!.currencyCode),
  enabled: () => !!selectedSecurity.value,
});

watch(securityPriceUploadInfo.error, (error: unknown) => {
  addNotification({
    text: t('settings.admin.priceUpload.notifications.dateInfoLoadFailed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    }),
    type: NotificationType.error,
  });
  currentStep.value = 'select';
  selectedSecurity.value = null;
});

// Step 3: File Upload
const fileData = ref<unknown[] | null>(null);
const fileName = ref('');
const fileType = ref<'csv' | 'json' | null>(null);

function handleFileLoaded(data: { content: unknown[]; fileName: string; fileType: 'csv' | 'json' }) {
  fileData.value = data.content;
  fileName.value = data.fileName;
  fileType.value = data.fileType;
  isMappingComplete.value = false; // Reset mapping state for new file
  currentStep.value = 'map';
}

function handleFileError(message: string) {
  addNotification({
    text: message,
    type: NotificationType.error,
  });
}

// Step 4: Field Mapping
const fileFields = computed(() => {
  if (!fileData.value || fileData.value.length === 0) return [];
  const first = fileData.value[0] as Record<string, unknown>;
  return Object.keys(first);
});

const fieldMapping = ref<Record<string, string>>({});
const dateFormat = ref<string>('dd/MM/yyyy');
const isMappingComplete = ref(false);

function handleMappingComplete(mapping: Record<string, string>, fmt: string) {
  fieldMapping.value = mapping;
  dateFormat.value = fmt;
  isMappingComplete.value = true;
}

function handleMappingChanged(mapping: Record<string, string>, fmt: string) {
  fieldMapping.value = mapping;
  dateFormat.value = fmt;
  // Check if mapping is still complete (all required fields mapped)
  const requiredFields = ['price', 'date'];
  isMappingComplete.value = requiredFields.every((field) => mapping[field]);
}

watch(selectedSecurity, (v) => console.log('selectedSecurity', v));

async function proceedToPreview() {
  const success = transformData();
  if (!success) return;

  // Fetch existing prices if security exists
  // await fetchExistingPrices();

  currentStep.value = 'preview';
}

// const existingSecurityPrices = useQuery({
//   queryKey: ['existing-security-prices', selectedSecurity],
//   queryFn: () => {
//     try {
//     // Get date range from preview data
//     const dates = previewData.value.map((row) => new Date(row.date));
//     const oldestDate = new Date(Math.min(...dates.map((d) => d.getTime())));
//     const newestDate = new Date(Math.max(...dates.map((d) => d.getTime())));

//     // Fetch existing prices for the date range
//     const prices = await getSecurityPrices({
//       securityId: selectedSecurity.value,
//       startDate: oldestDate.toISOString(),
//       endDate: newestDate.toISOString(),
//     });

//     console.log(
//       'prices',
//       {
//         securityId: selectedSecurity.value.,
//         startDate: oldestDate.toISOString(),
//         endDate: newestDate.toISOString(),
//       },
//       prices,
//     );

//     console.log(`Fetched ${prices.length} existing prices`);

//     // Transform to ExistingPrice format (priceClose is a string, convert to number)
//     existingPrices.value = prices.map((p) => ({
//       date: p.date,
//       price: parseFloat(p.priceClose),
//     }));
//   } catch (error) {
//     // Log error for debugging but don't block the UI
//     console.error('Failed to fetch existing prices:', error);
//     addNotification({
//       text: 'Failed to load existing prices for comparison. Continuing without comparison data.',
//       type: NotificationType.warning,
//     });
//   } finally {
//     isLoadingExistingPrices.value = false;
//   }
//   },
//   enabled: () => !!selectedSecurity.value && previewData.value.length > 0 && currentStep.value === 'preview',
// });

// async function fetchExistingPrices() {
//   if (!selectedSecurity.value || previewData.value.length === 0) return;

//   isLoadingExistingPrices.value = true;
//   existingPrices.value = [];

//   try {
//     // Get date range from preview data
//     const dates = previewData.value.map((row) => new Date(row.date));
//     const oldestDate = new Date(Math.min(...dates.map((d) => d.getTime())));
//     const newestDate = new Date(Math.max(...dates.map((d) => d.getTime())));

//     // Try to find the security in our database by fetching all securities
//     // This is admin-only so performance is acceptable
//     interface SecurityRecord {
//       id: number;
//       symbol: string;
//       exchangeMic?: string;
//     }

//     console.log('Found existing security:', existingSecurity.id);

//     // Fetch existing prices for the date range
//     const prices = await getSecurityPrices({
//       securityId: existingSecurity.id,
//       startDate: oldestDate.toISOString(),
//       endDate: newestDate.toISOString(),
//     });

//     console.log(
//       'prices',
//       {
//         securityId: selectedSecurity.value.,
//         startDate: oldestDate.toISOString(),
//         endDate: newestDate.toISOString(),
//       },
//       prices,
//     );

//     console.log(`Fetched ${prices.length} existing prices`);

//     // Transform to ExistingPrice format (priceClose is a string, convert to number)
//     existingPrices.value = prices.map((p) => ({
//       date: p.date,
//       price: parseFloat(p.priceClose),
//     }));
//   } catch (error) {
//     // Log error for debugging but don't block the UI
//     console.error('Failed to fetch existing prices:', error);
//     addNotification({
//       text: 'Failed to load existing prices for comparison. Continuing without comparison data.',
//       type: NotificationType.warning,
//     });
//   } finally {
//     isLoadingExistingPrices.value = false;
//   }
// }

// Step 5: Data Preview
const previewData = ref<PreviewRow[]>([]);
const existingPrices = ref<ExistingPrice[]>([]);
const isLoadingExistingPrices = ref(false);

function transformData(): boolean {
  if (!fileData.value || !selectedSecurity.value) return false;

  const currency = selectedSecurity.value.currencyCode;

  try {
    previewData.value = fileData.value.map((row, index) => {
      const rowData = row as Record<string, unknown>;
      const price = Number(rowData[fieldMapping.value.price!]);
      const dateStr = String(rowData[fieldMapping.value.date!]);

      // Parse date according to selected format, then convert to YYYY-MM-DD
      const parsedDate = parse(dateStr, dateFormat.value, new Date());

      // Check if date is valid
      if (isNaN(parsedDate.getTime())) {
        throw new Error(`Invalid date "${dateStr}" at row ${index + 1}. Please check your date format selection.`);
      }

      const formattedDate = format(parsedDate, 'yyyy-MM-dd');

      return {
        price,
        date: formattedDate,
        currency,
      };
    });
    return true;
  } catch (error) {
    addNotification({
      text: error instanceof Error ? error.message : 'Failed to parse dates. Please verify your date format selection.',
      type: NotificationType.error,
    });
    return false;
  }
}

// Step 6: Upload Options
const autoFilter = ref(true);
const override = ref(false);

function proceedToOptions() {
  currentStep.value = 'options';
}

// Step 7: Submit
const isUploading = ref(false);
const uploadResult = ref<{ inserted: number; duplicates: number; filtered: number } | null>(null);

async function submitUpload() {
  if (!selectedSecurity.value || previewData.value.length === 0) return;

  isUploading.value = true;
  try {
    const payload = {
      searchResult: selectedSecurity.value,
      prices: previewData.value.map((row) => ({
        price: row.price,
        date: row.date,
        currency: row.currency,
      })),
      autoFilter: autoFilter.value,
      override: override.value,
    };

    const result = await bulkUploadPrices(payload);
    uploadResult.value = result.summary;

    // Update date info with new dates
    if (result.newOldestDate && result.newNewestDate) {
      securityPriceUploadInfo.data.value = {
        ...securityPriceUploadInfo.data.value!,
        oldestDate: result.newOldestDate,
        newestDate: result.newNewestDate,
      };
    }

    currentStep.value = 'result';
    addNotification({
      text: t('settings.admin.priceUpload.notifications.uploadSuccess', {
        count: result.summary.inserted,
      }),
      type: NotificationType.success,
    });
  } catch (error) {
    addNotification({
      text: t('settings.admin.priceUpload.notifications.uploadFailed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      type: NotificationType.error,
    });
  } finally {
    isUploading.value = false;
  }
}

// Reset
function reset() {
  selectedSecurity.value = null;
  fileData.value = null;
  fileName.value = '';
  fileType.value = null;
  fieldMapping.value = {};
  isMappingComplete.value = false;
  previewData.value = [];
  existingPrices.value = [];
  isLoadingExistingPrices.value = false;
  autoFilter.value = true;
  override.value = false;
  uploadResult.value = null;
  currentStep.value = 'select';
}

function startOver() {
  reset();
}

// Only show if user is admin
if (!isAdmin.value) {
  isOpen.value = false;
}
</script>

<template>
  <ResponsiveDialog
    v-if="isAdmin"
    v-model:open="isOpen"
    @update:open="(open) => !open && reset()"
    dialog-content-class="max-w-[650px]"
  >
    <template #trigger>
      <slot />
    </template>

    <template #title> {{ $t('settings.admin.priceUpload.dialogTitle') }} </template>

    <template #default>
      <div class="grid gap-4">
        <!-- Step 1: Security Selection -->
        <div v-if="currentStep === 'select'" class="space-y-2">
          <InputField
            v-model="searchTerm"
            :label="$t('settings.admin.priceUpload.selectSecurity.searchLabel')"
            :placeholder="$t('settings.admin.priceUpload.selectSecurity.searchPlaceholder')"
            class="max-w-full"
          />

          <div v-if="query.isLoading.value" class="text-muted-foreground text-sm">
            {{ $t('settings.admin.priceUpload.selectSecurity.searching') }}
          </div>
          <div v-else-if="query.error.value" class="text-destructive-text text-sm">
            {{ $t('settings.admin.priceUpload.selectSecurity.failed') }}
          </div>
          <div v-else>
            <ul class="max-h-60 overflow-y-auto">
              <li
                v-for="sec in query.data.value || []"
                :key="sec.symbol"
                class="hover:bg-hover grid cursor-pointer grid-cols-[auto_auto_1fr_auto_auto] items-center gap-2 px-2 py-1"
                @click="selectSecurity(sec)"
              >
                <SecurityLogo :security="sec" class="size-5" />
                <span class="font-medium">{{ sec.symbol }}</span>
                <span class="text-muted-foreground truncate text-xs">{{ sec.name }}</span>
                <span class="text-muted-foreground text-right text-xs">{{ sec.exchangeName }}</span>
                <span class="text-muted-foreground text-right text-xs">{{ sec.currencyCode.toUpperCase() }}</span>
              </li>
            </ul>
            <div v-if="debounced && (query.data.value?.length ?? 0) === 0" class="text-muted-foreground text-sm">
              {{ $t('settings.admin.priceUpload.selectSecurity.noResults') }}
            </div>
          </div>
        </div>

        <!-- Steps 2-7: After security selected -->
        <div v-else class="space-y-4">
          <!-- Selected Security Header -->
          <div class="border-border flex items-center justify-between rounded border p-3">
            <div>
              <div class="font-medium">{{ selectedSecurity!.symbol }}</div>
              <div class="text-muted-foreground text-xs">{{ selectedSecurity!.name }}</div>
            </div>
            <button type="button" class="text-muted-foreground hover:text-foreground text-sm" @click="startOver">
              {{ $t('settings.admin.priceUpload.selectSecurity.changeButton') }}
            </button>
          </div>

          <div v-if="securityPriceUploadInfo.isLoading.value" class="text-muted-foreground text-center text-sm">
            {{ $t('settings.admin.priceUpload.dateRangeInfo.loading') }}
          </div>
          <div
            v-else-if="securityPriceUploadInfo.data"
            class="bg-muted/30 border-border flex items-start justify-between rounded border p-3 text-xs"
          >
            <div>
              <div class="mb-1 font-medium">
                {{
                  $t('settings.admin.priceUpload.dateRangeInfo.title', {
                    currency: securityPriceUploadInfo.data.value?.currencyCode,
                  })
                }}
              </div>
              <div class="text-muted-foreground">
                {{ new Date(securityPriceUploadInfo.data.value!.oldestDate).toLocaleDateString() }} -
                {{ new Date(securityPriceUploadInfo.data.value!.newestDate).toLocaleDateString() }}
              </div>
            </div>

            <Tooltip.TooltipProvider>
              <Tooltip.Tooltip>
                <Tooltip.TooltipTrigger class="flex items-center gap-2">
                  <InfoIcon class="size-6" />
                </Tooltip.TooltipTrigger>
                <Tooltip.TooltipContent class="max-w-100 p-4">
                  <span class="text-sm leading-6 opacity-90">
                    {{ $t('settings.admin.priceUpload.dateRangeInfo.tooltipText') }}
                  </span>
                </Tooltip.TooltipContent>
              </Tooltip.Tooltip>
            </Tooltip.TooltipProvider>
          </div>

          <!-- Step 2: File Upload -->
          <div v-if="currentStep === 'upload'">
            <FileUpload @file-loaded="handleFileLoaded" @error="handleFileError" />
          </div>

          <!-- Step 3: Field Mapping -->
          <div v-if="currentStep === 'map'">
            <div class="bg-muted/30 border-border mb-4 flex items-center justify-between rounded border p-3 text-xs">
              <div>
                <strong>{{ $t('settings.admin.priceUpload.fieldMapper.fileInfo') }}</strong> {{ fileName }} ({{
                  $t('settings.admin.priceUpload.fieldMapper.records', { count: fileData!.length })
                }})
              </div>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground text-xs underline"
                @click="currentStep = 'upload'"
              >
                {{ $t('settings.admin.priceUpload.fieldMapper.changeFileButton') }}
              </button>
            </div>
            <FieldMapper
              :file-fields="fileFields"
              :required-fields="['price', 'date']"
              @mapping-complete="handleMappingComplete"
              @mapping-changed="handleMappingChanged"
            />
            <div class="mt-4 flex justify-end">
              <Button :disabled="!isMappingComplete" @click="proceedToPreview" variant="secondary">
                {{ $t('settings.admin.priceUpload.fieldMapper.continueButton') }}
              </Button>
            </div>
          </div>

          <!-- Step 4: Data Preview -->
          <div v-if="currentStep === 'preview'">
            <div class="bg-muted/30 border-border mb-4 flex items-center justify-between rounded border p-3 text-xs">
              <div>
                <strong>{{ $t('settings.admin.priceUpload.fieldMapper.fileInfo') }}</strong> {{ fileName }} ({{
                  $t('settings.admin.priceUpload.fieldMapper.records', { count: fileData!.length })
                }})
              </div>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground text-xs underline"
                @click="currentStep = 'upload'"
              >
                {{ $t('settings.admin.priceUpload.fieldMapper.changeFileButton') }}
              </button>
            </div>

            <div v-if="isLoadingExistingPrices" class="text-muted-foreground mb-4 text-center text-sm">
              {{ $t('settings.admin.priceUpload.preview.loadingExisting') }}
            </div>

            <DataPreviewTable :data="previewData" :existing-prices="existingPrices" />

            <div class="mt-4 flex justify-end gap-2">
              <Button variant="outline" @click="currentStep = 'map'">{{
                $t('settings.admin.priceUpload.preview.backButton')
              }}</Button>
              <Button @click="proceedToOptions">{{ $t('settings.admin.priceUpload.preview.continueButton') }}</Button>
            </div>
          </div>

          <!-- Step 5: Upload Options -->
          <div v-if="currentStep === 'options'" class="space-y-4">
            <h3 class="text-sm font-medium">{{ $t('settings.admin.priceUpload.options.title') }}</h3>

            <label class="flex items-start gap-3">
              <input v-model="autoFilter" type="checkbox" class="mt-1" />
              <div>
                <div class="text-sm font-medium">{{ $t('settings.admin.priceUpload.options.autoFilter.title') }}</div>
                <div class="text-muted-foreground text-xs">
                  {{ $t('settings.admin.priceUpload.options.autoFilter.description') }}
                </div>
              </div>
            </label>

            <label class="flex items-start gap-3">
              <input v-model="override" type="checkbox" class="mt-1" />
              <div>
                <div class="text-sm font-medium">{{ $t('settings.admin.priceUpload.options.override.title') }}</div>
                <div class="text-muted-foreground text-xs">
                  {{ $t('settings.admin.priceUpload.options.override.description') }}
                </div>
              </div>
            </label>

            <div class="mt-6 flex justify-end gap-2">
              <Button variant="outline" @click="currentStep = 'preview'">{{
                $t('settings.admin.priceUpload.options.backButton')
              }}</Button>
              <Button :disabled="isUploading" @click="submitUpload">
                {{
                  isUploading
                    ? $t('settings.admin.priceUpload.options.uploadingButton')
                    : $t('settings.admin.priceUpload.options.uploadButton')
                }}
              </Button>
            </div>
          </div>

          <!-- Step 6: Result -->
          <div v-if="currentStep === 'result'" class="space-y-4">
            <Callout variant="success" :title="$t('settings.admin.priceUpload.result.title')">
              <div class="space-y-1 text-sm">
                <div>
                  {{
                    $t('settings.admin.priceUpload.result.inserted', {
                      count: uploadResult!.inserted,
                    })
                  }}
                </div>
                <div v-if="uploadResult!.duplicates > 0">
                  {{
                    $t('settings.admin.priceUpload.result.duplicates', {
                      count: uploadResult!.duplicates,
                      action: override
                        ? $t('settings.admin.priceUpload.result.duplicatesUpdated')
                        : $t('settings.admin.priceUpload.result.duplicatesSkipped'),
                    })
                  }}
                </div>
                <div v-if="uploadResult!.filtered > 0">
                  {{
                    $t('settings.admin.priceUpload.result.filtered', {
                      count: uploadResult!.filtered,
                    })
                  }}
                </div>
              </div>
            </Callout>

            <div class="flex justify-end gap-2">
              <Button variant="outline" @click="isOpen = false">{{
                $t('settings.admin.priceUpload.result.closeButton')
              }}</Button>
              <Button @click="startOver">{{ $t('settings.admin.priceUpload.result.uploadMoreButton') }}</Button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
