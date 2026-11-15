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

/**
 * Chat message limit (30 messages per 10 minutes). Every message starts a model run that spends the
 * user's own provider quota or subscription, so the budget bounds a runaway client or script; a
 * conversation by hand stays far below it. Card comments draw from the same budget, since they start
 * runs too.
 */
export const CHAT_MESSAGE_LIMIT = userRateLimit({ prefix: 'chat-message', windowSeconds: 10 * 60, maxAttempts: 30 });

/**
 * Chat approval limit (120 approvals per minute), shared by approving one card and "approve all".
 * An approval runs the real write handlers of the tools, so the budget bounds a runaway client; a
 * person clicking through cards, or one approve-all call, stays far below it.
 */
export const CHAT_APPROVAL_LIMIT = userRateLimit({ prefix: 'chat-approval', windowSeconds: 60, maxAttempts: 120 });
