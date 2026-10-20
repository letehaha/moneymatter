import {
  CHAT_ANALYSIS_MAX_ROWS,
  CHAT_MAX_ANALYSES,
  CHAT_READ_RESULT_MAX_CHARS,
  type ChatChartSpec,
  type ChatKpisSpec,
  type ChatRunEvent,
  type ChatTableSpec,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import ChatProposals from '@models/chat-proposals.model';
import * as usersCurrencies from '@models/users-currencies.model';
import { CHAT_TEST_USER_ID, makeChatRun, stubCatalog } from '@tests/helpers/chat-toolkit';

// The import chains of the services behind the catalog's tools open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));
// Storing a card opens a transaction; a unit test has no database, so the body just runs.
jest.mock('@services/common/with-transaction', () => ({
  withTransaction: <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => fn,
}));
jest.mock('../../mcp/auth', () => ({ buildMcpAuthInfo: jest.fn() }));
jest.mock('../visuals/resolve-entity-labels', () => ({ resolveEntityLabels: jest.fn() }));
jest.mock('../sandbox/run-sandboxed-analysis', () => ({ runSandboxedAnalysis: jest.fn() }));

import { buildMcpAuthInfo } from '../../mcp/auth';
import { PREVIEW_RESOLVERS } from '../proposals/previews';
import { runSandboxedAnalysis, type AnalysisOutput } from '../sandbox/run-sandboxed-analysis';
import { resolveEntityLabels } from '../visuals/resolve-entity-labels';
import { buildChatToolkit } from './build-toolkit';
import type { ChatToolkit } from './types';

const ACCOUNT = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';

const CHART: ChatChartSpec = {
  type: 'chart',
  kind: 'bar',
  title: 'Spend by month',
  unit: { kind: 'money', currencyCode: 'USD' },
  xAxis: { type: 'category', values: ['Aug', 'Sep'] },
  series: [{ name: 'Spend', values: [100, 120] }],
};

const TABLE: ChatTableSpec = {
  type: 'table',
  title: 'Top payees',
  columns: [
    { key: 'payee', label: 'Payee', kind: 'text' },
    { key: 'total', label: 'Total', kind: 'money', currencyCode: 'USD' },
  ],
  rows: [{ payee: 'Cafe', total: 42 }],
};

const KPIS: ChatKpisSpec = { type: 'kpis', items: [{ label: 'Total', value: 10, kind: 'number' }] };

const OUTPUT: AnalysisOutput = {
  values: { total: 220 },
  charts: { monthly: CHART },
  tables: { top: TABLE },
  kpis: { headline: KPIS },
};

const sandboxOk = ({ output = OUTPUT }: { output?: AnalysisOutput } = {}) => ({
  ok: true as const,
  output: output as AnalysisOutput,
  durationMs: 12,
});

const rows = ({ count, from = 0 }: { count: number; from?: number }) =>
  Array.from({ length: count }, (_, index) => ({ id: `tx-${from + index}`, amount: from + index }));

const setup = ({
  implementations,
  runOverrides,
}: {
  implementations?: Record<string, (args: unknown) => unknown>;
  runOverrides?: Parameters<typeof makeChatRun>[0];
} = {}) => {
  const { run, events } = makeChatRun(runOverrides);
  const catalog = stubCatalog({ implementations });
  const toolkit = buildChatToolkit({ run, catalog });
  const handler = ({ name }: { name: string }) =>
    catalog.find((entry) => entry.name === name)!.invoke as unknown as jest.Mock<
      (...args: unknown[]) => Promise<unknown>
    >;

  return { run, events, toolkit, handler };
};

const call = async ({
  toolkit,
  name,
  input = {},
  callId,
}: {
  toolkit: ChatToolkit;
  name: string;
  input?: unknown;
  callId?: string;
}) => {
  const tool = toolkit.getTool({ name });
  expect(tool).toBeDefined();
  return tool!.execute({ input, callId });
};

const fromCallInput = (name: string) => ({ name, fromCall: 'c1' });

const searchInput = (name: string) => ({ name, tool: 'search_securities', args: { query: 'apple' } });

const sandboxCalls = () => jest.mocked(runSandboxedAnalysis).mock.calls.map(([params]) => params);

const analysisParts = ({ events }: { events: ChatRunEvent[] }) =>
  events.flatMap((event) => (event.type === 'part.started' && event.part.type === 'analysis' ? [event.part] : []));

const partUpdates = ({ events }: { events: ChatRunEvent[] }) =>
  events.flatMap((event) => (event.type === 'part.updated' ? [event] : []));

const noticesIn = ({ events }: { events: ChatRunEvent[] }) =>
  events.flatMap((event) => (event.type === 'part.started' && event.part.type === 'notice' ? [event.part] : []));

const analysisIdOf = ({ text }: { text: string }) => {
  const match = /"analysisId":"([0-9a-f-]{36})"/.exec(text);
  expect(match).not.toBeNull();
  return match![1]!;
};

describe('run_analysis', () => {
  beforeEach(() => {
    jest.mocked(buildMcpAuthInfo).mockReset();
    jest.mocked(buildMcpAuthInfo).mockImplementation((async ({ user, clientId, scopes, token }: any) => ({
      token,
      clientId,
      scopes,
      extra: { userId: user.id, authUserId: user.authUserId, username: user.username, role: user.role },
    })) as never);
    jest.mocked(resolveEntityLabels).mockReset();
    jest.mocked(resolveEntityLabels).mockImplementation((async ({ spec }: any) => ({ spec, foreign: [] })) as never);
    jest.mocked(runSandboxedAnalysis).mockReset();
    jest.mocked(runSandboxedAnalysis).mockImplementation((async () => sandboxOk()) as never);
    for (const key of Object.keys(PREVIEW_RESOLVERS)) delete (PREVIEW_RESOLVERS as Record<string, unknown>)[key];
    jest.spyOn(ChatProposals, 'create').mockImplementation((async (values: any) => ({
      ...values,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as never);
    jest.spyOn(ChatProposals, 'findAll').mockResolvedValue([]);
    jest.spyOn(ChatProposals, 'findOne').mockResolvedValue(null);
    jest.spyOn(usersCurrencies, 'getBaseCurrency').mockResolvedValue({ currencyCode: 'USD' } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('the tool', () => {
    it('is a chat-native tool, offered on every step, and takes code and named inputs', () => {
      const { toolkit } = setup();
      const tool = toolkit.getTool({ name: 'run_analysis' });

      expect(tool?.kind).toBe('native');
      expect(toolkit.activeToolNames()).toContain('run_analysis');
      expect(tool?.modelSchema).toMatchObject({ type: 'object', required: ['code'] });
      expect(Object.keys((tool!.modelSchema as { properties: object }).properties).toSorted()).toEqual([
        'code',
        'inputs',
      ]);
    });

    it('refuses more than five inputs, a bad input name and an empty program as invalid input', () => {
      const { toolkit } = setup();
      const tool = toolkit.getTool({ name: 'run_analysis' })!;

      expect(tool.validate({ input: { code: 'return {}', inputs: [fromCallInput('a')] } }).success).toBe(true);
      expect(
        tool.validate({
          input: { code: 'return {}', inputs: ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => fromCallInput(name)) },
        }).success,
      ).toBe(false);
      for (const name of ['__proto__', '1abc', 'has space', '']) {
        expect([name, tool.validate({ input: { code: 'return {}', inputs: [fromCallInput(name)] } }).success]).toEqual([
          name,
          false,
        ]);
      }
      expect(tool.validate({ input: { code: '' } }).success).toBe(false);
    });
  });

  describe('inputs from an earlier call', () => {
    it('reuses the full result the run cached and does not call the tool again', async () => {
      const big = rows({ count: 600 });
      const { toolkit, handler } = setup({ implementations: { search_transactions: () => ({ transactions: big }) } });
      await call({ toolkit, name: 'search_transactions', callId: 'call-tx' });

      const result = await call({
        toolkit,
        name: 'run_analysis',
        input: {
          code: 'return { values: { n: input.tx.transactions.length } }',
          inputs: [{ name: 'tx', fromCall: 'call-tx' }],
        },
      });

      expect(result.isError).toBe(false);
      expect(handler({ name: 'search_transactions' })).toHaveBeenCalledTimes(1);
      expect(sandboxCalls()).toEqual([
        { code: 'return { values: { n: input.tx.transactions.length } }', inputs: { tx: { transactions: big } } },
      ]);
    });

    it('passes a result that is not JSON as the text it is', async () => {
      const { toolkit, handler } = setup();
      handler({ name: 'get_categories' }).mockResolvedValue({ content: [{ type: 'text', text: 'plain words' }] });
      await call({ toolkit, name: 'get_categories', callId: 'call-1' });

      await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'a', fromCall: 'call-1' }] },
      });

      expect(sandboxCalls()[0]!.inputs).toEqual({ a: 'plain words' });
    });

    it('refuses an unknown call id, names the reads that can be used, and runs nothing', async () => {
      const { toolkit, events } = setup();
      await call({ toolkit, name: 'get_categories', callId: 'call-1' });

      const result = await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'a', fromCall: 'nope' }] },
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain('nope');
      expect(result.text).toContain('call-1');
      expect(result.text).toContain('get_categories');
      expect(sandboxCalls()).toEqual([]);
      expect(analysisParts({ events })).toEqual([]);
    });

    it('does not count a refused call against the analyses of the message', async () => {
      const { toolkit } = setup();

      for (let index = 0; index < CHAT_MAX_ANALYSES + 2; index++) {
        const refused = await call({
          toolkit,
          name: 'run_analysis',
          input: { code: 'return {}', inputs: [{ name: 'a', fromCall: 'nope' }] },
        });
        expect(refused.text).not.toMatch(/limit of/);
      }

      expect((await call({ toolkit, name: 'run_analysis', input: { code: 'return {}' } })).isError).toBe(false);
    });
  });

  describe('inputs from a catalog read', () => {
    it('runs a read tool with the read-only scope and passes its JSON', async () => {
      const { toolkit, handler } = setup({ implementations: { get_categories: () => [{ id: 'c1', name: 'Food' }] } });

      const result = await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'categories', tool: 'get_categories' }] },
      });

      expect(result.isError).toBe(false);
      expect(handler({ name: 'get_categories' })).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: { authInfo: expect.objectContaining({ scopes: ['finance:read'], clientId: 'moneymatter-chat' }) },
        }),
      );
      expect(buildMcpAuthInfo).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['finance:read'] }));
      expect(sandboxCalls()[0]!.inputs).toEqual({ categories: [{ id: 'c1', name: 'Food' }] });
    });

    it('validates the arguments with the tool schema like a direct call', async () => {
      const { toolkit, handler } = setup();

      const result = await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'tx', tool: 'search_transactions', args: { limit: 'many' } }] },
      });

      expect(result.isError).toBe(true);
      expect(handler({ name: 'search_transactions' })).not.toHaveBeenCalled();
      expect(sandboxCalls()).toEqual([]);
    });

    it.each([
      ['a write tool', 'create_tag', /read/i],
      ['an excluded tool', 'create_attachment_upload_url', /not available|read/i],
      ['an unknown tool', 'no_such_tool', /unknown|read/i],
      ['a native tool', 'find_capabilities', /read/i],
    ])('refuses %s as an input source', async (_label, tool, message) => {
      const { toolkit, handler } = setup();

      const result = await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'a', tool, args: {} }] },
      });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(message);
      expect(handler({ name: 'create_tag' })).not.toHaveBeenCalled();
      expect(sandboxCalls()).toEqual([]);
    });

    it('refuses an input with both sources or with neither', async () => {
      const { toolkit } = setup();

      const both = await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'a', fromCall: 'c1', tool: 'get_categories' }] },
      });
      const neither = await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'a' }] },
      });
      const duplicated = await call({
        toolkit,
        name: 'run_analysis',
        input: {
          code: 'return {}',
          inputs: [
            { name: 'a', tool: 'get_categories' },
            { name: 'a', tool: 'get_accounts' },
          ],
        },
      });

      expect([both.isError, neither.isError, duplicated.isError]).toEqual([true, true, true]);
      expect(sandboxCalls()).toEqual([]);
    });

    it('counts a third-party read against its cap of the message, and runs no eleventh one', async () => {
      const { toolkit, handler, events } = setup();
      const five = ['a', 'b', 'c', 'd', 'e'].map(searchInput);

      const first = await call({ toolkit, name: 'run_analysis', input: { code: 'return {}', inputs: five } });
      const second = await call({ toolkit, name: 'run_analysis', input: { code: 'return {}', inputs: five } });
      const third = await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [searchInput('a')] },
      });

      expect([first.isError, second.isError, third.isError]).toEqual([false, false, true]);
      expect(third.text).toMatch(/third-party/);
      expect(handler({ name: 'search_securities' })).toHaveBeenCalledTimes(10);
      expect(noticesIn({ events })).toEqual([expect.objectContaining({ key: 'chat.notices.thirdPartyReadLimit' })]);
    });
  });

  describe('pagination', () => {
    const pagedTransactions = ({ total }: { total: number }) => {
      const seen: unknown[] = [];
      const implementation = (args: unknown) => {
        const { limit = 50, offset = 0 } = args as { limit?: number; offset?: number };
        seen.push(args);
        const page = rows({ count: Math.max(0, Math.min(limit, total - offset)), from: offset });
        return { transactions: page, count: page.length, limit, offset };
      };

      return { implementation, seen };
    };

    it('joins every page of a policy-marked tool into the shape of one result', async () => {
      const { implementation, seen } = pagedTransactions({ total: 1_120 });
      const { toolkit, handler } = setup({ implementations: { search_transactions: implementation } });

      const result = await call({
        toolkit,
        name: 'run_analysis',
        input: {
          code: 'return {}',
          inputs: [
            { name: 'tx', tool: 'search_transactions', args: { startDate: '2026-01-01', limit: 5 }, allPages: true },
          ],
        },
      });

      expect(result.isError).toBe(false);
      expect(handler({ name: 'search_transactions' })).toHaveBeenCalledTimes(3);
      expect(seen).toEqual([
        expect.objectContaining({ startDate: '2026-01-01', limit: 500, offset: 0 }),
        expect.objectContaining({ startDate: '2026-01-01', limit: 500, offset: 500 }),
        expect.objectContaining({ startDate: '2026-01-01', limit: 500, offset: 1_000 }),
      ]);
      const input = sandboxCalls()[0]!.inputs.tx as { transactions: unknown[]; count: number; truncated: boolean };
      expect(input.transactions).toEqual(rows({ count: 1_120 }));
      expect(input.count).toBe(1_120);
      expect(input.truncated).toBe(false);
    });

    it('stops at 5,000 rows and says so', async () => {
      const { implementation } = pagedTransactions({ total: 20_000 });
      const { toolkit, handler } = setup({ implementations: { search_transactions: implementation } });

      await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'tx', tool: 'search_transactions', allPages: true }] },
      });

      expect(CHAT_ANALYSIS_MAX_ROWS).toBe(5_000);
      expect(handler({ name: 'search_transactions' })).toHaveBeenCalledTimes(10);
      const input = sandboxCalls()[0]!.inputs.tx as { transactions: unknown[]; truncated: boolean };
      expect(input.transactions).toHaveLength(5_000);
      expect(input.truncated).toBe(true);
    });

    it('starts at the offset the model asked for', async () => {
      const { implementation, seen } = pagedTransactions({ total: 700 });
      const { toolkit } = setup({ implementations: { search_transactions: implementation } });

      await call({
        toolkit,
        name: 'run_analysis',
        input: {
          code: 'return {}',
          inputs: [{ name: 'tx', tool: 'search_transactions', args: { offset: 200 }, allPages: true }],
        },
      });

      expect((seen[0] as { offset: number }).offset).toBe(200);
      expect((sandboxCalls()[0]!.inputs.tx as { transactions: unknown[] }).transactions).toHaveLength(500);
    });

    it('pages a tool that counts pages, from page 1', async () => {
      const seen: unknown[] = [];
      const { toolkit } = setup({
        implementations: {
          get_refunds: (args) => {
            seen.push(args);
            const { page = 1, limit = 20 } = args as { page?: number; limit?: number };
            return {
              refunds: page <= 2 ? rows({ count: limit }) : rows({ count: 3 }),
              meta: { total: 203, page, limit },
            };
          },
        },
      });

      await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'refunds', tool: 'get_refunds', allPages: true }] },
      });

      expect(seen).toEqual([
        expect.objectContaining({ page: 1, limit: 100 }),
        expect.objectContaining({ page: 2, limit: 100 }),
        expect.objectContaining({ page: 3, limit: 100 }),
      ]);
      expect((sandboxCalls()[0]!.inputs.refunds as { refunds: unknown[] }).refunds).toHaveLength(203);
    });

    it('refuses allPages for a tool the policy does not mark as pageable, and calls nothing', async () => {
      const { toolkit, handler } = setup();

      const result = await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'payees', tool: 'get_payees', allPages: true }] },
      });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/get_payees/);
      expect(handler({ name: 'get_payees' })).not.toHaveBeenCalled();
    });

    it('refuses allPages on an earlier call, which is already whole', async () => {
      const { toolkit } = setup();
      await call({ toolkit, name: 'search_transactions', callId: 'call-tx' });

      const result = await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'tx', fromCall: 'call-tx', allPages: true }] },
      });

      expect(result.isError).toBe(true);
    });

    it('fails when a paged result holds no list', async () => {
      const { toolkit } = setup({ implementations: { search_transactions: () => ({ message: 'nothing' }) } });

      const result = await call({
        toolkit,
        name: 'run_analysis',
        input: { code: 'return {}', inputs: [{ name: 'tx', tool: 'search_transactions', allPages: true }] },
      });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/list/i);
    });
  });

  describe('the analysis part and the result', () => {
    it('stores the code, the input sources and the output on one part that opens running', async () => {
      const { toolkit, events } = setup({ implementations: { search_transactions: () => ({ transactions: [] }) } });
      await call({ toolkit, name: 'get_categories', callId: 'call-1' });

      const result = await call({
        toolkit,
        name: 'run_analysis',
        input: {
          code: 'return { values: { total: 220 } }',
          inputs: [
            { name: 'categories', fromCall: 'call-1' },
            { name: 'tx', tool: 'search_transactions', args: { startDate: '2026-09-01' }, allPages: true },
          ],
        },
      });

      const [part] = analysisParts({ events });
      expect(part).toEqual({
        type: 'analysis',
        id: analysisIdOf({ text: result.text }),
        code: 'return { values: { total: 220 } }',
        inputs: [
          { name: 'categories', source: { fromCall: 'call-1' } },
          { name: 'tx', source: { tool: 'search_transactions', args: { startDate: '2026-09-01' }, allPages: true } },
        ],
        status: 'running',
      });
      expect(partUpdates({ events })).toContainEqual({
        type: 'part.updated',
        partId: part!.id,
        patch: { status: 'ok', output: OUTPUT, durationMs: 12 },
      });
    });

    it('answers the model with the id, the values and the keys of what can be shown', async () => {
      const { toolkit } = setup();

      const result = await call({ toolkit, name: 'run_analysis', input: { code: 'return {}' } });

      expect(result.isError).toBe(false);
      const answer = JSON.parse(result.text) as Record<string, unknown>;
      expect(answer).toMatchObject({
        analysisId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        values: { total: 220 },
        charts: { monthly: expect.objectContaining({ title: 'Spend by month' }) },
        tables: { top: expect.objectContaining({ title: 'Top payees' }) },
        kpis: { headline: expect.anything() },
      });
      // The model learns what exists, not the rows: they are shown through render_*.
      expect(result.text).not.toContain('"Cafe"');
      expect(result.summary).toEqual(expect.any(String));
    });

    it('wraps the answer as data when the run asks for it, and caps what the model reads', async () => {
      const wrapUntrusted = jest.fn(({ text }: { kind: string; text: string }) => `<<WRAPPED ${text}>>`);
      const { toolkit } = setup({ runOverrides: { wrapUntrusted: wrapUntrusted as never } });
      jest
        .mocked(runSandboxedAnalysis)
        .mockResolvedValue(sandboxOk({ output: { values: { text: 'x'.repeat(100_000) } } }) as never);

      const result = await call({ toolkit, name: 'run_analysis', input: { code: 'return {}' } });

      expect(wrapUntrusted).toHaveBeenCalledWith(expect.objectContaining({ kind: 'toolResult' }));
      expect(result.text.startsWith('<<WRAPPED ')).toBe(true);
      expect(result.text.length).toBeLessThanOrEqual(CHAT_READ_RESULT_MAX_CHARS + 20);
    });

    it('hands a sandbox error to the model as a tool error with its kind, and the run goes on', async () => {
      const { toolkit, events } = setup();
      jest.mocked(runSandboxedAnalysis).mockResolvedValueOnce({
        ok: false,
        error: { kind: 'timeout', message: 'The code used up its 2 second CPU budget' },
        durationMs: 2_010,
      } as never);

      const failed = await call({ toolkit, name: 'run_analysis', input: { code: 'while(true){}' } });
      const next = await call({ toolkit, name: 'run_analysis', input: { code: 'return {}' } });

      expect(failed.isError).toBe(true);
      expect(failed.text).toContain('timeout');
      expect(failed.text).toContain('CPU budget');
      expect(next.isError).toBe(false);
      expect(partUpdates({ events })[0]).toMatchObject({
        patch: { status: 'error', error: expect.stringContaining('timeout'), durationMs: 2_010 },
      });
      // An analysis that failed still used one of the five.
      expect(analysisParts({ events })).toHaveLength(2);
    });

    it('records the analysis as a source of the cards proposed afterwards', async () => {
      const { toolkit, events } = setup();
      await call({ toolkit, name: 'get_categories', callId: 'call-1' });
      const result = await call({ toolkit, name: 'run_analysis', input: { code: 'return {}' } });

      await call({ toolkit, name: 'create_tag', input: { name: 'Coffee', color: '#aa0000' } });

      const card = events.flatMap((event) => (event.type === 'proposal.upserted' ? [event.card] : []))[0]!;
      expect(card.sources).toContainEqual({ type: 'analysis', partId: analysisIdOf({ text: result.text }) });
    });

    it('keeps the analysis source when _chat.sourceCallIds names the analysis id', async () => {
      const { toolkit, events } = setup();
      await call({ toolkit, name: 'get_categories', callId: 'call-1' });
      await call({ toolkit, name: 'get_accounts', callId: 'call-2' });
      const result = await call({ toolkit, name: 'run_analysis', input: { code: 'return {}' } });
      const analysisId = analysisIdOf({ text: result.text });

      await call({
        toolkit,
        name: 'create_tag',
        input: { name: 'Coffee', color: '#aa0000', _chat: { sourceCallIds: ['call-2', analysisId] } },
      });

      const card = events.flatMap((event) => (event.type === 'proposal.upserted' ? [event.card] : []))[0]!;
      expect(card.sources).toEqual([
        expect.objectContaining({ type: 'toolCall', callId: 'call-2' }),
        { type: 'analysis', partId: analysisId },
      ]);
    });
  });

  describe('the per-message cap', () => {
    it('allows five analyses and refuses the sixth with a notice, without running it', async () => {
      const { toolkit, events } = setup();

      for (let index = 0; index < CHAT_MAX_ANALYSES; index++) {
        expect((await call({ toolkit, name: 'run_analysis', input: { code: 'return {}' } })).isError).toBe(false);
      }
      const sixth = await call({ toolkit, name: 'run_analysis', input: { code: 'return {}' } });

      expect(CHAT_MAX_ANALYSES).toBe(5);
      expect(sixth.isError).toBe(true);
      expect(sixth.text).toMatch(/5 analyses/);
      expect(sandboxCalls()).toHaveLength(5);
      expect(analysisParts({ events })).toHaveLength(5);
      expect(noticesIn({ events })).toEqual([
        expect.objectContaining({ key: 'chat.notices.analysisLimit', params: { limit: 5 } }),
      ]);
    });
  });

  describe('render tools with an analysis source', () => {
    const analyse = async ({ toolkit }: { toolkit: ChatToolkit }) =>
      analysisIdOf({ text: (await call({ toolkit, name: 'run_analysis', input: { code: 'return {}' } })).text });

    it.each([
      ['render_chart', 'monthly', CHART],
      ['render_table', 'top', TABLE],
      ['render_kpis', 'headline', KPIS],
    ])('%s shows the output %s without the data being copied', async (name, key, spec) => {
      const { toolkit, events } = setup();
      const analysisId = await analyse({ toolkit });

      const result = await call({ toolkit, name, input: { source: { analysisId, key } } });

      expect(result.isError).toBe(false);
      expect(events).toContainEqual({ type: 'part.started', part: { type: 'visual', id: expect.any(String), spec } });
    });

    it('still resolves entity labels and refuses ids the user does not own', async () => {
      const { toolkit, events } = setup();
      const analysisId = await analyse({ toolkit });
      jest.mocked(resolveEntityLabels).mockResolvedValue({
        spec: TABLE as never,
        foreign: [{ kind: 'account', id: ACCOUNT }],
      });

      const result = await call({ toolkit, name: 'render_table', input: { source: { analysisId, key: 'top' } } });

      expect(resolveEntityLabels).toHaveBeenCalledWith({ userId: CHAT_TEST_USER_ID, spec: TABLE });
      expect(result.isError).toBe(true);
      expect(events.filter((event) => event.type === 'part.started' && event.part.type === 'visual')).toEqual([]);
    });

    it('counts toward the eight visuals of a message', async () => {
      const { toolkit } = setup();
      const analysisId = await analyse({ toolkit });

      for (let index = 0; index < 8; index++) {
        expect(
          (await call({ toolkit, name: 'render_chart', input: { source: { analysisId, key: 'monthly' } } })).isError,
        ).toBe(false);
      }

      expect(
        (await call({ toolkit, name: 'render_chart', input: { source: { analysisId, key: 'monthly' } } })).isError,
      ).toBe(true);
    });

    it('refuses an unknown analysis id', async () => {
      const { toolkit } = setup();
      await analyse({ toolkit });

      const result = await call({
        toolkit,
        name: 'render_chart',
        input: { source: { analysisId: '7c9e6679-7425-4a40-b5a1-9f3d6c2e8b14', key: 'monthly' } },
      });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/analysis/i);
    });

    it('refuses an unknown key and lists the keys of that type', async () => {
      const { toolkit } = setup();
      const analysisId = await analyse({ toolkit });

      const result = await call({ toolkit, name: 'render_chart', input: { source: { analysisId, key: 'top' } } });

      expect(result.isError).toBe(true);
      expect(result.text).toContain('monthly');
    });

    it('tells the model that an input is the whole result when the code treats it as a list', async () => {
      const { toolkit } = setup();
      jest.mocked(runSandboxedAnalysis).mockResolvedValueOnce({
        ok: false,
        error: { kind: 'runtime', message: 'input.tx.map is not a function' },
        durationMs: 900,
      } as never);

      const failed = await call({ toolkit, name: 'run_analysis', input: { code: 'return input.tx.map(x => x)' } });

      expect(failed.isError).toBe(true);
      expect(failed.text).toContain('input.tx.map is not a function');
      expect(failed.text).toMatch(/whole result[^.]*field/i);
    });

    it('says in its description that a list lives in a field of the input', () => {
      const { toolkit } = setup();

      expect(toolkit.getTool({ name: 'run_analysis' })!.description).toMatch(/input\.\w+\.transactions/);
    });

    it('refuses a failed analysis, whose output does not exist', async () => {
      const { toolkit } = setup();
      jest.mocked(runSandboxedAnalysis).mockResolvedValueOnce({
        ok: false,
        error: { kind: 'runtime', message: 'boom' },
        durationMs: 1,
      } as never);
      const failed = await call({ toolkit, name: 'run_analysis', input: { code: 'throw 1' } });
      expect(failed.isError).toBe(true);

      const result = await call({
        toolkit,
        name: 'render_chart',
        input: { source: { analysisId: '7c9e6679-7425-4a40-b5a1-9f3d6c2e8b14', key: 'monthly' } },
      });

      expect(result.isError).toBe(true);
    });

    it('takes a spec or a source, never both and never neither', async () => {
      const { toolkit } = setup();
      const analysisId = await analyse({ toolkit });

      const both = await call({
        toolkit,
        name: 'render_chart',
        input: { spec: CHART, source: { analysisId, key: 'monthly' } },
      });
      const neither = await call({ toolkit, name: 'render_chart', input: {} });
      const spec = await call({ toolkit, name: 'render_chart', input: { spec: CHART } });

      expect([both.isError, neither.isError, spec.isError]).toEqual([true, true, false]);
    });
  });
});
