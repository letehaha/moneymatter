import {
  ACCOUNT_CATEGORIES,
  API_ERROR_CODES,
  type CreateGoalPayload,
  FEATURES,
  type GoalModel,
  PLANS,
  type RecordId,
  type UpdateGoalPayload,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { connection } from '@models/index';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

const createAccountOf = async ({ accountCategory }: { accountCategory: ACCOUNT_CATEGORIES }) =>
  helpers.createAccount({
    payload: helpers.buildAccountPayload({ accountCategory, name: accountCategory }),
    raw: true,
  });

const percentShare = ({ accountId, sharePercent }: { accountId: RecordId; sharePercent: number }) => ({
  accountId,
  sharePercent,
  fixedAmount: null,
  fixedPosition: null,
});

const expectCapacityError = ({
  response,
  accountId,
  accountName,
  requested,
  usedByOtherGoals,
  free,
}: {
  response: Awaited<ReturnType<typeof helpers.createGoal<false>>>;
  accountId: RecordId;
  accountName: string;
  requested: number;
  usedByOtherGoals: number;
  free: number;
}) => {
  expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
  const error = response.body.response as unknown as ErrorResponse;
  expect(error.code).toBe(API_ERROR_CODES.goalShareCapacityExceeded);
  expect(error.details).toEqual({ accountId, accountName, requested, usedByOtherGoals, free });
};

describe('Goals CRUD', () => {
  it('returns an empty list before anything is created', async () => {
    expect(await helpers.listGoals({ raw: true })).toEqual([]);
  });

  it('creates, reads, updates and deletes a goal', async () => {
    const savings = await createAccountOf({ accountCategory: ACCOUNT_CATEGORIES.saving });
    const cash = await createAccountOf({ accountCategory: ACCOUNT_CATEGORIES.cash });

    const created = await helpers.createGoal({
      payload: {
        name: 'Vacation',
        targetAmount: 2500.5,
        targetDate: '2030-06-01',
        plannedMonthly: 150,
        logoIcon: 'airplane',
        accounts: [
          { accountId: savings.id, sharePercent: 100 },
          { accountId: cash.id, sharePercent: 25.5 },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const goal = created.body.response;

    expect(goal).toMatchObject({
      name: 'Vacation',
      currencyCode: global.BASE_CURRENCY.code,
      targetAmount: 2500.5,
      targetDate: '2030-06-01',
      plannedMonthly: 150,
      status: 'active',
      achievedAt: null,
      achievedAmount: null,
      logoIcon: 'airplane',
      logoImageId: null,
    });
    expect(goal.accounts.toSorted((a, b) => a.accountId.localeCompare(b.accountId))).toEqual(
      [
        percentShare({ accountId: savings.id, sharePercent: 100 }),
        percentShare({ accountId: cash.id, sharePercent: 25.5 }),
      ].toSorted((a, b) => a.accountId.localeCompare(b.accountId)),
    );

    expect(await helpers.getGoal({ goalId: goal.id, raw: true })).toEqual(goal);
    expect(await helpers.listGoals({ raw: true })).toEqual([goal]);

    const updated = await helpers.updateGoal({
      goalId: goal.id,
      payload: {
        name: 'Summer trip',
        currencyCode: 'USD',
        plannedMonthly: null,
        targetDate: null,
        accounts: [{ accountId: cash.id, sharePercent: 50 }],
      },
      raw: true,
    });
    expect(updated).toMatchObject({
      name: 'Summer trip',
      currencyCode: 'USD',
      targetAmount: 2500.5,
      plannedMonthly: null,
      targetDate: null,
      accounts: [{ accountId: cash.id, sharePercent: 50 }],
    });

    expect((await helpers.deleteGoal({ goalId: goal.id })).statusCode).toBe(200);
    expect((await helpers.getGoal({ goalId: goal.id })).statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(await helpers.listGoals({ raw: true })).toEqual([]);
  });

  it('pauses and archives through update', async () => {
    const goal = await helpers.createGoal({ raw: true });

    expect((await helpers.updateGoal({ goalId: goal.id, payload: { status: 'paused' }, raw: true })).status).toBe(
      'paused',
    );
    expect((await helpers.updateGoal({ goalId: goal.id, payload: { status: 'archived' }, raw: true })).status).toBe(
      'archived',
    );
  });

  it('rejects invalid payloads with 422', async () => {
    const account = await helpers.createAccount({ raw: true });
    const accounts = [{ accountId: account.id, sharePercent: 100 }];

    const invalid: Partial<CreateGoalPayload>[] = [
      { targetAmount: 0, accounts },
      { currencyCode: 'ZZZ', accounts },
      { name: '', accounts },
      { sortOrder: 3_000_000_000, accounts },
      { accounts: [] },
      { accounts: [{ accountId: account.id, sharePercent: 0 }] },
      { accounts: [{ accountId: account.id, sharePercent: 100.01 }] },
      { accounts: [{ accountId: account.id, sharePercent: 10.555 }] },
      {
        accounts: [
          { accountId: account.id, sharePercent: 40 },
          { accountId: account.id, sharePercent: 40 },
        ],
      },
    ];
    for (const payload of invalid) {
      expect((await helpers.createGoal({ payload })).statusCode).toBe(ERROR_CODES.ValidationError);
    }
    expect(await helpers.listGoals({ raw: true })).toEqual([]);
  });

  it('rejects an amount below the smallest unit of its currency with 422', async () => {
    const savings = await createAccountOf({ accountCategory: ACCOUNT_CATEGORIES.saving });
    const cash = await createAccountOf({ accountCategory: ACCOUNT_CATEGORIES.cash });
    const accounts = [{ accountId: savings.id, sharePercent: 100 }];

    const invalid: Partial<CreateGoalPayload>[] = [
      { targetAmount: 0.001, accounts },
      { plannedMonthly: 0.004, accounts },
      {
        targetAmount: 100,
        accounts: [
          { accountId: savings.id, fixedAmount: 100 },
          { accountId: cash.id, fixedAmount: 0.001 },
        ],
      },
    ];
    for (const payload of invalid) {
      expect((await helpers.createGoal({ payload })).statusCode).toBe(ERROR_CODES.ValidationError);
    }
    expect(await helpers.listGoals({ raw: true })).toEqual([]);

    const goal = await helpers.createGoal({ payload: { accounts }, raw: true });
    for (const payload of [{ targetAmount: 0.001 }, { plannedMonthly: 0.004 }]) {
      expect((await helpers.updateGoal({ goalId: goal.id, payload })).statusCode).toBe(ERROR_CODES.ValidationError);
    }
    expect(await helpers.getGoal({ goalId: goal.id, raw: true })).toMatchObject({
      targetAmount: 1000,
      plannedMonthly: null,
    });
  });

  it('rejects invalid update payloads with 422 and leaves the goal unchanged', async () => {
    const goal = await helpers.createGoal({ raw: true });
    const accountId = goal.accounts[0]!.accountId;

    const invalid: UpdateGoalPayload[] = [
      { accounts: [] },
      { accounts: [{ accountId, sharePercent: 0 }] },
      {
        accounts: [
          { accountId, sharePercent: 40 },
          { accountId, sharePercent: 40 },
        ],
      },
      { status: 'done' } as unknown as UpdateGoalPayload,
      { sortOrder: 3_000_000_000 },
    ];
    for (const payload of invalid) {
      expect((await helpers.updateGoal({ goalId: goal.id, payload })).statusCode).toBe(ERROR_CODES.ValidationError);
    }
    expect(await helpers.getGoal({ goalId: goal.id, raw: true })).toEqual(goal);
  });

  it('404s on an unknown goal', async () => {
    const goalId = generateRandomRecordId();

    expect((await helpers.getGoal({ goalId })).statusCode).toBe(ERROR_CODES.NotFoundError);
    expect((await helpers.updateGoal({ goalId, payload: { name: 'x' } })).statusCode).toBe(ERROR_CODES.NotFoundError);
    expect((await helpers.deleteGoal({ goalId })).statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});

describe('Goal account eligibility', () => {
  it('rejects an account of another user and hides goals across users', async () => {
    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const { foreignAccount, foreignGoal } = await helpers.asUser({
      cookies: other.cookies,
      fn: async () => ({
        foreignAccount: await helpers.createAccount({ raw: true }),
        foreignGoal: await helpers.createGoal({ raw: true }),
      }),
    });

    const response = await helpers.createGoal({
      payload: { accounts: [{ accountId: foreignAccount.id, sharePercent: 100 }] },
    });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

    expect((await helpers.getGoal({ goalId: foreignGoal.id })).statusCode).toBe(ERROR_CODES.NotFoundError);
    expect((await helpers.updateGoal({ goalId: foreignGoal.id, payload: { status: 'archived' } })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
    expect(await helpers.listGoals({ raw: true })).toEqual([]);
  });

  it.each([ACCOUNT_CATEGORIES.creditCard, ACCOUNT_CATEGORIES.overdraft])('rejects a %s account', async (category) => {
    const account = await createAccountOf({ accountCategory: category });

    const response = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 100 }] },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('applies the same account checks when an active goal changes accounts', async () => {
    const goal = await helpers.createGoal({ raw: true });
    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const foreignAccount = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.createAccount({ raw: true }),
    });
    const creditCard = await createAccountOf({ accountCategory: ACCOUNT_CATEGORIES.creditCard });
    const overdraft = await createAccountOf({ accountCategory: ACCOUNT_CATEGORIES.overdraft });

    for (const accountId of [foreignAccount.id, creditCard.id, overdraft.id]) {
      const response = await helpers.updateGoal({
        goalId: goal.id,
        payload: { accounts: [{ accountId, sharePercent: 50 }] },
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    }
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).accounts).toEqual(goal.accounts);
  });

  it.each([ACCOUNT_CATEGORIES.investment, ACCOUNT_CATEGORIES.crypto])('accepts a %s account', async (category) => {
    const account = await createAccountOf({ accountCategory: category });

    const goal = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 100 }] },
      raw: true,
    });

    expect(goal.accounts).toEqual([percentShare({ accountId: account.id, sharePercent: 100 })]);
  });

  it('drops the link when a deleted account cascades away', async () => {
    const kept = await helpers.createAccount({ raw: true });
    const deleted = await helpers.createAccount({ raw: true });
    const goal = await helpers.createGoal({
      payload: {
        accounts: [
          { accountId: kept.id, sharePercent: 50 },
          { accountId: deleted.id, sharePercent: 100 },
        ],
      },
      raw: true,
    });

    expect((await helpers.deleteAccount({ id: deleted.id, raw: false })).statusCode).toBe(200);

    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).accounts).toEqual([
      percentShare({ accountId: kept.id, sharePercent: 50 }),
    ]);
  });

  it('drops the link when the account moves to an ineligible category', async () => {
    const account = await helpers.createAccount({ raw: true });
    const goal = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 100 }] },
      raw: true,
    });

    await helpers.updateAccount({
      id: account.id,
      payload: { accountCategory: ACCOUNT_CATEGORIES.creditCard },
      raw: true,
    });

    const after = await helpers.getGoal({ goalId: goal.id, raw: true });
    expect(after.accounts).toEqual([]);
    expect(after.insights!.status).toBe('no_accounts');
  });

  it('keeps the link through account edits that leave it eligible', async () => {
    const account = await createAccountOf({ accountCategory: ACCOUNT_CATEGORIES.saving });
    const goal = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 100 }] },
      raw: true,
    });

    const edits: NonNullable<Parameters<typeof helpers.updateAccount>[0]['payload']>[] = [
      { name: 'Renamed' },
      { excludeFromStats: true },
      { excludeFromStats: false },
      { accountCategory: ACCOUNT_CATEGORIES.cash },
    ];
    for (const payload of edits) {
      await helpers.updateAccount({ id: account.id, payload, raw: true });
      expect((await helpers.getGoal({ goalId: goal.id, raw: true })).accounts).toEqual(goal.accounts);
    }
  });
});

describe('Goal share capacity', () => {
  it('lets several goals share an account up to exactly 100%', async () => {
    const account = await helpers.createAccount({ raw: true });

    for (const sharePercent of [33.33, 33.33, 33.34]) {
      const response = await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent }] } });
      expect(response.statusCode).toBe(201);
    }

    expect(await helpers.listGoals({ raw: true })).toHaveLength(3);
  });

  it('rejects a total share above 100% and names the account', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Monobank Black' }),
      raw: true,
    });
    await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 70 }] }, raw: true });

    expectCapacityError({
      response: await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 40 }] } }),
      accountId: account.id,
      accountName: 'Monobank Black',
      requested: 40,
      usedByOtherGoals: 70,
      free: 30,
    });
    expect(await helpers.listGoals({ raw: true })).toHaveLength(1);
  });

  it('rejects an update that pushes an account over 100% and keeps the stored shares', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Savings' }),
      raw: true,
    });
    await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 70 }] }, raw: true });
    const goal = await helpers.createGoal({ raw: true });

    expectCapacityError({
      response: await helpers.updateGoal({
        goalId: goal.id,
        payload: { accounts: [{ accountId: account.id, sharePercent: 40 }] },
      }),
      accountId: account.id,
      accountName: 'Savings',
      requested: 40,
      usedByOtherGoals: 70,
      free: 30,
    });
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).accounts).toEqual(goal.accounts);
  });

  it('lets only one of two concurrent creates claim the same account', async () => {
    const account = await helpers.createAccount({ raw: true });

    const responses = await Promise.all(
      [1, 2].map(() => helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 60 }] } })),
    );

    expect(responses.map((response) => response.statusCode).toSorted((a, b) => a - b)).toEqual([
      201,
      ERROR_CODES.ConflictError,
    ]);
    expect(await helpers.listGoals({ raw: true })).toHaveLength(1);
  });

  it('does not count the goal being edited against itself', async () => {
    const account = await helpers.createAccount({ raw: true });
    const goal = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 80 }] },
      raw: true,
    });

    const updated = await helpers.updateGoal({
      goalId: goal.id,
      payload: { accounts: [{ accountId: account.id, sharePercent: 100 }] },
      raw: true,
    });

    expect(updated.accounts).toEqual([percentShare({ accountId: account.id, sharePercent: 100 })]);
  });

  it('counts paused goals, releases the share on archive and re-checks on unarchive', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Savings' }),
      raw: true,
    });
    const first = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 70 }] },
      raw: true,
    });
    await helpers.updateGoal({ goalId: first.id, payload: { status: 'paused' }, raw: true });

    expectCapacityError({
      response: await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 40 }] } }),
      accountId: account.id,
      accountName: 'Savings',
      requested: 40,
      usedByOtherGoals: 70,
      free: 30,
    });

    await helpers.updateGoal({ goalId: first.id, payload: { status: 'archived' }, raw: true });
    const second = await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 40 }] } });
    expect(second.statusCode).toBe(201);

    expectCapacityError({
      response: await helpers.updateGoal({ goalId: first.id, payload: { status: 'active' } }),
      accountId: account.id,
      accountName: 'Savings',
      requested: 70,
      usedByOtherGoals: 40,
      free: 60,
    });
    expect((await helpers.getGoal({ goalId: first.id, raw: true })).status).toBe('archived');

    const unarchived = await helpers.updateGoal({
      goalId: first.id,
      payload: { status: 'active', accounts: [{ accountId: account.id, sharePercent: 60 }] },
      raw: true,
    });
    expect(unarchived.status).toBe('active');
  });

  it('checks the new accounts on unarchive, and skips the check when archiving with them', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Savings' }),
      raw: true,
    });
    const archived = await helpers.createGoal({ raw: true });
    await helpers.updateGoal({ goalId: archived.id, payload: { status: 'archived' }, raw: true });
    await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 40 }] }, raw: true });

    expectCapacityError({
      response: await helpers.updateGoal({
        goalId: archived.id,
        payload: { status: 'active', accounts: [{ accountId: account.id, sharePercent: 70 }] },
      }),
      accountId: account.id,
      accountName: 'Savings',
      requested: 70,
      usedByOtherGoals: 40,
      free: 60,
    });
    expect(await helpers.getGoal({ goalId: archived.id, raw: true })).toMatchObject({
      status: 'archived',
      accounts: archived.accounts,
    });

    const active = await helpers.createGoal({ raw: true });
    const response = await helpers.updateGoal({
      goalId: active.id,
      payload: { status: 'archived', accounts: [{ accountId: account.id, sharePercent: 70 }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.response).toMatchObject({
      status: 'archived',
      accounts: [{ accountId: account.id, sharePercent: 70 }],
    });
  });

  it('lets an archived goal hold accounts without checking capacity', async () => {
    const account = await helpers.createAccount({ raw: true });
    await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 100 }] }, raw: true });
    const archived = await helpers.createGoal({ raw: true });
    await helpers.updateGoal({ goalId: archived.id, payload: { status: 'archived' }, raw: true });

    const response = await helpers.updateGoal({
      goalId: archived.id,
      payload: { accounts: [{ accountId: account.id, sharePercent: 50 }] },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('Goals without the feature', () => {
  it('keeps reads open, answers writes with 402 and lets a day trial unlock them', async () => {
    const goal = await helpers.createGoal({ raw: true });
    const account = await helpers.createAccount({ raw: true });

    await helpers.setUserBilling({ plan: PLANS.early_adopter });

    expect((await helpers.listGoals()).statusCode).toBe(200);
    expect((await helpers.getGoal({ goalId: goal.id })).statusCode).toBe(200);

    const gatedResponses = [
      await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 10 }] } }),
      await helpers.updateGoal({ goalId: goal.id, payload: { name: 'Nope' } }),
      await helpers.deleteGoal({ goalId: goal.id }),
    ];
    for (const response of gatedResponses) {
      expect(response.statusCode).toBe(ERROR_CODES.PaymentRequired);
      expect((response.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);
    }

    await helpers.startFeatureTrial({ feature: FEATURES.goals, raw: true });
    expect((await helpers.updateGoal({ goalId: goal.id, payload: { name: 'Trial' } })).statusCode).toBe(200);

    const { id: userId } = await helpers.getUserInfo({ raw: true });
    await helpers.backdateFeatureTrial({ userId, feature: FEATURES.goals });
    expect((await helpers.updateGoal({ goalId: goal.id, payload: { name: 'Expired' } })).statusCode).toBe(
      ERROR_CODES.PaymentRequired,
    );
  });

  it('is part of Essential', async () => {
    await helpers.setUserBilling({ plan: PLANS.essential });

    expect((await helpers.createGoal()).statusCode).toBe(201);
  });
});

const fixedPositions = async ({ accountId }: { accountId: RecordId }) =>
  Object.fromEntries(
    (await helpers.listGoals({ raw: true })).flatMap((goal) =>
      goal.accounts
        .filter((share) => share.accountId === accountId && share.fixedAmount !== null)
        .map((share) => [goal.name, share.fixedPosition]),
    ),
  );

const createFixedGoal = ({
  accountId,
  name,
  fixedPosition,
}: {
  accountId: RecordId;
  name: string;
  fixedPosition?: number;
}) =>
  helpers.createGoal({
    payload: { name, targetAmount: 100, accounts: [{ accountId, fixedAmount: 100, fixedPosition }] },
    raw: true,
  });

const expectBelowTarget = (response: Awaited<ReturnType<typeof helpers.createGoal<false>>>) => {
  expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  expect((response.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.goalFixedAmountsBelowTarget);
};

describe('Goal fixed amounts', () => {
  it('stores a fixed amount next to a share and returns both shapes', async () => {
    const savings = await createAccountOf({ accountCategory: ACCOUNT_CATEGORIES.saving });
    const cash = await createAccountOf({ accountCategory: ACCOUNT_CATEGORIES.cash });

    const goal = await helpers.createGoal({
      payload: {
        targetAmount: 1000,
        reachedHoldDays: 0,
        accounts: [
          { accountId: savings.id, fixedAmount: 300.5 },
          { accountId: cash.id, sharePercent: 50 },
        ],
      },
      raw: true,
    });

    expect(goal.reachedHoldDays).toBe(0);
    expect(goal.accounts.toSorted((a, b) => a.accountId.localeCompare(b.accountId))).toEqual(
      [
        { accountId: savings.id, sharePercent: null, fixedAmount: 300.5, fixedPosition: 0 },
        { accountId: cash.id, sharePercent: 50, fixedAmount: null, fixedPosition: null },
      ].toSorted((a, b) => a.accountId.localeCompare(b.accountId)),
    );
    expect((await helpers.createGoal({ raw: true })).reachedHoldDays).toBe(30);
  });

  it('rejects a link with both or neither kind, a non-positive amount and an out-of-range hold window', async () => {
    const account = await helpers.createAccount({ raw: true });
    const invalid: Partial<CreateGoalPayload>[] = [
      { accounts: [{ accountId: account.id, sharePercent: 50, fixedAmount: 100 }] },
      { accounts: [{ accountId: account.id }] },
      { accounts: [{ accountId: account.id, fixedAmount: 0 }] },
      { accounts: [{ accountId: account.id, sharePercent: 50, fixedPosition: 0 }] },
      { reachedHoldDays: -1 },
      { reachedHoldDays: 366 },
    ];

    for (const payload of invalid) {
      expect((await helpers.createGoal({ payload })).statusCode).toBe(ERROR_CODES.ValidationError);
    }
    expect(await helpers.listGoals({ raw: true })).toEqual([]);
  });

  it('takes a fixed amount from an account whose shares are fully used', async () => {
    const account = await helpers.createAccount({ raw: true });
    await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 100 }] }, raw: true });

    const fixed = await helpers.createGoal({
      payload: { targetAmount: 500, accounts: [{ accountId: account.id, fixedAmount: 500 }] },
    });
    expect(fixed.statusCode).toBe(201);

    const share = await helpers.createGoal({ payload: { accounts: [{ accountId: account.id, sharePercent: 1 }] } });
    expect(share.statusCode).toBe(ERROR_CODES.ConflictError);
  });

  it('refuses fixed amounts alone below the target, on create and when the target grows', async () => {
    const savings = await helpers.createAccount({ raw: true });
    const cash = await helpers.createAccount({ raw: true });

    expectBelowTarget(
      await helpers.createGoal({
        payload: { targetAmount: 1000, accounts: [{ accountId: savings.id, fixedAmount: 600 }] },
      }),
    );

    const goal = await helpers.createGoal({
      payload: {
        targetAmount: 1000,
        accounts: [
          { accountId: savings.id, fixedAmount: 600 },
          { accountId: cash.id, fixedAmount: 400 },
        ],
      },
      raw: true,
    });
    expectBelowTarget(await helpers.updateGoal({ goalId: goal.id, payload: { targetAmount: 1500 } }));
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).targetAmount).toBe(1000);

    const withShare = await helpers.updateGoal({
      goalId: goal.id,
      payload: {
        targetAmount: 1500,
        accounts: [
          { accountId: savings.id, fixedAmount: 600 },
          { accountId: cash.id, sharePercent: 10 },
        ],
      },
    });
    expect(withShare.statusCode).toBe(200);
  });

  it('orders an account’s fixed amounts: appends, inserts at fixedPosition, keeps the place on edit', async () => {
    const account = await helpers.createAccount({ raw: true });
    const emergency = await createFixedGoal({ accountId: account.id, name: 'Emergency' });
    await createFixedGoal({ accountId: account.id, name: 'Laptop' });
    const car = await createFixedGoal({ accountId: account.id, name: 'Car', fixedPosition: 0 });
    expect(await fixedPositions({ accountId: account.id })).toEqual({ Car: 0, Emergency: 1, Laptop: 2 });

    await helpers.updateGoal({
      goalId: emergency.id,
      payload: { accounts: [{ accountId: account.id, fixedAmount: 150 }] },
      raw: true,
    });
    expect(await fixedPositions({ accountId: account.id })).toEqual({ Car: 0, Emergency: 1, Laptop: 2 });

    await helpers.updateGoal({
      goalId: emergency.id,
      payload: { accounts: [{ accountId: account.id, fixedAmount: 150, fixedPosition: 0 }] },
      raw: true,
    });
    expect(await fixedPositions({ accountId: account.id })).toEqual({ Emergency: 0, Car: 1, Laptop: 2 });

    await helpers.updateGoal({ goalId: emergency.id, payload: { status: 'archived' }, raw: true });
    await helpers.updateGoal({ goalId: emergency.id, payload: { status: 'active' }, raw: true });
    expect(await fixedPositions({ accountId: account.id })).toEqual({ Car: 0, Laptop: 1, Emergency: 2 });

    expect(car.accounts[0]!.fixedPosition).toBe(0);
  });

  it('returns dense positions that keep the order when a write echoes them back', async () => {
    const account = await helpers.createAccount({ raw: true });
    const goals: GoalModel[] = [];
    for (const name of ['A', 'B', 'C', 'D']) goals.push(await createFixedGoal({ accountId: account.id, name }));
    const [, b, c] = goals;

    await helpers.deleteGoal({ goalId: b!.id, raw: true });
    const { accounts } = await helpers.getGoal({ goalId: c!.id, raw: true });
    expect(accounts[0]!.fixedPosition).toBe(1);

    await helpers.updateGoal({ goalId: c!.id, payload: { name: 'C2', accounts }, raw: true });
    expect(await fixedPositions({ accountId: account.id })).toEqual({ A: 0, C2: 1, D: 2 });
  });

  it('moves a fixed amount to a later slot and renumbers the others', async () => {
    const account = await helpers.createAccount({ raw: true });
    const goals: GoalModel[] = [];
    for (const name of ['A', 'B', 'C', 'D']) goals.push(await createFixedGoal({ accountId: account.id, name }));

    await helpers.updateGoal({
      goalId: goals[0]!.id,
      payload: { accounts: [{ accountId: account.id, fixedAmount: 100, fixedPosition: 2 }] },
      raw: true,
    });
    expect(await fixedPositions({ accountId: account.id })).toEqual({ B: 0, C: 1, A: 2, D: 3 });
  });

  it('checks fixed amounts in another currency against the target after converting both to base', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['USD'] });
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'USD' }),
      raw: true,
    });
    const accounts = [{ accountId: account.id, fixedAmount: 1000 }];

    const goal = await helpers.createGoal({ payload: { targetAmount: 1, accounts }, raw: true });
    const converted = goal.insights!.input.accounts[0]!.fixedAmount!;
    const aboveConverted = Math.round(converted * 100 + 1) / 100;
    expect(goal.currencyCode).not.toBe('USD');

    expectBelowTarget(await helpers.createGoal({ payload: { targetAmount: aboveConverted, accounts } }));
    expect((await helpers.updateGoal({ goalId: goal.id, payload: { targetAmount: converted } })).statusCode).toBe(200);
    expectBelowTarget(await helpers.updateGoal({ goalId: goal.id, payload: { targetAmount: aboveConverted } }));
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).targetAmount).toBe(converted);
  });
});

describe('Goal amounts at the currency decimals', () => {
  it.each([
    { label: '2-decimal', currencyCode: undefined, sent: [100.555, 10.005, 200.545], stored: [100.56, 10.01, 200.55] },
    { label: 'JPY', currencyCode: 'JPY', sent: [1500.5, 100.4, 2000.5], stored: [1501, 100, 2001] },
    { label: 'KWD', currencyCode: 'KWD', sent: [1500.1255, 0.001, 2.0005], stored: [1500.126, 0.001, 2.001] },
  ])(
    'rounds the amounts of a $label goal half-up to its decimals',
    async ({
      currencyCode,
      sent: [targetAmount, plannedMonthly, updatedTarget],
      stored: [storedTarget, storedMonthly, storedUpdatedTarget],
    }) => {
      const goal = await helpers.createGoal({
        payload: { ...(currencyCode && { currencyCode }), targetAmount, plannedMonthly },
        raw: true,
      });
      expect(goal).toMatchObject({
        currencyCode: currencyCode ?? global.BASE_CURRENCY.code,
        targetAmount: storedTarget,
        plannedMonthly: storedMonthly,
      });

      const updated = await helpers.updateGoal({
        goalId: goal.id,
        payload: { targetAmount: updatedTarget },
        raw: true,
      });
      expect(updated.targetAmount).toBe(storedUpdatedTarget);
    },
  );

  it('rejects a share percent with three decimals on update', async () => {
    const goal = await helpers.createGoal({ raw: true });
    const accountId = goal.accounts[0]!.accountId;

    const response = await helpers.updateGoal({
      goalId: goal.id,
      payload: { accounts: [{ accountId, sharePercent: 10.555 }] },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).accounts).toEqual(goal.accounts);
  });

  it("rounds a fixed amount to its account's currency", async () => {
    const account = await helpers.createAccountIn({ currencyCode: 'JPY' });

    const goal = await helpers.createGoal({
      payload: { targetAmount: 1, accounts: [{ accountId: account.id, fixedAmount: 1000.5 }] },
      raw: true,
    });

    expect(goal.accounts[0]!.fixedAmount).toBe(1001);
  });

  it("rounds the stored amounts to the new currency's decimals when only the currency changes", async () => {
    const goal = await helpers.createGoal({ payload: { targetAmount: 1000.55, plannedMonthly: 100.45 }, raw: true });

    const updated = await helpers.updateGoal({ goalId: goal.id, payload: { currencyCode: 'JPY' }, raw: true });

    expect(updated).toMatchObject({ currencyCode: 'JPY', targetAmount: 1001, plannedMonthly: 100 });
  });

  it('refuses a currency change that rounds a stored amount to nothing and leaves the goal unchanged', async () => {
    const goal = await helpers.createGoal({ payload: { plannedMonthly: 0.4 }, raw: true });

    const response = await helpers.updateGoal({ goalId: goal.id, payload: { currencyCode: 'JPY' } });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await helpers.getGoal({ goalId: goal.id, raw: true })).toMatchObject({
      currencyCode: global.BASE_CURRENCY.code,
      plannedMonthly: 0.4,
    });
  });

  it('keeps a stored fixed amount as it is when a write does not send the shares', async () => {
    const account = await helpers.createAccountIn({ currencyCode: 'JPY' });
    const goal = await helpers.createGoal({
      payload: { targetAmount: 1, accounts: [{ accountId: account.id, fixedAmount: 1000 }] },
      raw: true,
    });
    // A row converted from 100050 cents holds 1000.50 in a currency without minor units.
    await connection.sequelize.query(`UPDATE "GoalAccounts" SET "fixedAmount" = 1000.5 WHERE "goalId" = :goalId`, {
      replacements: { goalId: goal.id },
    });

    const retargeted = await helpers.updateGoal({ goalId: goal.id, payload: { targetAmount: 2 } });
    expect(retargeted.statusCode).toBe(200);
    await helpers.updateGoal({ goalId: goal.id, payload: { status: 'archived' }, raw: true });
    const unarchived = await helpers.updateGoal({ goalId: goal.id, payload: { status: 'active' } });
    expect(unarchived.statusCode).toBe(200);

    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).accounts[0]!.fixedAmount).toBe(1000.5);
  });
});
