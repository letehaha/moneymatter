<script setup lang="ts">
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  type ChatEntityCell,
  type ChatEntityRef,
  type ChatTableCell,
  type ChatTableColumn,
  type ChatTableSpec,
  chatEntityLabelKey,
} from '@bt/shared/types';
import { useI18n } from 'vue-i18n';

import { chatEntityRoute } from '../entity-route';
import { formatVisualDate, formatVisualValue } from './format-visual-value';

defineProps<{ spec: ChatTableSpec }>();

const { t } = useI18n();

const NO_VALUE = '—';

const isEntityRef = (cell: ChatTableCell | undefined): cell is ChatEntityCell =>
  cell !== null && typeof cell === 'object';

const isRightAligned = ({ column }: { column: ChatTableColumn }) =>
  column.kind === 'money' || column.kind === 'number' || column.kind === 'percent';

/** The label is the entity's name, set by the server; rendered as text through interpolation only. */
const entityLabel = ({ cell }: { cell: ChatEntityCell }) =>
  typeof cell.label === 'string' && cell.label.trim() !== '' ? cell.label : null;

/** Entity names are written for the middle of a sentence ("budget plan"), a cell starts with a capital. */
const capitalize = ({ text }: { text: string }) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

const cellText = ({ column, cell }: { column: ChatTableColumn; cell: ChatTableCell | undefined }): string => {
  if (cell === null || cell === undefined) return NO_VALUE;
  if (isEntityRef(cell))
    return entityLabel({ cell }) ?? capitalize({ text: t(chatEntityLabelKey({ entity: cell.kind })) });
  if (typeof cell === 'string') return column.kind === 'date' ? formatVisualDate({ value: cell }) : cell;
  if (column.kind === 'money')
    return formatVisualValue({ value: cell, kind: 'money', currencyCode: column.currencyCode });
  if (column.kind === 'percent') return formatVisualValue({ value: cell, kind: 'percent' });

  return formatVisualValue({ value: cell, kind: 'number' });
};
</script>

<template>
  <figure class="flex min-w-0 flex-col gap-2">
    <figcaption class="text-sm font-medium wrap-anywhere">{{ spec.title }}</figcaption>

    <p v-if="spec.rows.length === 0" data-testid="table-empty" class="text-muted-foreground text-sm">
      {{ $t('chat.visuals.emptyTable') }}
    </p>
    <ScrollArea v-else class="border-border max-h-96 rounded-lg border" with-horizontal-scrollbar>
      <table class="w-full text-sm">
        <thead class="bg-muted/40 text-muted-foreground text-xs">
          <tr>
            <th
              v-for="column in spec.columns"
              :key="column.key"
              scope="col"
              :class="
                cn('px-3 py-2 font-medium whitespace-nowrap', isRightAligned({ column }) ? 'text-right' : 'text-left')
              "
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in spec.rows" :key="rowIndex" class="border-border border-t">
            <td
              v-for="column in spec.columns"
              :key="column.key"
              :class="cn('px-3 py-2', isRightAligned({ column }) ? 'text-right tabular-nums' : 'text-left')"
            >
              <template v-if="isEntityRef(row[column.key])">
                <RouterLink
                  v-if="chatEntityRoute({ entity: row[column.key] as ChatEntityRef })"
                  :to="chatEntityRoute({ entity: row[column.key] as ChatEntityRef })!"
                  class="text-primary-text hover:underline"
                >
                  {{ cellText({ column, cell: row[column.key] }) }}
                </RouterLink>
                <template v-else>{{ cellText({ column, cell: row[column.key] }) }}</template>
              </template>
              <template v-else>{{ cellText({ column, cell: row[column.key] }) }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </ScrollArea>
  </figure>
</template>
