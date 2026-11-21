// Retakes the landing screenshots that show the seeded showcase data, in both themes.
// Usage: node landing-shots.mjs [name,...]   (run `npm run screenshots:seed` first)
import { existsSync } from 'node:fs';
import sharp from 'sharp';

import { APP, STATE, bothThemes, open } from './helper.mjs';
import { ENTITLEMENTS, mockEntitlements } from './mocks.mjs';

const LANDING = new URL('../../../landing/', import.meta.url).pathname;
const SHOTS = LANDING + 'public/img/landing/screenshots/';
const HOME = LANDING + 'src/assets/home/';

const openFromList = async ({ page, path, item, ready }) => {
  await page.goto(APP + path);
  await page.getByText(item).first().click();
  await page.getByText(ready).waitFor();
};

// `size` is in CSS px: the @1x file's size, half the @2x file's.
const VIEWS = {
  'features/goals/goals-list': {
    size: [1015, 621],
    go: ({ page }) => page.goto(APP + '/goals'),
    ready: 'Trip to Japan',
    anchor: ({ page }) => page.getByRole('heading', { name: 'Goals', exact: true }),
    offset: [-20, -16],
    plan: 'goals',
  },
  'features/goals/goal-details': {
    size: [1063, 807],
    go: ({ page }) => openFromList({ page, path: '/goals', item: 'Trip to Japan', ready: 'Back to goals' }),
    ready: 'Trip to Japan',
    anchor: ({ page }) => page.getByText('Back to goals'),
    offset: [-20, -14],
  },
  'features/trackers/trackers-list': {
    size: [1063, 464],
    go: ({ page }) => page.goto(APP + '/planned/trackers'),
    ready: 'Lisbon trip',
    anchor: ({ page }) => page.getByRole('heading', { name: 'Trackers', exact: true }),
    offset: [-20, -14],
  },
  'features/trackers/tracker-details': {
    size: [1063, 673],
    go: ({ page }) => openFromList({ page, path: '/planned/trackers', item: 'Lisbon trip', ready: 'Back to trackers' }),
    ready: 'Flights',
    anchor: ({ page }) => page.getByText('Back to trackers'),
    offset: [-20, -14],
    plan: 'trackers',
  },
  'features/automations/automations-list': {
    size: [1015, 650],
    go: ({ page }) => page.goto(APP + '/transactions/automations'),
    ready: 'Monthly rent',
    anchor: ({ page }) => page.getByRole('heading', { name: 'Automations', exact: true }),
    offset: [-20, -26],
  },
  'features/automations/automation-form': {
    size: [1015, 1159],
    viewport: { height: 1400 },
    go: ({ page }) =>
      openFromList({ page, path: '/transactions/automations', item: 'Monthly rent', ready: 'Edit automation' }),
    ready: 'Landlord',
    anchor: ({ page }) => page.getByText('Edit automation'),
    offset: [-64, -24],
  },
  investments: {
    size: [757.5, 670],
    viewport: { height: 1300 },
    go: ({ page }) => openFromList({ page, path: '/investments', item: 'Brokerage', ready: 'Holdings' }),
    ready: 'VOO',
    // The holdings table needs ~1100px for all its columns, so this frame is taken larger and scaled down.
    clip: async ({ page }) => {
      const card = await page.getByText('Total value', { exact: true }).locator('xpath=../../..').boundingBox();
      const width = card.width + 32;
      return { x: card.x - 16, y: card.y - 16, width, height: (width * 670) / 757.5 };
    },
  },
  'money-flow': {
    size: [752, 627],
    viewport: { width: 1332 },
    // Before the SimpleFIN demo's own history starts, so only the seeded flows show.
    go: async ({ page }) => {
      await page.goto(APP + '/analytics/cash-flow');
      const previous = await page
        .getByRole('button', { name: 'Current month' })
        .locator('xpath=preceding-sibling::button[1]')
        .elementHandle();
      for (let i = 0; i < 8; i++) {
        await previous.click();
        await page.waitForTimeout(600);
      }
      const month = new Date(new Date().getFullYear(), new Date().getMonth() - 8, 1);
      await page
        .getByText(month.toLocaleString('en-US', { month: 'short', year: 'numeric' }), { exact: true })
        .waitFor();
    },
    ready: 'Wage, invoices',
    clip: async ({ page }) => {
      const card = page
        .locator('div')
        .filter({ has: page.getByText('Top 8') })
        .filter({ hasText: 'savings rate' })
        .last();
      await card.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
      const { x, y } = await card.boundingBox();
      return { x, y };
    },
  },
  'net-worth': {
    size: [751.5, 487.5],
    viewport: { width: 1332 },
    go: async ({ page }) => {
      await page.goto(APP + '/analytics/net-worth-history');
      await page.getByText('Weekly', { exact: true }).locator('visible=true').first().click();
      await page.getByRole('option', { name: 'Monthly' }).click();
      await page.waitForTimeout(2000);
    },
    ready: 'Cash & accounts',
    clip: async ({ page }) => {
      const label = await page.getByText('Current net worth').locator('visible=true').first().boundingBox();
      const b = { x: label.x - 17.5, y: label.y - 18 };
      await page.mouse.move(b.x + 330, b.y + 330);
      await page.waitForTimeout(800);
      return b;
    },
  },
  'home/shot-networth': {
    jpeg: true,
    viewport: { width: 1440, height: 804 },
    collapsed: true,
    go: async ({ page }) => {
      await page.goto(APP + '/analytics/net-worth-history');
      await page.getByText('Current net worth').locator('visible=true').first().waitFor();
      await page.waitForTimeout(2000);
    },
    ready: 'Cash & accounts',
  },
  'home/shot-investments': {
    jpeg: true,
    viewport: { width: 1440, height: 900 },
    collapsed: true,
    go: ({ page }) => openFromList({ page, path: '/investments', item: 'Brokerage', ready: 'Holdings' }),
    ready: 'VOO',
  },
};

async function clipOf({ page, view }) {
  const [width, height] = view.size;
  if (view.clip) return { width, height, ...(await view.clip({ page })) };
  const { x, y } = await view.anchor({ page }).boundingBox();
  return { x: x + view.offset[0], y: y + view.offset[1], width, height };
}

async function plan({ id, png, dark }) {
  const { width, height } = await sharp(png).metadata();
  const { data } = await sharp(png)
    .removeAlpha()
    .extract({ left: width - 4, top: height - 4, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = { r: data[0], g: data[1], b: data[2] };
  await sharp(png)
    .removeAlpha()
    .resize(1600, 1000, { fit: 'contain', background })
    .webp({ quality: 80 })
    .toFile(`${HOME}plan-${id}-${dark ? 'dark' : 'light'}.webp`);
}

if (!existsSync(STATE)) throw new Error('run npm run screenshots:seed first');
const only = process.argv[2]?.split(',');
const unknown = only?.filter((name) => !VIEWS[name]);
if (unknown?.length) throw new Error(`unknown views: ${unknown.join(', ')}`);

for (const [name, view] of Object.entries(VIEWS)) {
  if (only && !only.includes(name)) continue;
  const { browser, ctx, page } = await open(view.viewport);
  try {
    await ctx.addInitScript(
      (collapsed) => localStorage.setItem('sidebar:collapsed', String(collapsed)),
      Boolean(view.collapsed),
    );
    const failed = [];
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().includes('/api/')) failed.push(`${res.status()} ${res.url()}`);
    });
    await mockEntitlements({ page, entitlements: ENTITLEMENTS.activePlusYearly() });
    await view.go({ page });
    await page.getByText(view.ready).first().waitFor();
    await page.addStyleTag({ content: '[data-sonner-toaster] { display: none !important; }' });
    await page.waitForTimeout(3000);
    await bothThemes({
      page,
      capture: async ({ dark }) => {
        const clip = view.size && (await clipOf({ page, view }));
        const png = await page.screenshot({ clip, animations: 'disabled' });
        if (failed.length) throw new Error(`failed requests: ${failed.join(', ')}`);
        if (view.jpeg) {
          await sharp(png)
            .jpeg({ quality: 90 })
            .toFile(`${LANDING}src/assets/${name}-${dark ? 'dark' : 'light'}.jpg`);
          return;
        }
        const [w, h] = view.size;
        const { width, height } = await sharp(png).metadata();
        if (Math.abs(height - (width * h) / w) > 1) {
          throw new Error(`captured ${width}x${height} does not match the target aspect ratio`);
        }
        const base = SHOTS + name + (dark ? '' : '-light');
        for (const scale of [1, 2]) {
          await sharp(png)
            .resize(Math.round(w * scale), Math.round(h * scale), { fit: 'fill' })
            .webp({ quality: 80 })
            .toFile(`${base}@${scale}x.webp`);
        }
        if (view.plan) await plan({ id: view.plan, png, dark });
      },
    });
  } catch (e) {
    e.message = `${name}: ${e.message}`;
    throw e;
  }
  await browser.close();
  console.log(`• ${name}`);
}
