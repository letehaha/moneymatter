import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

import { TOOL_ARG_VALIDATORS } from './tool-arg-validators';
import { READ_TOOL_NAME } from './tool-classification';

const TOOLS_DIR = path.join(__dirname, 'tools');

/**
 * Helpers that refuse an argument without an `assert…Args` name. A handler that calls one of them
 * (or `.parse(` / `.safeParse(` / `assert…Args(`) is checking its args, so the check belongs in a
 * registered validator. Add a name here when an audit finds a new refusal helper.
 */
const ARG_CHECK_HELPERS = ['parseBulkTarget', 'hasNarrowingFilter', 'parseTransactionFilters'];

const TRIGGER_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: '.parse(', pattern: /\.parse\(/ },
  { label: '.safeParse(', pattern: /\.safeParse\(/ },
  { label: 'assert…Args(', pattern: /\bassert\w*Args\(/ },
  ...ARG_CHECK_HELPERS.map((name) => ({ label: `${name}(`, pattern: new RegExp(`\\b${name}\\(`) })),
];

interface ScannedTool {
  name: string;
  /** The callback passed to `registerTool`, printed without comments. */
  handler: string;
}

const printer = ts.createPrinter({ removeComments: true });

/** The tools a source file registers, each with its handler cut out by the compiler. */
function scanSource({ source, fileName }: { source: string; fileName: string }): ScannedTool[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const tools: ScannedTool[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'registerTool' &&
      node.arguments.length >= 3 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      tools.push({
        name: node.arguments[0].text,
        handler: printer.printNode(ts.EmitHint.Unspecified, node.arguments[2]!, sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return tools;
}

function scanToolsDir(): ScannedTool[] {
  return fs
    .readdirSync(TOOLS_DIR)
    .filter((entry) => entry.endsWith('.ts') && !entry.includes('.unit.') && !entry.includes('.e2e.'))
    .flatMap((entry) => scanSource({ source: fs.readFileSync(path.join(TOOLS_DIR, entry), 'utf-8'), fileName: entry }));
}

const triggersIn = ({ handler }: { handler: string }) =>
  TRIGGER_PATTERNS.filter(({ pattern }) => pattern.test(handler)).map(({ label }) => label);

const pascal = ({ name }: { name: string }) =>
  name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/** Everything wrong between the tools' handlers and the registry; an empty list is a pass. */
function findViolations({
  tools,
  registry,
}: {
  tools: ScannedTool[];
  registry: Readonly<Record<string, { name: string }>>;
}): string[] {
  const violations: string[] = [];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const tool of tools) {
    const triggers = triggersIn({ handler: tool.handler });
    const validator = registry[tool.name];

    if (!validator) {
      if (!READ_TOOL_NAME.test(tool.name) && triggers.length > 0) {
        violations.push(
          `${tool.name}: checks its args inline (${triggers.join(', ')}) and has no registered validator`,
        );
      }
      continue;
    }

    if (!tool.handler.includes(`${validator.name}(`)) {
      violations.push(`${tool.name}: the handler does not call its validator ${validator.name}`);
    }
    if (triggers.length > 0) {
      violations.push(`${tool.name}: the handler still checks its args inline (${triggers.join(', ')})`);
    }
  }

  for (const [name, validator] of Object.entries(registry)) {
    if (!byName.has(name)) violations.push(`${name}: registered validator names no existing tool`);
    if (validator.name !== `validate${pascal({ name })}Args`) {
      violations.push(`${name}: validator is named ${validator.name}, expected validate${pascal({ name })}Args`);
    }
  }

  return violations;
}

const TOOL_FIXTURE = ({ handlerBody }: { handlerBody: string }) => `
  import { z } from 'zod';
  const schema = z.object({});
  export function validateFixtureToolArgs({ args }: { args: unknown }) {
    return schema.parse(args);
  }
  export function registerFixtureTool(server: McpServer) {
    server.registerTool('fixture_tool', { inputSchema: {} }, async (args, extra) => {
      ${handlerBody}
    });
  }
`;

function validateFixtureToolArgs() {}
function validateGoneToolArgs() {}
function validateOtherArgs() {}

const fixtureViolations = ({ source, registered = true }: { source: string; registered?: boolean }) =>
  findViolations({
    tools: scanSource({ source, fileName: 'fixture.ts' }),
    registry: registered ? { fixture_tool: validateFixtureToolArgs } : {},
  });

describe('tool arg validator drift', () => {
  const tools = scanToolsDir();

  it('finds the handler of every tool', () => {
    expect(tools.length).toBeGreaterThanOrEqual(250);
    expect(tools.every((tool) => tool.handler.includes('=>') || tool.handler.includes('function'))).toBe(true);
  });

  it('keeps every write tool that checks its args inline in the registry, called from its handler', () => {
    expect(findViolations({ tools, registry: TOOL_ARG_VALIDATORS })).toEqual([]);
  });

  it('registers at least the tools the audit found', () => {
    expect(Object.keys(TOOL_ARG_VALIDATORS).length).toBeGreaterThanOrEqual(30);
  });

  describe('the suite itself', () => {
    it('passes a handler that calls its validator and checks nothing else', () => {
      const source = TOOL_FIXTURE({ handlerBody: 'const body = validateFixtureToolArgs({ args }); return body;' });
      expect(fixtureViolations({ source })).toEqual([]);
    });

    it('ignores a trigger pattern that sits in a comment', () => {
      const source = TOOL_FIXTURE({
        handlerBody: '// the schema.parse( call moved\n return validateFixtureToolArgs({ args });',
      });
      expect(fixtureViolations({ source })).toEqual([]);
    });

    it('fails a handler that defines its validator but no longer calls it', () => {
      const source = TOOL_FIXTURE({ handlerBody: 'return args;' });
      expect(fixtureViolations({ source })).toEqual([
        'fixture_tool: the handler does not call its validator validateFixtureToolArgs',
      ]);
    });

    it('fails a handler that keeps an inline check beside its validator', () => {
      const source = TOOL_FIXTURE({
        handlerBody: 'validateFixtureToolArgs({ args }); return schema.safeParse(args);',
      });
      expect(fixtureViolations({ source })).toEqual([
        'fixture_tool: the handler still checks its args inline (.safeParse()',
      ]);
    });

    it.each(['schema.parse(args)', 'assertThingArgs({ args })', 'parseBulkTarget({})', 'hasNarrowingFilter({})'])(
      'fails a write tool that checks its args with %s and has no entry',
      (check) => {
        const source = TOOL_FIXTURE({ handlerBody: `${check}; return args;` });
        const violations = fixtureViolations({ source, registered: false });

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatch(/^fixture_tool: checks its args inline .* and has no registered validator$/);
      },
    );

    it('does not ask a read tool for a validator', () => {
      const source = TOOL_FIXTURE({ handlerBody: 'return schema.parse(args);' }).replace('fixture_tool', 'get_fixture');
      expect(findViolations({ tools: scanSource({ source, fileName: 'fixture.ts' }), registry: {} })).toEqual([]);
    });

    it('fails an entry that names no existing tool', () => {
      const source = TOOL_FIXTURE({ handlerBody: 'return validateFixtureToolArgs({ args });' });
      const violations = findViolations({
        tools: scanSource({ source, fileName: 'fixture.ts' }),
        registry: {
          fixture_tool: validateFixtureToolArgs,
          gone_tool: validateGoneToolArgs,
        },
      });

      expect(violations).toEqual(['gone_tool: registered validator names no existing tool']);
    });

    it('fails a validator that is not named after its tool', () => {
      const source = TOOL_FIXTURE({ handlerBody: 'return validateOtherArgs({ args });' });
      const violations = findViolations({
        tools: scanSource({ source, fileName: 'fixture.ts' }),
        registry: { fixture_tool: validateOtherArgs },
      });

      expect(violations).toEqual([
        'fixture_tool: validator is named validateOtherArgs, expected validateFixtureToolArgs',
      ]);
    });
  });
});
