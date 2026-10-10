# MoneyMatter — Open-Source Budget Tracker & Personal Finance App

> Open-source personal finance app with budget tracking. Connect your banks, track expenses, set budgets, and monitor investments. Self-host for full control or use our cloud, and your data stays yours.

MoneyMatter is a privacy-first alternative to apps like Mint and YNAB. It is open-source (AGPL-3.0), and designed for people who want control over their financial data.

## Why MoneyMatter

- **Your finances. Your server. Your rules.**
- Open source. Self-host for free, or use the cloud: Essential $5/mo or $30/yr, Plus $8/mo or $55/yr, 40-day free trial without a card
- Self-host or use our cloud — either way, your data is never sold or shared
- Shape the roadmap with your feedback

## Features

- Bank account synchronization (LunchFlow, SimpleFIN, Monobank and Walutomat)
- AI-powered transaction categorization that follows your own instructions
- Budget tracking with visual progress indicators
- Investment portfolio tracking with automatic price updates
- Multi-currency support with automatic exchange rates
- CSV and bank statement import (with AI-assisted parsing)
- Custom categories, tags, and notes for transactions
- Recurring transaction tracking
- Detailed analytics and spending reports
- Full data export
- Dark mode, mobile-friendly responsive design
- PWA (Progressive Web App) support

## AI Integration (MCP)

MoneyMatter exposes a remote MCP (Model Context Protocol) server that gives AI assistants OAuth-secured access to your financial data. You choose the access level when connecting: read, write, or write and delete. Ask natural-language questions like:

- "Compare my dining out this month to my 3-month average"
- "Which subscriptions have increased in the past 6 months?"
- "I want to save $500/month — where can I realistically cut?"

Works with Claude, ChatGPT, OpenClaw, and any MCP-compatible client. Access can be revoked anytime.

- MCP endpoint: `https://mcp.moneymatter.app/mcp`
- MCP server card: [/.well-known/mcp/server-card.json](https://moneymatter.app/.well-known/mcp/server-card.json)
- OAuth discovery: [/.well-known/oauth-authorization-server](https://moneymatter.app/.well-known/oauth-authorization-server)

## Deployment Options

- **Cloud**: Sign up at <https://moneymatter.app> — no setup required, data never sold.
- **Self-hosted**: Deploy with Docker on your own server for maximum privacy. Source code and setup guide at <https://github.com/letehaha/moneymatter>.

## Links

- [Sign up / Get started](https://moneymatter.app/sign-up)
- [GitHub repository](https://github.com/letehaha/moneymatter)
- [API catalog](https://moneymatter.app/.well-known/api-catalog)
- [Privacy policy](https://moneymatter.app/privacy-policy)
- [Terms of use](https://moneymatter.app/terms-of-use)
- [llms.txt](https://moneymatter.app/llms.txt) · [llms-full.txt](https://moneymatter.app/llms-full.txt)

## License

MoneyMatter is released under the GNU Affero General Public License v3.0 (AGPL-3.0). Source: <https://github.com/letehaha/moneymatter>.
