import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

jest.mock('@services/common/with-transaction', () => ({
  withTransaction: (fn: unknown) => fn,
}));
jest.mock('@models/currencies.model', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('@models/users-currencies.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() },
  addCurrency: jest.fn(),
}));
jest.mock('@models/user-exchange-rates.model', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), bulkCreate: jest.fn() },
}));
jest.mock('@services/currencies/assert-currency-codes-visible', () => ({
  assertCurrencyCodesVisible: jest.fn(),
}));
jest.mock('@services/currencies/lock-user-currencies', () => ({ lockUserCurrencies: jest.fn() }));
jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));

/* eslint-disable import/first */
import { ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrenciesModel, * as UsersCurrencies from '@models/users-currencies.model';
import { assertCurrencyCodesVisible } from '@services/currencies/assert-currency-codes-visible';
import { lockUserCurrencies } from '@services/currencies/lock-user-currencies';

import { ensureUserCurrencyConnected } from './ensure-currency-connected.service';
/* eslint-enable import/first */

const OWNER_ID = 1;
const COLLABORATOR_ID = 2;
const OWNER_DEFINITION = {
  userId: OWNER_ID,
  nameOverride: 'Sats',
  symbolOverride: 's',
  decimalsOverride: 8,
  logoUrl: 'https://example.com/sats.png',
};

const findCurrency = Currencies.findByPk as jest.Mock<AnyFn>;
const findHolding = UsersCurrenciesModel.findOne as jest.Mock<AnyFn>;
const createHolding = UsersCurrenciesModel.create as jest.Mock<AnyFn>;
const addCurrency = UsersCurrencies.addCurrency as jest.Mock<AnyFn>;
const assertVisible = assertCurrencyCodesVisible as jest.Mock<AnyFn>;
const findRates = UserExchangeRates.findAll as unknown as jest.Mock<AnyFn>;
const copyRates = UserExchangeRates.bulkCreate as unknown as jest.Mock<AnyFn>;
const lockHoldings = lockUserCurrencies as jest.Mock<AnyFn>;

const holdingsOf = ({ owner }: { owner: boolean }) =>
  findHolding.mockImplementation(async (options) => {
    const { userId } = (options as { where: { userId: number } }).where;
    return owner && userId === OWNER_ID ? OWNER_DEFINITION : null;
  });

describe('ensureUserCurrencyConnected', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("creates a custom holding once, with the account owner's definition, rates and live rates off", async () => {
    findCurrency.mockResolvedValue({ code: 'SAT', isCustom: true });
    holdingsOf({ owner: true });
    findRates.mockResolvedValue([
      { baseCode: 'SAT', quoteCode: 'USD', rate: 0.0006 },
      { baseCode: 'USD', quoteCode: 'SAT', rate: 1666.67 },
    ]);

    await ensureUserCurrencyConnected({
      userId: COLLABORATOR_ID,
      currencyCode: 'SAT',
      definitionOwnerUserId: OWNER_ID,
    });

    expect(createHolding).toHaveBeenCalledTimes(1);
    expect(createHolding).toHaveBeenCalledWith({
      userId: COLLABORATOR_ID,
      currencyCode: 'SAT',
      liveRateUpdate: false,
      isDefaultCurrency: false,
      nameOverride: OWNER_DEFINITION.nameOverride,
      symbolOverride: OWNER_DEFINITION.symbolOverride,
      decimalsOverride: OWNER_DEFINITION.decimalsOverride,
      logoUrl: OWNER_DEFINITION.logoUrl,
    });
    expect((findRates.mock.calls[0]![0] as { where: { userId: number } }).where.userId).toBe(OWNER_ID);
    expect(copyRates).toHaveBeenCalledWith([
      { baseCode: 'SAT', quoteCode: 'USD', rate: 0.0006, userId: COLLABORATOR_ID },
      { baseCode: 'USD', quoteCode: 'SAT', rate: 1666.67, userId: COLLABORATOR_ID },
    ]);
    expect(addCurrency).toHaveBeenCalledTimes(1);
    expect(addCurrency).toHaveBeenCalledWith({ userId: COLLABORATOR_ID, currencyCode: 'USD' });
  });

  it('rejects a custom code that neither the user nor the definition owner holds', async () => {
    findCurrency.mockResolvedValue({ code: 'SAT', isCustom: true });
    holdingsOf({ owner: false });
    assertVisible.mockRejectedValue(new Error('invalid code'));

    await expect(
      ensureUserCurrencyConnected({ userId: COLLABORATOR_ID, currencyCode: 'SAT', definitionOwnerUserId: OWNER_ID }),
    ).rejects.toThrow('invalid code');
    await expect(ensureUserCurrencyConnected({ userId: COLLABORATOR_ID, currencyCode: 'SAT' })).rejects.toThrow(
      'invalid code',
    );
    expect(createHolding).not.toHaveBeenCalled();
  });

  it('connects an ISO currency through addCurrency', async () => {
    findCurrency.mockResolvedValue({ code: 'EUR', isCustom: false });
    findHolding.mockResolvedValue(null);

    await ensureUserCurrencyConnected({
      userId: COLLABORATOR_ID,
      currencyCode: 'EUR',
      definitionOwnerUserId: OWNER_ID,
    });

    expect(addCurrency).toHaveBeenCalledWith({ userId: COLLABORATOR_ID, currencyCode: 'EUR' });
    expect(createHolding).not.toHaveBeenCalled();
  });

  it('returns a holding the user already had without another lookup', async () => {
    const existing = { id: 'existing' };
    findHolding.mockResolvedValue(existing);

    await expect(
      ensureUserCurrencyConnected({ userId: COLLABORATOR_ID, currencyCode: 'SAT', definitionOwnerUserId: OWNER_ID }),
    ).resolves.toBe(existing);
    expect(findCurrency).not.toHaveBeenCalled();
    expect(createHolding).not.toHaveBeenCalled();
  });

  it("keeps a collaborator's custom holding that has the owner's decimals", async () => {
    const copy = { ...OWNER_DEFINITION, userId: COLLABORATOR_ID };
    findHolding.mockImplementation(async (options) =>
      (options as { where: { userId: number } }).where.userId === OWNER_ID ? OWNER_DEFINITION : copy,
    );

    await expect(
      ensureUserCurrencyConnected({ userId: COLLABORATOR_ID, currencyCode: 'SAT', definitionOwnerUserId: OWNER_ID }),
    ).resolves.toBe(copy);
  });

  it("rejects a collaborator's own definition of the code when its decimals differ from the owner's", async () => {
    const ownDefinition = { ...OWNER_DEFINITION, userId: COLLABORATOR_ID, decimalsOverride: 0 };
    findHolding.mockImplementation(async (options) =>
      (options as { where: { userId: number } }).where.userId === OWNER_ID ? OWNER_DEFINITION : ownDefinition,
    );

    await expect(
      ensureUserCurrencyConnected({ userId: COLLABORATOR_ID, currencyCode: 'SAT', definitionOwnerUserId: OWNER_ID }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(createHolding).not.toHaveBeenCalled();
  });

  it('adopts a holding a concurrent request inserted while this one waited on the per-user lock', async () => {
    const inserted = { id: 'inserted' };
    findHolding.mockResolvedValueOnce(null).mockResolvedValueOnce(inserted);

    await expect(
      ensureUserCurrencyConnected({ userId: COLLABORATOR_ID, currencyCode: 'SAT', definitionOwnerUserId: OWNER_ID }),
    ).resolves.toBe(inserted);
    expect(lockHoldings).toHaveBeenCalledWith({ userId: COLLABORATOR_ID });
    expect(findCurrency).not.toHaveBeenCalled();
    expect(createHolding).not.toHaveBeenCalled();
    expect(copyRates).not.toHaveBeenCalled();
  });
});
