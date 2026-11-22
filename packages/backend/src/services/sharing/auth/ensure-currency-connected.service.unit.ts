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
jest.mock('@services/logo-images/logo-images.service', () => ({ copyLogoImageIfPresent: jest.fn() }));
jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));
jest.mock('@js/utils/logger', () => ({ logger: { error: jest.fn() } }));

/* eslint-disable import/first */
import { UnexpectedError, ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrenciesModel, * as UsersCurrencies from '@models/users-currencies.model';
import { assertCurrencyCodesVisible } from '@services/currencies/assert-currency-codes-visible';
import { lockUserCurrencies } from '@services/currencies/lock-user-currencies';
import { copyLogoImageIfPresent } from '@services/logo-images/logo-images.service';

import { ensureUserCurrencyConnected } from './ensure-currency-connected.service';
/* eslint-enable import/first */

const OWNER_ID = 1;
const COLLABORATOR_ID = 2;
const OWNER_DEFINITION = {
  userId: OWNER_ID,
  nameOverride: 'Sats',
  symbolOverride: 's',
  decimalsOverride: 8,
  rateSource: 'coingecko',
  rateSourceConfig: { coinId: 'bitcoin', quoteCurrency: 'USD' },
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: '00000000-0000-4000-8000-000000000001',
};
const COPIED_IMAGE_ID = '00000000-0000-4000-8000-000000000002';

const findCurrency = Currencies.findByPk as jest.Mock<AnyFn>;
const findHolding = UsersCurrenciesModel.findOne as jest.Mock<AnyFn>;
const createHolding = UsersCurrenciesModel.create as jest.Mock<AnyFn>;
const addCurrency = UsersCurrencies.addCurrency as jest.Mock<AnyFn>;
const assertVisible = assertCurrencyCodesVisible as jest.Mock<AnyFn>;
const findRates = UserExchangeRates.findAll as unknown as jest.Mock<AnyFn>;
const copyRates = UserExchangeRates.bulkCreate as unknown as jest.Mock<AnyFn>;
const lockHoldings = lockUserCurrencies as jest.Mock<AnyFn>;
const copyLogoImage = copyLogoImageIfPresent as jest.Mock<AnyFn>;

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
      { baseCode: 'SAT', quoteCode: 'USD', rate: 0.0006, effectiveDate: '2026-01-01', source: 'initial' },
      { baseCode: 'SAT', quoteCode: 'USD', rate: 0.0007, effectiveDate: '2026-02-01', source: 'coingecko' },
    ]);
    copyLogoImage.mockResolvedValue(COPIED_IMAGE_ID);

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
      rateSource: 'manual',
      rateSourceConfig: null,
      logoDomain: OWNER_DEFINITION.logoDomain,
      logoInitials: OWNER_DEFINITION.logoInitials,
      logoColor: OWNER_DEFINITION.logoColor,
      logoIcon: OWNER_DEFINITION.logoIcon,
      logoImageId: COPIED_IMAGE_ID,
    });
    expect(copyLogoImage).toHaveBeenCalledWith({ id: OWNER_DEFINITION.logoImageId });
    expect((findRates.mock.calls[0]![0] as { where: unknown }).where).toEqual({ userId: OWNER_ID, baseCode: 'SAT' });
    expect(copyRates).toHaveBeenCalledWith([
      {
        baseCode: 'SAT',
        quoteCode: 'USD',
        rate: 0.0006,
        effectiveDate: '2026-01-01',
        source: 'initial',
        userId: COLLABORATOR_ID,
      },
      {
        baseCode: 'SAT',
        quoteCode: 'USD',
        rate: 0.0007,
        effectiveDate: '2026-02-01',
        source: 'coingecko',
        userId: COLLABORATOR_ID,
      },
    ]);
    expect(addCurrency).toHaveBeenCalledTimes(1);
    expect(addCurrency).toHaveBeenCalledWith({ userId: COLLABORATOR_ID, currencyCode: 'USD' });
  });

  it("copies the owner's peg, which has no stored rates, and connects the pegged currency", async () => {
    const pegConfig = { pegCurrency: 'EUR', factor: 2 };
    findCurrency.mockResolvedValue({ code: 'SAT', isCustom: true });
    findHolding.mockImplementation(async (options) =>
      (options as { where: { userId: number } }).where.userId === OWNER_ID
        ? { ...OWNER_DEFINITION, rateSource: 'peg', rateSourceConfig: pegConfig }
        : null,
    );
    findRates.mockResolvedValue([]);
    copyLogoImage.mockResolvedValue(COPIED_IMAGE_ID);

    await ensureUserCurrencyConnected({
      userId: COLLABORATOR_ID,
      currencyCode: 'SAT',
      definitionOwnerUserId: OWNER_ID,
    });

    expect(createHolding).toHaveBeenCalledWith(
      expect.objectContaining({ rateSource: 'peg', rateSourceConfig: pegConfig }),
    );
    expect(addCurrency).toHaveBeenCalledWith({ userId: COLLABORATOR_ID, currencyCode: 'EUR' });
  });

  it("refuses an owner's peg whose config cannot be read, and connects nothing", async () => {
    findCurrency.mockResolvedValue({ code: 'SAT', isCustom: true });
    findHolding.mockImplementation(async (options) =>
      (options as { where: { userId: number } }).where.userId === OWNER_ID
        ? { ...OWNER_DEFINITION, rateSource: 'peg', rateSourceConfig: null }
        : null,
    );
    findRates.mockResolvedValue([]);

    await expect(
      ensureUserCurrencyConnected({ userId: COLLABORATOR_ID, currencyCode: 'SAT', definitionOwnerUserId: OWNER_ID }),
    ).rejects.toBeInstanceOf(UnexpectedError);
    expect(createHolding).not.toHaveBeenCalled();
  });

  it('connects the custom currency without its logo image when copying the image fails', async () => {
    findCurrency.mockResolvedValue({ code: 'SAT', isCustom: true });
    holdingsOf({ owner: true });
    findRates.mockResolvedValue([]);
    copyLogoImage.mockRejectedValue(new Error('storage unavailable'));

    await ensureUserCurrencyConnected({
      userId: COLLABORATOR_ID,
      currencyCode: 'SAT',
      definitionOwnerUserId: OWNER_ID,
    });

    expect(createHolding).toHaveBeenCalledWith(expect.objectContaining({ logoImageId: null }));
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
