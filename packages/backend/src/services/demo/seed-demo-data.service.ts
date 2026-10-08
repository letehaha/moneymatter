import type { RecordId } from '@bt/shared/types';
import {
  ACCOUNT_TYPES,
  BUDGET_STATUSES,
  BUDGET_TYPES,
  DEPRECIATION_PRESET,
  LOAN_TYPE,
  SUPPORTED_LOAN_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE, VENTURE_SPV_SUBTYPE } from '@bt/shared/types/venture';
import { getTranslatedCategories } from '@common/const/default-categories';
import { getTranslatedDefaultTags } from '@common/const/default-tags';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import UserSettings, { DEFAULT_SETTINGS, type SettingsSchema } from '@models/user-settings.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import * as accountsService from '@services/accounts.service';
import { adjustAccountBalance } from '@services/accounts/balance-adjustment';
import { createBudget } from '@services/budgets/create-budget';
import * as categoriesService from '@services/categories.service';
import { createLoan } from '@services/loans/create-loan.service';
import * as tagsService from '@services/tags';
import * as userService from '@services/user.service';
import { createVehicle } from '@services/vehicles/create-vehicle.service';
import { createVentureDeal } from '@services/venture/deals/create.service';
import { createVentureEvent } from '@services/venture/events/create.service';
import { createVenturePlatform } from '@services/venture/platforms/create.service';
import { format, subMonths, subYears } from 'date-fns';

import { DEMO_CONFIG, DEMO_TAGS, type DemoAccountConfig, subcategoryMapKey } from './demo-config';

export async function setupCurrencies({ userId }: { userId: number }): Promise<void> {
  for (const currencyCode of DEMO_CONFIG.currencies) {
    const isBase = currencyCode === DEMO_CONFIG.baseCurrency;
    await UsersCurrencies.addCurrency({
      userId,
      currencyCode,
      exchangeRate: isBase ? 1 : (DEMO_CONFIG.exchangeRates[currencyCode] ?? 1),
      isDefaultCurrency: isBase,
      liveRateUpdate: true,
    });
  }
}

export async function createCategories({ userId }: { userId: number }): Promise<Map<string, string>> {
  const locale = 'en';
  const translatedCategories = getTranslatedCategories({ locale });

  // Create default categories
  const defaultCategories = translatedCategories.main.map((item) => ({
    name: item.name,
    type: item.type,
    color: item.color,
    key: item.key,
    userId,
  }));

  // The column allows NULL (user-created custom categories don't have a key), but the
  // seed path always should guard against future drift in `getTranslatedCategories`
  // that would silently produce keyless defaults. Log to Sentry in prod and continue;
  // throw in dev/test so bugs surface loudly during development.
  const mainMissingKey = defaultCategories.find((c) => !c.key);
  if (mainMissingKey) {
    const message = `Seed integrity bug: default category "${mainMissingKey.name}" is missing 'key'`;
    logger.error(message);
    if (process.env.NODE_ENV !== 'production') throw new Error(message);
  }

  const categories = await categoriesService.bulkCreate({ data: defaultCategories }, { returning: true });

  // Build map of category key -> id
  const categoryMap = new Map<string, RecordId>();
  translatedCategories.main.forEach((item, index) => {
    const createdCategory = categories[index];
    if (createdCategory) {
      categoryMap.set(item.key, createdCategory.id);
    }
  });

  // Create subcategories. `parentKey` rides alongside the row, not inside it:
  // it addresses `categoryMap` below and isn't a column.
  const subcats: Array<{
    parentKey: string;
    row: {
      name: string;
      parentId: string;
      color: string;
      userId: number;
      type: string;
      key: string;
    };
  }> = [];

  translatedCategories.subcategories.forEach((subcat) => {
    const parentId = categoryMap.get(subcat.parentKey);
    const parentCategory = translatedCategories.main.find((c) => c.key === subcat.parentKey);

    if (parentId && parentCategory) {
      subcat.values.forEach((subItem) => {
        subcats.push({
          parentKey: subcat.parentKey,
          row: {
            name: subItem.name,
            type: subItem.type,
            parentId,
            color: parentCategory.color,
            userId,
            key: subItem.key,
          },
        });
      });
    }
  });

  const subMissingKey = subcats.find((s) => !s.row.key);
  if (subMissingKey) {
    const message = `Seed integrity bug: default subcategory "${subMissingKey.row.name}" is missing 'key'`;
    logger.error(message);
    if (process.env.NODE_ENV !== 'production') throw new Error(message);
  }

  if (subcats.length > 0) {
    const createdSubcats = await categoriesService.bulkCreate(
      { data: subcats.map((subcat) => subcat.row) },
      { returning: true },
    );

    // Keyed by `parent/child` rather than by display name: the same child key
    // appears under more than one parent, and names are locale-dependent.
    subcats.forEach((subcat, index) => {
      const createdSubcat = createdSubcats[index];
      if (createdSubcat) {
        categoryMap.set(subcategoryMapKey({ parentKey: subcat.parentKey, key: subcat.row.key }), createdSubcat.id);
      }
    });
  }

  // Set default category
  const defaultCategoryKey = translatedCategories.defaultCategoryKey;
  const defaultCategoryId = categoryMap.get(defaultCategoryKey);

  if (defaultCategoryId) {
    await userService.updateUser({
      id: userId,
      defaultCategoryId,
    });
  }

  return categoryMap;
}

/**
 * Seeds the default tags every user gets, plus the demo-only ones, and returns
 * a key -> id map. The template addresses tags by key so the mapping survives
 * the locale-dependent display names.
 */
export async function createTags({ userId }: { userId: number }): Promise<Map<string, string>> {
  const locale = 'en';
  const defaultTags = getTranslatedDefaultTags({ locale });

  const tagsToCreate = [
    ...defaultTags.map((tag) => ({
      key: tag.key,
      name: tag.name,
      color: tag.color,
      icon: tag.icon,
      description: tag.description,
    })),
    ...DEMO_TAGS.map((tag) => ({
      key: tag.key,
      name: tag.name,
      color: tag.color,
      icon: tag.icon,
      description: null,
    })),
  ];

  const created = await tagsService.bulkCreateTags({
    userId,
    tags: tagsToCreate.map(({ key: _key, ...tag }) => tag),
  });

  const tagMap = new Map<string, string>();
  tagsToCreate.forEach((tag, index) => {
    const createdTag = created[index];
    if (createdTag) {
      tagMap.set(tag.key, createdTag.id);
    }
  });

  return tagMap;
}

export async function createAccounts({ userId }: { userId: number }): Promise<Accounts[]> {
  const accounts: Accounts[] = [];

  for (const accountConfig of DEMO_CONFIG.accounts) {
    // Widen away the per-entry literal types so the optional logo keys exist.
    const { logoDomain, logoInitials, logoColor }: DemoAccountConfig = accountConfig;
    const account = await accountsService.createAccount({
      userId,
      name: accountConfig.name,
      currencyCode: accountConfig.currency,
      accountCategory: accountConfig.type,
      initialBalance: Money.fromCents(accountConfig.initialBalance),
      creditLimit: Money.fromCents(accountConfig.creditLimit || 0),
      type: ACCOUNT_TYPES.system,
      logoDomain,
      logoInitials,
      logoColor,
    });
    if (account) {
      accounts.push(account);
    }
  }

  return accounts;
}

/** Rounds a cents amount to the nearest $10 so a derived limit reads as a number a person chose. */
function roundToNearestTenDollars({ cents }: { cents: number }): number {
  const step = 1000;
  return Math.max(step, Math.round(cents / step) * step);
}

/**
 * Seeds category budgets over a trailing window. Skipping `type: category` or
 * `startDate`/`endDate` breaks the read path: `createBudget` then writes no
 * `BudgetCategories` rows (every card reads zero), or `buildDateFilter` drops
 * the filter and totals all history against a one-month limit. Limits derive
 * from actual spend in the window so the cards keep their under/near/over states.
 */
export async function createBudgets({
  userId,
  categoryMap,
  spendByCategoryKey,
  windowStart,
  windowEnd,
}: {
  userId: number;
  categoryMap: Map<string, string>;
  spendByCategoryKey: Map<string, number>;
  windowStart: Date;
  windowEnd: Date;
}): Promise<void> {
  let created = 0;
  let skippedUnknownCategories = 0;
  let skippedNoSpend = 0;

  for (const budgetConfig of DEMO_CONFIG.budgets) {
    const categoryIds = budgetConfig.categoryKeys
      .map((key) => categoryMap.get(key))
      .filter((id): id is string => id !== undefined);

    if (!categoryIds.length) {
      skippedUnknownCategories += 1;
      continue;
    }

    const spent = budgetConfig.categoryKeys.reduce((total, key) => total + (spendByCategoryKey.get(key) ?? 0), 0);
    if (spent <= 0) {
      skippedNoSpend += 1;
      continue;
    }

    await createBudget({
      userId,
      name: budgetConfig.name,
      status: BUDGET_STATUSES.active,
      type: BUDGET_TYPES.category,
      categoryIds,
      limitAmount: Money.fromCents(roundToNearestTenDollars({ cents: spent / budgetConfig.targetUtilization })),
      startDate: windowStart,
      endDate: windowEnd,
    });
    created += 1;
  }

  const summary = `Created ${created} of ${DEMO_CONFIG.budgets.length} demo budgets (skipped: ${skippedUnknownCategories} with no matching category, ${skippedNoSpend} with no spend in the window)`;

  // Zero budgets leaves the Budgets page empty for every demo user; the skip
  // counters above narrow it to a category-key or generator drift.
  if (created === 0 && DEMO_CONFIG.budgets.length > 0) {
    logger.error(summary);
  } else {
    logger.info(summary);
  }
}

const DEMO_WATCHLIST_CATEGORY_KEYS = ['food', 'housing', 'transportation', 'life', 'income'];

export async function setupDashboardSettings({
  userId,
  categoryMap,
}: {
  userId: number;
  categoryMap: Map<string, string>;
}): Promise<void> {
  const selectedCategoryIds = DEMO_WATCHLIST_CATEGORY_KEYS.map((key) => categoryMap.get(key)).filter(
    (id): id is string => id !== undefined,
  );

  const taxCategoryId = categoryMap.get('financial-expenses/taxes');

  const settings: SettingsSchema = {
    ...DEFAULT_SETTINGS,
    ...(taxCategoryId && { taxCategoryIds: [taxCategoryId] }),
    dashboard: {
      widgets: [
        { widgetId: 'balance-trend', colSpan: 2, rowSpan: 1 },
        { widgetId: 'latest-records', colSpan: 1, rowSpan: 1 },
        { widgetId: 'cash-flow', colSpan: 1, rowSpan: 1 },
        { widgetId: 'spending-categories', colSpan: 1, rowSpan: 1 },
        { widgetId: 'fire-progress', colSpan: 1, rowSpan: 1 },
        { widgetId: 'category-spending-tracker', colSpan: 1, rowSpan: 1, config: { selectedCategoryIds } },
        { widgetId: 'credit-utilization', colSpan: 1, rowSpan: 1 },
        { widgetId: 'subscriptions-overview', colSpan: 1, rowSpan: 1 },
        { widgetId: 'taxes', colSpan: 1, rowSpan: 1 },
      ],
    },
  };

  await UserSettings.findOrCreate({
    where: { userId },
    defaults: { settings },
  });

  logger.info(`Configured demo dashboard with spending watchlist (${selectedCategoryIds.length} categories)`);
}

interface DemoVehicleConfig {
  name: string;
  make: string;
  model: string;
  trim: string;
  vehicleClass: VEHICLE_CLASS;
  /** Years before the reference date the vehicle was purchased. */
  ageYears: number;
  purchasePrice: number;
  currentMileage: number;
  /**
   * Optional mid-term manual revaluation, so the demo shows how an override
   * re-anchors the depreciation curve away from the smooth class default.
   */
  override?: {
    /** Months before the reference date the override took effect. */
    monthsAgo: number;
    targetValue: number;
    note: string;
  };
}

const DEMO_VEHICLES: DemoVehicleConfig[] = [
  {
    name: 'BMW X5',
    make: 'BMW',
    model: 'X5',
    trim: 'xDrive40i',
    vehicleClass: VEHICLE_CLASS.luxury,
    ageYears: 5,
    purchasePrice: 72000,
    currentMileage: 58000,
    override: {
      monthsAgo: 30,
      targetValue: 41000,
      note: 'Independent appraisal after major service',
    },
  },
  {
    name: 'Toyota Corolla',
    make: 'Toyota',
    model: 'Corolla',
    trim: 'LE',
    vehicleClass: VEHICLE_CLASS.sedan,
    ageYears: 1,
    purchasePrice: 26500,
    currentMileage: 12000,
  },
];

export async function setupVehicles({ userId, referenceDate }: { userId: number; referenceDate: Date }): Promise<void> {
  for (const config of DEMO_VEHICLES) {
    const vehicle = await createVehicle({
      userId,
      name: config.name,
      currencyCode: DEMO_CONFIG.baseCurrency,
      make: config.make,
      model: config.model,
      trim: config.trim,
      year: referenceDate.getFullYear() - config.ageYears,
      vehicleClass: config.vehicleClass,
      purchasePrice: Money.fromDecimal(config.purchasePrice),
      purchaseDate: format(subYears(referenceDate, config.ageYears), 'yyyy-MM-dd'),
      depreciationPreset: DEPRECIATION_PRESET.classDefault,
      currentMileage: config.currentMileage,
    });

    if (vehicle && config.override) {
      await adjustAccountBalance({
        userId,
        accountId: vehicle.accountId,
        targetBalance: Money.fromDecimal(config.override.targetValue),
        note: config.override.note,
        time: subMonths(referenceDate, config.override.monthsAgo),
      });
    }
  }

  logger.info(`Created ${DEMO_VEHICLES.length} demo vehicles for user ${userId}`);
}

/**
 * Seeds three venture SPV deals so demo users can see every outcome:
 *  - a successful full exit (~3.8x gross), which auto-progresses to
 *    `fully_exited` and splits carry to the GP,
 *  - a total write-off, which auto-progresses to `written_off`, and
 *  - an in-progress holding marked up via `nav_update`, which stays
 *    `outstanding` and carries a live current value (so it doesn't read as $0).
 * Cash flows use `out_of_wallet` so no linked wallet transactions are needed.
 */
export async function setupVentures({ userId, referenceDate }: { userId: number; referenceDate: Date }): Promise<void> {
  const platform = await createVenturePlatform({
    userId,
    name: 'AngelList',
    website: 'https://angellist.com',
    description: 'Syndicate platform for early-stage startup investments',
    defaultEntryFeePct: '0',
    defaultMgmtFeePct: '0.02',
    defaultCarryPct: '0.20',
    defaultHurdlePct: '0',
  });

  // Winner — invested ~4y ago, acquired recently for a ~3.8x gross return.
  const winner = await createVentureDeal({
    userId,
    name: 'Nimbus AI — Series A',
    currencyCode: DEMO_CONFIG.baseCurrency,
    principal: '25000',
    investmentDate: format(subYears(referenceDate, 4), 'yyyy-MM-dd'),
    platformId: platform.id,
    spvSubtype: VENTURE_SPV_SUBTYPE.single_company,
    targetCompany: 'Nimbus AI',
    carryPct: '0.20',
    hurdlePct: '0',
    expectedExitDate: format(subYears(referenceDate, 1), 'yyyy-MM-dd'),
    notes: 'Cloud infrastructure startup — strong growth, acquired by a strategic buyer.',
    initialInvestment: { cashFlowMode: VENTURE_CASH_FLOW_MODE.out_of_wallet },
  });

  await createVentureEvent({
    userId,
    dealId: winner.id,
    type: VENTURE_EVENT_TYPE.exit,
    eventDate: format(subMonths(referenceDate, 2), 'yyyy-MM-dd'),
    grossAmount: '95000',
    navAfter: '0',
    quantityPct: '1',
    cashFlowMode: VENTURE_CASH_FLOW_MODE.out_of_wallet,
    notes: 'Full exit via acquisition.',
  });

  // Loser — invested ~3y ago, company shut down and the position was written off.
  const loser = await createVentureDeal({
    userId,
    name: 'QuickBite — Seed',
    currencyCode: DEMO_CONFIG.baseCurrency,
    principal: '15000',
    investmentDate: format(subYears(referenceDate, 3), 'yyyy-MM-dd'),
    platformId: platform.id,
    spvSubtype: VENTURE_SPV_SUBTYPE.single_company,
    targetCompany: 'QuickBite',
    carryPct: '0.20',
    hurdlePct: '0',
    notes: 'Food delivery startup — ran out of runway and shut down.',
    initialInvestment: { cashFlowMode: VENTURE_CASH_FLOW_MODE.out_of_wallet },
  });

  await createVentureEvent({
    userId,
    dealId: loser.id,
    type: VENTURE_EVENT_TYPE.writedown,
    eventDate: format(subMonths(referenceDate, 6), 'yyyy-MM-dd'),
    navAfter: '0',
    cashFlowMode: VENTURE_CASH_FLOW_MODE.none,
    notes: 'Company ceased operations; position written off.',
  });

  // In progress — invested ~2y ago, marked up at the last round and still held,
  // so it shows a live (non-zero) current value while staying `outstanding`.
  const inProgress = await createVentureDeal({
    userId,
    name: 'Helios Robotics — Series B',
    currencyCode: DEMO_CONFIG.baseCurrency,
    principal: '30000',
    investmentDate: format(subYears(referenceDate, 2), 'yyyy-MM-dd'),
    platformId: platform.id,
    spvSubtype: VENTURE_SPV_SUBTYPE.single_company,
    targetCompany: 'Helios Robotics',
    carryPct: '0.20',
    hurdlePct: '0',
    notes: 'Industrial robotics startup — growing fast, still privately held.',
    initialInvestment: { cashFlowMode: VENTURE_CASH_FLOW_MODE.out_of_wallet },
  });

  await createVentureEvent({
    userId,
    dealId: inProgress.id,
    type: VENTURE_EVENT_TYPE.nav_update,
    eventDate: format(subMonths(referenceDate, 1), 'yyyy-MM-dd'),
    navAfter: '48000',
    cashFlowMode: VENTURE_CASH_FLOW_MODE.none,
    notes: 'Series B markup — valuation stepped up on strong revenue growth.',
  });

  logger.info(`Created 3 demo venture deals for user ${userId}`);
}

interface DemoLoanConfig {
  name: string;
  loanType: (typeof SUPPORTED_LOAN_TYPES)[number];
  /** Amount borrowed at origination. */
  originalPrincipal: number;
  /** Outstanding balance as-of the reference date (progress already paid down). */
  outstanding: number;
  interestRate: number;
  termMonths: number;
  /** Months before the reference date the loan originated. */
  startMonthsAgo: number;
  plannedPayment: number;
  paymentDayOfMonth: number;
  lenderName: string;
}

// Deliberately small consumer loans (≤ $25k) so the demo net worth stays
// realistic and each loan type the picker exposes is represented once.
const DEMO_LOANS: DemoLoanConfig[] = [
  {
    name: 'Car Loan',
    loanType: LOAN_TYPE.auto,
    originalPrincipal: 22000,
    outstanding: 15400,
    interestRate: 6.9,
    termMonths: 60,
    startMonthsAgo: 18,
    plannedPayment: 434,
    paymentDayOfMonth: 15,
    lenderName: 'Chase Auto Finance',
  },
  {
    name: 'Student Loan',
    loanType: LOAN_TYPE.student,
    originalPrincipal: 18000,
    outstanding: 15750,
    interestRate: 4.5,
    termMonths: 120,
    startMonthsAgo: 24,
    plannedPayment: 187,
    paymentDayOfMonth: 1,
    lenderName: 'SoFi',
  },
  {
    name: 'Personal Loan',
    loanType: LOAN_TYPE.personal,
    originalPrincipal: 12000,
    outstanding: 7200,
    interestRate: 9.9,
    termMonths: 36,
    startMonthsAgo: 15,
    plannedPayment: 387,
    paymentDayOfMonth: 10,
    lenderName: 'Marcus by Goldman Sachs',
  },
];

export async function setupLoans({ userId, referenceDate }: { userId: number; referenceDate: Date }): Promise<void> {
  for (const config of DEMO_LOANS) {
    await createLoan({
      userId,
      name: config.name,
      currencyCode: DEMO_CONFIG.baseCurrency,
      loanType: config.loanType,
      originalPrincipal: Money.fromDecimal(config.originalPrincipal),
      initialBalance: Money.fromDecimal(config.outstanding),
      interestRate: config.interestRate,
      termMonths: config.termMonths,
      startDate: format(subMonths(referenceDate, config.startMonthsAgo), 'yyyy-MM-dd'),
      plannedPayment: Money.fromDecimal(config.plannedPayment),
      paymentDayOfMonth: config.paymentDayOfMonth,
      lenderName: config.lenderName,
    });
  }

  logger.info(`Created ${DEMO_LOANS.length} demo loans for user ${userId}`);
}
