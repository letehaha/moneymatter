export const CLIENT_LOG_LEVELS = ['info', 'warn', 'error'] as const;

export interface RecordClientLogRequest {
  /** Stable machine name, e.g. `statement_import.file_rejected`. */
  event: string;
  level: (typeof CLIENT_LOG_LEVELS)[number];
  context?: Record<string, string | number | boolean | null>;
}
