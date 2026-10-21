import { ApiErrorResponseError } from '@/js/errors';
import { ACCOUNT_CATEGORIES, ACCOUNT_STATUSES, API_ERROR_CODES, type GoalModel, type RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  type GoalFormState,
  buildGoalPayload,
  getGoalFormServerError,
  getGoalFormSummary,
  getShareError,
  goalFormStateFrom,
  isGoalEligibleAccount,
  sumCountedAmount,
  validateGoalForm,
} from './form-helpers';

const id = (value: string) => value as RecordId;

const buildState = (overrides: Partial<GoalFormState> = {}): GoalFormState => ({
  name: 'Car',
  currencyCode: 'UAH',
  targetAmount: 600_000,
  targetDate: null,
  hasPlannedMonthly: false,
  plannedMonthly: null,
  accounts: [{ accountId: id('a1'), sharePercent: 100 }],
  ...overrides,
});

const buildGoal = (overrides: Partial<GoalModel> = {}) =>
  ({
    id: id('g1'),
    name: 'Japan trip',
    currencyCode: 'USD',
    targetAmount: 5000,
    targetDate: '2027-06-30',
    plannedMonthly: 300,
    status: 'active',
    accounts: [{ accountId: id('a1'), sharePercent: 25 }],
    ...overrides,
  }) as GoalModel;

describe('goalFormStateFrom', () => {
  it('starts a new goal in the base currency with nothing set', () => {
    expect(goalFormStateFrom({ baseCurrencyCode: 'UAH' })).toEqual({
      name: '',
      currencyCode: 'UAH',
      targetAmount: null,
      targetDate: null,
      hasPlannedMonthly: false,
      plannedMonthly: null,
      accounts: [],
    });
  });

  it('copies a stored goal and turns the planned switch on', () => {
    const goal = buildGoal();
    const state = goalFormStateFrom({ goal, baseCurrencyCode: 'UAH' });

    expect(state).toMatchObject({
      currencyCode: 'USD',
      targetAmount: 5000,
      hasPlannedMonthly: true,
      plannedMonthly: 300,
    });
    expect(state.targetDate).toEqual(new Date(2027, 5, 30));
    expect(state.accounts).not.toBe(goal.accounts);
  });

  it('starts from the goal but takes the what-if values', () => {
    const accounts = [{ accountId: id('a2'), sharePercent: 40 }];
    const state = goalFormStateFrom({
      goal: buildGoal(),
      initialValues: { plannedMonthly: 450, targetDate: null, accounts },
      baseCurrencyCode: 'UAH',
    });

    expect(state).toMatchObject({ name: 'Japan trip', targetDate: null, plannedMonthly: 450, accounts });
    expect(state.hasPlannedMonthly).toBe(true);
  });

  it('treats a what-if monthly amount of 0 as no plan', () => {
    const state = goalFormStateFrom({
      goal: buildGoal(),
      initialValues: { plannedMonthly: 0, targetDate: '2028-01-31', accounts: [] },
      baseCurrencyCode: 'UAH',
    });

    expect(state).toMatchObject({ hasPlannedMonthly: false, plannedMonthly: null, accounts: [] });
    expect(state.targetDate).toEqual(new Date(2028, 0, 31));
  });
});

describe('validateGoalForm', () => {
  const today = '2026-10-20';

  it('passes a complete form', () => {
    expect(Object.values(validateGoalForm({ state: buildState(), today })).every((error) => error === null)).toBe(true);
  });

  it('flags a blank name, a missing amount and no accounts', () => {
    const errors = validateGoalForm({ state: buildState({ name: '  ', targetAmount: 0, accounts: [] }), today });

    expect(errors.name).toBe('goals.form.errors.nameRequired');
    expect(errors.targetAmount).toBe('goals.form.errors.amountRequired');
    expect(errors.accounts).toBe('goals.form.errors.accountsRequired');
  });

  it('needs a planned amount only while the switch is on', () => {
    expect(validateGoalForm({ state: buildState({ hasPlannedMonthly: true }), today }).plannedMonthly).toBe(
      'goals.form.errors.amountRequired',
    );
    expect(validateGoalForm({ state: buildState({ plannedMonthly: null }), today }).plannedMonthly).toBeNull();
  });

  it('rejects a date that is not in the future unless it is the stored one', () => {
    const state = buildState({ targetDate: new Date(2026, 9, 20) });

    expect(validateGoalForm({ state, today }).targetDate).toBe('goals.form.errors.dateNotFuture');
    expect(validateGoalForm({ state, today, storedTargetDate: '2026-10-20' }).targetDate).toBeNull();
    expect(validateGoalForm({ state: buildState({ targetDate: new Date(2026, 9, 21) }), today }).targetDate).toBeNull();
  });
});

describe('buildGoalPayload', () => {
  it('trims the name, formats the date and drops a switched-off monthly amount', () => {
    const payload = buildGoalPayload({
      state: buildState({ name: ' Car ', targetDate: new Date(2028, 5, 30), plannedMonthly: 900 }),
    });

    expect(payload).toEqual({
      name: 'Car',
      currencyCode: 'UAH',
      targetAmount: 600_000,
      targetDate: '2028-06-30',
      plannedMonthly: null,
      accounts: [{ accountId: id('a1'), sharePercent: 100 }],
    });
  });

  it('keeps the monthly amount while the switch is on', () => {
    expect(
      buildGoalPayload({ state: buildState({ hasPlannedMonthly: true, plannedMonthly: 900 }) }).plannedMonthly,
    ).toBe(900);
  });

  it('refuses a state without a target amount', () => {
    expect(() => buildGoalPayload({ state: buildState({ targetAmount: null }) })).toThrow();
  });
});

describe('counted amounts', () => {
  it('subtracts the credit limit, clamps at 0 and applies the share', () => {
    const accountsById = {
      [id('a1')]: { refCurrentBalance: 1200, refCreditLimit: 200 },
      [id('a2')]: { refCurrentBalance: -50, refCreditLimit: 0 },
    };
    const shares = [
      { accountId: id('a1'), sharePercent: 25 },
      { accountId: id('a2'), sharePercent: 100 },
    ];

    expect(sumCountedAmount({ shares, accountsById })).toBe(250);
  });

  it('sums the shares and skips accounts it does not know', () => {
    const accountsById = { [id('a1')]: { refCurrentBalance: 1000, refCreditLimit: 0 } };
    const shares = [
      { accountId: id('a1'), sharePercent: 50 },
      { accountId: id('gone'), sharePercent: 100 },
    ];

    expect(sumCountedAmount({ shares, accountsById })).toBe(500);
  });
});

describe('isGoalEligibleAccount', () => {
  const account = {
    id: id('a1'),
    accountCategory: ACCOUNT_CATEGORIES.saving,
    status: ACCOUNT_STATUSES.active,
    share: undefined,
  };

  it('takes owned accounts of an eligible category', () => {
    expect(isGoalEligibleAccount({ account, linkedAccountIds: [] })).toBe(true);
    expect(
      isGoalEligibleAccount({
        account: { ...account, accountCategory: ACCOUNT_CATEGORIES.creditCard },
        linkedAccountIds: [],
      }),
    ).toBe(false);
    expect(
      isGoalEligibleAccount({
        account: { ...account, share: { isOwner: false } as never },
        linkedAccountIds: [],
      }),
    ).toBe(false);
  });

  it('keeps an archived account only while it is linked', () => {
    const archived = { ...account, status: ACCOUNT_STATUSES.archived };

    expect(isGoalEligibleAccount({ account: archived, linkedAccountIds: [] })).toBe(false);
    expect(isGoalEligibleAccount({ account: archived, linkedAccountIds: [id('a1')] })).toBe(true);
  });
});

describe('getShareError', () => {
  it.each([
    { sharePercent: null, max: 100, expected: 'invalid' },
    { sharePercent: 0, max: 100, expected: 'invalid' },
    { sharePercent: 0.001, max: 100, expected: 'invalid' },
    { sharePercent: 80, max: 75, expected: 'overMax' },
    { sharePercent: 75.004, max: 75, expected: null },
    { sharePercent: 101, max: 100, expected: 'overMax' },
    { sharePercent: 100, max: 100, expected: null },
  ])('$sharePercent% with $max% free → $expected', ({ sharePercent, max, expected }) => {
    expect(getShareError({ sharePercent, max })).toBe(expected);
  });
});

describe('getGoalFormServerError', () => {
  it('maps the share capacity conflict to the accounts field', () => {
    const details = { accountId: id('a1'), accountName: 'Mono', requested: 80, usedByOtherGoals: 25, free: 75 };
    const error = new ApiErrorResponseError('conflict', {
      code: API_ERROR_CODES.goalShareCapacityExceeded,
      message: 'Mono has 75% free',
      details,
    });

    expect(getGoalFormServerError({ error, currencyCode: 'UAH' })).toEqual({ field: 'accounts', details });
  });

  it('still maps silenced codes that come without details or a message', () => {
    const capacity = new ApiErrorResponseError('conflict', {
      code: API_ERROR_CODES.goalShareCapacityExceeded,
      message: '',
    } as never);
    const rate = new ApiErrorResponseError('', { code: API_ERROR_CODES.goalCurrencyRateUnavailable } as never);

    expect(getGoalFormServerError({ error: capacity, currencyCode: 'UAH' })).toEqual({
      field: 'accounts',
      details: null,
    });
    expect(getGoalFormServerError({ error: rate, currencyCode: 'XYZ' })).toEqual({
      field: 'currencyCode',
      currencyCode: 'XYZ',
      message: null,
    });
  });

  it('maps the missing rate to the currency field', () => {
    const message = "XYZ can't be converted to your base currency right now.";
    const error = new ApiErrorResponseError(message, { code: API_ERROR_CODES.goalCurrencyRateUnavailable, message });

    expect(getGoalFormServerError({ error, currencyCode: 'XYZ' })).toEqual({
      field: 'currencyCode',
      currencyCode: 'XYZ',
      message,
    });
  });

  it('leaves generic validation and other errors alone', () => {
    const zodError = new ApiErrorResponseError('XYZ', {
      code: API_ERROR_CODES.validationError,
      message: 'XYZ',
      validationErrors: [],
    } as never);

    expect(getGoalFormServerError({ error: zodError, currencyCode: 'XYZ' })).toBeNull();
    expect(getGoalFormServerError({ error: new Error('XYZ'), currencyCode: 'XYZ' })).toBeNull();
  });
});

describe('getGoalFormSummary', () => {
  const today = '2026-10-20';

  it('stays empty without a target', () => {
    expect(getGoalFormSummary({ state: buildState({ targetAmount: null }), counted: 0, today })).toBeNull();
  });

  it('asks for the remainder spread over the months left', () => {
    const summary = getGoalFormSummary({
      state: buildState({ targetAmount: 1000, targetDate: new Date(2027, 9, 20) }),
      counted: 400,
      today,
    });

    expect(summary?.isCovered).toBe(false);
    expect(summary?.neededMonthly).toBeCloseTo(600 / (365 / 30.44), 1);
  });

  it('reports a covered target and skips the ask without a date or rate', () => {
    expect(getGoalFormSummary({ state: buildState({ targetAmount: 100 }), counted: 150, today })).toEqual({
      isCovered: true,
      neededMonthly: null,
    });
    expect(getGoalFormSummary({ state: buildState(), counted: 0, today })?.neededMonthly).toBeNull();
    expect(getGoalFormSummary({ state: buildState(), counted: null, today })).toEqual({
      isCovered: false,
      neededMonthly: null,
    });
  });
});
