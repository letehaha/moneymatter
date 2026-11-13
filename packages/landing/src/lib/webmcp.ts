/**
 * WebMCP — expose landing-page actions to browser-based AI agents.
 * https://webmachinelearning.github.io/webmcp/
 *
 * `navigator.modelContext` is a draft API (not shipped in most browsers yet).
 * The feature-detect ensures this is a no-op where unsupported.
 */

import { rememberLocale } from '@/i18n/client';

import { GITHUB_URL } from './github-api';

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
}

interface ModelContextApi {
  provideContext: (context: { tools: WebMcpTool[] }) => void;
}

declare global {
  interface Navigator {
    modelContext?: ModelContextApi;
  }
}

const EMPTY_OBJECT_SCHEMA = { type: 'object', properties: {} as Record<string, unknown> };

export function initWebMcp(): void {
  if (!navigator.modelContext?.provideContext) return;

  navigator.modelContext.provideContext({
    tools: [
      {
        name: 'navigate_to_sign_up',
        description: 'Navigate the user to the MoneyMatter sign-up page so they can create a free account.',
        inputSchema: EMPTY_OBJECT_SCHEMA,
        execute: () => {
          rememberLocale();
          window.location.href = '/sign-up';
          return { navigatedTo: '/sign-up' };
        },
      },
      {
        name: 'open_github_repository',
        description: 'Open the MoneyMatter open-source repository on GitHub in a new tab.',
        inputSchema: EMPTY_OBJECT_SCHEMA,
        execute: () => {
          window.open(GITHUB_URL, '_blank', 'noopener,noreferrer');
          return { opened: GITHUB_URL };
        },
      },
      {
        name: 'start_demo',
        description:
          'Start the no-signup demo with sample data. Works on any landing page that has a demo start button; returns an error otherwise.',
        inputSchema: EMPTY_OBJECT_SCHEMA,
        execute: () => {
          const button = document.querySelector<HTMLButtonElement>('[data-demo-start]');
          if (!button) {
            return { started: false, error: 'This page has no demo button.' };
          }
          if (button.getAttribute('aria-busy') === 'true') {
            return { started: false, error: 'A demo is already starting.' };
          }
          button.click();
          return { started: true };
        },
      },
      {
        name: 'get_product_summary',
        description: 'Return a concise summary of MoneyMatter (what it is, pricing, deployment options, source code).',
        inputSchema: EMPTY_OBJECT_SCHEMA,
        execute: () => ({
          name: 'MoneyMatter',
          tagline: 'Your finances. Your server. Your rules.',
          description:
            'Open-source personal finance app with budget tracking. Bank sync, AI-assisted categorization, budgets, investment tracking, and full export. Self-host it or use the hosted cloud. Data is never sold or shared.',
          pricing:
            'Cloud: Essential $5/mo or $30/yr, Plus $8/mo or $55/yr, 40-day free trial without a card. Self-hosting is free.',
          cloudSignUpUrl: 'https://moneymatter.app/sign-up',
          sourceCodeUrl: GITHUB_URL,
          license: 'AGPL-3.0',
        }),
      },
      {
        name: 'get_mcp_connection_info',
        description:
          'Return the MoneyMatter MCP server endpoint and OAuth discovery URLs so the user can connect an AI agent to their financial data.',
        inputSchema: EMPTY_OBJECT_SCHEMA,
        execute: () => ({
          mcpEndpoint: 'https://mcp.moneymatter.app/mcp',
          transport: 'streamable-http',
          serverCard: 'https://moneymatter.app/.well-known/mcp/server-card.json',
          oauthProtectedResource: 'https://moneymatter.app/.well-known/oauth-protected-resource',
          oauthAuthorizationServer: 'https://moneymatter.app/.well-known/oauth-authorization-server',
          scopes: ['finance:read', 'profile:read', 'offline_access'],
          connectSkill: 'https://moneymatter.app/skills/connect-moneymatter/SKILL.md',
        }),
      },
    ],
  });
}
