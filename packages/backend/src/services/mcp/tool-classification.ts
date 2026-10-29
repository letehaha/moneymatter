/**
 * How the MCP tools are classified, by hand, so one list can serve every consumer: the drift
 * suite that checks each tool against these lists (`tool-scopes-drift.unit.ts`) and the chat,
 * which derives its read/write access and danger levels from the same names.
 */

/** Read tools are named by this rule; every other tool is a write and must check a scope. */
export const READ_TOOL_NAME = /^(get|list|search|preview)_/;

// Tools that permanently delete a record without `delete_` in their name. Kept by
// hand: a new destructive tool named otherwise is only checked once it is listed here.
export const DESTRUCTIVE_TOOLS = ['merge_payees', 'bulk_delete_transactions', 'bulk_delete_payees'];

// Tools whose delete path is optional: they require `finance:write` always and `finance:delete`
// only on the path that deletes, where the service decides and asks through a callback. Kept by
// hand, so a tool that sometimes deletes cannot ship with the write scope alone.
export const CONDITIONAL_DELETE_TOOLS = [
  // With `force`, the service deletes the payee the ignored name resolves to; the handler checks
  // finance:delete before it calls the service.
  'ignore_payee_name',
  // The revert deletes the payment transaction the app created for the period; `revertPeriod` asks
  // `assertCanDeleteTransaction` inside its own transaction, right before `deleteTransaction`.
  'revert_subscription_period',
];

// Tools that check a scope but whose REST route carries no `checkBaseCurrencyLock`, so they
// skip `assertBaseCurrencyUnlocked`. Kept by hand, one route per entry: the lock follows the
// route, not the tool's name or scope. Add a tool here only after reading its route.
export const LOCK_EXEMPT_TOOLS = [
  // POST /transactions/:transactionId/attachments has no lock: attachments touch no amounts.
  'create_attachment_upload_url',
  // GET /subscriptions/detect-candidates is a read in REST.
  'detect_subscription_candidates',
  // POST /user/currencies/change-base has no lock: the enqueue takes its own NX lock. The tool is
  // exempt in that branch only; its first-base branch (POST /user/currencies/base) carries the
  // lock, so it is also in LOCK_EXEMPT_IN_ONE_BRANCH and calls it there.
  'change_base_currency',
  // DELETE /attachments/:id has no lock: attachments touch no amounts.
  'delete_attachment',
  // POST /notifications/read-all and POST /notifications/:id/read have no lock.
  'mark_notifications_read',
  // PUT and PATCH /user/settings have no lock: settings touch no amounts.
  'update_user_settings',
];

// Read-named tools whose REST route carries `checkBaseCurrencyLock`, so REST refuses them with
// 423 during a base-currency change and the tool must too. They call no scope helper.
export const LOCK_GUARDED_READ_TOOLS = [
  // POST /automations/preview
  'preview_transaction_automation',
  // POST /transactions/transfer-recommendations/bulk-scan: a scan that writes nothing
  'list_transfer_suggestions',
];

// The only tools that may pass `allowReadOnly: true` to `requireScope`: each sits on a route in
// `READ_ONLY_ROUTES` (`middlewares/entitlements.ts`), which a read-only user may call. Kept by
// hand so the exemption cannot spread. The tools arrive with their tasks.
export const READ_ONLY_ROUTE_TOOLS = [
  // POST /notifications/read-all and POST /notifications/:id/read
  'mark_notifications_read',
  // PUT and PATCH /user/settings
  'update_user_settings',
  // POST /user/currencies/base, the first base currency only
  'change_base_currency',
];
