/**
 * Per-user budgets shared by the REST middleware (`middlewares/rate-limit.ts`) and the MCP tools
 * (`enforceUserRateLimit`). The key is the one REST has always used, so both paths draw from one
 * counter per user.
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
 * Rate-source save limit (20 saves per minute). A save that changes the source fetches from CoinGecko
 * (one shared key for the instance) or from the user's URL, and values every saved row of the
 * currency again, so it cannot be repeated without bound.
 */
export const RATE_SOURCE_SAVE_LIMIT = userRateLimit({ prefix: 'rate-source-save', windowSeconds: 60, maxAttempts: 20 });

/**
 * Rate-source preview limit (20 previews per minute). Each call makes the server fetch a URL the
 * user typed, so it stays low enough that the endpoint cannot be used to hammer a host.
 */
export const RATE_SOURCE_TEST_LIMIT = userRateLimit({ prefix: 'rate-source-test', windowSeconds: 60, maxAttempts: 20 });

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
