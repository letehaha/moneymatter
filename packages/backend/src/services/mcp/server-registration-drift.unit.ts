import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const TOOLS_DIR = path.join(__dirname, 'tools');
const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf-8');

const isToolSourceFile = (entry: string) =>
  entry.endsWith('.ts') && !entry.includes('.unit.') && !entry.includes('.e2e.');

/** Every `registerX` a tool file declares, plus the ones the venture barrel re-exports. */
function exportedRegisterFunctions(): string[] {
  const names = new Set<string>();
  for (const entry of fs.readdirSync(TOOLS_DIR).filter(isToolSourceFile)) {
    const content = fs.readFileSync(path.join(TOOLS_DIR, entry), 'utf-8');
    for (const match of content.matchAll(/export (?:async )?function (register\w+)\s*\(/g)) names.add(match[1]!);
    for (const match of content.matchAll(/export \{([^}]*)\} from/g)) {
      for (const name of match[1]!.split(',').map((part) => part.trim().split(/\s+as\s+/)[0]!)) {
        if (name.startsWith('register')) names.add(name);
      }
    }
  }
  return [...names].toSorted();
}

/** Every `registerX(server)` call in `createMcpServer`, one entry per call. */
const calledRegisterFunctions = () =>
  [...SERVER_SOURCE.matchAll(/\b(register[A-Z]\w*)\(server\)/g)].map((match) => match[1]!);

/** Every name `server.ts` imports from the tool files. */
function importedRegisterFunctions(): string[] {
  const names: string[] = [];
  for (const match of SERVER_SOURCE.matchAll(/import \{([^}]*)\} from '\.\/tools\/[^']+';/g)) {
    names.push(
      ...match[1]!
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    );
  }
  return names;
}

describe('MCP server registration', () => {
  it('finds the tool registrations it checks', () => {
    expect(exportedRegisterFunctions().length).toBeGreaterThan(100);
  });

  it('calls every exported register function exactly once', () => {
    const calls = calledRegisterFunctions();
    const notCalled = exportedRegisterFunctions().filter((name) => !calls.includes(name));
    const calledTwice = [...new Set(calls.filter((name, index) => calls.indexOf(name) !== index))];

    expect(notCalled).toEqual([]);
    expect(calledTwice).toEqual([]);
  });

  it('imports every exported register function', () => {
    const imported = importedRegisterFunctions();

    expect(exportedRegisterFunctions().filter((name) => !imported.includes(name))).toEqual([]);
  });

  it('calls and imports nothing that no tool file exports', () => {
    const exported = exportedRegisterFunctions();

    expect(calledRegisterFunctions().filter((name) => !exported.includes(name))).toEqual([]);
    expect(importedRegisterFunctions().filter((name) => !exported.includes(name))).toEqual([]);
  });
});
