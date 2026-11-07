import { FEATURES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));
jest.mock('@js/utils/posthog', () => ({
  ...jest.requireActual<object>('@js/utils/posthog'),
  trackMcpToolUsed: jest.fn(),
}));

import { trackMcpToolUsed } from '@js/utils/posthog';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import * as entitlementsService from '@services/entitlements/resolve-entitlements.service';

import { defineTool, type ToolAccess, validateToolArgs } from './define-tool';

const ID = '019f7e9e-b5f4-729c-9881-9544b15f4e3d';
const READ = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE = makeExtra({ scopes: ['finance:read', 'finance:delete'] });

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const run = jest.fn(() => ({ ok: true }));

const toolOf = ({
  access,
  lock,
  feature,
}: {
  access: ToolAccess;
  lock?: boolean;
  feature?: typeof FEATURES.budget_plan;
}) =>
  captureTools({
    register: defineTool({
      name: 'some_tool',
      toolset: 'core',
      access,
      lock,
      feature,
      description: 'Does a thing.',
      input: { id: z.string() },
      run,
    }),
  })[0]!;

beforeEach(() => {
  jest.clearAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('registerDefinedTool', () => {
  it('registers a strict input schema that rejects unknown keys', () => {
    const { inputSchema } = toolOf({ access: 'read' }).config;

    expect(inputSchema!.safeParse({ id: ID }).success).toBe(true);
    expect(inputSchema!.safeParse({ id: ID, extra: 1 }).success).toBe(false);
  });

  it('appends the scope sentence and sets the annotations from access', () => {
    const read = toolOf({ access: 'read' });
    const write = toolOf({ access: 'write' });
    const del = toolOf({ access: 'delete' });

    expect(read.config.description).toBe('Does a thing.');
    expect(write.config.description).toBe('Does a thing. Requires finance:write scope.');
    expect(del.config.description).toBe('Does a thing. Requires finance:delete scope.');
    expect(read.config.annotations).toEqual({ readOnlyHint: true });
    expect(write.config.annotations).toEqual({ readOnlyHint: false });
    expect(del.config.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
  });

  it('runs a read tool for a read-only token, tracks it and wraps the result in jsonContent', async () => {
    const result = await toolOf({ access: 'read' }).handler(
      { id: ID },
      { authInfo: { ...READ.authInfo, clientId: 'client-1' } },
    );

    expect(parseToolResult({ result })).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, args: { id: ID } }));
    expect(trackMcpToolUsed).toHaveBeenCalledWith({ userId: 42, tool: 'some_tool', clientId: 'client-1' });
  });

  it('checks the scope before the lock, the feature and tracking', async () => {
    lockCheck.mockResolvedValue(true);
    const tool = toolOf({ access: 'write', feature: FEATURES.budget_plan });

    await expect(tool.handler({ id: ID }, READ)).rejects.toThrow(/no longer includes editing/);
    expect(lockCheck).not.toHaveBeenCalled();
    expect(entitlementsService.getEntitlementsByUserId).not.toHaveBeenCalled();
    expect(trackMcpToolUsed).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('requires the scope of its access', async () => {
    await expect(toolOf({ access: 'write' }).handler({ id: ID }, READ)).rejects.toThrow(/no longer includes editing/);
    await expect(toolOf({ access: 'write' }).handler({ id: ID }, DELETE)).rejects.toThrow(/finance:write/);
    await expect(toolOf({ access: 'delete' }).handler({ id: ID }, WRITE)).rejects.toThrow(/finance:delete/);
    expect(run).not.toHaveBeenCalled();

    await toolOf({ access: 'write' }).handler({ id: ID }, WRITE);
    await toolOf({ access: 'delete' }).handler({ id: ID }, DELETE);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('checks the lock on writes and deletes by default and follows an explicit lock', async () => {
    lockCheck.mockResolvedValue(true);

    await expect(toolOf({ access: 'write' }).handler({ id: ID }, WRITE)).rejects.toThrow(
      /baseCurrencyChangeInProgress/,
    );
    await expect(toolOf({ access: 'delete' }).handler({ id: ID }, DELETE)).rejects.toThrow(
      /baseCurrencyChangeInProgress/,
    );
    await expect(toolOf({ access: 'read', lock: true }).handler({ id: ID }, READ)).rejects.toThrow(
      /baseCurrencyChangeInProgress/,
    );
    expect(run).not.toHaveBeenCalled();

    await toolOf({ access: 'read' }).handler({ id: ID }, READ);
    await toolOf({ access: 'write', lock: false }).handler({ id: ID }, WRITE);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('refuses a gated tool when the plan lacks the feature', async () => {
    const tool = toolOf({ access: 'write', feature: FEATURES.budget_plan });

    await expect(tool.handler({ id: ID }, WRITE)).rejects.toThrow(/Upgrade/);
    expect(run).not.toHaveBeenCalled();

    await tool.handler({ id: ID }, makeExtra({ scopes: ['finance:write'], features: [FEATURES.budget_plan] }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('calls a tool without input as (extra)', async () => {
    const [tool] = captureTools({
      register: defineTool({ name: 'no_input', toolset: 'core', access: 'read', description: 'X.', run }),
    });

    expect(tool!.config.inputSchema).toBeUndefined();
    expect(parseToolResult({ result: await tool!.handler(READ) })).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, args: {} }));
  });
});

describe('validate', () => {
  const validatedTool = () =>
    defineTool({
      name: 'validated_tool',
      toolset: 'core',
      access: 'write',
      description: 'Does a thing.',
      input: { from: z.number(), to: z.number() },
      validate: ({ args }) => {
        if (args.from > args.to) throw new Error('"from" must not exceed "to"');
        return { span: args.to - args.from };
      },
      run,
    });

  it('hands run what validate returns, after the guards', async () => {
    const [tool] = captureTools({ register: validatedTool() });

    await tool!.handler({ from: 2, to: 5 }, WRITE);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, args: { span: 3 } }));
  });

  it('refuses a bad input without running the tool', async () => {
    const [tool] = captureTools({ register: validatedTool() });

    await expect(tool!.handler({ from: 5, to: 2 }, WRITE)).rejects.toThrow(/"from" must not exceed "to"/);
    expect(run).not.toHaveBeenCalled();
  });

  it('checks the scope before validating', async () => {
    const validate = jest.fn(() => ({}));
    const [tool] = captureTools({
      register: defineTool({ name: 'x', toolset: 'core', access: 'write', description: 'X.', validate, run }),
    });

    await expect(tool!.handler(READ)).rejects.toThrow(/no longer includes editing/);
    expect(validate).not.toHaveBeenCalled();
  });

  it('runs validate alone through validateToolArgs, and passes the args through for a tool without one', () => {
    expect(validateToolArgs({ def: validatedTool(), args: { from: 1, to: 4 } })).toEqual({ span: 3 });
    expect(() => validateToolArgs({ def: validatedTool(), args: { from: 4, to: 1 } })).toThrow(/must not exceed/);
    expect(run).not.toHaveBeenCalled();

    const plain = defineTool({ name: 'plain', toolset: 'core', access: 'read', description: 'X.', run });
    expect(validateToolArgs({ def: plain, args: { id: ID } })).toEqual({ id: ID });
  });
});
