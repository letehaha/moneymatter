import {
  ArrowLeftRightIcon,
  ArrowUpDownIcon,
  BanknoteIcon,
  CalendarClockIcon,
  LayersIcon,
  PaperclipIcon,
  PiggyBankIcon,
  StoreIcon,
  TagIcon,
  UndoIcon,
} from '@lucide/vue';
import type { FunctionalComponent } from 'vue';

import type { ExtraFilterKey } from './filter-registry';

/**
 * Glyph paired with each filter in the picker menu. Kept separate from
 * `filter-registry` so the registry stays UI-agnostic (no Vue component
 * imports) and remains test-friendly.
 */
export const FILTER_ICONS: Record<ExtraFilterKey, FunctionalComponent> = {
  type: ArrowUpDownIcon,
  tags: TagIcon,
  payees: StoreIcon,
  trackers: PiggyBankIcon,
  amount: BanknoteIcon,
  transferKinds: LayersIcon,
  refunds: UndoIcon,
  transfers: ArrowLeftRightIcon,
  planned: CalendarClockIcon,
  attachments: PaperclipIcon,
};
