import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const TOOLS_DIR = path.join(__dirname, 'tools');

/**
 * Calls that check a tool's arguments. In a write or delete tool they belong in `validate`, which
 * the chat runs on a proposed call before the user approves it; in `run` the chat would only see
 * the refusal after approval. Read tools run straight away, so they may check in `run`.
 */
const ARG_CHECK = /\.parse\(|\.safeParse\(|\bassert\w*Args\(|\bparseBulkTarget\(/;

function writeToolSources(): Array<{ file: string; run: string }> {
  return fs
    .readdirSync(TOOLS_DIR)
    .filter((entry) => entry.endsWith('.ts') && !entry.includes('.unit.') && !entry.includes('.e2e.'))
    .flatMap((file) => {
      const content = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf-8');
      if (!/defineTool\(/.test(content) || !/access: '(write|delete)'/.test(content)) return [];
      const runStart = content.search(/^ {2}run[:(]/m);
      return runStart === -1 ? [] : [{ file, run: content.slice(runStart) }];
    });
}

describe('MCP tool argument checks', () => {
  it('finds the write and delete tools', () => {
    expect(writeToolSources().length).toBeGreaterThan(100);
  });

  it('keeps every argument check of a write or delete tool in validate, not in run', () => {
    const inRun = writeToolSources()
      .filter(({ run }) => ARG_CHECK.test(run))
      .map(({ file }) => file);

    expect(inRun).toEqual([]);
  });
});
