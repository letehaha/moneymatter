import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

jest.mock('@services/common/with-transaction', () => ({
  withTransaction: (fn: unknown) => fn,
}));
jest.mock('@models/currencies.model', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('@models/users-currencies.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), update: jest.fn() },
  addCurrency: jest.fn(),
}));

/* eslint-disable import/first */
import Currencies from '@models/currencies.model';
import UsersCurrenciesModel, * as UsersCurrencies from '@models/users-currencies.model';

import { ensureUserCurrencyConnected } from './ensure-currency-connected.service';
/* eslint-enable import/first */

const OWNER_ID = 1;
const COLLABORATOR_ID = 2;

const findCurrency = Currencies.findByPk as jest.Mock<AnyFn>;
const findHolding = UsersCurrenciesModel.findOne as jest.Mock<AnyFn>;
const updateHoldings = UsersCurrenciesModel.update as jest.Mock<AnyFn>;
const addCurrency = UsersCurrencies.addCurrency as jest.Mock<AnyFn>;

describe('ensureUserCurrencyConnected', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    addCurrency.mockImplementation(async () => ({
      userId: COLLABORATOR_ID,
      currencyCode: 'SAT',
      liveRateUpdate: true,
    }));
  });

  it('copies the account owner definition and turns live rates off for a newly connected custom currency', async () => {
    findCurrency.mockResolvedValue({ code: 'SAT', isCustom: true });
    findHolding.mockImplementation(async (options) => {
      const { userId } = (options as { where: { userId: number } }).where;
      return userId === OWNER_ID ? { nameOverride: 'Sats', symbolOverride: 's', decimalsOverride: 8 } : null;
    });

    const connected = await ensureUserCurrencyConnected({
      userId: COLLABORATOR_ID,
      currencyCode: 'SAT',
      definitionOwnerUserId: OWNER_ID,
    });

    expect(updateHoldings).toHaveBeenCalledWith(
      { liveRateUpdate: false, nameOverride: 'Sats', symbolOverride: 's', decimalsOverride: 8 },
      { where: { userId: COLLABORATOR_ID, currencyCode: 'SAT' } },
    );
    expect(connected).toMatchObject({ liveRateUpdate: false, decimalsOverride: 8 });
  });

  it('only turns live rates off when no owner definition is given', async () => {
    findCurrency.mockResolvedValue({ code: 'SAT', isCustom: true });
    findHolding.mockResolvedValue(null);

    await ensureUserCurrencyConnected({ userId: COLLABORATOR_ID, currencyCode: 'SAT' });

    expect(updateHoldings).toHaveBeenCalledWith(
      { liveRateUpdate: false },
      { where: { userId: COLLABORATOR_ID, currencyCode: 'SAT' } },
    );
  });

  it('leaves an ISO currency exactly as addCurrency made it', async () => {
    findCurrency.mockResolvedValue({ code: 'EUR', isCustom: false });
    findHolding.mockResolvedValue(null);

    await ensureUserCurrencyConnected({
      userId: COLLABORATOR_ID,
      currencyCode: 'EUR',
      definitionOwnerUserId: OWNER_ID,
    });

    expect(updateHoldings).not.toHaveBeenCalled();
  });

  it('does not touch a holding the user already had', async () => {
    findHolding.mockResolvedValue({ id: 'existing' });

    await ensureUserCurrencyConnected({
      userId: COLLABORATOR_ID,
      currencyCode: 'SAT',
      definitionOwnerUserId: OWNER_ID,
    });

    expect(findCurrency).not.toHaveBeenCalled();
    expect(updateHoldings).not.toHaveBeenCalled();
  });
});
