import { type APIRequestContext, type Locator, type Page, expect, test } from '@playwright/test';

import { addUserCurrencies, completeOnboarding } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import {
  ACCOUNT_CATEGORY,
  archiveAccount,
  createAccountOfCategory,
  createGoal,
  deleteAccount,
  seedMonthlyDeposits,
  setCustomRate,
  updateGoal,
} from '../../helpers/goals';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const GOAL_CURRENCY = 'EUR';
const EUR_TO_USD = 1.25;
const FULL = 100;
const DAYS_PER_MONTH = 30.44;
const PACE_WINDOW_MONTHS = 6;
const DAY_MS = 86_400_000;

type Category = (typeof ACCOUNT_CATEGORY)[keyof typeof ACCOUNT_CATEGORY];
type SeedAccount = {
  name: string;
  category: Category;
  initialBalance: number;
  creditLimit?: number;
  deposits?: number[];
};

// ─── Plan "Compute path" oracle ─────────────────────────────────────

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const balanceOf = ({ account }: { account: SeedAccount }) => account.initialBalance + sum(account.deposits ?? []);
const counted = ({ account, share }: { account: SeedAccount; share: number }) =>
  (share / FULL) * Math.max(0, balanceOf({ account }) - (account.creditLimit ?? 0));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const paceOf = ({ deposits }: { deposits: number[] }) => median(deposits.slice(-PACE_WINDOW_MONTHS));
const etaMonths = ({ left, pace }: { left: number; pace: number }) => Math.ceil(left / pace);
const aboutMonths = ({ months }: { months: number }) => `(${months - 1}|${months}|${months + 1})`;
const percentOf = ({ part, whole }: { part: number; whole: number }) => Math.round((part / whole) * FULL);

const NOW = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = ({ date }: { date: Date }) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const lastDayOfMonthIn = ({ months }: { months: number }) =>
  new Date(NOW.getFullYear(), NOW.getMonth() + months + 1, 0);
const daysFromToday = ({ date }: { date: Date }) =>
  Math.round(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(NOW.getFullYear(), NOW.getMonth(), NOW.getDate())) /
      DAY_MS,
  );
const monthLabel = ({ monthsFromNow }: { monthsFromNow: number }) =>
  new Date(NOW.getFullYear(), NOW.getMonth() + monthsFromNow, 1).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
  });

// Plan D13: whole units below 10k; k with ≤ 2 decimals to 100k; k with none to 1M; M with ≤ 2 decimals.
const trimmed = ({ value, digits }: { value: number; digits: number }) => String(Number(value.toFixed(digits)));
const money = ({ amount, symbol = '$' }: { amount: number; symbol?: string }) => {
  const abs = Math.abs(amount);
  if (abs < 10_000) return `${symbol}${Math.round(abs).toLocaleString('en-US')}`;
  if (abs < 100_000) return `${symbol}${trimmed({ value: abs / 1e3, digits: 2 })}k`;
  if (Math.round(abs / 1e3) < 1_000) return `${symbol}${Math.round(abs / 1e3)}k`;
  return `${symbol}${trimmed({ value: abs / 1e6, digits: 2 })}M`;
};
const euro = ({ amount }: { amount: number }) => money({ amount, symbol: '€' });

// ─── Seed data ──────────────────────────────────────────────────────

// Months 9..1 ago. 6 and 5 deltas give median 1000 (≠ mean 1233); 8+ deltas give 1100+,
// so a pace window wider than 6 months fails.
const CAR_SAVINGS: SeedAccount = {
  name: 'Car savings',
  category: ACCOUNT_CATEGORY.saving,
  initialBalance: 20_000,
  deposits: [2_000, 2_000, 2_000, 400, 800, 1_000, 1_200, 3_000, 1_000],
};
// One deposit 9 months ago only: history as old as Car savings, flat inside the pace window.
const JOINT_CURRENT: SeedAccount = {
  name: 'Joint current',
  category: ACCOUNT_CATEGORY.currentAccount,
  initialBalance: 4_000,
  creditLimit: 1_000,
  deposits: [1_000, 0, 0, 0, 0, 0, 0, 0, 0],
};
const OVERDRAWN_CURRENT: SeedAccount = {
  name: 'Overdrawn current',
  category: ACCOUNT_CATEGORY.currentAccount,
  initialBalance: 1_000,
  creditLimit: 2_000,
  deposits: [500, 0, 0, 0, 0, 0, 0, 0, 0],
};
const BIKE_GENERAL: SeedAccount = {
  name: 'Spending general',
  category: ACCOUNT_CATEGORY.general,
  initialBalance: 10_000,
  deposits: Array.from({ length: 9 }, () => -200),
};
const LAPTOP_CASH: SeedAccount = {
  name: 'Laptop cash',
  category: ACCOUNT_CATEGORY.cash,
  initialBalance: 2_000,
  deposits: [500],
};
const TAX_CASH: SeedAccount = {
  name: 'Tax cash',
  category: ACCOUNT_CATEGORY.cash,
  initialBalance: 900,
  deposits: [100, 0, 0, 0, 0, 0, 0, 0, 0],
};
const CUSHION_SAVINGS: SeedAccount = {
  name: 'Cushion savings',
  category: ACCOUNT_CATEGORY.saving,
  initialBalance: 50_400,
};
const EURO_SAVINGS: SeedAccount = { name: 'Euro savings', category: ACCOUNT_CATEGORY.saving, initialBalance: 5_000 };
const BROKERAGE: SeedAccount = { name: 'Brokerage', category: ACCOUNT_CATEGORY.investment, initialBalance: 2_000 };
const HOUSE_SAVINGS: SeedAccount = {
  name: 'House savings',
  category: ACCOUNT_CATEGORY.saving,
  initialBalance: 385_400,
};

const ACCOUNTS = [
  CAR_SAVINGS,
  JOINT_CURRENT,
  OVERDRAWN_CURRENT,
  BIKE_GENERAL,
  LAPTOP_CASH,
  TAX_CASH,
  CUSHION_SAVINGS,
  EURO_SAVINGS,
  BROKERAGE,
  HOUSE_SAVINGS,
];

const CAR_DATE = lastDayOfMonthIn({ months: 20 });
const CAR = {
  name: 'Car',
  target: 60_000,
  shares: [
    { account: CAR_SAVINGS, share: FULL },
    { account: JOINT_CURRENT, share: 25 },
    { account: OVERDRAWN_CURRENT, share: FULL },
  ],
};
const CAR_SAVED = sum(CAR.shares.map(counted));
const CAR_LEFT = CAR.target - CAR_SAVED;
const CAR_PACE = paceOf({ deposits: CAR_SAVINGS.deposits! });
const CAR_ETA = etaMonths({ left: CAR_LEFT, pace: CAR_PACE });
const CAR_NEEDED = CAR_LEFT / (daysFromToday({ date: CAR_DATE }) / DAYS_PER_MONTH);
const CAR_MONTHS_LATE = CAR_ETA - 20;
const CAR_BEST_MONTH = Math.max(...CAR_SAVINGS.deposits!);
const CAR_BEST_MONTH_AGO = CAR_SAVINGS.deposits!.length - CAR_SAVINGS.deposits!.indexOf(CAR_BEST_MONTH);
const CAR_PLANNED_AHEAD = 2_000;
const CAR_PLANNED_ON_TIME = 1_300;

const RAINY = { name: 'Rainy day', target: 5_000, shares: [{ account: JOINT_CURRENT, share: 50 }] };
const RAINY_SAVED = sum(RAINY.shares.map(counted));

const BIKE_DATE = lastDayOfMonthIn({ months: 12 });
const BIKE = { name: 'Bike', target: 12_000, shares: [{ account: BIKE_GENERAL, share: FULL }] };
const BIKE_PACE = paceOf({ deposits: BIKE_GENERAL.deposits! });
const BIKE_SAVED = sum(BIKE.shares.map(counted));
const BIKE_LEFT = BIKE.target - BIKE_SAVED;
const BIKE_NEEDED = BIKE_LEFT / (daysFromToday({ date: BIKE_DATE }) / DAYS_PER_MONTH);

const LAPTOP = { name: 'Laptop', target: 9_400, shares: [{ account: LAPTOP_CASH, share: FULL }] };
const LAPTOP_SAVED = sum(LAPTOP.shares.map(counted));
const LAPTOP_PLANNED = 1_000;
const LAPTOP_ETA = etaMonths({ left: LAPTOP.target - LAPTOP_SAVED, pace: LAPTOP_PLANNED });

const TAX_DATE = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 10);
const TAX = { name: 'Tax bill', target: 5_000, shares: [{ account: TAX_CASH, share: FULL }] };
const TAX_LEFT = TAX.target - sum(TAX.shares.map(counted));

const CUSHION = { name: 'Cushion', target: 50_000, shares: [{ account: CUSHION_SAVINGS, share: FULL }] };
const CUSHION_SAVED = sum(CUSHION.shares.map(counted));

const LISBON = {
  name: 'Lisbon',
  target: 10_000,
  shares: [
    { account: EURO_SAVINGS, share: FULL },
    { account: BROKERAGE, share: 50 },
  ],
};
const toEur = (usd: number) => usd / EUR_TO_USD;
const LISBON_SAVED = toEur(sum(LISBON.shares.map(counted)));

const HOUSE = { name: 'House', target: 1_240_000, shares: [{ account: HOUSE_SAVINGS, share: FULL }] };
const HOUSE_SAVED = sum(HOUSE.shares.map(counted));

const creds = buildTestCredentials({ prefix: 'goals-prog' });
const accountIds = new Map<SeedAccount, string>();
const goalIds = new Map<string, string>();
let dataSeeded = false;

async function seed({ request }: { request: APIRequestContext }) {
  await completeOnboarding({ request, currencyCode: CURRENCY });
  await addUserCurrencies({ request, currencyCode: GOAL_CURRENCY });
  await setCustomRate({ request, currencyCode: GOAL_CURRENCY, baseCurrencyCode: CURRENCY, rate: EUR_TO_USD });

  for (const account of ACCOUNTS) {
    const accountId = await createAccountOfCategory({
      request,
      name: account.name,
      currencyCode: CURRENCY,
      initialBalance: account.initialBalance,
      category: account.category,
      creditLimit: account.creditLimit ?? 0,
    });
    accountIds.set(account, accountId);
    if (account.deposits) await seedMonthlyDeposits({ request, accountId, amountsOldestFirst: account.deposits });
  }

  const goals = [
    { ...CAR, targetDate: isoDate({ date: CAR_DATE }) },
    RAINY,
    { ...BIKE, targetDate: isoDate({ date: BIKE_DATE }) },
    LAPTOP,
    { ...TAX, targetDate: isoDate({ date: TAX_DATE }) },
    CUSHION,
    { ...LISBON, currencyCode: GOAL_CURRENCY },
    HOUSE,
  ];
  for (const goal of goals) {
    const created = await createGoal({
      request,
      name: goal.name,
      targetAmount: goal.target,
      currencyCode: 'currencyCode' in goal ? goal.currencyCode : CURRENCY,
      targetDate: 'targetDate' in goal ? goal.targetDate : null,
      accounts: goal.shares.map(({ account, share }) => ({ accountId: accountIds.get(account)!, sharePercent: share })),
    });
    goalIds.set(goal.name, created.id);
  }
}

// ─── UI readers ─────────────────────────────────────────────────────

const main = ({ page }: { page: Page }) => page.locator('main');

const goalRow = ({ page, name }: { page: Page; name: string }) =>
  main({ page }).getByRole('link', { name, exact: true }).locator('xpath=../..');

const sectionHeader = ({ page, label }: { page: Page; label: string }) =>
  main({ page })
    .locator('div')
    .filter({ hasText: new RegExp(`^\\s*${label}\\s*·\\s*\\d+\\s*$`) });

async function precedes({ page, first, second }: { page: Page; first: Locator; second: Locator }) {
  const [a, b] = await Promise.all([first.elementHandle(), second.elementHandle()]);
  return page.evaluate(([x, y]) => Boolean(x!.compareDocumentPosition(y!) & Node.DOCUMENT_POSITION_FOLLOWING), [
    a,
    b,
  ] as const);
}

async function openGoalsPage({ page }: { page: Page }) {
  await page.goto('/goals');
  await expect(page.getByRole('heading', { level: 1, name: 'Goals' })).toBeVisible({ timeout: 15_000 });
}

async function openGoal({ page, name }: { page: Page; name: string }) {
  await page.goto(`/goals/${goalIds.get(name)}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 15_000 });
}

const stripCell = ({ page, label }: { page: Page; label: string }) =>
  main({ page }).getByText(label, { exact: true }).first().locator('..');
const stripValue = ({ page, label }: { page: Page; label: string }) =>
  stripCell({ page, label }).locator('span').first();

const kpiCell = ({ page, label }: { page: Page; label: string | RegExp }) =>
  main({ page })
    .getByText(label, { exact: typeof label === 'string' })
    .first()
    .locator('..');
const kpiValue = ({ page, label }: { page: Page; label: string | RegExp }) =>
  kpiCell({ page, label }).locator(':scope > div').nth(1).locator(':scope > div').first();

async function openTab({ page, name }: { page: Page; name: 'Progress' | 'Accounts' }) {
  await main({ page })
    .getByRole('button', { name: new RegExp(`^${name}(\\s*\\d+)?$`) })
    .and(page.locator('[aria-pressed]'))
    .click();
}

const accountRow = ({ page, name }: { page: Page; name: string }) =>
  main({ page })
    .getByText(name, { exact: true })
    .last()
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " grid ")][1]');

const parseAmount = (text: string | null) => Number((text ?? '').replace(/[^\d.]/g, ''));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

test.describe('Goals progress numbers', () => {
  test.use({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    if (!dataSeeded) {
      await seed({ request: page.request });
      dataSeeded = true;
    }
  });

  test('saved, pace, ETA, needs and statuses follow the compute rules', async ({ page }) => {
    test.setTimeout(300_000);

    await test.step('list rows: saved, target, percent, status, sections (docs overview, plan D13)', async () => {
      await openGoalsPage({ page });

      const car = goalRow({ page, name: CAR.name });
      await expect(car).toContainText(`${percentOf({ part: CAR_SAVED, whole: CAR.target })}%`);
      await expect(car).toContainText(money({ amount: CAR_SAVED }));
      await expect(car).toContainText(`of ${money({ amount: CAR.target })}`);
      await expect(car).toContainText(new RegExp(`Behind · ${aboutMonths({ months: CAR_MONTHS_LATE })} mo`));

      const rainy = goalRow({ page, name: RAINY.name });
      await expect(rainy).toContainText(money({ amount: RAINY_SAVED }));
      await expect(rainy).toContainText('No date');

      await expect(goalRow({ page, name: BIKE.name })).toContainText('Behind');
      await expect(goalRow({ page, name: LAPTOP.name })).toContainText('No date');
      await expect(goalRow({ page, name: LAPTOP.name })).toContainText(`of ${money({ amount: LAPTOP.target })}`);
      await expect(goalRow({ page, name: TAX.name })).toContainText('Overdue');
      await expect(goalRow({ page, name: LISBON.name })).toContainText(euro({ amount: LISBON_SAVED }));
      await expect(goalRow({ page, name: LISBON.name })).toContainText(`of ${euro({ amount: LISBON.target })}`);

      const ended = sectionHeader({ page, label: 'Ended' });
      const active = sectionHeader({ page, label: 'Active' });
      await expect(ended).toBeVisible();
      await expect(active).toBeVisible();
      expect(await precedes({ page, first: active, second: car })).toBe(true);
      expect(await precedes({ page, first: car, second: ended })).toBe(true);
      expect(await precedes({ page, first: ended, second: goalRow({ page, name: CUSHION.name }) })).toBe(true);
      expect(await precedes({ page, first: ended, second: goalRow({ page, name: LAPTOP.name }) })).toBe(false);
    });

    await test.step('big amounts use the compact format on read-only amounts (plan D13)', async () => {
      const cushion = goalRow({ page, name: CUSHION.name });
      await expect(cushion).toContainText('$50.4k');
      await expect(cushion).toContainText('of $50k');
      await expect(cushion).toContainText(/· reached \d{1,2} \w{3} \d{4}/);

      const house = goalRow({ page, name: HOUSE.name });
      await expect(house).toContainText('$385k');
      await expect(house).toContainText('of $1.24M');

      await openGoal({ page, name: HOUSE.name });
      await expect(stripCell({ page, label: 'Target' })).toContainText('$1.24M');
      await expect(stripCell({ page, label: 'Saved' })).toContainText(money({ amount: HOUSE_SAVED }));
      await expect(stripCell({ page, label: 'Saved' })).toContainText(
        `${percentOf({ part: HOUSE_SAVED, whole: HOUSE.target })}%`,
      );
      await expect(stripCell({ page, label: 'Left' })).toContainText(money({ amount: HOUSE.target - HOUSE_SAVED }));
    });

    await test.step('Car strip: Σ share × max(0, balance − limit), Left, Needs, Pace, ETA, Behind (plan Compute path)', async () => {
      await openGoal({ page, name: CAR.name });

      await expect(stripCell({ page, label: 'Target' })).toContainText('$60k');
      await expect(stripCell({ page, label: 'Target' })).toContainText(monthLabel({ monthsFromNow: 20 }));
      await expect(stripCell({ page, label: 'Saved' })).toContainText(money({ amount: CAR_SAVED }));
      await expect(stripCell({ page, label: 'Saved' })).toContainText(
        `${percentOf({ part: CAR_SAVED, whole: CAR.target })}%`,
      );
      await expect(stripCell({ page, label: 'Left' })).toContainText(money({ amount: CAR_LEFT }));

      await expect(stripValue({ page, label: 'Needs' })).toContainText('$');
      const needed = parseAmount(await stripValue({ page, label: 'Needs' }).textContent());
      expect(Math.abs(needed - CAR_NEEDED) / CAR_NEEDED).toBeLessThan(0.01);

      await expect(stripValue({ page, label: 'Pace' })).toHaveText(money({ amount: CAR_PACE }));
      await expect(stripCell({ page, label: 'Pace' })).toContainText(
        `around ${monthLabel({ monthsFromNow: CAR_ETA })}`,
      );

      const behind = main({ page })
        .getByText(/^\s*Behind · \d+ mo\s*$/)
        .first();
      await expect(behind).toBeVisible();
      const monthsLate = Number((await behind.textContent())!.match(/(\d+) mo/)![1]);
      expect(Math.abs(monthsLate - CAR_MONTHS_LATE)).toBeLessThanOrEqual(1);
    });

    await test.step('positive pace below the monthly need is warning-coloured (owner decision)', async () => {
      expect(CAR_PACE).toBeLessThan(CAR_NEEDED);
      await expect(stripValue({ page, label: 'Pace' })).toHaveClass(/warning/);
      await openTab({ page, name: 'Progress' });
      await expect(kpiValue({ page, label: 'Monthly pace' })).toHaveClass(/warning/);
    });

    await test.step('Progress tab: median pace, projected finish, best month, pace basis note (docs how-progress)', async () => {
      await expect(kpiCell({ page, label: 'Monthly pace' })).toContainText(money({ amount: CAR_PACE }));
      await expect(kpiCell({ page, label: 'Projected finish' })).toContainText(monthLabel({ monthsFromNow: CAR_ETA }));
      await expect(kpiCell({ page, label: 'Projected finish' })).toContainText(
        new RegExp(`\\b${aboutMonths({ months: CAR_MONTHS_LATE })} mo late`),
      );
      await expect(kpiCell({ page, label: 'Best month' })).toContainText(money({ amount: CAR_BEST_MONTH }));
      await expect(kpiCell({ page, label: 'Best month' })).toContainText(
        monthLabel({ monthsFromNow: -CAR_BEST_MONTH_AGO }),
      );
      await expect(main({ page })).toContainText(
        `Pace is the median monthly change over the last ${PACE_WINDOW_MONTHS} months.`,
      );
    });

    await test.step('Accounts tab: share, balance, counted, % of saved; rows add up to Saved (docs overview)', async () => {
      await openTab({ page, name: 'Accounts' });

      const savings = accountRow({ page, name: CAR_SAVINGS.name });
      const savingsCounted = counted({ account: CAR_SAVINGS, share: FULL });
      await expect(savings).toContainText('100%');
      await expect(savings).toContainText(money({ amount: balanceOf({ account: CAR_SAVINGS }) }));
      await expect(savings).toContainText(`${percentOf({ part: savingsCounted, whole: CAR_SAVED })}% of saved`);

      const joint = accountRow({ page, name: JOINT_CURRENT.name });
      const jointCounted = counted({ account: JOINT_CURRENT, share: 25 });
      await expect(joint).toContainText('25%');
      await expect(joint).toContainText(money({ amount: balanceOf({ account: JOINT_CURRENT }) }));
      await expect(joint).toContainText(money({ amount: jointCounted }));
      await expect(joint).toContainText(`${percentOf({ part: jointCounted, whole: CAR_SAVED })}% of saved`);

      const overdrawn = accountRow({ page, name: OVERDRAWN_CURRENT.name });
      expect(counted({ account: OVERDRAWN_CURRENT, share: FULL })).toBe(0);
      await expect(overdrawn).toContainText('100%');
      await expect(overdrawn).toContainText(money({ amount: balanceOf({ account: OVERDRAWN_CURRENT }) }));
      await expect(overdrawn).toContainText('$0');

      const total = main({ page }).getByText(`Total · ${CAR.shares.length} accounts`).locator('..');
      await expect(total).toContainText(money({ amount: CAR_SAVED }));
      await expect(total).toContainText(
        money({ amount: sum(CAR.shares.map(({ account }) => balanceOf({ account }))) }),
      );
    });

    await test.step('plannedMonthly overrides pace: Ahead, then On track (plan Compute path, docs statuses)', async () => {
      await updateGoal({ request: page.request, goalId: goalIds.get(CAR.name)!, plannedMonthly: CAR_PLANNED_AHEAD });
      await openGoal({ page, name: CAR.name });
      const aheadEta = etaMonths({ left: CAR_LEFT, pace: CAR_PLANNED_AHEAD });
      await expect(main({ page }).getByText('Ahead', { exact: true })).toBeVisible();
      await expect(stripValue({ page, label: 'Pace' })).toHaveText(money({ amount: CAR_PLANNED_AHEAD }));
      await expect(stripCell({ page, label: 'Pace' })).toContainText(
        `around ${monthLabel({ monthsFromNow: aheadEta })}`,
      );
      await expect(stripValue({ page, label: 'Pace' })).not.toHaveClass(/warning|destructive/);
      await expect(kpiCell({ page, label: 'Projected finish' })).toContainText(
        new RegExp(`\\b${aboutMonths({ months: 20 - aheadEta })} mo early`),
      );
      await expect(main({ page })).toContainText(
        `Pace uses your planned ${money({ amount: CAR_PLANNED_AHEAD })} a month.`,
      );

      await updateGoal({ request: page.request, goalId: goalIds.get(CAR.name)!, plannedMonthly: CAR_PLANNED_ON_TIME });
      await page.reload();
      const onTimeEta = etaMonths({ left: CAR_LEFT, pace: CAR_PLANNED_ON_TIME });
      expect(onTimeEta).toBe(20);
      await expect(main({ page }).getByText('On track', { exact: true })).toBeVisible();
      await expect(kpiCell({ page, label: 'Projected finish' })).toContainText(
        monthLabel({ monthsFromNow: onTimeEta }),
      );
      await expect(kpiCell({ page, label: 'Projected finish' })).toContainText('on time');

      await updateGoal({ request: page.request, goalId: goalIds.get(CAR.name)!, plannedMonthly: null });
    });

    await test.step('negative pace and negative "Saved in N mo" are red (owner decision)', async () => {
      await openGoal({ page, name: BIKE.name });
      expect(BIKE_PACE).toBeLessThan(0);
      await expect(
        main({ page })
          .getByText(/^\s*Behind/)
          .first(),
      ).toBeVisible();
      await expect(stripCell({ page, label: 'Saved' })).toContainText(money({ amount: BIKE_SAVED }));
      await expect(stripCell({ page, label: 'Left' })).toContainText(money({ amount: BIKE_LEFT }));
      await expect(stripValue({ page, label: 'Needs' })).toContainText('$');
      const bikeNeeded = parseAmount(await stripValue({ page, label: 'Needs' }).textContent());
      expect(Math.abs(bikeNeeded - BIKE_NEEDED) / BIKE_NEEDED).toBeLessThan(0.01);
      await expect(stripValue({ page, label: 'Pace' })).toContainText(money({ amount: BIKE_PACE }));
      await expect(stripValue({ page, label: 'Pace' })).toContainText(/[−-]/);
      await expect(stripValue({ page, label: 'Pace' })).toHaveClass(/destructive/);
      await openTab({ page, name: 'Progress' });
      await expect(kpiValue({ page, label: 'Monthly pace' })).toHaveClass(/destructive/);
      await expect(kpiValue({ page, label: /^Saved in \d+ mo$/ })).toContainText(/[−-]/);
      await expect(kpiValue({ page, label: /^Saved in \d+ mo$/ })).toHaveClass(/destructive/);
      await expect(kpiCell({ page, label: 'Projected finish' })).toContainText('—');
    });

    await test.step('undated goal with zero pace shows No date (docs statuses)', async () => {
      await openGoal({ page, name: RAINY.name });
      await expect(main({ page }).getByText('No date', { exact: true })).toBeVisible();
      await expect(stripCell({ page, label: 'Saved' })).toContainText(money({ amount: RAINY_SAVED }));
      await expect(stripCell({ page, label: 'Left' })).toContainText(money({ amount: RAINY.target - RAINY_SAVED }));
      await expect(stripCell({ page, label: 'Needs' })).toContainText('no date');
      await expect(main({ page }).getByText(/^\s*Behind/)).toHaveCount(0);
    });

    await test.step('past date shows Overdue and Needs is the whole remainder (docs how-progress)', async () => {
      await openGoal({ page, name: TAX.name });
      await expect(main({ page }).getByText('Overdue', { exact: true })).toBeVisible();
      await expect(stripValue({ page, label: 'Needs' })).toHaveText(money({ amount: TAX_LEFT }));
    });

    await test.step('< 3 months of history: No date undated, Not enough history dated, then plannedMonthly gives an ETA (docs statuses)', async () => {
      const laptopId = goalIds.get(LAPTOP.name)!;
      await openGoal({ page, name: LAPTOP.name });
      await expect(main({ page }).getByText('No date', { exact: true }).first()).toBeVisible();
      await expect(stripCell({ page, label: 'Target' })).toContainText(money({ amount: LAPTOP.target }));
      await expect(stripCell({ page, label: 'Saved' })).toContainText(money({ amount: LAPTOP_SAVED }));
      await expect(stripCell({ page, label: 'Pace' })).toContainText('not enough history');
      await openTab({ page, name: 'Progress' });
      await expect(main({ page })).toContainText('Not enough history for a pace yet');

      await updateGoal({
        request: page.request,
        goalId: laptopId,
        targetDate: isoDate({ date: lastDayOfMonthIn({ months: 12 }) }),
      });
      await page.reload();
      await expect(main({ page }).getByText('Not enough history', { exact: true }).first()).toBeVisible();

      await updateGoal({ request: page.request, goalId: laptopId, targetDate: null, plannedMonthly: LAPTOP_PLANNED });
      await page.reload();
      const around = `around ${monthLabel({ monthsFromNow: LAPTOP_ETA })}`;
      await expect(main({ page }).getByText(around, { exact: true })).toBeVisible();
      await expect(stripValue({ page, label: 'Pace' })).toHaveText(money({ amount: LAPTOP_PLANNED }));
      await expect(stripCell({ page, label: 'Pace' })).toContainText(around);
      await expect(main({ page }).getByText('Not enough history', { exact: true })).toHaveCount(0);
    });

    await test.step('reached goal: Reached state, amount above target (docs overview)', async () => {
      await openGoal({ page, name: CUSHION.name });
      await expect(main({ page }).getByText('Reached', { exact: true }).first()).toBeVisible();
      await expect(stripCell({ page, label: 'Saved' })).toContainText(money({ amount: CUSHION_SAVED }));
      await expect(stripCell({ page, label: 'Saved' })).toContainText(
        `${money({ amount: CUSHION_SAVED - CUSHION.target })} above target`,
      );
      // Design Detail-D-Reached: the strip swaps Left/Needs/Pace for a "Reached <date>" cell.
      await expect(main({ page })).toContainText(/Reached\s*\d{1,2} [A-Z][a-z]{2} \d{4}/);
      await expect(main({ page }).getByText('Left', { exact: true })).toHaveCount(0);
      await expect(main({ page }).getByRole('button', { name: 'Raise target' })).toBeVisible();
    });

    await test.step('non-base goal currency shows amounts in EUR; investment note appears (plan D5, D4/slice 10)', async () => {
      await openGoal({ page, name: LISBON.name });
      await expect(stripCell({ page, label: 'Target' })).toContainText(euro({ amount: LISBON.target }));
      await expect(stripCell({ page, label: 'Saved' })).toContainText(euro({ amount: LISBON_SAVED }));
      await expect(stripCell({ page, label: 'Saved' })).toContainText(
        `${percentOf({ part: LISBON_SAVED, whole: LISBON.target })}%`,
      );
      await expect(stripCell({ page, label: 'Left' })).toContainText(euro({ amount: LISBON.target - LISBON_SAVED }));

      await openTab({ page, name: 'Progress' });
      await expect(main({ page })).toContainText(/market moves/i);
      await expect(main({ page })).toContainText(/assume no growth/i);

      await openTab({ page, name: 'Accounts' });
      const euroCounted = toEur(counted({ account: EURO_SAVINGS, share: FULL }));
      const euroRow = accountRow({ page, name: EURO_SAVINGS.name });
      await expect(euroRow).toContainText(euro({ amount: euroCounted }));
      await expect(euroRow).toContainText(`${percentOf({ part: euroCounted, whole: LISBON_SAVED })}% of saved`);
      const brokerageCounted = toEur(counted({ account: BROKERAGE, share: 50 }));
      const brokerage = accountRow({ page, name: BROKERAGE.name });
      await expect(brokerage).toContainText('50%');
      await expect(brokerage).toContainText(euro({ amount: brokerageCounted }));
      await expect(brokerage).toContainText(`${percentOf({ part: brokerageCounted, whole: LISBON_SAVED })}% of saved`);
    });
  });

  test('archived linked account still counts; deleting the only account leaves no accounts', async ({ page }) => {
    test.setTimeout(120_000);

    await test.step('archived account keeps counting and is marked Archived (plan Lifecycle edges)', async () => {
      await archiveAccount({ request: page.request, accountId: accountIds.get(JOINT_CURRENT)! });
      await openGoal({ page, name: CAR.name });
      await expect(stripCell({ page, label: 'Saved' })).toContainText(money({ amount: CAR_SAVED }));
      await openTab({ page, name: 'Accounts' });
      const joint = accountRow({ page, name: JOINT_CURRENT.name });
      await expect(joint).toContainText('Archived');
      await expect(joint).toContainText(money({ amount: counted({ account: JOINT_CURRENT, share: 25 }) }));

      await openGoal({ page, name: RAINY.name });
      await expect(stripCell({ page, label: 'Saved' })).toContainText(money({ amount: RAINY_SAVED }));
    });

    await test.step('deleting the only linked account shows No accounts (plan Lifecycle edges)', async () => {
      await deleteAccount({ request: page.request, accountId: accountIds.get(LAPTOP_CASH)! });
      await openGoalsPage({ page });
      await expect(goalRow({ page, name: LAPTOP.name })).toContainText('No accounts');

      await openGoal({ page, name: LAPTOP.name });
      await expect(main({ page }).getByText('No accounts', { exact: true }).first()).toBeVisible();
      await openTab({ page, name: 'Accounts' });
      await expect(main({ page }).getByRole('heading', { name: 'No accounts' })).toBeVisible();
    });
  });
});
