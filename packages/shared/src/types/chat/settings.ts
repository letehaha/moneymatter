/** How long an unpinned thread lives after its last message; `null` keeps threads until the user deletes them. */
export const CHAT_RETENTION_OPTIONS = [7, 30, 90, 365] as const;

export type ChatRetentionDays = (typeof CHAT_RETENTION_OPTIONS)[number];

/** What a user who never chose gets. Applied when settings are read, never written into the stored row. */
export const CHAT_DEFAULT_RETENTION_DAYS: ChatRetentionDays = 30;

/** What `PUT /chat/settings` takes and answers with. */
export interface ChatSettings {
  retentionDays: ChatRetentionDays | null;
}
