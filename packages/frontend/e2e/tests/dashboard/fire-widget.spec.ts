import { type Locator, type Page, expect, test } from '@playwright/test';

import {
  completeOnboarding,
  createAccount,
  createCategory,
  createTransaction,
  extractId,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import {
  DURATION,
  WORLD_STOCK_REAL,
  addMonths,
  ageAt,
  expectMonths,
  monthYear,
  monthsToTarget,
  parseCompact,
  parseDuration,
  pastMonthIso,
  patchFireSettings,
  requiredMonthlyContribution,
  squash,
  toRealAnnual,
} from '../../helpers/fire';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

// Expected numbers come from the FIRE spec defaults and standard finance: spending and saving
// derived from the seeded months, 4% withdrawal rate, world-stock preset 8% nominal / 3% inflation.

const CURRENCY = 'USD';
const INITIAL_BALANCE = 100_000;
const MONTHLY_INCOME = 5_000;
const MONTHLY_EXPENSE = 3_000;
const SEEDED_MONTHS = 4;
const BALANCE = INITIAL_BALANCE + SEEDED_MONTHS * (MONTHLY_INCOME - MONTHLY_EXPENSE);
const CONTRIBUTION = MONTHLY_INCOME - MONTHLY_EXPENSE;
const TARGET = (MONTHLY_EXPENSE * 12) / 0.04;

const fireMonths = ({ target }: { target: number }) =>
  monthsToTarget({ balance: BALANCE, contribution: CONTRIBUTION, realAnnual: WORLD_STOCK_REAL, target })!;

const FIRE_MONTHS = fireMonths({ target: TARGET });
const NEXT_MILESTONE_MONTHS = fireMonths({ target: TARGET * 0.25 });
const PROGRESS_PCT = Math.round((BALANCE / TARGET) * 100);

// ─── UI readers ──────────────────────────────────────────────────────

const expectMonthsIn = ({ text, expected }: { text: string; expected: number }) => {
  const match = text.match(new RegExp(DURATION));
  expect(match, `duration in "${text}"`).not.toBeNull();
  expectMonths({ actual: parseDuration({ text: match![0] }), expected });
};

const fireHeading = ({ page }: { page: Page }) => page.getByRole('heading', { name: 'FIRE progress', level: 3 });

const widgetOf = ({ page, widgetId }: { page: Page; widgetId: string }) =>
  page.locator(`[data-widget-id="${widgetId}"]`);

const fireWidget = ({ page }: { page: Page }) => widgetOf({ page, widgetId: 'fire-progress' });

const widgetText = async ({ widget }: { widget: Locator }) => squash({ text: await widget.innerText() });

async function widgetWidthInColumns({ page }: { page: Page }): Promise<number> {
  const single = await widgetOf({ page, widgetId: 'subscriptions-overview' }).boundingBox();
  const fire = await fireWidget({ page }).boundingBox();
  if (!single || !fire) throw new Error('Widget boxes not measurable');
  return fire.width / single.width;
}

async function expectColumns({ page, columns }: { page: Page; columns: 1 | 2 }) {
  await expect.poll(() => widgetWidthInColumns({ page })).toBeGreaterThan(columns - 0.1);
  await expect.poll(() => widgetWidthInColumns({ page })).toBeLessThan(columns + 0.2);
}

async function enterEditMode({ page }: { page: Page }) {
  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
}

async function saveLayout({ page }: { page: Page }) {
  const saved = page.waitForResponse(
    (response) => response.url().includes('/api/v1/user/settings') && response.request().method() !== 'GET',
  );
  await page.getByRole('button', { name: 'Done' }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible({ timeout: 30_000 });
}

async function openDashboard({ page }: { page: Page }) {
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible({ timeout: 15_000 });
}

async function expectRingDesign({ page, size }: { page: Page; size: 1 | 2 }) {
  const widget = fireWidget({ page });
  const ring = widget.getByRole('img', { name: /of FIRE target reached/ });
  await expect(ring).toBeVisible({ timeout: 15_000 });
  await expect(ring).toHaveAccessibleName(new RegExp(`^${PROGRESS_PCT}% of FIRE target reached, (${DURATION}) left$`));
  expectMonthsIn({ text: (await ring.getAttribute('aria-label')) ?? '', expected: FIRE_MONTHS });
  await expect(ring).toContainText(new RegExp(`${PROGRESS_PCT}%\\s*to FIRE`, 'i'));
  await expect(widget.getByRole('img', { name: /net worth path/i })).toHaveCount(0);

  const text = await widgetText({ widget });
  expect(text).toMatch(/Time to FIRE/i);
  expectMonthsIn({ text: text.split(/Time to FIRE/i)[1]!, expected: FIRE_MONTHS });
  expect(text).toContain(monthYear({ months: FIRE_MONTHS, style: 'long' }));
  const saved = text.match(/Saved\s*(\$[\d.,]+[kKM]?) of (\$[\d.,]+[kKM]?)/);
  expect(saved, text).not.toBeNull();
  expect(parseCompact({ text: saved![1]! })).toBeCloseTo(BALANCE, -3);
  expect(parseCompact({ text: saved![2]! })).toBeCloseTo(TARGET, -3);
  expect(text).toMatch(/Next milestone\s*25% in/);
  expectMonthsIn({ text: text.split(/Next milestone\s*25% in/)[1]!, expected: NEXT_MILESTONE_MONTHS });
  expect(text).toContain(monthYear({ months: NEXT_MILESTONE_MONTHS, style: 'short' }));
  const fireNumber = text.match(/FIRE number\s*(\$[\d.,]+[kKM]?) at 4\.0%/);
  expect(fireNumber, text).not.toBeNull();
  expect(parseCompact({ text: fireNumber![1]! })).toBeCloseTo(TARGET, -3);

  const milestones = widget.getByRole('list', { name: '0 of 4 milestones' });
  if (size === 1) {
    expect(text).not.toMatch(/0 of 4 milestones/i);
    await expect(milestones).toHaveCount(0);
    return;
  }
  expect(text).toMatch(/0 of 4 milestones/i);
  await expect(milestones).toBeVisible();
  await expect(milestones).toContainText('Today');
  await expect(milestones).toContainText(monthYear({ months: FIRE_MONTHS, style: 'short' }));
}

async function expectNumbersDesign({ page, size }: { page: Page; size: 1 | 2 }) {
  const widget = fireWidget({ page });
  await expect(widget.getByText(/Time to FIRE/i)).toBeVisible({ timeout: 15_000 });
  await expect(widget.getByRole('img', { name: /of FIRE target reached/ })).toHaveCount(0);

  const text = await widgetText({ widget });
  expectMonthsIn({ text: text.split(/Time to FIRE/i)[1]!, expected: FIRE_MONTHS });
  expect(text).toContain(monthYear({ months: FIRE_MONTHS, style: 'long' }));
  const progress = text.match(/Progress\s*(\d+)%/i);
  expect(progress, text).not.toBeNull();
  expect(Number(progress![1])).toBe(PROGRESS_PCT);
  expect(text).not.toMatch(/\d+%\s*·\s*\$/);
  const saved = text.match(/(\$[\d.,]+[kKM]?) of (\$[\d.,]+[kKM]?)/);
  expect(saved, text).not.toBeNull();
  expect(parseCompact({ text: saved![1]! })).toBeCloseTo(BALANCE, -3);
  expect(parseCompact({ text: saved![2]! })).toBeCloseTo(TARGET, -3);
  const fireNumber = text.match(/FIRE number\s*(\$[\d.,]+[kKM]?) at 4\.0%/);
  expect(fireNumber, text).not.toBeNull();
  expect(parseCompact({ text: fireNumber![1]! })).toBeCloseTo(TARGET, -3);
  expect(text).toContain(monthYear({ months: NEXT_MILESTONE_MONTHS, style: 'short' }));

  const chart = widget.getByRole('img', { name: /net worth path/i });
  const timeline = widget.getByRole('list', { name: '0 of 4 milestones' });
  if (size === 1) {
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText('Today');
    await expect(chart).toHaveCount(0);
    return;
  }
  expect(text).toMatch(/Next milestone\s*25% in/);
  expectMonthsIn({ text: text.split(/Next milestone\s*25% in/)[1]!, expected: NEXT_MILESTONE_MONTHS });
  await expect(chart).toBeVisible();
  const chartText = squash({ text: (await chart.textContent()) ?? '' });
  expect(chartText).toMatch(/FIRE · \$[\d.,]+[kKM]?/);
  expect(parseCompact({ text: chartText.match(/FIRE · (\$[\d.,]+[kKM]?)/)![1]! })).toBeCloseTo(TARGET, -3);
  expect(chartText).toContain('Today');
  expect(chartText).toContain('25%');
}

async function readFirePage({ page, type = 'FIRE' }: { page: Page; type?: string }) {
  await page.goto('/analytics/fire');
  const main = page.locator('main');
  await expect(main.getByText(new RegExp(`Progress to ${type}`))).toBeVisible({ timeout: 15_000 });
  const text = squash({ text: await main.innerText() });
  const hero = text.match(new RegExp(`Time to ${type}\\s*(${DURATION})`, 'i'));
  const progress = text.match(new RegExp(`Progress to ${type}\\s*([\\d.]+)%`));
  if (!hero || !progress) throw new Error(`FIRE page values not found in: ${text.slice(0, 600)}`);
  return { months: parseDuration({ text: hero[1]! }), pct: Number(progress[1]) };
}

// ─── Tests ───────────────────────────────────────────────────────────

const creds = buildTestCredentials({ prefix: 'firew' });
let seeded = false;

test.describe('FIRE progress widget', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: { width: 1440, height: 1600 } });

  test.beforeAll(async () => {
    await signUpAndVerify({ creds });
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    if (seeded) return;

    const request = page.request;
    await completeOnboarding({ request, currencyCode: CURRENCY });
    const accountId = extractId(
      await createAccount({ request, name: 'Savings', currencyCode: CURRENCY, initialBalance: INITIAL_BALANCE }),
    );
    const salaryId = extractId(await createCategory({ request, name: 'FIRE Salary', color: '#2e7d32' }));
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
      await createTransaction({ request, accountId, amount: MONTHLY_EXPENSE, time });
    }
    seeded = true;
  });

  test('added in edit mode it defaults to the Ring design at 1×1', async ({ page }) => {
    await openDashboard({ page });
    await expect(fireHeading({ page })).toHaveCount(0);

    await enterEditMode({ page });
    await page.getByRole('button', { name: /^FIRE progress/ }).click();

    const widget = fireWidget({ page });
    await expect(widget).toBeVisible();
    await expect(widget.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Ring' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(widget.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Numbers' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expectColumns({ page, columns: 1 });
    await expectRingDesign({ page, size: 1 });

    await saveLayout({ page });
    await page.reload();
    await expectRingDesign({ page, size: 1 });
    await expectColumns({ page, columns: 1 });
  });

  test('both designs render at 1×1 and 2×1 and the choice persists', async ({ page }) => {
    await openDashboard({ page });
    await enterEditMode({ page });
    const widget = fireWidget({ page });
    const style = widget.getByRole('group', { name: 'Style' });

    await widget.getByRole('button', { name: '2×1' }).click();
    await expectColumns({ page, columns: 2 });
    await expectRingDesign({ page, size: 2 });

    await style.getByRole('button', { name: 'Numbers' }).click();
    await expect(style.getByRole('button', { name: 'Numbers' })).toHaveAttribute('aria-pressed', 'true');
    await expect(style.getByRole('button', { name: 'Ring' })).toHaveAttribute('aria-pressed', 'false');
    await expectNumbersDesign({ page, size: 2 });

    await widget.getByRole('button', { name: '1×1' }).click();
    await expectColumns({ page, columns: 1 });
    await expectNumbersDesign({ page, size: 1 });

    await saveLayout({ page });
    await page.reload();
    await expectNumbersDesign({ page, size: 1 });
    await expectColumns({ page, columns: 1 });

    await enterEditMode({ page });
    await expect(fireWidget({ page }).getByRole('button', { name: 'Numbers' })).toHaveAttribute('aria-pressed', 'true');
    await fireWidget({ page }).getByRole('button', { name: '2×1' }).click();
    await saveLayout({ page });
    await page.reload();
    await expectNumbersDesign({ page, size: 2 });
    await expectColumns({ page, columns: 2 });

    await enterEditMode({ page });
    await fireWidget({ page }).getByRole('button', { name: 'Ring' }).click();
    await expectRingDesign({ page, size: 2 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();
    await expectNumbersDesign({ page, size: 2 });
    await page.reload();
    await expectNumbersDesign({ page, size: 2 });
  });

  test('the Ring shows the age, Coast, reached and unreachable states', async ({ page }) => {
    const widget = fireWidget({ page });
    const ring = widget.getByRole('img', { name: /FIRE target reached/ });
    const reloadWith = async ({ fire }: { fire: Record<string, unknown> }) => {
      await patchFireSettings({ request: page.request, fire });
      await page.reload();
      await expect(ring).toBeVisible({ timeout: 15_000 });
    };

    await openDashboard({ page });
    await enterEditMode({ page });
    await widget.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Ring' }).click();
    await saveLayout({ page });

    await reloadWith({ fire: { birthYear: 1990, coastTargetAge: 90 } });
    await expect(widget).toContainText(/Coast FIRE\s*Reached/);
    const text = await widgetText({ widget });
    const months = parseDuration({ text: text.split(/Time to FIRE/i)[1]!.match(new RegExp(DURATION))![0] });
    expect(Math.abs(months - FIRE_MONTHS)).toBeLessThanOrEqual(1);
    const age = Math.floor(ageAt({ birthYear: 1990, date: addMonths({ months }) }));
    expect(text).toContain(`${monthYear({ months, style: 'long' })} · at age ${age}`);

    const reachedSpending = 3_000;
    const monthlyIncome = (BALANCE * 0.04) / 12;
    await reloadWith({ fire: { annualSpendingOverride: reachedSpending } });
    await expect(ring).toHaveAccessibleName('FIRE target reached');
    await expect(widget).toContainText('FIRE reached');
    await expect(widget).toContainText(
      `Supports $${Math.round(monthlyIncome)}/mo · ${Math.round(((monthlyIncome * 12) / reachedSpending) * 100)}% of spending`,
    );

    await reloadWith({
      fire: {
        annualSpendingOverride: null,
        monthlyContributionOverride: 0,
        returnIndicatorId: 'custom',
        customReturnPct: 2.5,
      },
    });
    await expect(ring).toHaveAccessibleName(
      `${Math.floor((BALANCE / TARGET) * 100)}% of FIRE target reached, not reachable at your current pace`,
    );
    await expect(widget).toContainText('Not reachable at current savings');
    const pmt = requiredMonthlyContribution({
      balance: BALANCE,
      target: TARGET,
      realAnnual: toRealAnnual({ nominalPct: 2.5, inflationPct: 3 }),
      months: 20 * 12,
    });
    await expect(widget).toContainText(
      `Needs about $${Math.round(pmt).toLocaleString('en-US')}/mo to get there in 20 yrs`,
    );

    await patchFireSettings({
      request: page.request,
      fire: {
        monthlyContributionOverride: null,
        returnIndicatorId: 'world-stock',
        customReturnPct: null,
        birthYear: null,
        coastTargetAge: 65,
      },
    });
  });

  test('edit mode blocks navigation from the widget while drag, resize and style keep working', async ({ page }) => {
    await openDashboard({ page });
    await enterEditMode({ page });
    const widget = fireWidget({ page });
    const dashboardUrl = page.url();

    const body = await widget.getByRole('img', { name: /of FIRE target reached/ }).boundingBox();
    expect(body).not.toBeNull();
    await page.mouse.click(body!.x + body!.width / 2, body!.y + body!.height / 2);
    const headerLink = await widget.getByRole('link', { name: 'Open FIRE plan' }).boundingBox();
    expect(headerLink).not.toBeNull();
    await page.mouse.click(headerLink!.x + headerLink!.width / 2, headerLink!.y + headerLink!.height / 2);
    await expect(page).not.toHaveURL(/analytics\/fire/);
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

    const headings = page.getByRole('heading', { level: 3 });
    const titlesBefore = await headings.allInnerTexts();
    const indexBefore = titlesBefore.findIndex((title) => title.includes('FIRE progress'));
    expect(indexBefore).toBeGreaterThan(0);

    const handle = await widget.locator('.drag-handle').boundingBox();
    const dropTarget = await widgetOf({ page, widgetId: 'subscriptions-overview' }).boundingBox();
    expect(handle).not.toBeNull();
    expect(dropTarget).not.toBeNull();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(dropTarget!.x + dropTarget!.width / 2, dropTarget!.y + dropTarget!.height / 3, {
      steps: 20,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await headings.allInnerTexts()).findIndex((title) => title.includes('FIRE progress')))
      .toBeLessThan(indexBefore);
    expect(page.url()).toBe(dashboardUrl);

    await widget.getByRole('button', { name: '2×1' }).click();
    await expectColumns({ page, columns: 2 });
    await widget.getByRole('button', { name: '1×1' }).click();
    await expectColumns({ page, columns: 1 });
    expect(page.url()).toBe(dashboardUrl);

    await saveLayout({ page });
    await page.reload();
    await expect(headings).toHaveCount(titlesBefore.length, { timeout: 15_000 });
    const indexAfterReload = (await headings.allInnerTexts()).findIndex((title) => title.includes('FIRE progress'));
    expect(indexAfterReload).toBeLessThan(indexBefore);

    const ring = await fireWidget({ page })
      .getByRole('img', { name: /of FIRE target reached/ })
      .boundingBox();
    expect(ring).not.toBeNull();
    await page.mouse.click(ring!.x + ring!.width / 2, ring!.y + ring!.height / 2);
    await page.waitForURL(/\/analytics\/fire$/);
  });

  test('the FIRE page "Add to dashboard" call to action adds the widget', async ({ page }) => {
    await openDashboard({ page });
    await enterEditMode({ page });
    // Async banners above the grid can shift it between Playwright's stability check and the click.
    await expect(async () => {
      await fireWidget({ page }).getByRole('button', { name: 'Remove widget' }).click({ timeout: 2_000 });
      await expect(fireHeading({ page })).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await saveLayout({ page });

    await page.goto('/analytics/fire');
    const cta = page.getByRole('button', { name: 'Add to dashboard' });
    await expect(cta).toBeVisible({ timeout: 15_000 });

    const saved = page.waitForResponse(
      (response) => response.url().includes('/api/v1/user/settings') && response.request().method() !== 'GET',
    );
    await cta.click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect(JSON.stringify(response.request().postDataJSON())).toContain('fire-progress');
    await expect(cta).toBeHidden();
    await page.reload();
    await expect(page.getByText(/Progress to FIRE/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Add to dashboard' })).toHaveCount(0);

    await openDashboard({ page });
    await expect(fireWidget({ page }).getByRole('img', { name: /of FIRE target reached/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('after picking Lean on the page both designs show its progress and time', async ({ page }) => {
    const leanTarget = TARGET * 0.7;
    await page.goto('/analytics/fire');
    const leanCard = page.getByRole('button', { name: /^Lean FIRE/ });
    await expect(leanCard).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
    const saved = page.waitForResponse(
      (response) => response.url().includes('/api/v1/user/settings') && response.request().method() === 'PATCH',
    );
    await leanCard.click();
    expect((await saved).ok()).toBe(true);
    await expect(leanCard).toHaveAttribute('aria-pressed', 'true');

    const fromPage = await readFirePage({ page, type: 'Lean FIRE' });
    expect(Math.abs(fromPage.months - fireMonths({ target: leanTarget }))).toBeLessThanOrEqual(1);
    expect(fromPage.pct).toBeCloseTo((BALANCE / leanTarget) * 100, 1);
    const pct = Math.round(fromPage.pct);
    const monthsIn = ({ text }: { text: string }) => parseDuration({ text: text.match(new RegExp(DURATION))![0] });

    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible({ timeout: 15_000 });
    const widget = fireWidget({ page });
    const ring = widget.getByRole('img', { name: /of Lean FIRE target reached/ });
    const expectRing = async () => {
      await expect(ring).toContainText(new RegExp(`^\\s*${pct}%\\s*to Lean FIRE\\s*$`, 'i'), { timeout: 15_000 });
      const label = (await ring.getAttribute('aria-label')) ?? '';
      expect(Number(label.match(/^(\d+)%/)![1])).toBe(pct);
      expect(monthsIn({ text: label })).toBe(fromPage.months);
    };
    const expectLeanTarget = ({ text, pattern }: { text: string; pattern: RegExp }) => {
      const match = text.match(pattern);
      expect(match, text).not.toBeNull();
      expect(parseCompact({ text: match![1]! })).toBeCloseTo(leanTarget, -3);
    };

    await expectRing();
    let text = await widgetText({ widget });
    expect(monthsIn({ text: text.split(/Time to Lean FIRE/i)[1]! })).toBe(fromPage.months);

    await enterEditMode({ page });
    await widget.getByRole('button', { name: '2×1' }).click();
    await expect(widget.getByText(/Time to Lean FIRE/i)).toBeVisible();
    await expectRing();
    text = await widgetText({ widget });
    expect(text).not.toMatch(/Time to FIRE/i);
    expect(monthsIn({ text: text.split(/Time to Lean FIRE/i)[1]! })).toBe(fromPage.months);
    expectLeanTarget({ text, pattern: /Saved\s*\$[\d.,]+[kKM]? of (\$[\d.,]+[kKM]?)/ });
    expectLeanTarget({ text, pattern: /Lean FIRE number\s*(\$[\d.,]+[kKM]?) at 4\.0%/ });

    await widget.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Numbers' }).click();
    await expect(ring).toHaveCount(0);
    for (const size of ['2×1', '1×1']) {
      await widget.getByRole('button', { name: size }).click();
      await expect(widget.getByText(/Time to Lean FIRE/i)).toBeVisible();
      text = await widgetText({ widget });
      expect(text).not.toMatch(/Time to FIRE/i);
      expect(monthsIn({ text: text.split(/Time to Lean FIRE/i)[1]! })).toBe(fromPage.months);
      expect(Number(text.match(/Progress\s*(\d+)%/i)![1])).toBe(pct);
      expectLeanTarget({ text, pattern: /\$[\d.,]+[kKM]? of (\$[\d.,]+[kKM]?)/ });
      if (size === '2×1') {
        const chart = squash({
          text: (await widget.getByRole('img', { name: /net worth path/i }).textContent()) ?? '',
        });
        expectLeanTarget({ text: chart, pattern: /Lean FIRE · (\$[\d.,]+[kKM]?)/ });
      }
    }

    await page.getByRole('button', { name: 'Cancel' }).click();
    await patchFireSettings({ request: page.request, fire: { targetType: 'regular' } });
  });
});
