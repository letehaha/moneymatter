import { type Locator, type Page, type Request, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  API_BASE_URL,
  apiPatch,
  completeOnboarding,
  createAccount,
  createCategory,
  createLoan,
  createTransaction,
  createVehicle,
  createVentureDeal,
  extractId,
  signInViaApi,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import {
  DURATION,
  NOW,
  PRESET_INFLATION_PCT,
  WORLD_STOCK_REAL,
  addMonths,
  ageAt,
  coastHitMonth,
  expectMonths,
  monthYear,
  monthsToTarget,
  monthsUntilAge,
  parseCompact,
  parseDuration,
  parseMoney,
  pastMonthIso,
  patchFireSettings,
  requiredMonthlyContribution,
  squash,
  toMonthly,
  toRealAnnual,
} from '../../helpers/fire';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const INITIAL_BALANCE = 100_000;
const MONTHLY_INCOME = 5_000;
const MONTHLY_GROCERIES = 2_200;
const MONTHLY_TRAVEL = 600;
const MONTHLY_FLIGHTS = 200;
const MONTHLY_EXPENSE = MONTHLY_GROCERIES + MONTHLY_TRAVEL + MONTHLY_FLIGHTS;
const SEEDED_MONTHS = 4;
const BALANCE = INITIAL_BALANCE + SEEDED_MONTHS * (MONTHLY_INCOME - MONTHLY_EXPENSE);
const LOAN_BALANCE = 150_000;
const VEHICLE_VALUE = 20_000;
const VENTURE_VALUE = 30_000;
const UNREACHABLE_PMT_YEARS = 20;

const BASE_FIRE = {
  annualSpendingOverride: 40_000,
  monthlyContributionOverride: 2_500,
  spendingExcludedCategoryIds: [],
  includeVentures: false,
  includeVehicles: false,
  includeLoans: false,
  returnIndicatorId: 'world-stock',
  customReturnPct: null,
  inflationPct: 3,
  withdrawalRatePct: 4,
  leanMultiplier: 0.7,
  fatMultiplier: 1.5,
  baristaMonthlyIncome: null,
  birthYear: null,
  coastTargetAge: 65,
  targetType: 'regular',
};

// ─── UI readers ──────────────────────────────────────────────────────

const pageText = async ({ page }: { page: Page }) => squash({ text: await page.locator('main').innerText() });

async function readHero({ page, type = 'FIRE' }: { page: Page; type?: string }) {
  const text = await pageText({ page });
  const hero = text.match(
    new RegExp(`Time to ${type}\\s*(${DURATION})\\s*([A-Z][a-z]+ \\d{4})(?:\\s*·?\\s*at age (\\d+))?`, 'i'),
  );
  if (!hero) throw new Error(`Hero ETA not found in: ${text.slice(0, 600)}`);
  const range = text.match(/(\w{3} \d{4}) to (after \d{4}|\w{3} \d{4}) if returns run 2 points higher or lower/);
  return {
    duration: hero[1]!,
    months: parseDuration({ text: hero[1]! }),
    date: hero[2]!,
    age: hero[3] ? Number(hero[3]) : null,
    range: range ? { low: range[1]!, high: range[2]! } : null,
  };
}

async function readProgress({ page, type = 'FIRE' }: { page: Page; type?: string }) {
  const text = await pageText({ page });
  const match = text.match(
    new RegExp(`Progress to ${type}\\s*([\\d.]+)%\\s*·\\s*(\\$[\\d.]+[KM]?) of (\\$[\\d.]+[KM]?)`),
  );
  if (!match) throw new Error(`Progress line not found in: ${text.slice(0, 600)}`);
  const supports = text.match(/Supports (\$[\d,]+)\/mo today/);
  return {
    pct: Number(match[1]),
    balance: parseCompact({ text: match[2]! }),
    target: parseCompact({ text: match[3]! }),
    supportsMonthly: supports ? parseMoney({ text: supports[1]! }) : null,
  };
}

const chipLocator = ({ page, name }: { page: Page; name: string }) =>
  page
    .getByTestId('fire-types')
    .getByRole('listitem')
    .filter({ hasText: `${name} FIRE` });

const othersTrigger = ({ page }: { page: Page }) =>
  page.getByTestId('fire-types').getByRole('button', { name: 'Others', exact: true });

// The Others collapsible only exists in the compact (narrow-container) layout; wide layouts show every card.
async function openOthers({ page }: { page: Page }) {
  await expect(page.getByTestId('fire-types')).toBeVisible({ timeout: 15_000 });
  const trigger = othersTrigger({ page });
  if (!(await trigger.isVisible())) return;
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
}

const typeCard = ({ page, name }: { page: Page; name: string }) =>
  page.getByRole('button', { name: new RegExp(`^${name} FIRE`) });

const TARGET_TYPES = [
  { type: 'lean', name: 'Lean', label: 'Lean FIRE', multiplier: 0.7 },
  { type: 'fat', name: 'Fat', label: 'Fat FIRE', multiplier: 1.5 },
  { type: 'regular', name: 'Regular', label: 'FIRE', multiplier: 1 },
] as const;

async function readChip({ page, name }: { page: Page; name: string }) {
  const text = squash({ text: await chipLocator({ page, name }).innerText() });
  const amount = text.match(/\$\s*[\d.,]+\s*[kKM]?/);
  const eta = text.match(new RegExp(`\\bin (${DURATION})`));
  return {
    text,
    amount: amount ? parseCompact({ text: amount[0] }) : null,
    months: eta ? parseDuration({ text: eta[1]! }) : null,
  };
}

async function readMilestone({ page, label }: { page: Page; label: string }) {
  const text = squash({
    text: await page
      .getByRole('listitem')
      .filter({ hasText: new RegExp(`^\\s*${label} ·`) })
      .innerText(),
  });
  const eta = text.match(new RegExp(`in (${DURATION}) · (\\w{3} \\d{4})`));
  return { text, months: eta ? parseDuration({ text: eta[1]! }) : null, date: eta ? eta[2]! : null };
}

// ─── Assertions ──────────────────────────────────────────────────────

// Progress amounts render compact: rounded to 3 significant digits before the K/M suffix.
const expectProgressAmount = ({ actual, expected }: { actual: number; expected: number }) =>
  expect(actual).toBeCloseTo(Number(expected.toPrecision(3)), 0);

// Compact amounts keep 3 significant digits, so they sit within 0.5% of the exact value.
const expectCompact = ({ actual, expected }: { actual: number | null; expected: number }) => {
  expect(actual, `expected a compact amount near ${expected}`).not.toBeNull();
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(0.0051 * Math.abs(expected));
};

async function expectHeroEta({ page, months, type }: { page: Page; months: number; type?: string }) {
  await expect(async () => {
    const hero = await readHero({ page, type });
    expectMonths({ actual: hero.months, expected: months });
    expect(hero.duration).toMatch(/^(?:\d+ yrs? \d+ mos?|\d+ yrs?|\d+ mos?)$/);
    expect(hero.date).toBe(monthYear({ months: hero.months, style: 'long' }));
  }).toPass({ timeout: 10_000 });
}

// The sliding indicator sits on the selected pill, and every option fits the track without scrolling.
async function expectSelectedPill({ selected }: { selected: Locator }) {
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(async () => {
    const pills = await selected.evaluate((button) => {
      const track = button.parentElement!;
      const trackBox = track.getBoundingClientRect();
      const indicator = track.querySelector(':scope > div')!.getBoundingClientRect();
      const selectedBox = button.getBoundingClientRect();
      const options = [...track.querySelectorAll('button')];
      return {
        options: options.length,
        clipped: options.filter((option) => {
          const box = option.getBoundingClientRect();
          return (
            box.left < trackBox.left - 1 || box.right > trackBox.right + 1 || option.scrollWidth > option.clientWidth
          );
        }).length,
        trackOverflow: track.scrollWidth - track.clientWidth,
        leftOffset: Math.abs(indicator.left - selectedBox.left),
        widthOffset: Math.abs(indicator.width - selectedBox.width),
        indicatorWidth: indicator.width,
      };
    });
    expect(pills.options).toBe(5);
    expect(pills.clipped).toBe(0);
    expect(pills.trackOverflow).toBeLessThanOrEqual(0);
    expect(pills.indicatorWidth).toBeGreaterThan(0);
    expect(pills.leftOffset).toBeLessThanOrEqual(2);
    expect(pills.widthOffset).toBeLessThanOrEqual(2);
  }).toPass({ timeout: 5_000 });
}

async function expectFireNumber({ page, target, type }: { page: Page; target: number; type?: string }) {
  await expect(async () => {
    const progress = await readProgress({ page, type });
    expectProgressAmount({ actual: progress.target, expected: target });
  }).toPass({ timeout: 10_000 });
}

// ─── Page helpers ────────────────────────────────────────────────────

async function openFirePage({
  page,
  fire,
  others = true,
}: {
  page: Page;
  fire?: Record<string, unknown>;
  others?: boolean;
}) {
  if (fire) await patchFireSettings({ request: page.request, fire });
  await page.goto('/analytics/fire');
  await expect(page.getByRole('heading', { level: 1, name: 'FIRE', exact: true })).toBeVisible({ timeout: 15_000 });
  if (others) await openOthers({ page });
}

async function openAssumptions({ page }: { page: Page }): Promise<Locator> {
  const toggle = page.getByRole('button', { name: 'Adjust assumptions' });
  const panel = page.getByRole('complementary');
  const heading = panel.getByRole('heading', { name: 'Assumptions' });
  await expect(toggle.or(heading).first()).toBeVisible({ timeout: 15_000 });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(heading).toBeVisible();
  return panel;
}

const waitForSave = ({ page }: { page: Page }) =>
  page.waitForResponse(
    (response) => response.url().includes('/api/v1/user/settings') && response.request().method() === 'PATCH',
  );

async function saveVia({ page, action }: { page: Page; action: () => Promise<void> }) {
  const saved = waitForSave({ page });
  await action();
  const response = await saved;
  expect(response.status()).toBe(200);
  return response;
}

// The returned stop() waits past the autosave debounce, then lists the settings writes it saw.
function watchSettingsWrites({ page }: { page: Page }) {
  const writes: string[] = [];
  const record = (request: Request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/v1/user/settings')) {
      writes.push(request.postData() ?? '');
    }
  };
  page.on('request', record);
  return async () => {
    await page.waitForTimeout(1_500);
    page.off('request', record);
    return writes;
  };
}

async function getFireSettings({ page }: { page: Page }): Promise<Record<string, unknown>> {
  const response = await page.request.get(`${API_BASE_URL}/api/v1/user/settings`);
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return (body.response ?? body).fire ?? {};
}

// ─── Seeded user ─────────────────────────────────────────────────────

const creds = buildTestCredentials({ prefix: 'fire' });
let travelCategoryId = '';
let flightsCategoryId = '';

test.describe('FIRE planner', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: { width: 1440, height: 900 } });

  // Seeds before the app first loads: the categories query persists with staleTime Infinity,
  // so categories created after that never reach the exclusion picker.
  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    const request = await signInViaApi({ playwright, email: creds.email, password: creds.password });
    await completeOnboarding({ request, currencyCode: CURRENCY });
    const accountId = extractId(
      await createAccount({ request, name: 'Savings', currencyCode: CURRENCY, initialBalance: INITIAL_BALANCE }),
    );
    const salaryId = extractId(await createCategory({ request, name: 'FIRE Salary', color: '#2e7d32' }));
    const groceriesId = extractId(await createCategory({ request, name: 'FIRE Groceries', color: '#c62828' }));
    travelCategoryId = extractId(await createCategory({ request, name: 'FIRE Travel', color: '#1565c0' }));
    flightsCategoryId = extractId(await createCategory({ request, name: 'FIRE Flights', parentId: travelCategoryId }));
    for (let monthsAgo = 1; monthsAgo <= SEEDED_MONTHS; monthsAgo++) {
      const time = pastMonthIso({ monthsAgo });
      await createTransaction({
        request,
        accountId,
        amount: MONTHLY_INCOME,
        transactionType: 'income',
        categoryId: salaryId,
        time,
      });
      await createTransaction({ request, accountId, amount: MONTHLY_GROCERIES, categoryId: groceriesId, time });
      await createTransaction({ request, accountId, amount: MONTHLY_TRAVEL, categoryId: travelCategoryId, time });
      await createTransaction({ request, accountId, amount: MONTHLY_FLIGHTS, categoryId: flightsCategoryId, time });
    }
    await createLoan({ request, name: 'FIRE Mortgage', currencyCode: CURRENCY, balance: LOAN_BALANCE });
    await createVehicle({ request, name: 'FIRE Car', currencyCode: CURRENCY, purchasePrice: VEHICLE_VALUE });
    // Unlinked to any transaction, so the deal moves no cash and leaves the derived contribution alone.
    await createVentureDeal({
      request,
      payload: {
        name: 'FIRE Deal',
        currencyCode: CURRENCY,
        principal: String(VENTURE_VALUE),
        investmentDate: '2024-01-15',
        entryFeePct: '0',
      },
    });
    await request.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
  });

  test('derives spending and contribution from the last 12 full months', async ({ page }) => {
    await openFirePage({ page });
    const main = page.locator('main');

    const spending = MONTHLY_EXPENSE * 12;
    const contribution = MONTHLY_INCOME - MONTHLY_EXPENSE;
    const target = spending / 0.04;
    const eta = ({ target: t }: { target: number }) =>
      monthsToTarget({ balance: BALANCE, contribution, realAnnual: WORLD_STOCK_REAL, target: t })!;

    await expect(main).toContainText(new RegExp(`\\$${spending.toLocaleString('en-US')}/yr\\s*Auto`));
    await expect(main).toContainText(new RegExp(`\\$${contribution.toLocaleString('en-US')}/mo\\s*Auto`));

    const progress = await readProgress({ page });
    expectProgressAmount({ actual: progress.balance, expected: BALANCE });
    expectProgressAmount({ actual: progress.target, expected: target });
    await expectHeroEta({ page, months: eta({ target }) });

    const panel = await openAssumptions({ page });
    const autoBadges = panel.getByText('Auto', { exact: true });
    await expect(autoBadges).toHaveCount(2);
    await autoBadges.first().hover();
    await expect(page.getByText(`last ${SEEDED_MONTHS} full months`)).toBeVisible();
    const savingsRate = `You save ${(contribution / MONTHLY_INCOME) * 100}% of your income`;
    await expect(panel).toContainText(savingsRate);

    // Excluded categories leave spending only; the money still left the account, so the contribution stays.
    await panel.getByRole('button', { name: 'Exclude categories' }).click();
    const search = page.getByRole('textbox', { name: 'Search categories...' });
    const excludeDialog = page.getByRole('dialog').filter({ has: search });
    await search.fill('FIRE Travel');
    const travelRow = excludeDialog.getByText('FIRE Travel', { exact: true });
    const excluded = await saveVia({ page, action: () => travelRow.click() });
    const excludedIds: string[] = excluded.request().postDataJSON().fire.spendingExcludedCategoryIds;
    expect([...excludedIds].sort()).toEqual([travelCategoryId, flightsCategoryId].sort());
    const spendingWithoutTravel = MONTHLY_GROCERIES * 12;
    await expect(main).toContainText(`$${spendingWithoutTravel.toLocaleString('en-US')}/yr`);
    await expect(main).toContainText(`$${contribution.toLocaleString('en-US')}/mo`);
    await expect(panel).toContainText(savingsRate);
    await expectFireNumber({ page, target: spendingWithoutTravel / 0.04 });
    await expectHeroEta({ page, months: eta({ target: spendingWithoutTravel / 0.04 }) });

    // Unticking a subcategory also drops its parent, which the server would expand back over it.
    await search.fill('FIRE Flights');
    const flightsRow = excludeDialog.getByText('FIRE Flights', { exact: true });
    const partial = await saveVia({ page, action: () => flightsRow.click() });
    expect(partial.request().postDataJSON()).toEqual({ fire: { spendingExcludedCategoryIds: [] } });
    await expect(main).toContainText(`$${spending.toLocaleString('en-US')}/yr`);

    const flightsExcluded = await saveVia({ page, action: () => flightsRow.click() });
    expect(flightsExcluded.request().postDataJSON()).toEqual({
      fire: { spendingExcludedCategoryIds: [flightsCategoryId] },
    });
    await expect(main).toContainText(`$${((MONTHLY_GROCERIES + MONTHLY_TRAVEL) * 12).toLocaleString('en-US')}/yr`);
    const flightsIncluded = await saveVia({ page, action: () => flightsRow.click() });
    expect(flightsIncluded.request().postDataJSON()).toEqual({ fire: { spendingExcludedCategoryIds: [] } });
    await page.keyboard.press('Escape');
    await expectFireNumber({ page, target });

    const expectPressed = async ({
      pressed,
    }: {
      pressed: { Ventures: boolean; Vehicles: boolean; Loans: boolean };
    }) => {
      for (const [name, isPressed] of Object.entries(pressed)) {
        await expect(main.getByRole('button', { name, exact: true, pressed: isPressed })).toBeVisible();
      }
    };

    // Debt shifts the target instead of compounding: assets grow toward target + loans.
    const loans = await saveVia({ page, action: () => panel.getByRole('switch', { name: 'Loans' }).click() });
    expect(loans.request().postDataJSON()).toEqual({ fire: { includeLoans: true } });
    await expectPressed({ pressed: { Ventures: false, Vehicles: false, Loans: true } });
    expect(BALANCE - LOAN_BALANCE).toBeLessThan(0);
    await expect(main).toContainText(/Progress to FIRE\s*0%/);
    await expect(main).toContainText('Net worth is below zero');
    const withLoans = eta({ target: target + LOAN_BALANCE });
    const compoundedDebt = monthsToTarget({
      balance: BALANCE - LOAN_BALANCE,
      contribution,
      realAnnual: WORLD_STOCK_REAL,
      target,
    })!;
    expect(Math.abs(withLoans - compoundedDebt)).toBeGreaterThan(1);
    await expectHeroEta({ page, months: withLoans });

    const toggleBucket = async ({
      name,
      fire,
      pressed,
      balance,
      toggle = panel.getByRole('switch', { name }),
    }: {
      name: string;
      fire: Record<string, boolean>;
      pressed: { Ventures: boolean; Vehicles: boolean; Loans: boolean };
      balance: number;
      toggle?: Locator;
    }) => {
      const saved = await saveVia({ page, action: () => toggle.click() });
      expect(saved.request().postDataJSON()).toEqual({ fire });
      await expectPressed({ pressed });
      expectProgressAmount({ actual: (await readProgress({ page })).balance, expected: balance });
      await expectHeroEta({
        page,
        months: monthsToTarget({ balance, contribution, realAnnual: WORLD_STOCK_REAL, target })!,
      });
    };
    await toggleBucket({
      name: 'Loans',
      fire: { includeLoans: false },
      pressed: { Ventures: false, Vehicles: false, Loans: false },
      balance: BALANCE,
    });
    await toggleBucket({
      name: 'Vehicles',
      fire: { includeVehicles: true },
      pressed: { Ventures: false, Vehicles: true, Loans: false },
      balance: BALANCE + VEHICLE_VALUE,
    });
    await toggleBucket({
      name: 'Ventures',
      fire: { includeVentures: true },
      pressed: { Ventures: true, Vehicles: true, Loans: false },
      balance: BALANCE + VEHICLE_VALUE + VENTURE_VALUE,
    });
    await toggleBucket({
      name: 'Vehicles',
      fire: { includeVehicles: false },
      pressed: { Ventures: true, Vehicles: false, Loans: false },
      balance: BALANCE + VENTURE_VALUE,
    });
    await toggleBucket({
      name: 'Ventures',
      fire: { includeVentures: false },
      pressed: { Ventures: false, Vehicles: false, Loans: false },
      balance: BALANCE,
      toggle: main.getByRole('button', { name: 'Ventures', exact: true, pressed: true }),
    });
  });

  test('overrides typed into the panel drive the hero, progress and chips until Back to auto', async ({ page }) => {
    await openFirePage({
      page,
      fire: { ...BASE_FIRE, annualSpendingOverride: null, monthlyContributionOverride: null },
    });
    const panel = await openAssumptions({ page });

    await saveVia({
      page,
      action: () => panel.getByRole('spinbutton', { name: 'Yearly spending in retirement' }).fill('40000'),
    });
    await saveVia({ page, action: () => panel.getByRole('spinbutton', { name: 'Monthly contribution' }).fill('2500') });

    const contribution = 2_500;
    const target = 40_000 / 0.04;
    const eta = ({ target: t }: { target: number }) =>
      monthsToTarget({ balance: BALANCE, contribution, realAnnual: WORLD_STOCK_REAL, target: t })!;

    await expectFireNumber({ page, target });
    await expectHeroEta({ page, months: eta({ target }) });

    const hero = await readHero({ page });
    const highRate = monthsToTarget({ balance: BALANCE, contribution, realAnnual: WORLD_STOCK_REAL + 0.02, target })!;
    const lowRate = monthsToTarget({ balance: BALANCE, contribution, realAnnual: WORLD_STOCK_REAL - 0.02, target })!;
    expect(hero.range).not.toBeNull();
    const rangeLow = [highRate - 1, highRate, highRate + 1].map((m) => monthYear({ months: m, style: 'short' }));
    const rangeHigh = [lowRate - 1, lowRate, lowRate + 1].map((m) => monthYear({ months: m, style: 'short' }));
    expect(rangeLow).toContain(hero.range!.low);
    expect(rangeHigh).toContain(hero.range!.high);

    const progress = await readProgress({ page });
    expect(progress.pct).toBeCloseTo((BALANCE / target) * 100, 1);
    expect(progress.supportsMonthly).toBe(Math.round((BALANCE * 0.04) / 12));
    const next = (await pageText({ page })).match(new RegExp(`Next: 25% in (${DURATION}) · (\\w{3} \\d{4})`));
    expect(next).not.toBeNull();
    expectMonths({ actual: parseDuration({ text: next![1]! }), expected: eta({ target: target * 0.25 }) });
    expect(next![2]).toBe(monthYear({ months: parseDuration({ text: next![1]! }), style: 'short' }));

    const lean = await readChip({ page, name: 'Lean' });
    expectCompact({ actual: lean.amount, expected: target * 0.7 });
    expectMonths({ actual: lean.months, expected: eta({ target: target * 0.7 }) });

    const regular = await readChip({ page, name: 'Regular' });
    expectCompact({ actual: regular.amount, expected: target });
    expectMonths({ actual: regular.months, expected: eta({ target }) });

    const fat = await readChip({ page, name: 'Fat' });
    expectCompact({ actual: fat.amount, expected: target * 1.5 });
    expectMonths({ actual: fat.months, expected: eta({ target: target * 1.5 }) });

    await expect(page.getByRole('img', { name: /projected path/i })).toBeVisible();

    await expect
      .poll(() => getFireSettings({ page }))
      .toMatchObject({
        annualSpendingOverride: 40_000,
        monthlyContributionOverride: 2_500,
      });

    const autoSpending = MONTHLY_EXPENSE * 12;
    const backToAuto = await saveVia({
      page,
      action: () =>
        panel
          .getByRole('button', { name: new RegExp(`^Back to auto \\(\\$${autoSpending.toLocaleString('en-US')}`) })
          .click(),
    });
    expect(backToAuto.request().postDataJSON()).toEqual({ fire: { annualSpendingOverride: null } });
    await expect(page.locator('main')).toContainText(
      new RegExp(`\\$${autoSpending.toLocaleString('en-US')}/yr\\s*Auto`),
    );
    await expectFireNumber({ page, target: autoSpending / 0.04 });
  });

  test('a higher withdrawal rate lowers the FIRE number and brings FIRE closer', async ({ page }) => {
    await openFirePage({ page, fire: BASE_FIRE });
    const panel = await openAssumptions({ page });

    await expect(panel).toContainText(/higher rate means a smaller FIRE number/i);

    await expectSelectedPill({ selected: panel.getByRole('button', { name: '4.0%', exact: true }) });

    const results: { rate: number; target: number; months: number }[] = [];
    for (const rate of [3, 4.5]) {
      const chip = panel.getByRole('button', { name: `${rate.toFixed(1)}%`, exact: true });
      if ((await chip.getAttribute('aria-pressed')) !== 'true') await saveVia({ page, action: () => chip.click() });
      await expect(chip).toHaveAttribute('aria-pressed', 'true');

      const target = 40_000 / (rate / 100);
      const months = monthsToTarget({ balance: BALANCE, contribution: 2_500, realAnnual: WORLD_STOCK_REAL, target })!;
      await expectFireNumber({ page, target });
      await expectHeroEta({ page, months });
      expectCompact({ actual: (await readChip({ page, name: 'Regular' })).amount, expected: target });
      const progress = await readProgress({ page });
      expect(progress.supportsMonthly).toBe(Math.round((BALANCE * rate) / 100 / 12));
      results.push({ rate, target: progress.target, months: (await readHero({ page })).months });
    }

    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.target).toBeLessThan(results[i - 1]!.target);
      expect(results[i]!.months).toBeLessThan(results[i - 1]!.months);
    }

    await panel.getByRole('button', { name: 'Custom', exact: true }).click();
    const customRate = panel.getByRole('spinbutton', { name: 'Withdrawal rate' });
    await saveVia({ page, action: () => customRate.fill('5') });
    await expectFireNumber({ page, target: 800_000 });
    const customMonths = monthsToTarget({
      balance: BALANCE,
      contribution: 2_500,
      realAnnual: WORLD_STOCK_REAL,
      target: 800_000,
    })!;
    await expectHeroEta({ page, months: customMonths });
    expect((await readHero({ page })).months).toBeLessThan(results.at(-1)!.months);

    const clamped = await saveVia({
      page,
      action: async () => {
        await customRate.fill('12');
        await customRate.press('Tab');
      },
    });
    expect(clamped.request().postDataJSON()).toEqual({ fire: { withdrawalRatePct: 10 } });
    await expect(customRate).toHaveValue('10');
    await expectFireNumber({ page, target: 400_000 });

    const saved = await saveVia({
      page,
      action: () => panel.getByRole('button', { name: '4.5%', exact: true }).click(),
    });
    expect(saved.request().postDataJSON()).toEqual({ fire: { withdrawalRatePct: 4.5 } });
    await expect.poll(() => getFireSettings({ page })).toMatchObject({ withdrawalRatePct: 4.5 });

    const countsToggle = panel.getByRole('button', { name: 'What counts toward FIRE' });
    await countsToggle.click();
    await expect(countsToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.getByRole('switch', { name: 'Loans' })).toBeHidden();

    await page.reload();
    const reloadedPanel = await openAssumptions({ page });
    await expect(reloadedPanel.getByRole('button', { name: '4.5%', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectFireNumber({ page, target: 40_000 / 0.045 });

    const reloadedCounts = reloadedPanel.getByRole('button', { name: 'What counts toward FIRE' });
    await expect(reloadedCounts).toHaveAttribute('aria-expanded', 'false');
    await expect(reloadedPanel.getByRole('switch', { name: 'Loans' })).toBeHidden();
    await reloadedCounts.click();
    await expect(reloadedPanel.getByRole('switch', { name: 'Loans' })).toBeVisible();
  });

  test('return presets, custom return and inflation move the ETA in the right direction', async ({ page }) => {
    await openFirePage({ page, fire: BASE_FIRE });
    const panel = await openAssumptions({ page });
    const target = 1_000_000;
    const etaAt = ({ realAnnual }: { realAnnual: number }) =>
      monthsToTarget({ balance: BALANCE, contribution: 2_500, realAnnual, target });

    const worldMonths = etaAt({ realAnnual: WORLD_STOCK_REAL })!;
    await expectHeroEta({ page, months: worldMonths });
    await expect(panel.getByRole('combobox')).toContainText(/≈4\.9% real/);

    const pickReturn = async ({ option }: { option: string | RegExp }) => {
      await panel.getByRole('combobox').click();
      await saveVia({ page, action: () => page.getByRole('option', { name: option }).click() });
    };

    await pickReturn({ option: /^S&P 500/ });
    const spMonths = etaAt({ realAnnual: toRealAnnual({ nominalPct: 10, inflationPct: PRESET_INFLATION_PCT }) })!;
    await expectHeroEta({ page, months: spMonths });
    expect(spMonths).toBeLessThan(worldMonths);
    await expect(panel).toContainText(/3% · built into this preset/);

    await pickReturn({ option: /^US Treasury bonds/ });
    const treasuryMonths = etaAt({ realAnnual: toRealAnnual({ nominalPct: 5, inflationPct: PRESET_INFLATION_PCT }) })!;
    await expectHeroEta({ page, months: treasuryMonths });
    expect(treasuryMonths).toBeGreaterThan(worldMonths);

    await pickReturn({ option: 'Custom' });
    const customReturn = panel.getByRole('spinbutton', { name: /return/i });
    const typed = await saveVia({
      page,
      action: async () => {
        await customReturn.clear();
        await customReturn.pressSequentially('6.5');
      },
    });
    expect(typed.request().postDataJSON()).toEqual({ fire: { customReturnPct: 6.5 } });
    await expect(customReturn).toHaveValue('6.5');
    await expectHeroEta({ page, months: etaAt({ realAnnual: toRealAnnual({ nominalPct: 6.5, inflationPct: 3 }) })! });

    const stopWatching = watchSettingsWrites({ page });
    await customReturn.clear();
    await customReturn.blur();
    expect(await stopWatching()).toEqual([]);
    await expect(customReturn).toHaveValue('6.5');
    await expect.poll(() => getFireSettings({ page })).toMatchObject({ customReturnPct: 6.5 });

    await saveVia({ page, action: () => customReturn.fill('10') });
    await expectHeroEta({ page, months: etaAt({ realAnnual: toRealAnnual({ nominalPct: 10, inflationPct: 3 }) })! });

    const inflation = panel.getByRole('slider', { name: 'Inflation' });
    await saveVia({
      page,
      action: async () => {
        await inflation.focus();
        await inflation.press('Home');
      },
    });
    await expect(panel).toContainText(/Inflation\s*0%/);
    const zeroInflationMonths = etaAt({ realAnnual: 0.1 })!;
    await expectHeroEta({ page, months: zeroInflationMonths });

    await saveVia({
      page,
      action: async () => {
        for (let i = 0; i < 5; i++) await inflation.press('ArrowRight');
      },
    });
    const shownInflation = Number((await panel.innerText()).match(/Inflation\s*([\d.]+)%/)![1]);
    expect(shownInflation).toBeGreaterThan(0);
    const higherInflationMonths = etaAt({
      realAnnual: toRealAnnual({ nominalPct: 10, inflationPct: shownInflation }),
    })!;
    await expectHeroEta({ page, months: higherInflationMonths });
    expect(higherInflationMonths).toBeGreaterThan(zeroInflationMonths);
    await expect
      .poll(() => getFireSettings({ page }))
      .toMatchObject({
        returnIndicatorId: 'custom',
        customReturnPct: 10,
        inflationPct: shownInflation,
      });

    await openFirePage({ page, fire: { returnIndicatorId: `portfolio:${randomUUID()}` } });
    await expect(page.locator('main')).toContainText('Return switched to world stocks');
    await expectHeroEta({ page, months: worldMonths });
  });

  test('zero contribution projects on growth alone', async ({ page }) => {
    await patchFireSettings({ request: page.request, fire: BASE_FIRE });
    await page.goto('/analytics/investment-calculator');
    await page.getByRole('link', { name: 'Plan for FIRE' }).click();
    await page.waitForURL(/\/analytics\/fire$/);
    await openOthers({ page });
    const panel = await openAssumptions({ page });
    await saveVia({ page, action: () => panel.getByRole('spinbutton', { name: 'Monthly contribution' }).fill('0') });

    const growthOnly = ({ target, realAnnual = WORLD_STOCK_REAL }: { target: number; realAnnual?: number }) =>
      monthsToTarget({ balance: BALANCE, contribution: 0, realAnnual, target });
    // Closed form for c = 0: n = ln(T/B) / ln(1 + monthly rate).
    const closedForm = Math.ceil(Math.log(1_000_000 / BALANCE) / Math.log(1 + toMonthly({ annual: WORLD_STOCK_REAL })));
    expect(growthOnly({ target: 1_000_000 })).toBe(closedForm);

    await expectHeroEta({ page, months: closedForm });

    // Only the -2 pt run misses the 50-year horizon, so the range stays open-ended.
    expect(growthOnly({ target: 1_000_000, realAnnual: WORLD_STOCK_REAL - 0.02 })).toBeNull();
    const earliest = growthOnly({ target: 1_000_000, realAnnual: WORLD_STOCK_REAL + 0.02 })!;
    const { range } = await readHero({ page });
    expect(range).not.toBeNull();
    expect(range!.high).toBe(`after ${NOW.getFullYear() + 50}`);
    expect([earliest - 1, earliest, earliest + 1].map((m) => monthYear({ months: m, style: 'short' }))).toContain(
      range!.low,
    );

    const regular = await readChip({ page, name: 'Regular' });
    expectMonths({ actual: regular.months, expected: closedForm });
    expect(regular.text).toMatch(/growth only/i);
    const lean = await readChip({ page, name: 'Lean' });
    expectMonths({ actual: lean.months, expected: growthOnly({ target: 700_000 })! });
  });

  test('an unreachable target explains why and what it would take', async ({ page }) => {
    await openFirePage({
      page,
      fire: { ...BASE_FIRE, monthlyContributionOverride: 0, returnIndicatorId: 'custom', customReturnPct: 2.5 },
    });

    const main = page.locator('main');
    await expect(main).toContainText(/not reachable|not within 50 years/i);
    await expect(main).toContainText(/no new savings/i);
    await expect(main).toContainText(/doesn't beat inflation/i);
    await expect(main).not.toContainText(/if returns run 2 points higher or lower/);

    const expectPmt = async ({ target }: { target: number }) => {
      const text = await pageText({ page });
      const pmt = text.match(
        /What it would take\s*(\$[\d,]+)\s*\/\s*mo(?:nth)? to reach (\$[\d,]+) in (\d+) (?:yrs|years)/i,
      );
      expect(pmt, `PMT line in: ${text.slice(0, 900)}`).not.toBeNull();
      expect(parseMoney({ text: pmt![2]! })).toBe(target);
      expect(Number(pmt![3])).toBe(UNREACHABLE_PMT_YEARS);
      const expectedPmt = requiredMonthlyContribution({
        balance: BALANCE,
        target,
        realAnnual: toRealAnnual({ nominalPct: 2.5, inflationPct: 3 }),
        months: UNREACHABLE_PMT_YEARS * 12,
      });
      expect(parseMoney({ text: pmt![1]! })).toBe(Math.round(expectedPmt));
    };
    await expectPmt({ target: 1_000_000 });

    for (const name of ['Lean', 'Regular', 'Fat']) {
      expect((await readChip({ page, name })).text).toMatch(/not within 50 yrs/);
    }
    expect((await readChip({ page, name: 'Coast' })).text).toMatch(/real return/i);

    await patchFireSettings({ request: page.request, fire: { targetType: 'lean' } });
    await page.reload();
    await expect(typeCard({ page, name: 'Lean' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(main).toContainText(/Time to Lean FIRE/i);
    await expectPmt({ target: 700_000 });
  });

  test('birth year shows the age at FIRE and drives the Coast FIRE chip', async ({ page }) => {
    await openFirePage({ page, fire: BASE_FIRE });
    const coastChip = chipLocator({ page, name: 'Coast' });
    await expect(coastChip).toContainText(/birth year/i);

    const panel = await openAssumptions({ page });
    await coastChip.getByRole('button', { name: 'Add birth year' }).click();
    const birthYear = panel.getByRole('spinbutton', { name: 'Birth year' });
    await expect(birthYear).toBeFocused();
    await saveVia({ page, action: () => birthYear.fill('1990') });

    const target = 1_000_000;
    const months = monthsToTarget({ balance: BALANCE, contribution: 2_500, realAnnual: WORLD_STOCK_REAL, target })!;
    await expectHeroEta({ page, months });
    await expect(async () => {
      const hero = await readHero({ page });
      expect(hero.age).toBe(Math.floor(ageAt({ birthYear: 1990, date: addMonths({ months: hero.months }) })));
    }).toPass({ timeout: 10_000 });

    const coastMonths = monthsUntilAge({ birthYear: 1990, age: 65 });
    const coastNumber = target / (1 + WORLD_STOCK_REAL) ** (coastMonths / 12);
    await expect(async () => {
      const coast = await readChip({ page, name: 'Coast' });
      expectCompact({ actual: coast.amount, expected: coastNumber });
      expectMonths({
        actual: coast.months,
        expected: coastHitMonth({
          balance: BALANCE,
          contribution: 2_500,
          realAnnual: WORLD_STOCK_REAL,
          target,
          coastMonths,
        })!,
      });
      expect(coast.months!).toBeLessThanOrEqual((await readChip({ page, name: 'Regular' })).months!);
    }).toPass({ timeout: 10_000 });

    // Retiring at 90 needs target / (1+r)^~54y ≈ $78K today, already below the balance.
    await saveVia({
      page,
      action: () => panel.getByRole('spinbutton', { name: 'Coast FIRE target age' }).fill('90'),
    });
    await expect(coastChip).toContainText(/reached/i);

    await saveVia({ page, action: () => birthYear.fill('1930') });
    await expect(coastChip).toContainText(/past your coast age/i);
  });

  test('already financially independent', async ({ page }) => {
    await openFirePage({
      page,
      fire: { ...BASE_FIRE, annualSpendingOverride: 3_000, monthlyContributionOverride: 500 },
    });
    const target = 3_000 / 0.04;
    const main = page.locator('main');

    await expect(main).toContainText(/financially independent|FIRE reached/i);
    await expect(main).not.toContainText(/if returns run 2 points higher or lower/);
    const text = await pageText({ page });
    expect(text).not.toMatch(/Time to FIRE/i);
    expect(text).toContain(`$${Math.round((BALANCE * 0.04) / 12).toLocaleString('en-US')}/mo`);
    expect(text).toContain(`${Math.floor(((BALANCE * 0.04) / 3_000) * 100)}% of your spending`);
    expect(text).toContain(`${Math.floor(BALANCE / 3_000)} years of spending covered`);

    const progress = await readProgress({ page });
    expectProgressAmount({ actual: progress.target, expected: target });
    expect(progress.pct).toBeCloseTo((BALANCE / target) * 100, 1);
    expect(text).toContain('FIRE target reached');
    for (const label of ['25%', '50%', '75%']) {
      expect((await readMilestone({ page, label })).text).toMatch(/Reached/);
    }

    await expect(chipLocator({ page, name: 'Lean' })).toContainText(/reached/i);
    await expect(chipLocator({ page, name: 'Regular' })).toContainText(/reached/i);
    const fat = await readChip({ page, name: 'Fat' });
    expect(fat.text).toMatch(/next/i);
    expectCompact({ actual: fat.amount, expected: target * 1.5 });
    const fatPct = Number(fat.text.match(/([\d.]+)%\s*·/)![1]);
    expect(Math.abs(fatPct - (BALANCE / (target * 1.5)) * 100)).toBeLessThanOrEqual(0.1);
    expectMonths({
      actual: fat.months,
      expected: monthsToTarget({
        balance: BALANCE,
        contribution: 500,
        realAnnual: WORLD_STOCK_REAL,
        target: target * 1.5,
      })!,
    });

    await openFirePage({ page, fire: { monthlyContributionOverride: -500 } });
    await expect(main).toContainText(/drawing down about \$500(\.00)?\s*\/\s*mo/i);
  });

  test('part-time income sets the Barista FIRE target and a pending edit saves on leave', async ({ page }) => {
    await openFirePage({ page, fire: BASE_FIRE });
    const baristaChip = chipLocator({ page, name: 'Barista' });
    await expect(baristaChip).toContainText(/add part-time income/i);

    const panel = await openAssumptions({ page });
    await baristaChip.getByRole('button', { name: 'Add part-time income' }).click();
    const partTime = panel.getByRole('spinbutton', { name: /part-time income/i });
    await expect(partTime).toBeFocused();
    await saveVia({ page, action: () => partTime.fill('1000') });

    const target = (40_000 - 12 * 1_000) / 0.04;
    await expect(async () => {
      const barista = await readChip({ page, name: 'Barista' });
      expectCompact({ actual: barista.amount, expected: target });
      expectMonths({
        actual: barista.months,
        expected: monthsToTarget({ balance: BALANCE, contribution: 2_500, realAnnual: WORLD_STOCK_REAL, target })!,
      });
    }).toPass({ timeout: 10_000 });
    await expectFireNumber({ page, target: 1_000_000 });

    const flushed = page.waitForRequest(
      (request) => request.method() === 'PATCH' && request.url().includes('/api/v1/user/settings'),
    );
    await panel.getByRole('spinbutton', { name: 'Fat FIRE multiplier' }).fill('2');
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    expect((await flushed).postDataJSON()).toEqual({ fire: { fatMultiplier: 2 } });
    await expect.poll(() => getFireSettings({ page })).toMatchObject({ fatMultiplier: 2 });

    await openFirePage({ page });
    await expect(async () => {
      const fat = await readChip({ page, name: 'Fat' });
      expectCompact({ actual: fat.amount, expected: 2 * 1_000_000 });
      expect(fat.text).toContain('200% of your spending');
    }).toPass({ timeout: 10_000 });
  });

  test('phone width keeps the key numbers visible without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirePage({ page, fire: BASE_FIRE });

    const months = monthsToTarget({
      balance: BALANCE,
      contribution: 2_500,
      realAnnual: WORLD_STOCK_REAL,
      target: 1_000_000,
    })!;
    await expectHeroEta({ page, months });
    await expect(page.getByText('Time to FIRE', { exact: true })).toBeInViewport();
    await expect(page.getByText(`$${BALANCE / 1_000}K of $1M`).first()).toBeVisible();
    await expect(chipLocator({ page, name: 'Regular' })).toBeVisible();

    const overflow = await page.evaluate(() => {
      const widest = [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => {
          const style = getComputedStyle(el);
          return el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(style.overflowX);
        })
        .map((el) => `${el.tagName}.${el.className}`.slice(0, 120));
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollers: widest,
      };
    });
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.scrollers).toEqual([]);

    const panel = await openAssumptions({ page });
    await expectSelectedPill({ selected: panel.getByRole('button', { name: '4.0%', exact: true }) });
  });

  test('Lean, Regular and Fat cards each become the headline target', async ({ page }) => {
    await openFirePage({ page, fire: { ...BASE_FIRE, birthYear: 1990 } });
    const eta = ({ target }: { target: number }) =>
      monthsToTarget({ balance: BALANCE, contribution: 2_500, realAnnual: WORLD_STOCK_REAL, target })!;
    const coastMonths = monthsUntilAge({ birthYear: 1990, age: 65 });

    await expect(typeCard({ page, name: 'Regular' })).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Barista', 'Coast']) {
      await expect(typeCard({ page, name })).toHaveCount(0);
      await expect(chipLocator({ page, name }).locator('[aria-pressed]')).toHaveCount(0);
    }
    const stopWatching = watchSettingsWrites({ page });
    await chipLocator({ page, name: 'Coast' }).click();
    await chipLocator({ page, name: 'Barista' }).getByText('Barista FIRE').click();
    expect(await stopWatching()).toEqual([]);
    await expect(typeCard({ page, name: 'Regular' })).toHaveAttribute('aria-pressed', 'true');

    const expectHeadline = async ({ name, label, target }: (typeof TARGET_TYPES)[number] & { target: number }) => {
      for (const other of TARGET_TYPES) {
        await expect(typeCard({ page, name: other.name })).toHaveAttribute(
          'aria-pressed',
          String(other.name === name),
          { timeout: 15_000 },
        );
      }
      await expectHeroEta({ page, months: eta({ target }), type: label });
      const text = await pageText({ page });
      for (const other of TARGET_TYPES.filter((t) => t.name !== name)) {
        expect(text).not.toMatch(new RegExp(`Time to ${other.label}\\b`, 'i'));
      }
      const hero = await readHero({ page, type: label });
      expect(hero.months).toBe((await readChip({ page, name })).months);

      await expectFireNumber({ page, target, type: label });
      expect((await readProgress({ page, type: label })).pct).toBeCloseTo((BALANCE / target) * 100, 1);

      for (const [milestone, share] of [
        ['25%', 0.25],
        ['50%', 0.5],
        ['75%', 0.75],
        [label, 1],
      ] as const) {
        expectMonths({
          actual: (await readMilestone({ page, label: milestone })).months,
          expected: eta({ target: target * share }),
        });
      }

      const chart = squash({ text: (await page.getByRole('img', { name: /projected path/i }).textContent()) ?? '' });
      const chartTarget = chart.match(/(?:(Lean|Regular|Fat) )?FIRE · (\$[\d.,]+[KM]?)/);
      expect(chartTarget, chart).not.toBeNull();
      expect(chartTarget![1] ? `${chartTarget![1]} FIRE` : 'FIRE').toBe(label);
      expectCompact({ actual: parseCompact({ text: chartTarget![2]! }), expected: target });

      const coast = await readChip({ page, name: 'Coast' });
      expectCompact({ actual: coast.amount, expected: target / (1 + WORLD_STOCK_REAL) ** (coastMonths / 12) });
      expectMonths({
        actual: coast.months,
        expected: coastHitMonth({
          balance: BALANCE,
          contribution: 2_500,
          realAnnual: WORLD_STOCK_REAL,
          target,
          coastMonths,
        })!,
      });
    };

    for (const type of TARGET_TYPES) {
      const saved = await saveVia({ page, action: () => typeCard({ page, name: type.name }).click() });
      expect(saved.request().postDataJSON()).toEqual({ fire: { targetType: type.type } });
      await expectHeadline({ ...type, target: 1_000_000 * type.multiplier });
      await expect.poll(() => getFireSettings({ page })).toMatchObject({ targetType: type.type });
    }

    const lean = TARGET_TYPES[0];
    await typeCard({ page, name: lean.name }).focus();
    const byKeyboard = await saveVia({ page, action: () => page.keyboard.press('Enter') });
    expect(byKeyboard.request().postDataJSON()).toEqual({ fire: { targetType: lean.type } });
    await page.reload();
    await openOthers({ page });
    await expectHeadline({ ...lean, target: 1_000_000 * lean.multiplier });
    await patchFireSettings({ request: page.request, fire: { targetType: 'regular' } });
  });

  test('phone width collapses the other types by default and remembers the choice', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirePage({ page, fire: BASE_FIRE, others: false });
    const trigger = othersTrigger({ page });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: 15_000 });
    await expect(chipLocator({ page, name: 'Lean' })).toHaveCount(0);
    await expect(chipLocator({ page, name: 'Regular' })).toBeVisible();
    await expect(typeCard({ page, name: 'Regular' })).toHaveAttribute('aria-pressed', 'true');

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(trigger).toBeHidden();
    await expect(chipLocator({ page, name: 'Lean' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(chipLocator({ page, name: 'Lean' })).toBeVisible();

    await page.reload();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 });
    await expect(chipLocator({ page, name: 'Lean' })).toBeVisible();

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: 15_000 });
    await expect(chipLocator({ page, name: 'Lean' })).toHaveCount(0);
  });
});

// ─── Brand-new user ──────────────────────────────────────────────────

const emptyCreds = buildTestCredentials({ prefix: 'fire-empty' });

test.describe('FIRE planner without any data', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the widget leads to setup, and two numbers turn into a plan', async ({ page }) => {
    await signUpAndVerify({ creds: emptyCreds });
    await loginViaUI({ page, email: emptyCreds.email, password: emptyCreds.password });
    const request = page.request;
    await completeOnboarding({ request, currencyCode: CURRENCY });
    await apiPatch({
      request,
      path: '/api/v1/user/settings',
      data: { dashboard: { widgets: [{ widgetId: 'fire-progress', colSpan: 1, rowSpan: 1 }] } },
    });

    await openFirePage({ page, others: false });

    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: /plan your path to financial independence/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(main.getByRole('link', { name: 'Add an account' })).toBeVisible();
    await expect(main).not.toContainText(/Time to FIRE\s*\d/i);

    const panel = await openAssumptions({ page });
    const spending = panel.getByRole('spinbutton', { name: 'Yearly spending in retirement' });
    const spendingToggle = panel.getByRole('button', { name: /^Yearly spending in retirement/ });
    await spendingToggle.click();
    await expect(spending).toBeHidden();
    await main.getByRole('button', { name: 'Enter spending' }).click();
    await expect(spendingToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(spending).toBeFocused();
    await saveVia({ page, action: () => spending.fill('40000') });
    await expect(main).toContainText(/Saving:\s*\$0\/mo/);
    await expect(main).not.toContainText(/\$0\/mo\s*Auto/);
    await expect(page.getByRole('img', { name: /projected path/i })).toHaveCount(0);

    const balance = 1_000;
    const accountId = extractId(
      await createAccount({ request, name: 'Savings', currencyCode: CURRENCY, initialBalance: 0 }),
    );
    await createTransaction({
      request,
      accountId,
      amount: balance,
      transactionType: 'income',
      time: pastMonthIso({ monthsAgo: 1 }),
    });
    await patchFireSettings({ request: page.request, fire: { annualSpendingOverride: null } });

    // The dashboard shows onboarding until an account exists, so the widget's setup state comes after one.
    await page.goto('/dashboard');
    await expect(page.getByText('Plan your path to FIRE', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Set up', exact: true }).click();
    await page.waitForURL(/\/analytics\/fire$/);
    await expect(main.getByRole('heading', { name: 'Only 1 full month of transactions' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(main.getByRole('link', { name: 'Add an account' })).toHaveCount(0);

    await main.getByRole('button', { name: 'Enter spending' }).click();
    await expect(spending).toBeFocused();
    await saveVia({ page, action: () => spending.fill('40000') });
    await saveVia({ page, action: () => panel.getByRole('spinbutton', { name: 'Monthly contribution' }).fill('1500') });

    await expectFireNumber({ page, target: 1_000_000 });
    expectProgressAmount({ actual: (await readProgress({ page })).balance, expected: balance });
    await expectHeroEta({
      page,
      months: monthsToTarget({ balance, contribution: 1_500, realAnnual: WORLD_STOCK_REAL, target: 1_000_000 })!,
    });
  });
});

// ─── Failures and callouts ───────────────────────────────────────────

async function signUpWithHistory({
  page,
  prefix,
  monthlyIncome,
}: {
  page: Page;
  prefix: string;
  monthlyIncome: number;
}) {
  const userCreds = buildTestCredentials({ prefix });
  await signUpAndVerify({ creds: userCreds });
  await loginViaUI({ page, email: userCreds.email, password: userCreds.password });
  const request = page.request;
  await completeOnboarding({ request, currencyCode: CURRENCY });
  const accountId = extractId(
    await createAccount({ request, name: 'Savings', currencyCode: CURRENCY, initialBalance: INITIAL_BALANCE }),
  );
  for (let monthsAgo = 1; monthsAgo <= SEEDED_MONTHS; monthsAgo++) {
    const time = pastMonthIso({ monthsAgo });
    await createTransaction({ request, accountId, amount: monthlyIncome, transactionType: 'income', time });
    await createTransaction({ request, accountId, amount: MONTHLY_EXPENSE, time });
  }
}

test.describe('FIRE planner failures and callouts', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a failed save keeps an error toast whose Retry saves the edit', async ({ page }) => {
    await signUpWithHistory({ page, prefix: 'fire-save', monthlyIncome: MONTHLY_INCOME });
    await openFirePage({ page, others: false });
    const panel = await openAssumptions({ page });

    const settingsUrl = /\/api\/v1\/user\/settings/;
    await page.route(settingsUrl, (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 500, body: '' }) : route.fallback(),
    );
    const failed = waitForSave({ page });
    await panel.getByRole('button', { name: '4.5%', exact: true }).click();
    expect((await failed).status()).toBe(500);

    const retry = page.locator('[data-sonner-toast][data-type="error"]').getByRole('button', { name: /^try again$/i });
    await expect(retry).toBeVisible();
    expect(await getFireSettings({ page })).not.toMatchObject({ withdrawalRatePct: 4.5 });

    await page.unroute(settingsUrl);
    const saved = await saveVia({ page, action: () => retry.click() });
    expect(saved.request().postDataJSON()).toEqual({ fire: { withdrawalRatePct: 4.5 } });
    await expect(retry).toBeHidden();

    await page.reload();
    const reloadedPanel = await openAssumptions({ page });
    await expect(reloadedPanel.getByRole('button', { name: '4.5%', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('spending above income flags the clamped contribution until one is entered', async ({ page }) => {
    await signUpWithHistory({ page, prefix: 'fire-clamp', monthlyIncome: 2_000 });
    await openFirePage({ page, others: false });
    const panel = page.getByRole('complementary');

    const enterContribution = page.locator('main').getByRole('button', { name: /^enter (a )?contribution$/i });
    await expect(enterContribution).toBeVisible({ timeout: 15_000 });
    await enterContribution.click();
    const contribution = panel.getByRole('spinbutton', { name: 'Monthly contribution' });
    await expect(contribution).toBeFocused();
    await saveVia({ page, action: () => contribution.fill('500') });
    await expect(enterContribution).toHaveCount(0);

    const backToAuto = await saveVia({
      page,
      action: () => panel.getByRole('button', { name: /^Back to auto \(\$0/ }).click(),
    });
    expect(backToAuto.request().postDataJSON()).toEqual({ fire: { monthlyContributionOverride: null } });
    await expect(enterContribution).toBeVisible();
  });

  test('a return-fallback callout can only be hidden for the session', async ({ page }) => {
    await signUpWithHistory({ page, prefix: 'fire-callout', monthlyIncome: MONTHLY_INCOME });
    await openFirePage({ page, fire: { returnIndicatorId: 'custom', customReturnPct: null }, others: false });
    const main = page.locator('main');
    const hide = main.getByRole('button', { name: /^hide/i });
    const dialog = page.getByRole('alertdialog');

    await expect(hide).toBeVisible({ timeout: 15_000 });
    await hide.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await dialog.getByRole('button').last().click();
    await expect(dialog).toBeHidden();
    await expect(hide).toHaveCount(0);

    await page.reload();
    await expect(hide).toBeVisible({ timeout: 15_000 });
  });

  test('a failed load offers Retry, which brings the plan back', async ({ page }) => {
    await signUpWithHistory({ page, prefix: 'fire-load', monthlyIncome: MONTHLY_INCOME });
    const cashFlowUrl = /\/api\/v1\/stats\/cash-flow/;
    await page.route(cashFlowUrl, (route) => route.fulfill({ status: 500, body: '' }));
    await openFirePage({ page, others: false });

    const retry = page.locator('main').getByRole('button', { name: /^try again$/i });
    // The query client retries with backoff before the error surfaces.
    await expect(retry).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('main')).not.toContainText(/Time to FIRE/i);

    await page.unroute(cashFlowUrl);
    await retry.click();
    await expect(page.locator('main')).toContainText(/Time to FIRE/i, { timeout: 15_000 });
  });
});
