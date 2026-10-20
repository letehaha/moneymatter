import {
  CHAT_CARD_KINDS,
  CHAT_ENTITY_KINDS,
  CHAT_FIELD_LABEL_KEYS,
  chatCardTitleKey,
  chatEntityLabelKey,
} from '@bt/shared/types';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// The import chains of these services open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
// The names of the records a card points at come from the database; these suites run without one.
jest.mock('../proposals/card-labels', () => ({ resolveCardLabels: jest.fn(async () => ({})) }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));
// Storing a card opens a transaction; a unit test has no database, so the body just runs.
jest.mock('@services/common/with-transaction', () => ({
  withTransaction: <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => fn,
}));

import ChatProposals from '@models/chat-proposals.model';
import * as usersCurrencies from '@models/users-currencies.model';
import { makeChatRun } from '@tests/helpers/chat-toolkit';

import { getToolCatalog, type ToolCatalogEntry } from '../../mcp/tool-catalog';
import { CONDITIONAL_DELETE_TOOLS, DESTRUCTIVE_TOOLS, READ_TOOL_NAME } from '../../mcp/tool-classification';
import { createProposal } from '../proposals/create-proposal';
import { PREVIEW_RESOLVERS } from '../proposals/previews';
import { ENTITY_LOADERS } from '../proposals/previews/entity-loaders';
import { buildChatToolkit } from '../toolkit/build-toolkit';
import { CHAT_CORE_TOOL_REASONS, CHAT_CORE_TOOLS } from './core-tools';
import { UNMAPPED_ID_FIELDS } from './entity-fields';
import { CHAT_ARGS_ONLY_TOOLS, CHAT_EXCLUDED_TOOLS } from './excluded';
import {
  EGRESS_TOOLS,
  ENTITY_LOADER_KINDS,
  EXPLICIT_POLICIES,
  READ_TOOL_PAGINATION,
  STANDALONE_TOOLS,
  THIRD_PARTY_READ_TOOLS,
} from './explicit';
import { getToolPolicy, resolveToolPolicy } from './index';
import { HIGH_IMPACT_TOOLS, PREVIEW_RESOLVER_NAMES } from './rules';

const EN_CHAT_PATH = path.resolve(__dirname, '../../../../../frontend/src/i18n/locales/chunks/en/pages/chat.json');

/** The schema budget for the core catalog tools every chat step sends; the rest is found through `find_capabilities`. */
const CORE_SCHEMA_BUDGET_BYTES = 44 * 1024;

/** The chat-native tools (find_capabilities, ask_clarification, render_*, read_attachment, run_analysis, set_thread_title) have a budget of their own. */
const NATIVE_SCHEMA_BUDGET_BYTES = 12 * 1024;

const schemaBytes = ({ tools }: { tools: ReadonlyArray<{ name: string; description: string; modelSchema: object }> }) =>
  Buffer.byteLength(
    JSON.stringify(
      tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.modelSchema })),
    ),
    'utf8',
  );

/** Arguments that take each conditional-delete tool down its delete path. */
const CONDITIONAL_DELETE_FIXTURES: Record<string, unknown> = {
  ignore_payee_name: { rawName: 'ACME', force: true },
  revert_subscription_period: { subscriptionId: 'x', periodId: 'y' },
};

/** Arguments that take each conditional-delete tool down its delete path, in the shape cards are built from. */
const CONDITIONAL_DELETE_FIXTURES_ARGS: Record<string, Record<string, unknown>> = {
  ignore_payee_name: { rawName: 'ACME', force: true },
};

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const catalog = (): readonly ToolCatalogEntry[] => getToolCatalog();
const writeTools = () => catalog().filter((tool) => tool.access === 'write');
const capabilities = () => writeTools().filter((tool) => !(tool.name in CHAT_EXCLUDED_TOOLS));
const toolNames = () => new Set(catalog().map((tool) => tool.name));
const shapeKeys = ({ tool }: { tool: ToolCatalogEntry }) => Object.keys(tool.inputShape ?? {});
const policyOf = ({ name }: { name: string }) => getToolPolicy({ name })!;

describe('chat capability drift', () => {
  // Check 1
  it('treats every tool as a read, a write capability or an excluded write, and nothing else', () => {
    for (const tool of catalog()) {
      const excluded = tool.name in CHAT_EXCLUDED_TOOLS;
      if (tool.access === 'read') {
        expect([tool.name, excluded]).toEqual([tool.name, false]);
      } else if (excluded) {
        expect([tool.name, getToolPolicy({ name: tool.name })]).toEqual([tool.name, null]);
      }
    }
  });

  it('gives every exclusion a reason and names a write tool', () => {
    for (const [name, reason] of Object.entries(CHAT_EXCLUDED_TOOLS)) {
      expect(toolNames().has(name)).toBe(true);
      expect(READ_TOOL_NAME.test(name)).toBe(false);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  // Check 2
  it('resolves a policy for every write capability', () => {
    const without = capabilities()
      .filter((tool) => getToolPolicy({ name: tool.name }) === null)
      .map((tool) => tool.name);

    expect(without).toEqual([]);
  });

  it('keeps a policy name equal to its tool name and its entity and kind in the shared lists', () => {
    for (const tool of capabilities()) {
      const policy = policyOf({ name: tool.name });

      expect(policy.name).toBe(tool.name);
      expect(CHAT_ENTITY_KINDS).toContain(policy.entity);
      expect(CHAT_CARD_KINDS).toContain(policy.kind);
    }
  });

  // Check 3
  it('makes every delete, bulk, merge, destructive and high-impact tool red with a real resolver', () => {
    const red = capabilities().filter(
      (tool) =>
        tool.name.startsWith('delete_') ||
        tool.name.startsWith('bulk_') ||
        tool.name.startsWith('merge_') ||
        DESTRUCTIVE_TOOLS.includes(tool.name) ||
        HIGH_IMPACT_TOOLS.includes(tool.name),
    );
    expect(red.length).toBeGreaterThan(30);

    for (const tool of red) {
      const policy = policyOf({ name: tool.name });

      expect([tool.name, policy.danger !== 'none']).toEqual([tool.name, true]);
      expect([tool.name, policy.previewResolver !== null]).toEqual([tool.name, true]);
      expect([tool.name, CHAT_ARGS_ONLY_TOOLS.includes(tool.name)]).toEqual([tool.name, false]);
    }
  });

  it('makes every conditional-delete tool red on its delete path', () => {
    for (const name of CONDITIONAL_DELETE_TOOLS) {
      expect([name, name in CONDITIONAL_DELETE_FIXTURES]).toEqual([name, true]);
      expect([name, resolveToolPolicy({ name, args: CONDITIONAL_DELETE_FIXTURES[name] })!.danger !== 'none']).toEqual([
        name,
        true,
      ]);
      expect([name, policyOf({ name }).previewResolver !== null]).toEqual([name, true]);
    }
  });

  it('keeps a red tool out of the args-only list', () => {
    for (const name of CHAT_ARGS_ONLY_TOOLS) {
      expect([name, policyOf({ name }).danger]).toEqual([name, 'none']);
    }
  });

  it('lists a tool as args-only exactly when its policy declares no preview resolver', () => {
    const declared = capabilities()
      .filter((tool) => policyOf({ name: tool.name }).previewResolver === null)
      .map((tool) => tool.name)
      .toSorted();

    expect([...CHAT_ARGS_ONLY_TOOLS].toSorted()).toEqual(declared);
  });

  it('has a resolver function in the registry for every name a policy declares, and for no other', () => {
    expect(Object.keys(PREVIEW_RESOLVERS).toSorted()).toEqual([...PREVIEW_RESOLVER_NAMES].toSorted());

    for (const tool of capabilities()) {
      const { previewResolver } = policyOf({ name: tool.name });
      if (previewResolver === null) continue;

      expect([tool.name, typeof PREVIEW_RESOLVERS[previewResolver]]).toEqual([tool.name, 'function']);
    }
  });

  it('declares only resolver names the resolver registry lists, and uses each of them', () => {
    const used = new Set<string>();
    for (const tool of capabilities()) {
      const { previewResolver } = policyOf({ name: tool.name });
      if (previewResolver === null) continue;

      expect(PREVIEW_RESOLVER_NAMES).toContain(previewResolver);
      used.add(previewResolver);
    }

    expect([...used].toSorted()).toEqual([...PREVIEW_RESOLVER_NAMES].toSorted());
  });

  it('names a target field the tool takes for every entity-loader policy, on an entity that has a loader', () => {
    for (const tool of capabilities()) {
      const policy = policyOf({ name: tool.name });
      if (policy.previewResolver !== 'entity') {
        expect([tool.name, policy.targetFields]).toEqual([tool.name, []]);
        continue;
      }

      expect(ENTITY_LOADER_KINDS).toContain(policy.entity);
      expect([tool.name, policy.targetFields.length > 0]).toEqual([tool.name, true]);
      for (const field of policy.targetFields) {
        expect([tool.name, field, shapeKeys({ tool }).includes(field)]).toEqual([tool.name, field, true]);
      }
    }
  });

  it('keeps standalone tools red, because they pass the stricter confirmation', () => {
    for (const name of STANDALONE_TOOLS) {
      expect(policyOf({ name })).toMatchObject({ standalone: true, danger: 'highImpact' });
    }
    const standalone = capabilities().filter((tool) => policyOf({ name: tool.name }).standalone);
    expect(standalone.map((tool) => tool.name).toSorted()).toEqual([...STANDALONE_TOOLS].toSorted());
  });

  // Check 4
  it('names an existing tool in every explicit entry and list', () => {
    const existing = toolNames();
    const named: Record<string, string[]> = {
      EXPLICIT_POLICIES: Object.keys(EXPLICIT_POLICIES),
      CHAT_EXCLUDED_TOOLS: Object.keys(CHAT_EXCLUDED_TOOLS),
      CHAT_ARGS_ONLY_TOOLS: [...CHAT_ARGS_ONLY_TOOLS],
      HIGH_IMPACT_TOOLS: [...HIGH_IMPACT_TOOLS],
      STANDALONE_TOOLS: [...STANDALONE_TOOLS],
      EGRESS_TOOLS: Object.keys(EGRESS_TOOLS),
      THIRD_PARTY_READ_TOOLS: [...THIRD_PARTY_READ_TOOLS],
      READ_TOOL_PAGINATION: Object.keys(READ_TOOL_PAGINATION),
      CHAT_CORE_TOOLS: [...CHAT_CORE_TOOLS],
      UNMAPPED_ID_FIELDS: Object.keys(UNMAPPED_ID_FIELDS),
    };

    for (const [list, names] of Object.entries(named)) {
      expect([list, names.filter((name) => !existing.has(name))]).toEqual([list, []]);
    }
  });

  it('keeps the hand-kept lists of reads on read tools and of writes on write tools', () => {
    for (const name of [...THIRD_PARTY_READ_TOOLS, ...Object.keys(READ_TOOL_PAGINATION)]) {
      expect([name, READ_TOOL_NAME.test(name)]).toEqual([name, true]);
    }
    for (const name of [
      ...Object.keys(EGRESS_TOOLS),
      ...STANDALONE_TOOLS,
      ...HIGH_IMPACT_TOOLS,
      ...CHAT_ARGS_ONLY_TOOLS,
    ]) {
      expect([name, READ_TOOL_NAME.test(name)]).toEqual([name, false]);
      expect([name, name in CHAT_EXCLUDED_TOOLS]).toEqual([name, false]);
    }
  });

  it('names pagination arguments the read tool takes', () => {
    const byName = new Map(catalog().map((tool) => [tool.name, tool]));

    for (const [name, pagination] of Object.entries(READ_TOOL_PAGINATION)) {
      const keys = shapeKeys({ tool: byName.get(name)! });
      const args = [pagination.limitArg, pagination.offsetArg, pagination.pageArg].filter(
        (arg): arg is string => !!arg,
      );

      expect(args.length).toBeGreaterThanOrEqual(2);
      for (const arg of args) expect([name, arg, keys.includes(arg)]).toEqual([name, arg, true]);
      expect(pagination.maxLimit).toBeGreaterThan(0);
    }
    expect(Object.keys(READ_TOOL_PAGINATION)).toContain('search_transactions');
  });

  it('gives an egress function to every egress tool, and an egress card to no other', () => {
    for (const name of Object.keys(EGRESS_TOOLS)) {
      expect([name, typeof EGRESS_TOOLS[name]]).toEqual([name, 'function']);
    }
    for (const tool of capabilities()) {
      if (tool.name in EGRESS_TOOLS) continue;

      expect([tool.name, resolveToolPolicy({ name: tool.name, args: {} })!.egress]).toEqual([tool.name, null]);
    }
  });

  // Check 5
  it('lists a reason for every core tool and keeps the list about 35 tools long', () => {
    expect([...CHAT_CORE_TOOLS].toSorted()).toEqual(Object.keys(CHAT_CORE_TOOL_REASONS).toSorted());
    expect(CHAT_CORE_TOOLS.length).toBeGreaterThanOrEqual(30);
    expect(CHAT_CORE_TOOLS.length).toBeLessThanOrEqual(40);
    expect(new Set(CHAT_CORE_TOOLS).size).toBe(CHAT_CORE_TOOLS.length);
    for (const name of CHAT_CORE_TOOLS) {
      expect([name, CHAT_CORE_TOOL_REASONS[name]!.length > 10]).toEqual([name, true]);
      expect([name, name in CHAT_EXCLUDED_TOOLS]).toEqual([name, false]);
    }
  });

  it('keeps the model-facing schemas of the core tools within 44 KB, and those of the chat-native tools within their own budget', () => {
    const toolkit = buildChatToolkit({ run: makeChatRun().run });
    const active = new Set(toolkit.activeToolNames());
    const offered = toolkit.tools.filter((tool) => active.has(tool.name));
    const core = offered.filter((tool) => CHAT_CORE_TOOLS.includes(tool.name));
    const native = offered.filter((tool) => tool.kind === 'native');

    for (const name of CHAT_CORE_TOOLS) expect([name, active.has(name)]).toEqual([name, true]);
    expect(offered.length).toBe(core.length + native.length);
    expect(core).toHaveLength(CHAT_CORE_TOOLS.length);
    expect(native.map((tool) => tool.name).toSorted()).toEqual([
      'ask_clarification',
      'find_capabilities',
      'read_attachment',
      'render_chart',
      'render_kpis',
      'render_table',
      'run_analysis',
      'set_thread_title',
    ]);
    expect(schemaBytes({ tools: core })).toBeGreaterThan(5_000);
    expect(schemaBytes({ tools: core })).toBeLessThanOrEqual(CORE_SCHEMA_BUDGET_BYTES);
    expect(schemaBytes({ tools: native })).toBeGreaterThan(1_000);
    expect(schemaBytes({ tools: native })).toBeLessThanOrEqual(NATIVE_SCHEMA_BUDGET_BYTES);
  });

  // Check 6
  it('has a label key for every top-level field of every write capability', () => {
    const missing = capabilities().flatMap((tool) =>
      shapeKeys({ tool })
        .filter((field) => !(field in CHAT_FIELD_LABEL_KEYS))
        .map((field) => `${tool.name}.${field}`),
    );

    expect(missing).toEqual([]);
  });

  it('keeps every label key under chat.fields and drops a label no capability uses', () => {
    const used = new Set(capabilities().flatMap((tool) => shapeKeys({ tool })));

    for (const [field, key] of Object.entries(CHAT_FIELD_LABEL_KEYS)) {
      expect(key).toBe(`chat.fields.${field}`);
      expect([field, used.has(field)]).toEqual([field, true]);
    }
  });

  // Check 7
  it('has a title key for every card kind and a name for every entity the policies use', () => {
    const en = JSON.parse(fs.readFileSync(EN_CHAT_PATH, 'utf-8')) as unknown;
    const read = ({ key }: { key: string }) =>
      key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);

    const kinds = new Set(capabilities().map((tool) => policyOf({ name: tool.name }).kind));
    const entities = new Set(capabilities().map((tool) => policyOf({ name: tool.name }).entity));

    for (const kind of kinds)
      expect([kind, typeof read({ key: chatCardTitleKey({ kind }) })]).toEqual([kind, 'string']);
    for (const entity of entities) {
      expect([entity, typeof read({ key: chatEntityLabelKey({ entity }) })]).toEqual([entity, 'string']);
    }
  });

  // Entity pickers
  it('maps every id-like argument of a write capability to an entity, or acknowledges that it names none', () => {
    const unmapped: string[] = [];

    for (const tool of capabilities()) {
      const policy = policyOf({ name: tool.name });

      for (const field of shapeKeys({ tool })) {
        if (!/(^ids?$|Ids?$|TxId$)/.test(field)) continue;
        if (field in policy.entityFields) continue;
        if (UNMAPPED_ID_FIELDS[tool.name]?.includes(field)) continue;

        unmapped.push(`${tool.name}.${field}`);
      }
    }

    expect(unmapped).toEqual([]);
  });

  it('acknowledges only unmapped id arguments that a tool really takes and that have no mapping', () => {
    for (const [name, fields] of Object.entries(UNMAPPED_ID_FIELDS)) {
      const tool = catalog().find((entry) => entry.name === name)!;
      const policy = policyOf({ name });

      for (const field of fields) {
        expect([name, field, shapeKeys({ tool }).includes(field)]).toEqual([name, field, true]);
        expect([name, field, field in policy.entityFields]).toEqual([name, field, false]);
      }
    }
  });

  it('covers every write capability with a card kind, so none falls through to an unnamed type', () => {
    const kinds = new Map<string, number>();
    for (const tool of capabilities()) {
      const { kind } = policyOf({ name: tool.name });
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }

    expect([...kinds.keys()].toSorted()).toEqual([...CHAT_CARD_KINDS].toSorted());
    expect(capabilities().length).toBe(writeTools().length - Object.keys(CHAT_EXCLUDED_TOOLS).length);
  });

  describe('cards', () => {
    const EGRESS_ARGS: Record<string, unknown> = {
      set_currency_rate_source: {
        code: 'PTS',
        rateSource: 'http',
        config: { urlTemplate: 'https://rates.example.com/{date}.json' },
      },
    };

    /** Arguments that take a tool down its most dangerous path. */
    const fixtureArgs = ({ name }: { name: string }): Record<string, unknown> => {
      const policy = policyOf({ name });
      const targets = Object.fromEntries(policy.targetFields.map((field, index) => [field, uuid(index + 1)]));
      return { ...targets, ...CONDITIONAL_DELETE_FIXTURES_ARGS[name], ...(EGRESS_ARGS[name] as object) };
    };

    /** A card for every write capability, made by the real proposal path, the entity resolver and the policies. */
    async function buildCards(): Promise<
      Array<{ name: string; card: Awaited<ReturnType<typeof createProposal>>['card'] }>
    > {
      const original = { ...PREVIEW_RESOLVERS };
      const loaders = { ...ENTITY_LOADERS };
      jest.spyOn(usersCurrencies, 'getBaseCurrency').mockResolvedValue({ currencyCode: 'USD' } as never);
      jest.spyOn(ChatProposals, 'findAll').mockResolvedValue([]);
      jest.spyOn(ChatProposals, 'create').mockImplementation((async (values: any) => ({
        ...values,
        createdAt: new Date('2026-10-18T09:00:00.000Z'),
        updatedAt: new Date('2026-10-18T09:00:00.000Z'),
      })) as never);

      // The services behind the loaders and the explicit resolvers are replaced; the entity resolver,
      // the proposal path, the policies and the card builder are the real ones.
      for (const kind of Object.keys(ENTITY_LOADERS)) {
        (ENTITY_LOADERS as Record<string, unknown>)[kind] = async () => ({
          row: { id: uuid(1) },
          updatedAt: new Date('2026-10-18T09:00:00.000Z'),
          counts: {},
          removes: 0,
        });
      }
      for (const name of Object.keys(PREVIEW_RESOLVERS)) {
        if (name === 'entity') continue;
        (PREVIEW_RESOLVERS as Record<string, unknown>)[name] = async () => ({
          preview: { affected: { count: 5, columns: [], rows: [], truncated: false } },
          snapshot: { targetCount: 5 },
          affectedCount: 5,
        });
      }

      try {
        const { run } = makeChatRun();
        const cards: Array<{ name: string; card: Awaited<ReturnType<typeof createProposal>>['card'] }> = [];
        for (const tool of capabilities()) {
          const args = fixtureArgs({ name: tool.name });
          const policy = resolveToolPolicy({ name: tool.name, args })!;
          const { card } = await createProposal({
            run,
            policy,
            args,
            meta: {},
            refs: [],
            sources: [],
          });
          cards.push({ name: tool.name, card });
        }
        return cards;
      } finally {
        Object.assign(PREVIEW_RESOLVERS, original);
        Object.assign(ENTITY_LOADERS, loaders);
      }
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // Check 8
    it('makes an egress card amber: the URL and host, a confirm, and never safe', async () => {
      const cards = await buildCards();

      for (const name of Object.keys(EGRESS_TOOLS)) {
        const { card } = cards.find((entry) => entry.name === name)!;

        expect([name, card.egress]).toEqual([
          name,
          { url: 'https://rates.example.com/{date}.json', host: 'rates.example.com' },
        ]);
        expect([name, card.confirmation.mode]).toEqual([name, 'confirm']);
        expect([name, card.safe]).toEqual([name, false]);
        expect([name, card.warnings.map((warning) => warning.key)]).toEqual([name, ['chat.warnings.egress']]);
      }
    });

    // Check 9
    it('never makes a red, egress, standalone or settings card safe, however perfect it is otherwise', async () => {
      const cards = await buildCards();
      expect(cards).toHaveLength(capabilities().length);

      for (const { name, card } of cards) {
        const policy = policyOf({ name });
        const unsafe =
          card.danger !== 'none' || card.egress !== undefined || policy.standalone || card.kind === 'settings';
        if (!unsafe) continue;

        expect([name, card.canApply.ok, card.safe]).toEqual([name, true, false]);
      }
      expect(cards.filter(({ card }) => card.danger !== 'none').length).toBeGreaterThan(30);
    });

    it('gives every red card a confirmation, and every high-impact and multi-record red card a typed one', async () => {
      const cards = await buildCards();

      for (const { name, card } of cards) {
        if (card.danger === 'none') continue;

        expect([name, card.confirmation.mode !== 'none']).toEqual([name, true]);
        if (card.danger === 'highImpact') expect([name, card.confirmation.mode]).toEqual([name, 'typed']);
      }
    });

    it('gives every capability with a resolver a stored preview, so no card is waiting for one', async () => {
      const cards = await buildCards();

      for (const { name, card } of cards) {
        if (policyOf({ name }).previewResolver === null) continue;

        expect([name, card.canApply]).toEqual([name, { ok: true }]);
      }
    });
  });
});
