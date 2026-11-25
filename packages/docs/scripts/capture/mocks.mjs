const DAY = 86_400_000;
const daysFromNow = (days) => new Date(Date.now() + days * DAY).toISOString();

export const ENTITLEMENTS = {
  activePlusYearly: () => ({
    plan: null,
    trialEndsAt: daysFromNow(-200),
    readOnly: false,
    seats: 5,
    subscriptions: [
      {
        externalSubscriptionId: 'sub_docs',
        provider: 'stripe',
        tier: 'plus',
        status: 'active',
        billingCycle: 'year',
        currentPeriodEndsAt: daysFromNow(170),
        scheduledChange: null,
      },
    ],
  }),
  /** Essential subscriber who never started a day trial, so Plus-only tabs offer one. */
  essentialNoTrials: () => {
    const plus = ENTITLEMENTS.activePlusYearly();
    return {
      ...plus,
      seats: 2,
      // Mirrors ESSENTIAL_FEATURES in packages/shared/src/types/billing.ts.
      features: ['backup_export', 'backup_restore', 'data_export', 'attachments', 'budget_plan', 'goals'],
      featureTrials: {},
      budgetPlanTrialEndsAt: null,
      trialUsage: {},
      subscriptions: [
        { ...plus.subscriptions[0], tier: 'essential', billingCycle: 'month', currentPeriodEndsAt: daysFromNow(20) },
      ],
    };
  },
  trialEnded: () => ({
    plan: null,
    trialEndsAt: daysFromNow(-4),
    readOnly: true,
    seats: 1,
    features: [],
    subscriptions: [],
  }),
};

/** Overrides `entitlements` on `GET /user`, which drives the plan page, trial banners and read-only mode. */
export async function mockEntitlements({ page, entitlements }) {
  await page.route(/\/api\/v1\/user$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    Object.assign(body.response.entitlements, entitlements);
    await route.fulfill({ response: res, json: body });
  });
}

/** Answers saves with the backend's read-only 402, so the app shows its "See plans" toast. */
export async function mockPlanRequiredOnSave({ page, url = /\/api\/v1\/transactions\/[^/]+$/ }) {
  await page.route(url, async (route) => {
    if (!['PUT', 'PATCH', 'POST', 'DELETE'].includes(route.request().method())) return route.fallback();
    await route.fulfill({
      status: 402,
      json: {
        status: 'error',
        response: { message: 'Your trial has ended. Subscribe to keep editing your data.', code: 'PLAN_REQUIRED' },
      },
    });
  });
}

/** Presents an existing connection as an Enable Banking one whose consent ends in `daysLeft` days. */
export async function mockEnableBankingConsent({ page, connectionId, daysLeft = 5, name = 'Demo Bank' }) {
  await page.route(/\/api\/v1\/bank-data-providers\/connections$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const c of body.response.connections) {
      if (c.id === connectionId)
        Object.assign(c, { providerType: 'enable-banking', providerName: name, bankName: null });
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.route(new RegExp(`/api/v1/bank-data-providers/connections/${connectionId}$`), async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const connection = body.response.connection;
    Object.assign(connection, {
      providerType: 'enable-banking',
      providerName: name,
      createdAt: daysFromNow(-175),
      consent: {
        validFrom: daysFromNow(-175),
        validUntil: daysFromNow(daysLeft + 0.5),
        daysRemaining: daysLeft,
        isExpired: daysLeft <= 0,
        isExpiringSoon: daysLeft > 0 && daysLeft <= 7,
      },
    });
    connection.provider = { ...connection.provider, name: 'Enable Banking' };
    connection.accounts = connection.accounts.map((a) => ({ ...a, type: 'enable-banking' }));
    await route.fulfill({ response: res, json: body });
  });
}

/**
 * Replaces a budget period's pool with readable numbers that still add up, so the strip, the Assign/Fix menus and
 * Budget calculation agree. The flow is that of the pool's first period.
 */
export async function mockBudgetPool({ page, planId, periodId, readyToAssign }) {
  await page.route(new RegExp(`/api/v1/budget-plans/${planId}/periods/${periodId}$`), async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    const { totalAssigned: assigned = 0 } = body.response.header ?? {};
    const inLines = body.response.pool?.balance.inLines ?? 0;
    const income = body.response.pool?.flow.income ?? 0;
    const outsideSpending = body.response.pool?.flow.outsideSpending ?? 0;
    const round = (value) => Math.round(value * 100) / 100;
    body.response.pool = {
      readyToAssign,
      committedLater: 0,
      flow: {
        leftOver: round(readyToAssign - income - outsideSpending + assigned),
        income,
        outsideSpending,
        fromLines: 0,
        assigned,
      },
      balance: { cash: round(readyToAssign + inLines), inLines, drift: 0 },
    };
    await route.fulfill({ response: res, json: body });
  });
}
