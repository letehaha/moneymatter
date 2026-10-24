import { ACCOUNT_CATEGORIES, DEPRECIATION_PRESET, VEHICLE_CLASS } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError, ValidationError } from '@js/errors';
import type Vehicles from '@models/vehicles.model';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { createVehicle } from '@services/vehicles/create-vehicle.service';
import { deleteVehicle } from '@services/vehicles/delete-vehicle.service';
import { getVehicle } from '@services/vehicles/get-vehicle.service';
import { getVehicles } from '@services/vehicles/get-vehicles.service';
import { updateVehicle } from '@services/vehicles/update-vehicle.service';
import { createVehicleBodyFields, updateVehicleBodyFields } from '@services/vehicles/zod-schemas';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/vehicles/create-vehicle.service', () => ({ createVehicle: jest.fn() }));
jest.mock('@services/vehicles/update-vehicle.service', () => ({ updateVehicle: jest.fn() }));
jest.mock('@services/vehicles/delete-vehicle.service', () => ({ deleteVehicle: jest.fn() }));
jest.mock('@services/vehicles/get-vehicle.service', () => ({ getVehicle: jest.fn() }));
jest.mock('@services/vehicles/get-vehicles.service', () => ({ getVehicles: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { registerCreateVehicle } from './create-vehicle';
import { registerDeleteVehicle } from './delete-vehicle';
import { registerGetVehicles } from './get-vehicles';
import { registerUpdateVehicle } from './update-vehicle';

const READ_ONLY = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE_ONLY = makeExtra({ scopes: ['finance:read', 'finance:delete'] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });
const READ_ONLY_USER_WITH_SCOPES = makeExtra({ readOnly: true });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const createService = jest.mocked(createVehicle);
const updateService = jest.mocked(updateVehicle);
const deleteService = jest.mocked(deleteVehicle);
const getOneService = jest.mocked(getVehicle);
const getAllService = jest.mocked(getVehicles);

const VEHICLE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_VEHICLE_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

const call = async ({
  tool,
  args,
  extra = READ_ONLY,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

/** A vehicle row with its account as the model returns it, with the fields an assistant has no use for. */
const makeVehicle = (patch: Record<string, unknown> = {}, ownerId = 42) =>
  ({
    id: VEHICLE_ID,
    accountId: ACCOUNT_ID,
    userId: ownerId,
    make: 'Toyota',
    model: 'Camry',
    trim: 'XSE',
    year: 2020,
    vehicleClass: VEHICLE_CLASS.sedan,
    purchasePrice: Money.fromDecimal(25_000.5),
    purchaseDate: '2023-05-01',
    valueAnchor: Money.fromDecimal(22_000),
    valueAnchorDate: '2024-01-01',
    depreciationPreset: DEPRECIATION_PRESET.classDefault,
    customAnnualRatePct: null,
    salvageFloorPct: '10.00',
    currentMileage: 42_000,
    valueLastComputedAt: new Date('2026-10-10T08:00:00.000Z'),
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    updatedAt: new Date('2026-10-10T08:00:00.000Z'),
    account: {
      id: ACCOUNT_ID,
      name: 'Toyota Camry 2020',
      initialBalance: Money.fromDecimal(20_000),
      refInitialBalance: Money.fromDecimal(20_000),
      currentBalance: Money.fromDecimal(19_500.25),
      refCurrentBalance: Money.fromDecimal(19_500.25),
      creditLimit: Money.zero(),
      refCreditLimit: Money.zero(),
      type: 'system',
      accountCategory: ACCOUNT_CATEGORIES.vehicle,
      currencyCode: 'USD',
      userId: ownerId,
      externalId: null,
      status: 'active',
      excludeFromStats: false,
      bankDataProviderConnectionId: null,
      logoDomain: null,
      logoInitials: null,
      logoColor: null,
    },
    ...patch,
  }) as unknown as Vehicles;

/** What an assistant sees of that vehicle. */
const presentedVehicle = (patch: Record<string, unknown> = {}) => ({
  id: VEHICLE_ID,
  accountId: ACCOUNT_ID,
  isOwner: true,
  make: 'Toyota',
  model: 'Camry',
  trim: 'XSE',
  year: 2020,
  vehicleClass: VEHICLE_CLASS.sedan,
  purchasePrice: 25_000.5,
  purchaseDate: '2023-05-01',
  valueAnchor: 22_000,
  valueAnchorDate: '2024-01-01',
  depreciationPreset: DEPRECIATION_PRESET.classDefault,
  customAnnualRatePct: null,
  salvageFloorPct: 10,
  currentMileage: 42_000,
  valueLastComputedAt: '2026-10-10T08:00:00.000Z',
  account: {
    name: 'Toyota Camry 2020',
    currencyCode: 'USD',
    currentBalance: 19_500.25,
    refCurrentBalance: 19_500.25,
    status: 'active',
    excludeFromStats: false,
  },
  ...patch,
});

const VALID_CREATE = {
  name: 'Toyota Camry 2020',
  currencyCode: 'USD',
  make: 'Toyota',
  model: 'Camry',
  year: 2020,
  vehicleClass: VEHICLE_CLASS.sedan,
  purchasePrice: 25_000.5,
  purchaseDate: '2023-05-01',
};

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('get_vehicles', () => {
  const tool = captureTools({ register: registerGetVehicles })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and takes only an optional vehicle id', () => {
    expect(tool.name).toBe('get_vehicles');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['vehicleId']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ vehicleId: VEHICLE_ID }).success).toBe(true);
    expect(schema.safeParse({ vehicleId: 'nope' }).success).toBe(false);
  });

  it('lists the vehicles of the caller slimmed, and works for a read-only user during a base-currency change', async () => {
    lockCheck.mockResolvedValue(true);
    getAllService.mockResolvedValue([makeVehicle(), makeVehicle({ id: OTHER_VEHICLE_ID, make: 'Honda' })] as never);

    const data = (await call({ tool, args: {}, extra: READ_ONLY })) as Record<string, unknown>[];

    expect(getAllService).toHaveBeenCalledWith({ userId: 42 });
    expect(getOneService).not.toHaveBeenCalled();
    expect(data).toEqual([presentedVehicle(), presentedVehicle({ id: OTHER_VEHICLE_ID, make: 'Honda' })]);
  });

  it('returns an empty list for a user without vehicles', async () => {
    getAllService.mockResolvedValue([] as never);

    expect(await call({ tool, args: {} })).toEqual([]);
  });

  it('reads one vehicle for the caller', async () => {
    getOneService.mockResolvedValue(makeVehicle() as never);

    const data = await call({ tool, args: { vehicleId: VEHICLE_ID } });

    expect(getOneService).toHaveBeenCalledWith({ userId: 42, vehicleId: VEHICLE_ID });
    expect(getAllService).not.toHaveBeenCalled();
    expect(data).toEqual(presentedVehicle());
  });

  it('marks a vehicle shared by someone else as not owned', async () => {
    getAllService.mockResolvedValue([makeVehicle({}, 7)] as never);

    const data = (await call({ tool, args: {} })) as { isOwner: boolean }[];

    expect(data[0]!.isOwner).toBe(false);
  });

  it('leaves out the owner, the full account and the audit fields', async () => {
    getOneService.mockResolvedValue(makeVehicle() as never);

    const data = (await call({ tool, args: { vehicleId: VEHICLE_ID } })) as Record<string, unknown>;

    for (const key of ['userId', 'createdAt', 'updatedAt']) expect(data).not.toHaveProperty(key);
    for (const key of ['userId', 'externalId', 'initialBalance', 'creditLimit', 'type', 'logoDomain', 'id']) {
      expect(data.account).not.toHaveProperty(key);
    }
  });

  it("passes another user's vehicle through as the service not-found error", async () => {
    getOneService.mockRejectedValue(new NotFoundError({ message: 'Vehicle not found' }));

    await expect(call({ tool, args: { vehicleId: OTHER_VEHICLE_ID } })).rejects.toThrow('Vehicle not found');
  });

  it('reports a missing vehicle as not found rather than returning null', async () => {
    getOneService.mockResolvedValue(null as never);

    await expect(call({ tool, args: { vehicleId: VEHICLE_ID } })).rejects.toThrow(/vehicles.notFound/);
  });

  it('says what the balance means and how to override the value', () => {
    expect(tool.config.description).toMatch(/estimated|depreciat/i);
    expect(tool.config.description).toMatch(/adjust_account_balance/);
  });
});

describe('create_vehicle', () => {
  const tool = captureTools({ register: registerCreateVehicle })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with every field of the REST body', () => {
    expect(tool.name).toBe('create_vehicle');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      Object.keys(createVehicleBodyFields).toSorted(),
    );
    expect(Object.keys(createVehicleBodyFields).length).toBeGreaterThan(10);
  });

  it('applies the REST validation', () => {
    expect(schema.safeParse(VALID_CREATE).success).toBe(true);
    expect(
      schema.safeParse({
        ...VALID_CREATE,
        trim: null,
        depreciationPreset: DEPRECIATION_PRESET.custom,
        customAnnualRatePct: 12,
        salvageFloorPct: 20,
        currentMileage: 0,
      }).success,
    ).toBe(true);

    const invalid: Record<string, unknown>[] = [
      { purchasePrice: undefined },
      { purchasePrice: 0 },
      { purchasePrice: -5 },
      { name: '' },
      { currencyCode: 'USD1' },
      { currencyCode: 'ZZZ' },
      { make: '' },
      { model: '' },
      { year: 1899 },
      { year: new Date().getFullYear() + 2 },
      { vehicleClass: 'spaceship' },
      { purchaseDate: '2023/05/01' },
      { depreciationPreset: 'turbo' },
      { customAnnualRatePct: 101 },
      { salvageFloorPct: 101 },
      { currentMileage: -1 },
    ];
    for (const patch of invalid) {
      expect([patch, schema.safeParse({ ...VALID_CREATE, ...patch }).success]).toEqual([patch, false]);
    }
  });

  it('creates the vehicle for the caller with the price as Money and returns it slimmed', async () => {
    createService.mockResolvedValue(makeVehicle() as never);

    const data = await call({
      tool,
      args: { ...VALID_CREATE, name: ' Toyota Camry 2020 ', currencyCode: 'usd', trim: 'XSE', currentMileage: 42_000 },
      extra: WRITE,
    });

    expect(createService).toHaveBeenCalledTimes(1);
    const params = createService.mock.calls[0]![0];
    expect(params).toMatchObject({
      userId: 42,
      name: 'Toyota Camry 2020',
      currencyCode: 'USD',
      make: 'Toyota',
      model: 'Camry',
      trim: 'XSE',
      year: 2020,
      vehicleClass: VEHICLE_CLASS.sedan,
      purchaseDate: '2023-05-01',
      currentMileage: 42_000,
    });
    expect(params.purchasePrice).toBeInstanceOf(Money);
    expect(params.purchasePrice.toNumber()).toBe(25_000.5);
    expect(data).toEqual(presentedVehicle());
  });

  it('leaves the depreciation fields to the service defaults when they are omitted', async () => {
    createService.mockResolvedValue(makeVehicle() as never);

    await call({ tool, args: VALID_CREATE, extra: WRITE });

    const params = createService.mock.calls[0]![0];
    expect(params.depreciationPreset).toBeUndefined();
    expect(params.salvageFloorPct).toBeUndefined();
    expect(params.customAnnualRatePct).toBeUndefined();
  });

  it('lets a service error through, such as a custom preset without a rate', async () => {
    createService.mockRejectedValue(new ValidationError({ message: 'customAnnualRatePct is required' }));

    await expect(
      call({ tool, args: { ...VALID_CREATE, depreciationPreset: DEPRECIATION_PRESET.custom }, extra: WRITE }),
    ).rejects.toThrow('customAnnualRatePct is required');
  });

  it('rejects an invalid payload in the handler too, before the service', async () => {
    await expect(call({ tool, args: { ...VALID_CREATE, purchasePrice: 0 }, extra: WRITE })).rejects.toThrow();
    expect(createService).not.toHaveBeenCalled();
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    await expect(call({ tool, args: VALID_CREATE, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args: VALID_CREATE, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: VALID_CREATE, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(createService).not.toHaveBeenCalled();
  });

  it('says how the depreciation is set and that the vehicle gets its own account', () => {
    expect(tool.config.description).toMatch(/depreciationPreset/);
    expect(tool.config.description).toMatch(/customAnnualRatePct/);
    expect(tool.config.description).toMatch(/account/);
  });
});

describe('update_vehicle', () => {
  const tool = captureTools({ register: registerUpdateVehicle })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the vehicle id and every editable field of the REST body, and none of the fixed ones', () => {
    expect(tool.name).toBe('update_vehicle');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['vehicleId', ...Object.keys(updateVehicleBodyFields)].toSorted(),
    );
    for (const locked of ['purchasePrice', 'purchaseDate', 'currencyCode']) {
      expect(tool.config.inputSchema).not.toHaveProperty(locked);
    }
    expect(tool.config.description).toMatch(/purchase price/i);
    expect(tool.config.description).toMatch(/purchase date/i);
    expect(tool.config.description).toMatch(/currency/i);
  });

  it('applies the REST field validation', () => {
    expect(schema.safeParse({ vehicleId: VEHICLE_ID, currentMileage: 50_000 }).success).toBe(true);
    expect(schema.safeParse({ vehicleId: VEHICLE_ID, trim: null, currentMileage: null }).success).toBe(true);

    const invalid: Record<string, unknown>[] = [
      { vehicleId: undefined },
      { name: '' },
      { make: '' },
      { year: 1899 },
      { year: new Date().getFullYear() + 2 },
      { vehicleClass: 'spaceship' },
      { depreciationPreset: 'turbo' },
      { customAnnualRatePct: -1 },
      { salvageFloorPct: 101 },
      { currentMileage: -1 },
    ];
    for (const patch of invalid) {
      expect([patch, schema.safeParse({ vehicleId: VEHICLE_ID, ...patch }).success]).toEqual([patch, false]);
    }
  });

  it('updates the vehicle for the caller without the id in the body and returns it slimmed', async () => {
    updateService.mockResolvedValue(makeVehicle({ currentMileage: 50_000 }) as never);

    const data = await call({
      tool,
      args: { vehicleId: VEHICLE_ID, name: ' Family car ', currentMileage: 50_000, trim: null },
      extra: WRITE,
    });

    expect(updateService).toHaveBeenCalledTimes(1);
    const params = updateService.mock.calls[0]![0];
    expect(params).toEqual({
      userId: 42,
      vehicleId: VEHICLE_ID,
      name: 'Family car',
      currentMileage: 50_000,
      trim: null,
    });
    expect(data).toEqual(presentedVehicle({ currentMileage: 50_000 }));
  });

  it('ignores a fixed field the model sends anyway', async () => {
    updateService.mockResolvedValue(makeVehicle() as never);

    await call({
      tool,
      args: { vehicleId: VEHICLE_ID, make: 'Honda', purchasePrice: 1, purchaseDate: '2000-01-01', currencyCode: 'EUR' },
      extra: WRITE,
    });

    expect(updateService.mock.calls[0]![0]).toEqual({ userId: 42, vehicleId: VEHICLE_ID, make: 'Honda' });
  });

  it("passes another user's vehicle through as the service not-found error", async () => {
    updateService.mockRejectedValue(new NotFoundError({ message: 'Vehicle not found' }));

    await expect(call({ tool, args: { vehicleId: OTHER_VEHICLE_ID, make: 'Honda' }, extra: WRITE })).rejects.toThrow(
      'Vehicle not found',
    );
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { vehicleId: VEHICLE_ID, make: 'Honda' };

    await expect(call({ tool, args, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(updateService).not.toHaveBeenCalled();
  });
});

describe('delete_vehicle', () => {
  const tool = captureTools({ register: registerDeleteVehicle })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name, takes a vehicle id and warns that it is irreversible', () => {
    expect(tool.name).toBe('delete_vehicle');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['vehicleId']);
    expect(schema.safeParse({ vehicleId: VEHICLE_ID }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(tool.config.description).toMatch(/irreversible|permanent/i);
    expect(tool.config.description).toMatch(/account/);
  });

  it('deletes the vehicle for the caller', async () => {
    deleteService.mockResolvedValue({ id: VEHICLE_ID });

    const data = await call({ tool, args: { vehicleId: VEHICLE_ID }, extra: DELETE_ONLY });

    expect(deleteService).toHaveBeenCalledWith({ userId: 42, vehicleId: VEHICLE_ID });
    expect(data).toEqual({ deleted: true, id: VEHICLE_ID });
  });

  it("passes another user's vehicle through as the service not-found error", async () => {
    deleteService.mockRejectedValue(new NotFoundError({ message: 'Vehicle not found' }));

    await expect(call({ tool, args: { vehicleId: OTHER_VEHICLE_ID }, extra: DELETE_ONLY })).rejects.toThrow(
      'Vehicle not found',
    );
  });

  it('refuses a write-only token, a read-only user and a base-currency change, before the service', async () => {
    const args = { vehicleId: VEHICLE_ID };

    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/finance:delete/);
    await expect(
      call({ tool, args, extra: makeExtra({ scopes: ['finance:read', 'finance:delete'], readOnly: true }) }),
    ).rejects.toThrow();
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(LOCKED);
    expect(deleteService).not.toHaveBeenCalled();
  });
});
