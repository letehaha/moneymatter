import { type APIRequestContext, type Locator, type Page, expect, test } from '@playwright/test';

import { completeOnboarding, createTransaction } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import {
  ACCOUNT_CATEGORY,
  createAccountOfCategory,
  createGoal,
  listGoals,
  monthsAgoIso,
  seedMonthlyDeposits,
  updateGoal,
} from '../../helpers/goals';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';
import { waitForSuccessToast } from '../../helpers/ui';

const CURRENCY = 'USD';
const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30.44;
const PACE_WINDOW_MONTHS = 6;

const whatIfCreds = buildTestCredentials({ prefix: 'gwi' });
const feasibilityCreds = buildTestCredentials({ prefix: 'gfs' });

// ─── Requirement arithmetic (plan "Compute path", docs how-progress-is-calculated) ───

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const addMonths = ({ months }: { months: number }) => {
  const today = startOfToday();
  const monthIndex = today.getMonth() + months;
  const lastDay = new Date(today.getFullYear(), monthIndex + 1, 0).getDate();
  return new Date(today.getFullYear(), monthIndex, Math.min(today.getDate(), lastDay));
};

const toDateKey = ({ date }: { date: Date }) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const monthLabel = ({ months }: { months: number }) =>
  addMonths({ months }).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
  });

const daysUntil = ({ date }: { date: Date }) => Math.round((date.getTime() - startOfToday().getTime()) / MS_PER_DAY);

const neededMonthly = ({ remaining, date }: { remaining: number; date: Date }) =>
  remaining / (daysUntil({ date }) / DAYS_PER_MONTH);

const median = ({ values }: { values: number[] }) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const sum = ({ values }: { values: number[] }) => values.reduce((total, value) => total + value, 0);

const againstTarget = ({ etaMonths, targetMonths }: { etaMonths: number; targetMonths: number }) => {
  const early = targetMonths - etaMonths;
  if (early > 0) return `${early} mo early`;
  if (early < 0) return `${-early} mo late`;
  return 'On time';
};

/** `flowsOldestFirst` land via `seedMonthlyDeposits`: the last entry is 1 month ago. */
type SeededAccount = {
  name: string;
  initial: number;
  flowsOldestFirst: number[];
};
type Share = { account: SeededAccount; share: number };

const balanceAtMonthEnd = ({ account, monthsAgo }: { account: SeededAccount; monthsAgo: number }) => {
  const count = account.flowsOldestFirst.length;
  return (
    account.initial +
    sum({
      values: account.flowsOldestFirst.filter((_, index) => count - index >= Math.max(monthsAgo, 1)),
    })
  );
};

const goalValueAt = ({ shares, monthsAgo }: { shares: Share[]; monthsAgo: number }) =>
  sum({
    values: shares.map(({ account, share }) => (share / 100) * Math.max(0, balanceAtMonthEnd({ account, monthsAgo }))),
  });

const toCents = ({ amount }: { amount: number }) => Math.round(amount * 100) / 100;

const savedNow = ({ shares }: { shares: Share[] }) => toCents({ amount: goalValueAt({ shares, monthsAgo: 0 }) });

const paceOf = ({ shares }: { shares: Share[] }) =>
  toCents({
    amount: median({
      values: Array.from(
        { length: PACE_WINDOW_MONTHS },
        (_, index) => goalValueAt({ shares, monthsAgo: index + 1 }) - goalValueAt({ shares, monthsAgo: index + 2 }),
      ),
    }),
  });

// ─── UI readers ──────────────────────────────────────────────────────

const parseMoney = ({ text }: { text: string }) => {
  const match = text.replace(/,/g, '').match(/([-−])?\$\s?(\d+(?:\.\d+)?)\s*([kKM])?/);
  if (!match) return Number.NaN;
  const scale = { k: 1e3, K: 1e3, M: 1e6 }[match[3] ?? ''] ?? 1;
  return (match[1] ? -1 : 1) * Number(match[2]) * scale;
};

async function expectMoney({ locator, expected }: { locator: Locator; expected: number }) {
  const tolerance = Math.max(1, Math.abs(expected) * 0.005);
  await expect
    .poll(async () => Math.abs(parseMoney({ text: await locator.innerText() }) - expected), {
      message: `expected about ${expected}`,
      timeout: 10_000,
    })
    .toBeLessThanOrEqual(tolerance);
}

const compareCells = ({ page, label }: { page: Page; label: string }) => {
  const row = page.getByRole('main').getByText(label, { exact: true }).locator('..');
  return {
    now: row.locator(':scope > span').nth(1),
    next: row.locator(':scope > span').nth(2),
  };
};

type ColumnExpectation = {
  monthly: number;
  isAuto: boolean;
  etaMonths: number;
  /** null = undated, so no early/late comparison. */
  targetMonths: number | null;
  needs?: number;
};

async function expectColumn({
  page,
  column,
  expected,
}: {
  page: Page;
  column: 'now' | 'next';
  expected: ColumnExpectation;
}) {
  const monthly = compareCells({ page, label: 'Monthly toward goal' })[column];
  await expectMoney({ locator: monthly, expected: expected.monthly });
  if (expected.isAuto) await expect(monthly).toContainText('Auto');
  else await expect(monthly).not.toContainText('Auto');

  await expect(compareCells({ page, label: 'Reached around' })[column]).toContainText(
    monthLabel({ months: expected.etaMonths }),
  );

  const against = compareCells({ page, label: 'Against target' })[column];
  if (expected.targetMonths === null) await expect(against).not.toContainText(/mo early|mo late|On time/);
  else {
    await expect(against).toHaveText(
      againstTarget({
        etaMonths: expected.etaMonths,
        targetMonths: expected.targetMonths,
      }),
    );
  }

  if (expected.needs !== undefined) {
    await expectMoney({
      locator: compareCells({ page, label: 'Needs per month' })[column],
      expected: expected.needs,
    });
  }
}

const monthlyInput = ({ page }: { page: Page }) =>
  page.getByRole('main').getByRole('spinbutton', { name: /^Monthly toward this goal/ });
const whatIfDateInput = ({ page }: { page: Page }) => page.getByRole('main').getByLabel('Target date', { exact: true });
const shareInput = ({ page, name }: { page: Page; name: string }) =>
  page.getByRole('main').getByRole('spinbutton', { name: `Share of ${name}` });
const resetButton = ({ page }: { page: Page }) => page.getByRole('button', { name: 'Reset', exact: true });
const applyButton = ({ page }: { page: Page }) => page.getByRole('button', { name: 'Apply in Edit goal' });
const tab = ({ page, name }: { page: Page; name: string }) =>
  page.getByRole('button', { name: new RegExp(`^${name}`) });

async function openGoal({ page, goalId, name }: { page: Page; goalId: string; name: string }) {
  await page.goto(`/goals/${goalId}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({
    timeout: 15_000,
  });
}

const findGoal = async ({ request, goalId }: { request: APIRequestContext; goalId: string }) => {
  const goal = (await listGoals({ request })).find((item) => item.id === goalId);
  if (!goal) throw new Error(`Goal ${goalId} not found`);
  return goal;
};

const shareFor = ({
  goal,
  accountId,
}: {
  goal: { accounts: { accountId: string; sharePercent: number | null }[] };
  accountId: string;
}) => Number(goal.accounts.find((account) => account.accountId === accountId)?.sharePercent);

// ─── Feasibility helpers (docs what-if-and-feasibility "How the check works") ───

type FeasibilityGoal = { name: string; need: number; date: Date | null };

const fundingOrder = ({ goals }: { goals: FeasibilityGoal[] }) =>
  [...goals].sort((a, b) => {
    if (!a.date) return b.date ? 1 : 0;
    if (!b.date) return -1;
    return a.date.getTime() - b.date.getTime();
  });

const feasibilityBanner = ({ page }: { page: Page }) => page.getByRole('status').filter({ hasText: 'Your goals need' });

async function openGoalsPageSettled({ page, anyGoalName }: { page: Page; anyGoalName: string }) {
  const cashFlow = page.waitForResponse((response) => response.url().includes('/stats/cash-flow'), {
    timeout: 20_000,
  });
  await page.goto('/goals');
  await expect(page.getByRole('main').getByText(anyGoalName, { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await (await cashFlow).finished();
  // Two frames let Vue render the banner from the fresh cash-flow data before absence checks run.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

async function expectBanner({
  page,
  goals,
  typicalSaving,
}: {
  page: Page;
  goals: FeasibilityGoal[];
  typicalSaving: number;
}) {
  const totalNeed = sum({ values: goals.map((goal) => goal.need) });
  expect(totalNeed, 'scenario must exceed the typical saving').toBeGreaterThan(typicalSaving);

  const banner = feasibilityBanner({ page });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  const summary = (await banner.innerText()).match(/Your goals need (\S+)\/mo, you save a median (\S+)\/mo/);
  expect(summary, 'banner summary sentence').not.toBeNull();
  expect(Math.abs(parseMoney({ text: summary![1]! }) - totalNeed)).toBeLessThanOrEqual(Math.max(2, totalNeed * 0.005));
  expect(parseMoney({ text: summary![2]! })).toBeCloseTo(typicalSaving, 0);
  await expectMoney({
    locator: banner.getByText(/a month short/),
    expected: totalNeed - typicalSaving,
  });

  const toggle = banner.getByRole('button', { name: /Show goals/ });
  await toggle.click();
  const items = banner.getByRole('listitem');
  const ordered = fundingOrder({ goals });
  await expect(items).toHaveCount(ordered.length);

  let funded = 0;
  for (const [index, goal] of ordered.entries()) {
    funded += goal.need;
    const item = items.nth(index);
    await expect(item).toContainText(goal.name);
    await expectMoney({ locator: item, expected: goal.need });
    if (funded <= typicalSaving) {
      await expect(item).toContainText('Fits');
      await expect(item).not.toContainText("Doesn't fit");
    } else {
      await expect(item).toContainText("Doesn't fit");
    }
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds: whatIfCreds });
  await signUpAndVerify({ creds: feasibilityCreds });
});

test.describe('Goals planning', () => {
  test.use({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });

  test('What if tab: sandbox math, reset and apply in Edit goal', async ({ page }) => {
    test.setTimeout(300_000);
    await loginViaUI({
      page,
      email: whatIfCreds.email,
      password: whatIfCreds.password,
    });
    const request = page.request;
    await completeOnboarding({ request, currencyCode: CURRENCY });

    const SAVINGS: SeededAccount = {
      name: 'Savings',
      initial: 1_000,
      flowsOldestFirst: [500, 500, 400, 100, 400, 2_000, 400, 200],
    };
    const WALLET: SeededAccount = {
      name: 'Wallet',
      initial: 300,
      flowsOldestFirst: [100, 100, 150, 50, 250, -100, 150, 150],
    };
    const PIGGY: SeededAccount = {
      name: 'Piggy',
      initial: 800,
      flowsOldestFirst: [],
    };

    const savingsId = await createAccountOfCategory({
      request,
      name: SAVINGS.name,
      currencyCode: CURRENCY,
      initialBalance: SAVINGS.initial,
      category: ACCOUNT_CATEGORY.saving,
    });
    await seedMonthlyDeposits({
      request,
      accountId: savingsId,
      amountsOldestFirst: SAVINGS.flowsOldestFirst,
    });
    const walletId = await createAccountOfCategory({
      request,
      name: WALLET.name,
      currencyCode: CURRENCY,
      initialBalance: WALLET.initial,
      category: ACCOUNT_CATEGORY.cash,
    });
    await seedMonthlyDeposits({
      request,
      accountId: walletId,
      amountsOldestFirst: WALLET.flowsOldestFirst,
    });
    const piggyId = await createAccountOfCategory({
      request,
      name: PIGGY.name,
      currencyCode: CURRENCY,
      initialBalance: PIGGY.initial,
      category: ACCOUNT_CATEGORY.cash,
    });

    const EMERGENCY_SAVINGS_SHARE = 20;
    const CAR_SAVINGS_SHARE = 80;
    const CAR_SAVINGS_FREE = 100 - EMERGENCY_SAVINGS_SHARE;
    const CAR_TARGET = 15_550;
    const CAR_TARGET_MONTHS = 20;
    const carTargetDate = addMonths({ months: CAR_TARGET_MONTHS });

    await createGoal({
      request,
      name: 'Emergency fund',
      targetAmount: 50_000,
      currencyCode: CURRENCY,
      accounts: [{ accountId: savingsId, sharePercent: EMERGENCY_SAVINGS_SHARE }],
    });
    const car = await createGoal({
      request,
      name: 'Car',
      targetAmount: CAR_TARGET,
      currencyCode: CURRENCY,
      targetDate: toDateKey({ date: carTargetDate }),
      accounts: [
        { accountId: savingsId, sharePercent: CAR_SAVINGS_SHARE },
        { accountId: walletId, sharePercent: 100 },
      ],
    });
    const bike = await createGoal({
      request,
      name: 'Bike',
      targetAmount: 300,
      currencyCode: CURRENCY,
      accounts: [{ accountId: piggyId, sharePercent: 50 }],
    });
    const oldPlan = await createGoal({
      request,
      name: 'Old plan',
      targetAmount: 99_000,
      currencyCode: CURRENCY,
      accounts: [{ accountId: piggyId, sharePercent: 50 }],
    });
    await updateGoal({ request, goalId: oldPlan.id, status: 'archived' });

    const JAR = {
      name: 'Jar',
      initial: 1_000,
      goalName: 'Jar fund',
      target: 6_000,
    };
    const jarId = await createAccountOfCategory({
      request,
      name: JAR.name,
      currencyCode: CURRENCY,
      initialBalance: JAR.initial,
      category: ACCOUNT_CATEGORY.cash,
    });
    const jarFund = await createGoal({
      request,
      name: JAR.goalName,
      targetAmount: JAR.target,
      currencyCode: CURRENCY,
      accounts: [{ accountId: jarId, sharePercent: 100 }],
    });

    const carShares: Share[] = [
      { account: SAVINGS, share: CAR_SAVINGS_SHARE },
      { account: WALLET, share: 100 },
    ];
    const carSaved = savedNow({ shares: carShares });
    const carRemaining = CAR_TARGET - carSaved;
    const carPace = paceOf({ shares: carShares });
    const carEta = Math.ceil(carRemaining / carPace);
    const carNeeds = neededMonthly({
      remaining: carRemaining,
      date: carTargetDate,
    });
    const baseline: ColumnExpectation = {
      monthly: carPace,
      isAuto: true,
      etaMonths: carEta,
      targetMonths: CAR_TARGET_MONTHS,
      needs: carNeeds,
    };

    await test.step('What if is hidden for reached and archived goals (docs what-if-and-feasibility)', async () => {
      expect(savedNow({ shares: [{ account: PIGGY, share: 50 }] })).toBeGreaterThanOrEqual(300);
      await openGoal({ page, goalId: bike.id, name: 'Bike' });
      await expect(tab({ page, name: 'Progress' })).toBeVisible();
      await expect(tab({ page, name: 'What if' })).toHaveCount(0);

      await openGoal({ page, goalId: oldPlan.id, name: 'Old plan' });
      await expect(tab({ page, name: 'Progress' })).toBeVisible();
      await expect(tab({ page, name: 'What if' })).toHaveCount(0);
    });

    await test.step('No Auto without enough history: the typed amount drives the projection (docs what-if)', async () => {
      const MONTHLY = 500;
      const jarRemaining = JAR.target - JAR.initial;
      await openGoal({ page, goalId: jarFund.id, name: JAR.goalName });
      await tab({ page, name: 'What if' }).click();
      await expect(page.getByRole('main').getByText('Not enough history for Auto yet. Enter an amount.')).toBeVisible();
      await expect(page.getByRole('main').getByText(/^Auto \$/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Use Auto' })).toHaveCount(0);

      await monthlyInput({ page }).fill(String(MONTHLY));
      await expectColumn({
        page,
        column: 'next',
        expected: {
          monthly: MONTHLY,
          isAuto: false,
          etaMonths: Math.ceil(jarRemaining / MONTHLY),
          targetMonths: null,
        },
      });
      await expect(page.getByRole('button', { name: 'Use Auto' })).toHaveCount(0);
      await expect(resetButton({ page })).toBeEnabled();
    });

    await test.step('Baseline: Auto is the median pace and both columns match (plan Compute path)', async () => {
      await openGoal({ page, goalId: car.id, name: 'Car' });
      await tab({ page, name: 'What if' }).click();
      await expect(page.getByText(new RegExp(`^Auto \\$${carPace}(\\.00)?$`))).toBeVisible();
      await expect(page.getByText(`median monthly change of the last ${PACE_WINDOW_MONTHS} months`)).toBeVisible();
      await expect(monthlyInput({ page })).toHaveValue('');
      await expectColumn({ page, column: 'now', expected: baseline });
      await expectColumn({ page, column: 'next', expected: baseline });
      await expect(resetButton({ page })).toBeDisabled();
    });

    await test.step('Monthly toward this goal drives Reached around / Against target; Use Auto restores', async () => {
      for (const monthly of [500, 625, 400]) {
        await monthlyInput({ page }).fill(String(monthly));
        await expectColumn({
          page,
          column: 'next',
          expected: {
            monthly,
            isAuto: false,
            etaMonths: Math.ceil(carRemaining / monthly),
            targetMonths: CAR_TARGET_MONTHS,
            needs: carNeeds,
          },
        });
        await expectColumn({ page, column: 'now', expected: baseline });
      }

      await page.getByRole('button', { name: 'Use Auto' }).click();
      await expect(monthlyInput({ page })).toHaveValue('');
      await expectColumn({ page, column: 'next', expected: baseline });
    });

    await test.step('Target date: a new date changes the comparison and needs; clearing it drops the comparison', async () => {
      const WHAT_IF_MONTHS = 22;
      const whatIfDate = addMonths({ months: WHAT_IF_MONTHS });
      await whatIfDateInput({ page }).fill(toDateKey({ date: whatIfDate }));
      await expectColumn({
        page,
        column: 'next',
        expected: {
          ...baseline,
          targetMonths: WHAT_IF_MONTHS,
          needs: neededMonthly({ remaining: carRemaining, date: whatIfDate }),
        },
      });

      await whatIfDateInput({ page }).locator('xpath=..').getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(whatIfDateInput({ page })).toHaveValue('');
      await expectColumn({
        page,
        column: 'next',
        expected: { ...baseline, targetMonths: null, needs: undefined },
      });
      await expectColumn({ page, column: 'now', expected: baseline });

      await resetButton({ page }).click();
      await expect(whatIfDateInput({ page })).toHaveValue(toDateKey({ date: carTargetDate }));
      await expectColumn({ page, column: 'next', expected: baseline });
      await expect(resetButton({ page })).toBeDisabled();
    });

    await test.step('Account shares: 0 leaves an account out, capped at what is free, partial-share deposit hint', async () => {
      await shareInput({ page, name: WALLET.name }).fill('0');
      const savingsOnly: Share[] = [{ account: SAVINGS, share: CAR_SAVINGS_SHARE }];
      const savingsOnlyRemaining = CAR_TARGET - savedNow({ shares: savingsOnly });
      const savingsOnlyPace = paceOf({ shares: savingsOnly });
      await expectColumn({
        page,
        column: 'next',
        expected: {
          monthly: savingsOnlyPace,
          isAuto: true,
          etaMonths: Math.ceil(savingsOnlyRemaining / savingsOnlyPace),
          targetMonths: CAR_TARGET_MONTHS,
          needs: neededMonthly({
            remaining: savingsOnlyRemaining,
            date: carTargetDate,
          }),
        },
      });
      await expectColumn({ page, column: 'now', expected: baseline });

      await shareInput({ page, name: SAVINGS.name }).fill(String(CAR_SAVINGS_FREE + 10));
      await expect(page.getByRole('main').getByText(`Max ${CAR_SAVINGS_FREE}%`).first()).toBeVisible();
      await expect(applyButton({ page })).toBeDisabled();

      const PARTIAL_SHARE = 25;
      const MONTHLY_COUNTED = 100;
      const depositNeeded = MONTHLY_COUNTED / (PARTIAL_SHARE / 100);
      await shareInput({ page, name: SAVINGS.name }).fill(String(PARTIAL_SHARE));
      await monthlyInput({ page }).fill(String(MONTHLY_COUNTED));
      const typedDepositHint = page
        .getByRole('main')
        .getByText(
          new RegExp(
            `To count \\$${MONTHLY_COUNTED}(\\.00)? a month toward this goal, deposit \\$${depositNeeded}(\\.00)? into ${SAVINGS.name}\\.`,
          ),
        );
      await expect(typedDepositHint).toBeVisible();
      await expect(applyButton({ page })).toBeEnabled();

      await resetButton({ page }).click();
      await expect(shareInput({ page, name: SAVINGS.name })).toHaveValue(String(CAR_SAVINGS_SHARE));
      await expect(shareInput({ page, name: WALLET.name })).toHaveValue('100');
      await expect(monthlyInput({ page })).toHaveValue('');
      await expect(typedDepositHint).toHaveCount(0);
      await expectColumn({ page, column: 'next', expected: baseline });
    });

    await test.step('Nothing is saved before apply; Apply in Edit goal prefills the form and saving persists it', async () => {
      const APPLIED_MONTHLY = 625;
      const APPLIED_MONTHS = 18;
      const APPLIED_WALLET_SHARE = 50;
      const appliedDate = addMonths({ months: APPLIED_MONTHS });

      await monthlyInput({ page }).fill(String(APPLIED_MONTHLY));
      await whatIfDateInput({ page }).fill(toDateKey({ date: appliedDate }));
      await shareInput({ page, name: WALLET.name }).fill(String(APPLIED_WALLET_SHARE));
      await expect(applyButton({ page })).toBeEnabled();

      const untouched = await findGoal({ request, goalId: car.id });
      expect(untouched.plannedMonthly ?? null).toBeNull();
      expect(String(untouched.targetDate).slice(0, 10)).toBe(toDateKey({ date: carTargetDate }));
      expect(shareFor({ goal: untouched, accountId: walletId })).toBe(100);

      const dialog = page.getByRole('dialog', { name: 'Edit goal' });
      const expectPrefilled = async () => {
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('switch', { name: 'Set a monthly amount' })).toBeChecked();
        await expect(dialog.getByPlaceholder('Enter a monthly amount')).toHaveValue(
          new RegExp(`^${APPLIED_MONTHLY}(\\.00?)?$`),
        );
        await expect(dialog.getByLabel('Target date', { exact: true })).toHaveValue(toDateKey({ date: appliedDate }));
        await expect(dialog).toContainText(new RegExp(`${SAVINGS.name}\\s*${CAR_SAVINGS_SHARE}%`));
        await expect(dialog).toContainText(new RegExp(`${WALLET.name}\\s*${APPLIED_WALLET_SHARE}%`));
      };

      await applyButton({ page }).click();
      await expectPrefilled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      const dismissed = await findGoal({ request, goalId: car.id });
      expect(dismissed.plannedMonthly ?? null).toBeNull();
      expect(String(dismissed.targetDate).slice(0, 10)).toBe(toDateKey({ date: carTargetDate }));
      expect(shareFor({ goal: dismissed, accountId: walletId })).toBe(100);
      await expect(resetButton({ page })).toBeEnabled();
      await expect(monthlyInput({ page })).toHaveValue(String(APPLIED_MONTHLY));

      await applyButton({ page }).click();
      await expectPrefilled();

      await dialog.getByRole('button', { name: 'Save changes' }).click();
      await waitForSuccessToast({ page });
      await expect(dialog).toBeHidden();

      const saved = await findGoal({ request, goalId: car.id });
      expect(Number(saved.plannedMonthly)).toBe(APPLIED_MONTHLY);
      expect(String(saved.targetDate).slice(0, 10)).toBe(toDateKey({ date: appliedDate }));
      expect(shareFor({ goal: saved, accountId: walletId })).toBe(APPLIED_WALLET_SHARE);
      expect(shareFor({ goal: saved, accountId: savingsId })).toBe(CAR_SAVINGS_SHARE);

      const appliedShares: Share[] = [
        { account: SAVINGS, share: CAR_SAVINGS_SHARE },
        { account: WALLET, share: APPLIED_WALLET_SHARE },
      ];
      const appliedRemaining = CAR_TARGET - savedNow({ shares: appliedShares });
      const applied: ColumnExpectation = {
        monthly: APPLIED_MONTHLY,
        isAuto: false,
        etaMonths: Math.ceil(appliedRemaining / APPLIED_MONTHLY),
        targetMonths: APPLIED_MONTHS,
        needs: neededMonthly({
          remaining: appliedRemaining,
          date: appliedDate,
        }),
      };
      await expect(resetButton({ page })).toBeDisabled();
      await expect(monthlyInput({ page })).toHaveValue(new RegExp(`^(${APPLIED_MONTHLY}(\\.0+)?)?$`));
      await expect(shareInput({ page, name: WALLET.name })).toHaveValue(String(APPLIED_WALLET_SHARE));
      await expectColumn({ page, column: 'now', expected: applied });
      await expectColumn({ page, column: 'next', expected: applied });
    });
  });

  test('Feasibility banner: shown only when active goals need more than the median saving', async ({ page }) => {
    test.setTimeout(300_000);
    await loginViaUI({
      page,
      email: feasibilityCreds.email,
      password: feasibilityCreds.password,
    });
    const request = page.request;
    await completeOnboarding({ request, currencyCode: CURRENCY });

    const checkingId = await createAccountOfCategory({
      request,
      name: 'Checking',
      currencyCode: CURRENCY,
      initialBalance: 0,
      category: ACCOUNT_CATEGORY.general,
    });
    const VAULT_BALANCE = 3_000;
    const vaultId = await createAccountOfCategory({
      request,
      name: 'Vault',
      currencyCode: CURRENCY,
      initialBalance: VAULT_BALANCE,
      category: ACCOUNT_CATEGORY.saving,
    });
    const brokerageId = await createAccountOfCategory({
      request,
      name: 'Brokerage',
      currencyCode: CURRENCY,
      initialBalance: 1_000,
      category: ACCOUNT_CATEGORY.investment,
    });

    const VAULT_SHARE = 50;
    const vaultSaved = VAULT_BALANCE * (VAULT_SHARE / 100);
    const LAPTOP = { name: 'Laptop', target: 7_500, months: 10 };
    const TRIP = { name: 'Trip', target: 10_500, months: 12, laterMonths: 36 };
    const HOUSE = { name: 'House', target: 20_000, planned: 300 };
    const DONE = {
      name: 'Done',
      balance: 500,
      target: 400,
      planned: 2_000,
      months: 2,
    };
    expect(DONE.balance).toBeGreaterThanOrEqual(DONE.target);
    const cashBoxId = await createAccountOfCategory({
      request,
      name: 'Cash box',
      currencyCode: CURRENCY,
      initialBalance: DONE.balance,
      category: ACCOUNT_CATEGORY.cash,
    });
    await createGoal({
      request,
      name: DONE.name,
      targetAmount: DONE.target,
      currencyCode: CURRENCY,
      plannedMonthly: DONE.planned,
      targetDate: toDateKey({ date: addMonths({ months: DONE.months }) }),
      accounts: [{ accountId: cashBoxId, sharePercent: 100 }],
    });

    const laptopDate = addMonths({ months: LAPTOP.months });
    const tripDate = addMonths({ months: TRIP.months });
    const tripLaterDate = addMonths({ months: TRIP.laterMonths });

    const trip = await createGoal({
      request,
      name: TRIP.name,
      targetAmount: TRIP.target,
      currencyCode: CURRENCY,
      targetDate: toDateKey({ date: tripDate }),
      accounts: [{ accountId: vaultId, sharePercent: VAULT_SHARE }],
    });
    await createGoal({
      request,
      name: HOUSE.name,
      targetAmount: HOUSE.target,
      currencyCode: CURRENCY,
      plannedMonthly: HOUSE.planned,
      accounts: [{ accountId: brokerageId, sharePercent: 100 }],
    });
    const laptop = await createGoal({
      request,
      name: LAPTOP.name,
      targetAmount: LAPTOP.target,
      currencyCode: CURRENCY,
      targetDate: toDateKey({ date: laptopDate }),
      accounts: [{ accountId: vaultId, sharePercent: VAULT_SHARE }],
    });

    const laptopNeed = neededMonthly({
      remaining: LAPTOP.target - vaultSaved,
      date: laptopDate,
    });
    const tripNeed = neededMonthly({
      remaining: TRIP.target - vaultSaved,
      date: tripDate,
    });
    const tripLaterNeed = neededMonthly({
      remaining: TRIP.target - vaultSaved,
      date: tripLaterDate,
    });

    const MONTHS = [
      { monthsAgo: 3, income: 3_000, expense: 600 },
      { monthsAgo: 2, income: 2_000, expense: 1_100 },
      { monthsAgo: 1, income: 2_500, expense: 1_300 },
    ];
    const typicalSaving = median({
      values: MONTHS.map((month) => month.income - month.expense),
    });
    const seedMonth = async ({ monthsAgo, income, expense }: (typeof MONTHS)[number]) => {
      const time = monthsAgoIso({ monthsAgo });
      await createTransaction({
        request,
        accountId: checkingId,
        amount: income,
        transactionType: 'income',
        time,
      });
      await createTransaction({
        request,
        accountId: checkingId,
        amount: expense,
        transactionType: 'expense',
        time,
      });
    };

    const allActive: FeasibilityGoal[] = [
      { name: LAPTOP.name, need: laptopNeed, date: laptopDate },
      { name: TRIP.name, need: tripNeed, date: tripDate },
      { name: HOUSE.name, need: HOUSE.planned, date: null },
    ];

    await test.step('No cash-flow history: check skipped, no banner (owner decision)', async () => {
      await openGoalsPageSettled({ page, anyGoalName: LAPTOP.name });
      await expect(feasibilityBanner({ page })).toHaveCount(0);
    });

    await test.step('Two months of history is still under the 3-month minimum: no banner (plan slice 6)', async () => {
      for (const month of MONTHS.filter(({ monthsAgo }) => monthsAgo <= 2)) await seedMonth(month);
      await openGoalsPageSettled({ page, anyGoalName: LAPTOP.name });
      await expect(feasibilityBanner({ page })).toHaveCount(0);
    });

    await test.step('Three months: needs above the median net flow show the banner, funded nearest date first; the reached goal is left out', async () => {
      await seedMonth(MONTHS.find(({ monthsAgo }) => monthsAgo === 3)!);
      await openGoalsPageSettled({ page, anyGoalName: LAPTOP.name });
      await expectBanner({ page, goals: allActive, typicalSaving });
    });

    await test.step('Pausing a goal leaves it out of the check: needs fit, banner disappears (docs create-and-edit)', async () => {
      const stillActive = allActive.filter((goal) => goal.name !== TRIP.name);
      expect(sum({ values: stillActive.map((goal) => goal.need) })).toBeLessThanOrEqual(typicalSaving);

      await page.getByRole('button', { name: `More actions for ${TRIP.name}` }).click();
      await page.getByRole('menuitem', { name: 'Pause' }).click();
      await waitForSuccessToast({ page });
      await expect(feasibilityBanner({ page })).toHaveCount(0);
    });

    await test.step('Resuming brings it back; archiving leaves it out again (plan D3, docs)', async () => {
      await page.getByRole('button', { name: `More actions for ${TRIP.name}` }).click();
      await page.getByRole('menuitem', { name: 'Resume' }).click();
      await expect(feasibilityBanner({ page })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole('button', { name: `More actions for ${TRIP.name}` }).click();
      await page.getByRole('menuitem', { name: 'Archive' }).click();
      await waitForSuccessToast({ page });
      await expect(feasibilityBanner({ page })).toHaveCount(0);
    });

    await test.step('A later date lowers the need so every active goal fits: no banner', async () => {
      await updateGoal({
        request,
        goalId: trip.id,
        status: 'active',
        targetDate: toDateKey({ date: tripLaterDate }),
      });
      const fitting = [laptopNeed, tripLaterNeed, HOUSE.planned];
      expect(sum({ values: fitting })).toBeLessThanOrEqual(typicalSaving);
      await openGoalsPageSettled({ page, anyGoalName: TRIP.name });
      await expect(feasibilityBanner({ page })).toHaveCount(0);
    });

    await test.step('A monthly amount above Needs counts as the goal need (docs "larger of Needs and monthly")', async () => {
      const LAPTOP_PLANNED = 900;
      expect(LAPTOP_PLANNED).toBeGreaterThan(laptopNeed);
      await updateGoal({
        request,
        goalId: laptop.id,
        plannedMonthly: LAPTOP_PLANNED,
      });
      await openGoalsPageSettled({ page, anyGoalName: LAPTOP.name });
      await expectBanner({
        page,
        goals: [
          {
            name: LAPTOP.name,
            need: Math.max(laptopNeed, LAPTOP_PLANNED),
            date: laptopDate,
          },
          { name: TRIP.name, need: tripLaterNeed, date: tripLaterDate },
          { name: HOUSE.name, need: HOUSE.planned, date: null },
        ],
        typicalSaving,
      });
    });
  });
});
