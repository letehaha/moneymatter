import { FEATURES, USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError, ValidationError } from '@js/errors';
import { archiveLine } from '@services/budget-plans/archive-line';
import { createLine } from '@services/budget-plans/create-line';
import { deleteLine } from '@services/budget-plans/delete-line';
import { setLayout } from '@services/budget-plans/line-groups';
import { restoreLine } from '@services/budget-plans/restore-line';
import { addSuggestedLines } from '@services/budget-plans/suggested-lines';
import { updateLine } from '@services/budget-plans/update-line';
import {
  createLineBodyFields,
  createLineBodySchema,
  setLayoutBodyFields,
  setLayoutBodySchema,
  updateLineBodyFields,
  updateLineBodySchema,
} from '@services/budget-plans/zod-schemas';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/budget-plans/create-line', () => ({ createLine: jest.fn() }));
jest.mock('@services/budget-plans/update-line', () => ({ updateLine: jest.fn() }));
jest.mock('@services/budget-plans/delete-line', () => ({ deleteLine: jest.fn() }));
jest.mock('@services/budget-plans/archive-line', () => ({ archiveLine: jest.fn() }));
jest.mock('@services/budget-plans/restore-line', () => ({ restoreLine: jest.fn() }));
jest.mock('@services/budget-plans/suggested-lines', () => ({ addSuggestedLines: jest.fn() }));
jest.mock('@services/budget-plans/line-groups', () => ({ setLayout: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { registerAddSuggestedBudgetPlanLines } from './add-suggested-budget-plan-lines';
import { registerArchiveBudgetPlanLine } from './archive-budget-plan-line';
import { registerCreateBudgetPlanLine } from './create-budget-plan-line';
import { registerDeleteBudgetPlanLine } from './delete-budget-plan-line';
import { registerSetBudgetPlanLayout } from './set-budget-plan-layout';
import { registerUpdateBudgetPlanLine } from './update-budget-plan-line';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_GROUP_ID = '66666666-6666-4666-8666-666666666666';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CATEGORY_ID = '44444444-4444-4444-8444-444444444444';
const LINE_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_LINE_ID = '77777777-7777-4777-8777-777777777777';

const WITH_PLAN = makeExtra({ features: [FEATURES.budget_plan] });

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const createLineService = jest.mocked(createLine);
const updateLineService = jest.mocked(updateLine);
const deleteLineService = jest.mocked(deleteLine);
const archiveLineService = jest.mocked(archiveLine);
const restoreLineService = jest.mocked(restoreLine);
const addSuggestedLinesService = jest.mocked(addSuggestedLines);
const setLayoutService = jest.mocked(setLayout);

const call = async ({
  tool,
  args,
  extra = WITH_PLAN,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

const LINE_ENTRY = {
  id: LINE_ID,
  name: 'Groceries',
  sortOrder: 3,
  groupId: GROUP_ID,
  activeFrom: '2026-01-01',
  activeUntil: null,
  categoryIds: [CATEGORY_ID],
};

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('create_budget_plan_line', () => {
  const tool = captureTools({ register: registerCreateBudgetPlanLine })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const valid = { planId: PLAN_ID, name: 'Groceries', categoryIds: [CATEGORY_ID] };

  it('registers under its name with the plan id and every field of the REST body', () => {
    expect(tool.name).toBe('create_budget_plan_line');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['planId', ...Object.keys(createLineBodyFields)].toSorted(),
    );
    expect(Object.keys(createLineBodyFields).toSorted()).toEqual([
      'activeFrom',
      'categoryIds',
      'groupId',
      'name',
      'sortOrder',
    ]);
  });

  it('applies the REST validation', () => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(
      schema.safeParse({
        ...valid,
        categoryIds: [CATEGORY_ID, OTHER_CATEGORY_ID],
        sortOrder: 4,
        groupId: GROUP_ID,
        activeFrom: '2026-02-01',
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...valid, groupId: null }).success).toBe(true);

    const invalid: Record<string, unknown>[] = [
      { planId: undefined },
      { planId: 'nope' },
      { name: undefined },
      { name: '  ' },
      { name: 'x'.repeat(201) },
      { categoryIds: undefined },
      { categoryIds: [] },
      { categoryIds: ['nope'] },
      { categoryIds: [CATEGORY_ID, CATEGORY_ID] },
      { sortOrder: 1.5 },
      { sortOrder: '2' },
      { groupId: 'nope' },
      { activeFrom: '2026-02-30' },
      { activeFrom: 'today' },
    ];
    for (const patch of invalid) {
      expect([patch, schema.safeParse({ ...valid, ...patch }).success]).toEqual([patch, false]);
    }
    expect(schema.safeParse({ ...valid, activeUntil: '2026-03-01' }).success).toBe(false);
  });

  it('keeps the REST body schema strict, with the same fields', () => {
    expect(createLineBodySchema.safeParse({ name: 'A', categoryIds: [CATEGORY_ID] }).success).toBe(true);
    expect(createLineBodySchema.safeParse({ name: 'A', categoryIds: [CATEGORY_ID], extra: 1 }).success).toBe(false);
  });

  it('creates the line for the caller with the given fields only and returns it', async () => {
    createLineService.mockResolvedValue(LINE_ENTRY as never);

    const data = await call({ tool, args: { ...valid, name: ' Groceries ' } });

    expect(createLineService).toHaveBeenCalledTimes(1);
    expect(createLineService).toHaveBeenCalledWith({
      userId: 42,
      planId: PLAN_ID,
      name: 'Groceries',
      categoryIds: [CATEGORY_ID],
    });
    expect(data).toEqual(LINE_ENTRY);
  });

  it('passes the optional fields and a null group through', async () => {
    createLineService.mockResolvedValue(LINE_ENTRY as never);

    await call({ tool, args: { ...valid, sortOrder: 0, groupId: null, activeFrom: '2026-02-01' } });

    expect(createLineService).toHaveBeenCalledWith({
      userId: 42,
      planId: PLAN_ID,
      name: 'Groceries',
      categoryIds: [CATEGORY_ID],
      sortOrder: 0,
      groupId: null,
      activeFrom: '2026-02-01',
    });
  });

  it('passes the service refusals through, scoped to the caller', async () => {
    createLineService.mockRejectedValue(new ValidationError({ message: 'Category already budgeted' }));

    await expect(
      call({ tool, args: valid, extra: makeExtra({ userId: 7, features: [FEATURES.budget_plan] }) }),
    ).rejects.toThrow('Category already budgeted');
    expect(createLineService).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
  });

  it('says what the fields mean and what is not accepted', () => {
    expect(tool.config.description).toMatch(/list_budget_plans|get_budget_plan_period/);
    expect(tool.config.description).toMatch(/activeUntil|archive_budget_plan_line/);
  });
});

describe('update_budget_plan_line', () => {
  const tool = captureTools({ register: registerUpdateBudgetPlanLine })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const base = { planId: PLAN_ID, lineId: LINE_ID };

  it('registers under its name with both ids and every field of the REST patch', () => {
    expect(tool.name).toBe('update_budget_plan_line');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['lineId', 'planId', ...Object.keys(updateLineBodyFields)].toSorted(),
    );
    expect(Object.keys(updateLineBodyFields).toSorted()).toEqual([
      'categoryIds',
      'effectiveFrom',
      'groupId',
      'name',
      'sortOrder',
    ]);
  });

  it('applies the REST validation, with both ids required', () => {
    expect(schema.safeParse(base).success).toBe(true);
    expect(
      schema.safeParse({
        ...base,
        name: 'Food',
        sortOrder: 0,
        groupId: null,
        categoryIds: [CATEGORY_ID],
        effectiveFrom: '2026-02-01',
      }).success,
    ).toBe(true);

    const invalid: Record<string, unknown>[] = [
      { planId: undefined },
      { lineId: undefined },
      { lineId: 'nope' },
      { name: '' },
      { sortOrder: 0.5 },
      { groupId: 'nope' },
      { categoryIds: [] },
      { categoryIds: [CATEGORY_ID, CATEGORY_ID] },
      { effectiveFrom: 'soon' },
      // a line's lifetime changes by archiving and restoring, not by patching
      { activeFrom: '2026-02-01' },
      { activeUntil: '2026-02-01' },
      { archived: true },
    ];
    for (const patch of invalid) {
      expect([patch, schema.safeParse({ ...base, ...patch }).success]).toEqual([patch, false]);
    }
  });

  it('refuses effectiveFrom without categoryIds in the REST schema', () => {
    expect(updateLineBodySchema.safeParse({ effectiveFrom: '2026-02-01' }).success).toBe(false);
    expect(updateLineBodySchema.safeParse({ effectiveFrom: '2026-02-01', categoryIds: [CATEGORY_ID] }).success).toBe(
      true,
    );
    expect(updateLineBodySchema.safeParse({ name: 'Food', extra: 1 }).success).toBe(false);
  });

  it('updates the caller line with the given fields only and returns it', async () => {
    updateLineService.mockResolvedValue({ ...LINE_ENTRY, name: 'Food' } as never);

    const data = await call({ tool, args: { ...base, name: 'Food', groupId: null } });

    expect(updateLineService).toHaveBeenCalledWith({
      userId: 42,
      planId: PLAN_ID,
      lineId: LINE_ID,
      name: 'Food',
      groupId: null,
    });
    expect(data).toEqual({ ...LINE_ENTRY, name: 'Food' });
  });

  it('passes the categories with their effective date', async () => {
    updateLineService.mockResolvedValue(LINE_ENTRY as never);

    await call({ tool, args: { ...base, categoryIds: [CATEGORY_ID], effectiveFrom: '2026-02-01' } });

    expect(updateLineService).toHaveBeenCalledWith({
      userId: 42,
      planId: PLAN_ID,
      lineId: LINE_ID,
      categoryIds: [CATEGORY_ID],
      effectiveFrom: '2026-02-01',
    });
  });

  it('rejects effectiveFrom without categoryIds in the handler, with the service not called', async () => {
    await expect(call({ tool, args: { ...base, effectiveFrom: '2026-02-01' } })).rejects.toThrow(
      /effectiveFrom can only be used together with categoryIds/,
    );
    expect(updateLineService).not.toHaveBeenCalled();
  });

  it("passes another user's line through as the service not-found error, scoped to the caller", async () => {
    updateLineService.mockRejectedValue(new NotFoundError({ message: 'Line not found' }));

    await expect(
      call({
        tool,
        args: { ...base, name: 'Food' },
        extra: makeExtra({ userId: 7, features: [FEATURES.budget_plan] }),
      }),
    ).rejects.toThrow('Line not found');
    expect(updateLineService).toHaveBeenCalledWith({ userId: 7, planId: PLAN_ID, lineId: LINE_ID, name: 'Food' });
  });

  it('says that the lifetime and the id are not accepted and that effectiveFrom needs categoryIds', () => {
    expect(tool.config.description).toMatch(/effectiveFrom/);
    expect(tool.config.description).toMatch(/categoryIds/);
    expect(tool.config.description).toMatch(/archive_budget_plan_line/);
    expect(tool.config.description).toMatch(/not accepted|cannot be changed/i);
  });
});

describe('delete_budget_plan_line', () => {
  const tool = captureTools({ register: registerDeleteBudgetPlanLine })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with both ids', () => {
    expect(tool.name).toBe('delete_budget_plan_line');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['lineId', 'planId']);
    expect(schema.safeParse({ planId: PLAN_ID, lineId: LINE_ID }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(false);
    expect(schema.safeParse({ lineId: LINE_ID }).success).toBe(false);
  });

  it('deletes the line of the caller plan', async () => {
    const data = await call({ tool, args: { planId: PLAN_ID, lineId: LINE_ID } });

    expect(deleteLineService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, lineId: LINE_ID });
    expect(data).toEqual({ deleted: true, id: LINE_ID, planId: PLAN_ID });
  });

  it('needs the delete scope, not the write scope', async () => {
    await expect(
      call({
        tool,
        args: { planId: PLAN_ID, lineId: LINE_ID },
        extra: makeExtra({ scopes: ['finance:read', 'finance:write'], features: [FEATURES.budget_plan] }),
      }),
    ).rejects.toThrow(/Missing required scope: finance:delete/);
    expect(deleteLineService).not.toHaveBeenCalled();
  });

  it('warns that it is permanent and points to archiving', () => {
    expect(tool.config.description).toMatch(/irreversible|cannot be undone/i);
    expect(tool.config.description).toMatch(/archive_budget_plan_line/);
  });
});

describe('archive_budget_plan_line', () => {
  const tool = captureTools({ register: registerArchiveBudgetPlanLine })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with both ids and archived, all required', () => {
    expect(tool.name).toBe('archive_budget_plan_line');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['archived', 'lineId', 'planId']);
    expect(schema.safeParse({ planId: PLAN_ID, lineId: LINE_ID, archived: true }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, lineId: LINE_ID, archived: false }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, lineId: LINE_ID }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, lineId: LINE_ID, archived: 'yes' }).success).toBe(false);
  });

  it('archives the line when archived is true', async () => {
    const data = await call({ tool, args: { planId: PLAN_ID, lineId: LINE_ID, archived: true } });

    expect(archiveLineService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, lineId: LINE_ID });
    expect(restoreLineService).not.toHaveBeenCalled();
    expect(data).toEqual({ archived: true, id: LINE_ID, planId: PLAN_ID });
  });

  it('restores the line and returns it when archived is false', async () => {
    restoreLineService.mockResolvedValue(LINE_ENTRY as never);

    const data = await call({ tool, args: { planId: PLAN_ID, lineId: LINE_ID, archived: false } });

    expect(restoreLineService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, lineId: LINE_ID });
    expect(archiveLineService).not.toHaveBeenCalled();
    expect(data).toEqual(LINE_ENTRY);
  });

  it('passes the already-archived refusal through', async () => {
    archiveLineService.mockRejectedValue(new Error('budgetPlans.lineAlreadyArchived'));

    await expect(call({ tool, args: { planId: PLAN_ID, lineId: LINE_ID, archived: true } })).rejects.toThrow(
      'budgetPlans.lineAlreadyArchived',
    );
  });

  it('says what archiving does and how to bring a line back', () => {
    expect(tool.config.description).toMatch(/archived: false/);
    expect(tool.config.description).toMatch(/current period/i);
  });
});

describe('add_suggested_budget_plan_lines', () => {
  const tool = captureTools({ register: registerAddSuggestedBudgetPlanLines })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the plan id and the optional answers', () => {
    expect(tool.name).toBe('add_suggested_budget_plan_lines');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['answers', 'planId']);
    expect(schema.safeParse({ planId: PLAN_ID }).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, answers: {} }).success).toBe(true);
    expect(
      schema.safeParse({ planId: PLAN_ID, answers: { detail: 'compact', focusCategoryIds: [CATEGORY_ID] } }).success,
    ).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, answers: { detail: 'whatever' } }).success).toBe(false);
    expect(schema.safeParse({ planId: PLAN_ID, answers: { unknownKey: 1 } }).success).toBe(false);
    expect(
      schema.safeParse({ planId: PLAN_ID, answers: { focusCategoryIds: [CATEGORY_ID, CATEGORY_ID] } }).success,
    ).toBe(false);
  });

  it('adds the lines with no answers by default', async () => {
    addSuggestedLinesService.mockResolvedValue({ created: 5 });

    const data = await call({ tool, args: { planId: PLAN_ID } });

    expect(addSuggestedLinesService).toHaveBeenCalledTimes(1);
    expect(addSuggestedLinesService).toHaveBeenCalledWith({ userId: 42, planId: PLAN_ID, answers: undefined });
    expect(data).toEqual({ created: 5 });
  });

  it('passes the answers through and reports when they were ignored', async () => {
    addSuggestedLinesService.mockResolvedValue({ created: 3, answersIgnored: true });

    const data = await call({
      tool,
      args: { planId: PLAN_ID, answers: { detail: 'compact', pets: 'dog' } },
    });

    expect(addSuggestedLinesService).toHaveBeenCalledWith({
      userId: 42,
      planId: PLAN_ID,
      answers: { detail: 'compact', pets: 'dog' },
    });
    expect(data).toEqual({ created: 3, answersIgnored: true });
  });

  it('reports zero lines created when nothing could be suggested', async () => {
    addSuggestedLinesService.mockResolvedValue({ created: 0 });

    expect(await call({ tool, args: { planId: PLAN_ID } })).toEqual({ created: 0 });
  });

  it('says it may use the AI of the server and falls back to spending-based lines', () => {
    expect(tool.config.description).toMatch(/AI/);
    expect(tool.config.description).toMatch(/spending/i);
    expect(tool.config.description).toMatch(/answersIgnored/);
  });
});

describe('set_budget_plan_layout', () => {
  const tool = captureTools({ register: registerSetBudgetPlanLayout })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const valid = {
    planId: PLAN_ID,
    groups: [{ id: GROUP_ID, lineIds: [LINE_ID] }],
    ungroupedLineIds: [OTHER_LINE_ID],
  };

  it('registers under its name with the plan id and every field of the REST body', () => {
    expect(tool.name).toBe('set_budget_plan_layout');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['planId', ...Object.keys(setLayoutBodyFields)].toSorted(),
    );
    expect(Object.keys(setLayoutBodyFields).toSorted()).toEqual(['groups', 'ungroupedLineIds']);
  });

  it('applies the REST validation', () => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ planId: PLAN_ID, groups: [], ungroupedLineIds: [] }).success).toBe(true);

    const invalid: Record<string, unknown>[] = [
      { groups: undefined },
      { ungroupedLineIds: undefined },
      { groups: [{ id: 'nope', lineIds: [] }] },
      { groups: [{ id: GROUP_ID }] },
      { groups: [{ id: GROUP_ID, lineIds: [LINE_ID, LINE_ID] }] },
      { groups: [{ id: GROUP_ID, lineIds: [], name: 'Fixed' }] },
      { ungroupedLineIds: ['nope'] },
      { ungroupedLineIds: [LINE_ID, LINE_ID] },
    ];
    for (const patch of invalid) {
      expect([patch, schema.safeParse({ ...valid, ...patch }).success]).toEqual([patch, false]);
    }
    expect(setLayoutBodySchema.safeParse({ groups: [], ungroupedLineIds: [], extra: 1 }).success).toBe(false);
  });

  it('sets the layout of the caller plan and reports the counts', async () => {
    const args = {
      planId: PLAN_ID,
      groups: [
        { id: GROUP_ID, lineIds: [LINE_ID] },
        { id: OTHER_GROUP_ID, lineIds: [] },
      ],
      ungroupedLineIds: [OTHER_LINE_ID],
    };

    const data = await call({ tool, args });

    expect(setLayoutService).toHaveBeenCalledTimes(1);
    expect(setLayoutService).toHaveBeenCalledWith({
      userId: 42,
      planId: PLAN_ID,
      groups: args.groups,
      ungroupedLineIds: [OTHER_LINE_ID],
    });
    expect(data).toEqual({ updated: true, planId: PLAN_ID });
  });

  it('passes an invalid layout refusal through', async () => {
    setLayoutService.mockRejectedValue(new ValidationError({ message: 'budgetPlans.layoutInvalid' }));

    await expect(call({ tool, args: valid })).rejects.toThrow('budgetPlans.layoutInvalid');
  });

  it('says every group must be listed once', () => {
    expect(tool.config.description).toMatch(/every group/i);
    expect(tool.config.description).toMatch(/once/i);
    expect(tool.config.description).toMatch(/get_budget_plan_period/);
  });
});

const LINE_TOOLS = [
  {
    register: registerCreateBudgetPlanLine,
    name: 'create_budget_plan_line',
    result: LINE_ENTRY,
    args: { planId: PLAN_ID, name: 'Groceries', categoryIds: [CATEGORY_ID] },
    service: createLineService,
    scopes: ['finance:read', 'finance:write'],
  },
  {
    register: registerUpdateBudgetPlanLine,
    name: 'update_budget_plan_line',
    result: LINE_ENTRY,
    args: { planId: PLAN_ID, lineId: LINE_ID, name: 'Food' },
    service: updateLineService,
    scopes: ['finance:read', 'finance:write'],
  },
  {
    register: registerDeleteBudgetPlanLine,
    name: 'delete_budget_plan_line',
    result: undefined,
    args: { planId: PLAN_ID, lineId: LINE_ID },
    service: deleteLineService,
    scopes: ['finance:read', 'finance:delete'],
  },
  {
    register: registerArchiveBudgetPlanLine,
    name: 'archive_budget_plan_line',
    result: undefined,
    args: { planId: PLAN_ID, lineId: LINE_ID, archived: true },
    service: archiveLineService,
    scopes: ['finance:read', 'finance:write'],
  },
  {
    register: registerArchiveBudgetPlanLine,
    name: 'archive_budget_plan_line',
    result: LINE_ENTRY,
    args: { planId: PLAN_ID, lineId: LINE_ID, archived: false },
    service: restoreLineService,
    scopes: ['finance:read', 'finance:write'],
  },
  {
    register: registerAddSuggestedBudgetPlanLines,
    name: 'add_suggested_budget_plan_lines',
    result: { created: 2 },
    args: { planId: PLAN_ID },
    service: addSuggestedLinesService,
    scopes: ['finance:read', 'finance:write'],
  },
  {
    register: registerSetBudgetPlanLayout,
    name: 'set_budget_plan_layout',
    result: undefined,
    args: { planId: PLAN_ID, groups: [], ungroupedLineIds: [] },
    service: setLayoutService,
    scopes: ['finance:read', 'finance:write'],
  },
];

describe.each(LINE_TOOLS)('$name write guards', ({ register, name, args, service, scopes, result }) => {
  const tool = captureTools({ register }).find((candidate) => candidate.name === name)!;
  const ok = makeExtra({ scopes, features: [FEATURES.budget_plan] });

  it('is refused while the base-currency lock is set, with the service not called', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler(args, ok)).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(service).not.toHaveBeenCalled();
  });

  it('is refused for a demo user, with the service not called', async () => {
    await expect(
      tool.handler(args, makeExtra({ scopes, role: USER_ROLES.demo, features: [FEATURES.budget_plan] })),
    ).rejects.toThrow(/demo mode/);
    expect(service).not.toHaveBeenCalled();
  });

  it('is refused for a read-only user, with the service not called', async () => {
    await expect(
      tool.handler(args, makeExtra({ scopes, readOnly: true, features: [FEATURES.budget_plan] })),
    ).rejects.toThrow(/no longer includes editing/);
    expect(service).not.toHaveBeenCalled();
  });

  it('is refused without its scope, with the service not called', async () => {
    await expect(
      tool.handler(args, makeExtra({ scopes: ['finance:read'], features: [FEATURES.budget_plan] })),
    ).rejects.toThrow(/Missing required scope/);
    expect(service).not.toHaveBeenCalled();
  });

  it('is refused without the budget plan feature, with the service not called', async () => {
    await expect(tool.handler(args, makeExtra({ scopes, features: [] }))).rejects.toThrow(
      /not included in your current plan/,
    );
    expect(service).not.toHaveBeenCalled();
  });

  it('is refused when the plan carries other features only', async () => {
    await expect(tool.handler(args, makeExtra({ scopes, features: [FEATURES.attachments] }))).rejects.toThrow(
      /not included in your current plan/,
    );
    expect(service).not.toHaveBeenCalled();
  });

  it('checks the scope before the feature', async () => {
    await expect(tool.handler(args, makeExtra({ scopes: ['finance:read'], features: [] }))).rejects.toThrow(
      /Missing required scope/,
    );
  });

  it('runs with the budget plan feature and a free lock', async () => {
    service.mockResolvedValue(result as never);
    await tool.handler(args, ok);

    expect(service).toHaveBeenCalledTimes(1);
  });
});
