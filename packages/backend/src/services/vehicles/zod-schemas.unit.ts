import { DEPRECIATION_PRESET, VEHICLE_CLASS } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

import {
  createVehicleBodyFields,
  createVehicleBodySchema,
  updateVehicleBodyFields,
  updateVehicleBodySchema,
  vehicleIdParamsSchema,
} from './zod-schemas';

const VALID_CREATE = {
  name: ' Camry ',
  currencyCode: 'usd',
  make: ' Toyota ',
  model: 'Camry',
  year: 2020,
  vehicleClass: VEHICLE_CLASS.sedan,
  purchasePrice: 25_000.5,
  purchaseDate: '2023-05-01',
};

describe('createVehicleBodySchema', () => {
  it('is built from the exported fields, which carry a plain number for the price', () => {
    const fields = z.object(createVehicleBodyFields);

    expect(Object.keys(createVehicleBodyFields).toSorted()).toEqual(
      [
        'currencyCode',
        'currentMileage',
        'customAnnualRatePct',
        'depreciationPreset',
        'make',
        'model',
        'name',
        'purchaseDate',
        'purchasePrice',
        'salvageFloorPct',
        'trim',
        'vehicleClass',
        'year',
      ].toSorted(),
    );
    expect(fields.safeParse(VALID_CREATE).success).toBe(true);
    expect(fields.parse(VALID_CREATE).purchasePrice).toBe(25_000.5);
  });

  it('turns the price into Money, trims the text and upper-cases the currency', () => {
    const body = createVehicleBodySchema.parse(VALID_CREATE);

    expect(body.purchasePrice).toBeInstanceOf(Money);
    expect(body.purchasePrice.toNumber()).toBe(25_000.5);
    expect(body.name).toBe('Camry');
    expect(body.make).toBe('Toyota');
    expect(body.currencyCode).toBe('USD');
  });

  it('leaves the optional fields undefined when omitted and keeps null where it clears', () => {
    const bare = createVehicleBodySchema.parse(VALID_CREATE);
    expect(bare.trim).toBeUndefined();
    expect(bare.depreciationPreset).toBeUndefined();
    expect(bare.salvageFloorPct).toBeUndefined();

    const cleared = createVehicleBodySchema.parse({ ...VALID_CREATE, trim: null, currentMileage: null });
    expect(cleared.trim).toBeNull();
    expect(cleared.currentMileage).toBeNull();
  });

  it('accepts every optional field', () => {
    const body = createVehicleBodySchema.parse({
      ...VALID_CREATE,
      trim: 'XSE',
      depreciationPreset: DEPRECIATION_PRESET.custom,
      customAnnualRatePct: 12.5,
      salvageFloorPct: 20,
      currentMileage: 42_000,
    });

    expect(body).toMatchObject({
      trim: 'XSE',
      depreciationPreset: DEPRECIATION_PRESET.custom,
      customAnnualRatePct: 12.5,
      salvageFloorPct: 20,
      currentMileage: 42_000,
    });
  });

  it('rejects every body that breaks a field rule', () => {
    const invalid: Record<string, unknown>[] = [
      { purchasePrice: 0 },
      { purchasePrice: -1 },
      { purchasePrice: 'a lot' },
      { name: '' },
      { name: 'x'.repeat(201) },
      { make: '' },
      { make: 'x'.repeat(101) },
      { model: '' },
      { trim: 'x'.repeat(101) },
      { currencyCode: 'USD1' },
      { currencyCode: 'ZZZ' },
      { year: 1899 },
      { year: new Date().getFullYear() + 2 },
      { year: 2020.5 },
      { vehicleClass: 'spaceship' },
      { purchaseDate: '2023/05/01' },
      { purchaseDate: '01-05-2023' },
      { depreciationPreset: 'turbo' },
      { customAnnualRatePct: -1 },
      { customAnnualRatePct: 101 },
      { salvageFloorPct: -1 },
      { salvageFloorPct: 101 },
      { currentMileage: -1 },
      { currentMileage: 1.5 },
      { purchasePrice: undefined },
      { currencyCode: undefined },
      { purchaseDate: undefined },
    ];

    for (const patch of invalid) {
      expect([patch, createVehicleBodySchema.safeParse({ ...VALID_CREATE, ...patch }).success]).toEqual([patch, false]);
    }
  });

  it('accepts the edges of the numeric ranges', () => {
    for (const patch of [
      { year: 1900 },
      { year: new Date().getFullYear() + 1 },
      { customAnnualRatePct: 0 },
      { customAnnualRatePct: 100 },
      { salvageFloorPct: 0 },
      { salvageFloorPct: 100 },
      { currentMileage: 0 },
    ]) {
      expect([patch, createVehicleBodySchema.safeParse({ ...VALID_CREATE, ...patch }).success]).toEqual([patch, true]);
    }
  });
});

describe('updateVehicleBodySchema', () => {
  it('is built from the exported fields: the editable ones only', () => {
    const fields = z.object(updateVehicleBodyFields);

    expect(Object.keys(updateVehicleBodyFields).toSorted()).toEqual(
      [
        'currentMileage',
        'customAnnualRatePct',
        'depreciationPreset',
        'make',
        'model',
        'name',
        'salvageFloorPct',
        'trim',
        'vehicleClass',
        'year',
      ].toSorted(),
    );
    for (const locked of ['purchasePrice', 'purchaseDate', 'currencyCode']) {
      expect(updateVehicleBodyFields).not.toHaveProperty(locked);
    }
    expect(fields.safeParse({}).success).toBe(true);
    expect(fields.parse({ year: 2021 }).year).toBe(2021);
  });

  it('accepts a partial patch, nulls that clear and an empty patch, as the REST body does', () => {
    expect(updateVehicleBodySchema.parse({ name: ' Family car ', trim: null, currentMileage: null })).toEqual({
      name: 'Family car',
      trim: null,
      currentMileage: null,
    });
    expect(updateVehicleBodySchema.parse({})).toEqual({});
  });

  it('rejects every patch that breaks a field rule', () => {
    const invalid: Record<string, unknown>[] = [
      { name: '' },
      { make: '' },
      { model: '' },
      { trim: 'x'.repeat(101) },
      { year: 1899 },
      { year: new Date().getFullYear() + 2 },
      { vehicleClass: 'spaceship' },
      { depreciationPreset: 'turbo' },
      { customAnnualRatePct: -1 },
      { customAnnualRatePct: 101 },
      { salvageFloorPct: 101 },
      { currentMileage: -5 },
      { currentMileage: 0.5 },
    ];

    for (const patch of invalid) {
      expect([patch, updateVehicleBodySchema.safeParse(patch).success]).toEqual([patch, false]);
    }
  });
});

describe('vehicleIdParamsSchema', () => {
  it('takes a record id', () => {
    expect(vehicleIdParamsSchema.safeParse({ id: '11111111-1111-4111-8111-111111111111' }).success).toBe(true);
    expect(vehicleIdParamsSchema.safeParse({ id: 'nope' }).success).toBe(false);
    expect(vehicleIdParamsSchema.safeParse({}).success).toBe(false);
  });
});
