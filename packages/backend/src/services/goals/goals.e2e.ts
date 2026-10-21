import {
  ACCOUNT_CATEGORIES,
  API_ERROR_CODES,
  type CreateGoalPayload,
  FEATURES,
  PLANS,
  type RecordId,
  type UpdateGoalPayload,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

const createAccountOf = async ({ accountCategory }: { accountCategory: ACCOUNT_CATEGORIES }) =>
  helpers.createAccount({
    payload: helpers.buildAccountPayload({ accountCategory, name: accountCategory }),
    raw: true,
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
        { accountId: savings.id, sharePercent: 100 },
        { accountId: cash.id, sharePercent: 25.5 },
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

    expect(goal.accounts).toEqual([{ accountId: account.id, sharePercent: 100 }]);
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
      { accountId: kept.id, sharePercent: 50 },
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

    expect(updated.accounts).toEqual([{ accountId: account.id, sharePercent: 100 }]);
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
