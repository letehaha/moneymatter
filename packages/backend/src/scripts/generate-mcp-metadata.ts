import { MCP_CORE_TOOLSET, MCP_OPTIONAL_TOOLSETS, mcpToolsetScope } from '@bt/shared/types';
import fs from 'fs';
import path from 'path';

import { scopeSentence, type ToolDef } from '../services/mcp/define-tool';
import { MCP_SCOPES_SUPPORTED } from '../services/mcp/oauth-scopes';
import { MCP_PROMPTS, MCP_SERVER_INFO } from '../services/mcp/server';
import { TOOLSET_DESCRIPTIONS, TOOLS_BY_TOOLSET } from '../services/mcp/toolsets';

/**
 * Regenerates the MCP metadata served from packages/frontend/public: the server card, `scopes_supported`
 * in the OAuth discovery mirrors and the tool tables of the connect-moneymatter skill.
 *
 * Usage: npm run mcp:generate-metadata
 */
const PUBLIC_DIR = path.resolve(__dirname, '../../../frontend/public');
const SERVER_CARD_PATH = path.join(PUBLIC_DIR, '.well-known/mcp/server-card.json');
const OAUTH_MIRROR_PATHS = ['oauth-authorization-server', 'oauth-protected-resource'].map((file) =>
  path.join(PUBLIC_DIR, '.well-known', file),
);
const SKILL_PATH = path.join(PUBLIC_DIR, 'skills/connect-moneymatter/SKILL.md');

const SKILL_BEGIN = '<!-- BEGIN GENERATED TOOL TABLES: npm run mcp:generate-metadata -->';
const SKILL_END = '<!-- END GENERATED TOOL TABLES -->';

const TOOLSETS = [MCP_CORE_TOOLSET, ...MCP_OPTIONAL_TOOLSETS] as const;

function firstSentence({ text }: { text: string }): string {
  for (const match of text.matchAll(/[.!?](?=\s|$)/g)) {
    if (!/\b(e\.g|i\.e)$/i.test(text.slice(0, match.index))) return text.slice(0, match.index + 1);
  }
  return text;
}

const readJson = ({ file }: { file: string }) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const toJson = ({ value }: { value: unknown }) => `${JSON.stringify(value, null, 2)}\n`;

function buildServerCard(): string {
  const card = readJson({ file: SERVER_CARD_PATH });

  return toJson({
    value: {
      ...card,
      serverInfo: { ...card.serverInfo, ...MCP_SERVER_INFO },
      authentication: {
        ...card.authentication,
        oauth2: { ...card.authentication.oauth2, scopes: [...MCP_SCOPES_SUPPORTED] },
      },
      toolsets: TOOLSETS.map((toolset) => ({
        name: toolset,
        scope: toolset === MCP_CORE_TOOLSET ? null : mcpToolsetScope({ toolset }),
        description: TOOLSET_DESCRIPTIONS[toolset],
      })),
      tools: TOOLSETS.flatMap((toolset) =>
        TOOLS_BY_TOOLSET[toolset].map((def) => ({
          name: def.name,
          toolset,
          description: firstSentence({ text: def.description }) + scopeSentence({ def }),
        })),
      ),
      prompts: MCP_PROMPTS.map(({ name, description }) => ({ name, description })),
    },
  });
}

function markdownTable({ rows }: { rows: string[][] }): string {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  const line = ({ cells }: { cells: string[] }) =>
    `| ${cells.map((cell, col) => cell.padEnd(widths[col]!)).join(' | ')} |`;

  return [
    line({ cells: rows[0]! }),
    line({ cells: widths.map((width) => '-'.repeat(width)) }),
    ...rows.slice(1).map((cells) => line({ cells })),
  ].join('\n');
}

function toolPurpose({ def }: { def: ToolDef }): string {
  const purpose = firstSentence({ text: def.description }).replace(/\.$/, '').replaceAll('|', '\\|');
  const notes = [
    def.access !== 'read' &&
      `\`finance:${def.access}\`${def.conditionalDelete ? ` + \`finance:delete\` ${def.conditionalDelete}` : ''}`,
    def.feature && `${def.feature[0]!.toUpperCase()}${def.feature.slice(1).replaceAll('_', ' ')} feature`,
  ].filter(Boolean);
  return notes.length ? `${purpose} (${notes.join(', ')})` : purpose;
}

function buildSkill(): string {
  const skill = fs.readFileSync(SKILL_PATH, 'utf-8');
  const begin = skill.indexOf(SKILL_BEGIN);
  const end = skill.indexOf(SKILL_END);
  if (begin === -1 || end < begin) throw new Error(`${SKILL_PATH} lost its generated-region markers`);

  const tables = TOOLSETS.map((toolset) => {
    const rows = TOOLS_BY_TOOLSET[toolset].map((def) => [`\`${def.name}\``, toolPurpose({ def })]);
    return [
      `### \`${toolset}\``,
      TOOLSET_DESCRIPTIONS[toolset],
      markdownTable({ rows: [['Tool', 'Purpose'], ...rows] }),
    ].join('\n\n');
  }).join('\n\n');

  return `${skill.slice(0, begin + SKILL_BEGIN.length)}\n\n${tables}\n\n${skill.slice(end)}`;
}

/** Absolute path → the content the generator would write there. */
export function buildMcpMetadataFiles(): Record<string, string> {
  return {
    [SERVER_CARD_PATH]: buildServerCard(),
    ...Object.fromEntries(
      OAUTH_MIRROR_PATHS.map((file) => [
        file,
        toJson({ value: { ...readJson({ file }), scopes_supported: [...MCP_SCOPES_SUPPORTED] } }),
      ]),
    ),
    [SKILL_PATH]: buildSkill(),
  };
}

if (require.main === module) {
  for (const [file, content] of Object.entries(buildMcpMetadataFiles())) fs.writeFileSync(file, content);
  console.log('generate-mcp-metadata: wrote the server card, the OAuth mirrors and SKILL.md');
  // The tool modules open Redis and DB handles at import time, which would keep the process alive.
  process.exit(0);
}
