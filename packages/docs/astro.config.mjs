import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';

const OG_IMAGE = 'https://docs.moneymatter.app/og-image.jpg';

export default defineConfig({
  site: 'https://docs.moneymatter.app',
  // The default Sätteri processor's linux-x64 binary panics or mangles MDX output, which breaks CI and Docker builds.
  markdown: { processor: unified() },
  integrations: [
    starlight({
      title: 'MoneyMatter Docs',
      description: 'Guides and explanations for MoneyMatter, the personal finance app.',
      logo: { src: './src/assets/logo.svg' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/custom.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/letehaha/moneymatter' },
        { icon: 'external', label: 'Open MoneyMatter', href: 'https://moneymatter.app' },
      ],
      editLink: { baseUrl: 'https://github.com/letehaha/moneymatter/edit/main/packages/docs/' },
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: OG_IMAGE } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: OG_IMAGE } },
      ],
      plugins: [
        starlightLinksValidator(),
        starlightLlmsTxt({
          projectName: 'MoneyMatter',
          description:
            'MoneyMatter is a personal finance app for tracking accounts, transactions, transfers and spending across currencies, with bank connections and imports.',
        }),
      ],
      sidebar: [
        { label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
        { label: 'Accounts', items: [{ autogenerate: { directory: 'accounts' } }] },
        { label: 'Transactions', items: [{ autogenerate: { directory: 'transactions' } }] },
        { label: 'Transfers & refunds', items: [{ autogenerate: { directory: 'transfers-and-refunds' } }] },
        { label: 'Stats & reports', items: [{ autogenerate: { directory: 'stats' } }] },
        { label: 'Import & bank connections', items: [{ autogenerate: { directory: 'import' } }] },
        { label: 'AI', items: [{ autogenerate: { directory: 'ai' } }] },
        { label: 'Settings', items: [{ autogenerate: { directory: 'settings' } }] },
      ],
    }),
  ],
});
