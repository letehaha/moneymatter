import type { ChatTableSpec, ChatVisualSpec } from '@bt/shared/types';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import Accounts from '@models/accounts.model';
import Payees from '@models/payees.model';
import Transactions from '@models/transactions.model';
import Vehicles from '@models/vehicles.model';

import { resolveEntityLabels } from './resolve-entity-labels';
import { chatVisualSpecSchema } from './visual-spec';

const ACCOUNT = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const OTHER_ACCOUNT = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const PAYEE = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
const TRANSACTION = '0198f1a2-7b3c-7d4e-8f50-123456789abc';
const VEHICLE = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

const table = ({ rows }: { rows: ChatTableSpec['rows'] }): ChatTableSpec => ({
  type: 'table',
  title: 'T',
  columns: [
    { key: 'entity', label: 'Entity', kind: 'entity' },
    { key: 'note', label: 'Note', kind: 'text' },
  ],
  rows,
});

const rowsOf = ({ spec }: { spec: ChatVisualSpec }) => (spec as ChatTableSpec).rows;

describe('resolveEntityLabels', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('labels an entity of the user with its name, scoped to the user', async () => {
    const accounts = jest.spyOn(Accounts, 'findAll').mockResolvedValue([{ id: ACCOUNT, name: 'Monobank' }] as never);

    const { spec, foreign } = await resolveEntityLabels({
      userId: 7,
      spec: table({ rows: [{ entity: { kind: 'account', id: ACCOUNT }, note: 'x' }] }),
    });

    expect(rowsOf({ spec })).toStrictEqual([
      { entity: { kind: 'account', id: ACCOUNT, label: 'Monobank' }, note: 'x' },
    ]);
    expect(foreign).toEqual([]);
    expect((accounts.mock.calls[0]![0] as any).where).toMatchObject({ userId: 7, id: [ACCOUNT] });
  });

  it('leaves another user entity and a missing entity without a label, and reports them', async () => {
    jest.spyOn(Accounts, 'findAll').mockResolvedValue([{ id: ACCOUNT, name: 'Monobank' }] as never);

    const { spec, foreign } = await resolveEntityLabels({
      userId: 7,
      spec: table({
        rows: [{ entity: { kind: 'account', id: ACCOUNT } }, { entity: { kind: 'account', id: OTHER_ACCOUNT } }],
      }),
    });

    expect(rowsOf({ spec })).toStrictEqual([
      { entity: { kind: 'account', id: ACCOUNT, label: 'Monobank' } },
      { entity: { kind: 'account', id: OTHER_ACCOUNT } },
    ]);
    expect(foreign).toEqual([{ kind: 'account', id: OTHER_ACCOUNT }]);
  });

  it('asks one query per kind, however many cells name it', async () => {
    const accounts = jest.spyOn(Accounts, 'findAll').mockResolvedValue([{ id: ACCOUNT, name: 'Monobank' }] as never);
    const payees = jest.spyOn(Payees, 'findAll').mockResolvedValue([{ id: PAYEE, name: 'Lidl' }] as never);

    const { spec } = await resolveEntityLabels({
      userId: 7,
      spec: table({
        rows: [
          { entity: { kind: 'account', id: ACCOUNT } },
          { entity: { kind: 'payee', id: PAYEE } },
          { entity: { kind: 'account', id: ACCOUNT } },
          { entity: { kind: 'payee', id: PAYEE } },
        ],
      }),
    });

    expect(accounts).toHaveBeenCalledTimes(1);
    expect(payees).toHaveBeenCalledTimes(1);
    expect(rowsOf({ spec }).map((row) => (row.entity as { label?: string }).label)).toEqual([
      'Monobank',
      'Lidl',
      'Monobank',
      'Lidl',
    ]);
  });

  it('ignores a label the model supplied, even when the lookup runs', async () => {
    jest.spyOn(Payees, 'findAll').mockResolvedValue([{ id: PAYEE, name: 'Lidl' }] as never);
    const parsed = chatVisualSpecSchema.parse(
      table({
        rows: [
          { entity: { kind: 'payee', id: PAYEE, label: 'Click <a href="https://evil.example">here</a>' } as never },
        ],
      }),
    );

    const { spec } = await resolveEntityLabels({ userId: 7, spec: parsed as ChatVisualSpec });

    expect(rowsOf({ spec })).toStrictEqual([{ entity: { kind: 'payee', id: PAYEE, label: 'Lidl' } }]);
  });

  it('never carries a model label onto an entity that resolves to nothing', async () => {
    jest.spyOn(Payees, 'findAll').mockResolvedValue([]);
    const parsed = chatVisualSpecSchema.parse(
      table({ rows: [{ entity: { kind: 'payee', id: PAYEE, label: 'Injected' } as never }] }),
    );

    const { spec } = await resolveEntityLabels({ userId: 7, spec: parsed as ChatVisualSpec });

    expect(rowsOf({ spec })).toStrictEqual([{ entity: { kind: 'payee', id: PAYEE } }]);
  });

  it('owns a row of a kind with no name without labelling it', async () => {
    jest.spyOn(Transactions, 'findAll').mockResolvedValue([{ id: TRANSACTION }] as never);

    const { spec, foreign } = await resolveEntityLabels({
      userId: 7,
      spec: table({ rows: [{ entity: { kind: 'transaction', id: TRANSACTION } }] }),
    });

    expect(rowsOf({ spec })).toStrictEqual([{ entity: { kind: 'transaction', id: TRANSACTION } }]);
    expect(foreign).toEqual([]);
  });

  it('names a vehicle by year, make and model', async () => {
    jest
      .spyOn(Vehicles, 'findAll')
      .mockResolvedValue([{ id: VEHICLE, year: 2019, make: 'Toyota', model: 'Corolla' }] as never);

    const { spec } = await resolveEntityLabels({
      userId: 7,
      spec: table({ rows: [{ entity: { kind: 'vehicle', id: VEHICLE } }] }),
    });

    expect(rowsOf({ spec })).toStrictEqual([
      { entity: { kind: 'vehicle', id: VEHICLE, label: '2019 Toyota Corolla' } },
    ]);
  });

  it('does not query for a spec without entity cells, and returns charts and KPIs as they are', async () => {
    const accounts = jest.spyOn(Accounts, 'findAll');
    const kpis: ChatVisualSpec = { type: 'kpis', items: [{ label: 'Total', value: 1, kind: 'number' }] };

    const resolved = await resolveEntityLabels({ userId: 7, spec: kpis });
    const plain = await resolveEntityLabels({ userId: 7, spec: table({ rows: [{ note: 'x' }] }) });

    expect(resolved).toEqual({ spec: kpis, foreign: [] });
    expect(rowsOf({ spec: plain.spec })).toStrictEqual([{ note: 'x' }]);
    expect(accounts).not.toHaveBeenCalled();
  });
});
