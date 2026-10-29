/**
 * Per-user budgets of the REST middleware (`middlewares/rate-limit.ts`). One counter per user and budget.
 */
export interface UserRateLimit {
  windowSeconds: number;
  maxAttempts: number;
  key: ({ userId }: { userId: number }) => string;
}

const userRateLimit = ({
  prefix,
  windowSeconds,
  maxAttempts,
}: {
  prefix: string;
  windowSeconds: number;
  maxAttempts: number;
}): UserRateLimit => ({
  windowSeconds,
  maxAttempts,
  key: ({ userId }) => `${prefix}:user:${userId}`,
});

/**
 * Chat attachment upload limit (30 uploads per 10 minutes). Each upload buffers a file of up to
 * 10 MB and reads a PDF on the API thread, so the budget bounds memory churn and parsing time per
 * user; it matches the message budget, which is what a conversation of attachments needs.
 */
export const CHAT_ATTACHMENT_LIMIT = userRateLimit({
  prefix: 'chat-attachment',
  windowSeconds: 10 * 60,
  maxAttempts: 30,
});
