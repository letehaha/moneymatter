import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const TOOLS_DIR = path.join(__dirname, 'tools');
const TOOLSETS_SOURCE = fs.readFileSync(path.join(__dirname, 'toolsets.ts'), 'utf-8');

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

/** Every register function listed in `TOOLSET_REGISTRARS`, one entry per listing. */
function calledRegisterFunctions(): string[] {
  const start = TOOLSETS_SOURCE.indexOf('export const TOOLSET_REGISTRARS');
  const end = TOOLSETS_SOURCE.indexOf('\n};', start);
  if (start === -1 || end === -1) throw new Error('Could not find TOOLSET_REGISTRARS in toolsets.ts');

  return [...TOOLSETS_SOURCE.slice(start, end).matchAll(/\b(register[A-Z]\w*)\b/g)].map((match) => match[1]!);
}

/** Every name `toolsets.ts` imports from the tool files. */
function importedRegisterFunctions(): string[] {
  const names: string[] = [];
  for (const match of TOOLSETS_SOURCE.matchAll(/import \{([^}]*)\} from '\.\/tools\/[^']+';/g)) {
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

  it('lists every exported register function in exactly one toolset', () => {
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
