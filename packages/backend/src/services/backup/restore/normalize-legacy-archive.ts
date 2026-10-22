import isPlainObject from 'lodash/isPlainObject';

type Row = Record<string, unknown>;

/** Format version whose archives still carry the pre-rename "budget" names for trackers. */
const LEGACY_TRACKER_NAMING_VERSION = 1;
/** Format version whose archives still carry `type: 'category'` trackers instead of rules. */
const LEGACY_TRACKER_TYPE_VERSION = 2;

const LEGACY_FILE_NAMES: Record<string, string> = {
  budgets: 'trackers',
  'budget-transactions': 'tracker-transactions',
  'budget-categories': 'tracker-categories',
};

const TRACKER_CHILD_FILES = ['tracker-lines', 'tracker-transactions', 'tracker-categories', 'tracker-suggestions'];

const LEGACY_NOTIFICATION_TYPES: Record<string, string> = {
  budget_alert: 'tracker_alert',
  share_owner_budget_deleted: 'share_owner_tracker_deleted',
};

const asObject = (value: unknown): Row | null => (isPlainObject(value) ? (value as Row) : null);

function renameKey({ obj, from, to }: { obj: Row; from: string; to: string }): void {
  if (!(from in obj)) return;
  if (!(to in obj)) obj[to] = obj[from];
  delete obj[from];
}

function replaceInArray({ value, from, to }: { value: unknown; from: string; to: string }): void {
  if (!Array.isArray(value)) return;
  for (let i = 0; i < value.length; i++) if (value[i] === from) value[i] = to;
}

function rowsAt({ parsedByPath, name }: { parsedByPath: Map<string, unknown>; name: string }): Row[] {
  const value = parsedByPath.get(`data/${name}.json`);
  return Array.isArray(value) ? (value.map(asObject).filter(Boolean) as Row[]) : [];
}

function normalizeNotification({ row }: { row: Row }): void {
  if (typeof row.type === 'string') row.type = LEGACY_NOTIFICATION_TYPES[row.type] ?? row.type;
  const payload = asObject(row.payload);
  if (!payload) return;
  renameKey({ obj: payload, from: 'budgetId', to: 'trackerId' });
  renameKey({ obj: payload, from: 'budgetName', to: 'trackerName' });
  if (payload.resourceType === 'budget') payload.resourceType = 'tracker';
}

function normalizeSettings({ settings }: { settings: Row }): void {
  const types = asObject(asObject(settings.notifications)?.types);
  if (types) renameKey({ obj: types, from: 'budget_alert', to: 'tracker_alert' });

  if (Array.isArray(settings.savedTransactionViews)) {
    for (const view of settings.savedTransactionViews) {
      const filters = asObject(asObject(view)?.filters);
      if (!filters) continue;
      renameKey({ obj: filters, from: 'budgetIds', to: 'trackerIds' });
      renameKey({ obj: filters, from: 'excludedBudgetIds', to: 'excludedTrackerIds' });
    }
  }

  const transactionsTable = asObject(asObject(settings.ui)?.transactionsTable);
  replaceInArray({ value: transactionsTable?.extraFilters, from: 'budgets', to: 'trackers' });
  replaceInArray({ value: asObject(settings.onboarding)?.completedTasks, from: 'create-budget', to: 'create-tracker' });
}

/**
 * Category trackers were computed live and have no TrackerTransactions rows. They become rules
 * trackers that sync on the next visit or cron run. One with no categories stays rules-off.
 * Every row gets the rule columns: restore writes a key missing from one row as NULL.
 */
function normalizeCategoryTrackers({ parsedByPath }: { parsedByPath: Map<string, unknown> }): void {
  const trackerIdsWithCategories = new Set(
    rowsAt({ parsedByPath, name: 'tracker-categories' }).map((row) => row.trackerId),
  );
  for (const row of rowsAt({ parsedByPath, name: 'trackers' })) {
    const rulesEnabled = row.type === 'category' && trackerIdsWithCategories.has(row.id);
    Object.assign(row, { rulesEnabled, rulesCleanup: true, rulesSyncedAt: null });
    delete row.type;
    delete row.autoInclude;
  }
  if (!parsedByPath.has('data/tracker-tags.json')) parsedByPath.set('data/tracker-tags.json', []);
}

/**
 * Rewrite an older archive's tracker file names, row keys and embedded stored values
 * to the current shapes, in place. Runs after checksum verification (which uses
 * the original paths) and before any file is mapped to a table.
 */
export function normalizeLegacyArchive({
  formatVersion,
  parsedByPath,
}: {
  formatVersion: number;
  parsedByPath: Map<string, unknown>;
}): void {
  if (formatVersion > LEGACY_TRACKER_TYPE_VERSION) return;
  if (formatVersion <= LEGACY_TRACKER_NAMING_VERSION) normalizeTrackerNaming({ parsedByPath });
  normalizeCategoryTrackers({ parsedByPath });
}

function normalizeTrackerNaming({ parsedByPath }: { parsedByPath: Map<string, unknown> }): void {
  for (const [legacyName, name] of Object.entries(LEGACY_FILE_NAMES)) {
    const legacyPath = `data/${legacyName}.json`;
    const path = `data/${name}.json`;
    if (!parsedByPath.has(legacyPath) || parsedByPath.has(path)) continue;
    parsedByPath.set(path, parsedByPath.get(legacyPath));
    parsedByPath.delete(legacyPath);
  }

  for (const name of TRACKER_CHILD_FILES) {
    for (const row of rowsAt({ parsedByPath, name })) renameKey({ obj: row, from: 'budgetId', to: 'trackerId' });
  }

  for (const row of rowsAt({ parsedByPath, name: 'notifications' })) normalizeNotification({ row });

  for (const row of rowsAt({ parsedByPath, name: 'user-settings' })) {
    const settings = asObject(row.settings);
    if (settings) normalizeSettings({ settings });
  }
}
