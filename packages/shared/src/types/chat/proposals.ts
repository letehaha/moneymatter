import type { ChatEntityKind, ChatEntityRef } from './fields';
import type { ChatPageContext } from './messages';
import type { ChatTableColumn, ChatTableRow } from './visuals';

export type ChatProposalStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'rejected'
  | 'failed'
  | 'stale'
  | 'blocked'
  | 'superseded'
  | 'expired'
  | 'unknown';

export const CHAT_CARD_KINDS = ['create', 'update', 'delete', 'bulk', 'merge', 'link', 'settings', 'action'] as const;

export type ChatCardKind = (typeof CHAT_CARD_KINDS)[number];

/** The i18n key of a card's title; the entity name goes in as the `entity` param. */
export const chatCardTitleKey = ({ kind }: { kind: ChatCardKind }): string => `chat.cards.title.${kind}`;

export type ChatCardDanger = 'none' | 'destructive' | 'highImpact';

export type ChatConfirmationMode = 'none' | 'confirm' | 'typed';

/** Why the model is unsure about a field; the only way a card can express doubt, so it is never prose. */
export const CHAT_UNCERTAINTY_REASONS = [
  'guessedFromHistory',
  'guessedFromAttachment',
  'ambiguousMatch',
  'missingInSource',
  'inferredDate',
  'convertedCurrency',
  'other',
] as const;

/**
 * Reasons only the server sets, from a check against the user's own data. The model cannot name one, so
 * a card never claims a check that did not happen.
 */
const CHAT_SERVER_UNCERTAINTY_REASONS = ['accountHistoryMismatch'] as const;

export type ChatUncertaintyReason =
  | (typeof CHAT_UNCERTAINTY_REASONS)[number]
  | (typeof CHAT_SERVER_UNCERTAINTY_REASONS)[number];

/**
 * A field of a card the user should check, shown highlighted: the model's own `_chat.uncertain` entry, or the
 * server's mark from a check against the user's data (`accountHistoryMismatch`). Stored on the proposal.
 */
export interface ChatUncertainField {
  field: string;
  reason: ChatUncertaintyReason;
  alternatives?: unknown[];
}

/** Where a card's values came from; the "details" section lists them. */
export type ChatSource =
  | { type: 'toolCall'; callId: string; toolName: string; args: unknown }
  | { type: 'attachment'; attachmentId: string; fileName: string }
  | { type: 'pageContext'; context: ChatPageContext }
  | { type: 'analysis'; partId: string };

export interface ChatCardTitle {
  key: string;
  params: Record<string, string | number>;
}

export type ChatFieldDisplay = {
  kind: 'money' | 'date' | 'datetime' | 'entity' | 'enum' | 'text' | 'boolean' | 'matchingRules';
  currencyCode?: string;
  entity?: ChatEntityRef & { label: string };
};

export type ChatFieldEditable = {
  type: 'text' | 'number' | 'money' | 'date' | 'datetime' | 'enum' | 'boolean' | 'entity';
  entity?: ChatEntityKind;
  options?: string[];
};

export interface ChatCardField {
  /** Top-level argument name. */
  path: string;
  /** From `CHAT_FIELD_LABEL_KEYS`. */
  labelKey: string;
  /** The validated argument; a `$proposal:` ref is resolved to a parent link. */
  value: unknown;
  display?: ChatFieldDisplay;
  /** Update cards: the value before the change. */
  before?: unknown;
  editable: null | ChatFieldEditable;
  uncertain?: { reason: ChatUncertaintyReason; alternatives?: unknown[] };
}

/** Count plus up to 10 sample rows of what a bulk, merge or delete card affects. */
export interface ChatCardAffected {
  count: number;
  columns: ChatTableColumn[];
  rows: ChatTableRow[];
  truncated: boolean;
}

export interface ChatCardWarning {
  key: string;
  params?: Record<string, string | number>;
}

export interface ChatCardDependency {
  id: string;
  title: ChatCardTitle;
  status: ChatProposalStatus;
  revision: number;
}

export interface ChatCardError {
  messageKey?: string;
  message?: string;
}

/** What the server computed the call will do, stored on the proposal and shown on the card. */
export interface ChatProposalPreview {
  /** The entity as it is now, for update and delete cards. */
  before?: Record<string, unknown> | null;
  affected?: ChatCardAffected;
  /** Related counts, such as the transactions an account holds. */
  counts?: Record<string, number>;
  /** What the resolver wants the user to see before approving, such as the transfer twin a delete also removes. */
  warnings?: ChatCardWarning[];
  /**
   * Display names of the records the card's arguments point at, by `chatEntityRefKey`, read
   * from the user's own data. Only for kinds the app holds no list of (a subscription, a transaction, a plan), so
   * the card names the record and not only its kind.
   */
  labels?: Record<string, string>;
}

/**
 * What the preview was computed against. An approval recomputes it and compares: a different target
 * set, `updatedAt`, base currency or parent status makes the card stale.
 */
export interface ChatProposalSnapshot {
  baseCurrencyCode: string;
  updatedAt?: string | null;
  /** The frozen target ids of a filter-based bulk delete. */
  targetIds?: string[];
  /** Hash of the target set, and how many targets it holds (the number a stale card shows). */
  targetHash?: string;
  targetCount?: number;
  parentStatuses?: Record<string, ChatProposalStatus>;
  /** Set when an approval found the card stale: what moved, so the card can show it after a reload. */
  staleDiff?: { before?: unknown; after?: unknown };
}

/** The slimmed handler output and the entities it created or touched. */
export interface ChatProposalResult {
  refs: ChatEntityRef[];
  output?: unknown;
  /** The pending parents the same approval applied first. */
  alsoApplied?: string[];
}

export interface ChatProposalCard {
  id: string;
  status: ChatProposalStatus;
  /** Sent back on approve, with the parents' revisions. */
  revision: number;
  toolName: string;
  kind: ChatCardKind;
  entity: ChatEntityKind;
  danger: ChatCardDanger;
  /** `phrase` is the affected count a `typed` confirmation asks for. */
  confirmation: { mode: ChatConfirmationMode; phrase?: string };
  title: ChatCardTitle;
  fields: ChatCardField[];
  /**
   * Update and delete cards: the record the call targets as it is now, by its identifying fields (amount,
   * date, payee, note, account, name), so the user sees which record changes and not only its kind.
   */
  target?: ChatCardField[];
  affected?: ChatCardAffected;
  /** Related records that are not zero, by count name (`splitCount`, `transferTwinCount`, ...); the card lists them. */
  counts?: Record<string, number>;
  /** Display names of the records the arguments point at, by `chatEntityRefKey`; see `ChatProposalPreview.labels`. */
  labels?: Record<string, string>;
  dependsOn: ChatCardDependency[];
  /** Amber card: the full URL and host the server will contact; the confirm repeats the host. */
  egress?: { url: string; host: string };
  /** Eligible for "Approve all safe". */
  safe: boolean;
  warnings: ChatCardWarning[];
  sources: ChatSource[];
  canApply: { ok: true } | { ok: false; reasonKey: string };
  stale?: { reasonKey: string; before?: unknown; after?: unknown };
  result?: { refs: ChatEntityRef[]; executedArgs: unknown; appliedAt: string; alsoApplied?: string[] };
  error?: ChatCardError;
  editedByUser: boolean;
  createdAt: string;
  expiresAt: string;
}

/** An unapproved card expires this long after it was proposed, pinned threads included. */
export const CHAT_PROPOSAL_LIFETIME_MS = 24 * 60 * 60 * 1000;
