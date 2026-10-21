import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import type { ChatCardField, ChatProposalCard } from '@bt/shared/types';
import { createI18n } from 'vue-i18n';

import type { CardLookups } from './use-card-lookups';

/** A pending create card; `overrides` change any part of it. */
export const buildCard = (overrides: Partial<ChatProposalCard> = {}): ChatProposalCard => ({
  id: 'card-1',
  status: 'pending',
  revision: 1,
  toolName: 'create_transaction',
  kind: 'create',
  entity: 'transaction',
  danger: 'none',
  confirmation: { mode: 'none' },
  title: { key: 'chat.cards.title.create', params: { entity: 'transaction' } },
  fields: [],
  dependsOn: [],
  safe: true,
  warnings: [],
  sources: [],
  canApply: { ok: true },
  editedByUser: false,
  createdAt: '2026-03-05T10:00:00.000Z',
  expiresAt: '2026-03-06T10:00:00.000Z',
  ...overrides,
});

/** A card field; the label key defaults to the real one for `path`. */
export const buildField = (overrides: Partial<ChatCardField> & Pick<ChatCardField, 'path'>): ChatCardField => ({
  labelKey: `chat.fields.${overrides.path}`,
  value: null,
  editable: null,
  ...overrides,
});

/** Lookups backed by plain maps, for components that take them as a prop. */
export const buildLookups = ({
  names = {},
  currencies = {},
  baseCurrencyCode = 'USD',
}: {
  names?: Record<string, string>;
  currencies?: Record<string, string>;
  baseCurrencyCode?: string | null;
} = {}): CardLookups => ({
  entityName: ({ kind, id }) => names[`${kind}:${id}`] ?? null,
  accountCurrency: ({ id }) => currencies[id] ?? null,
  baseCurrencyCode: () => baseCurrencyCode,
  accounts: () => [],
  categories: () => [],
  currencyCodes: () => ['USD', 'EUR'],
});

/** English chat messages, as the cards read them. */
export const createChatI18n = () =>
  createI18n({ legacy: false, locale: 'en', messages: { en: enChat }, missingWarn: false, fallbackWarn: false });
