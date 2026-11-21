import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APP, EMAIL, PASSWORD, STATE, api, open } from './helper.mjs';
import { seedShowcase } from './seed-showcase.mjs';

// SimpleFIN's public demo: claimable any number of times, returns demo accounts with fresh transactions.
const SIMPLEFIN_DEMO_TOKEN = Buffer.from('https://beta-bridge.simplefin.org/simplefin/claim/DEMO').toString('base64');
const MANUAL_ACCOUNT = 'Everyday Checking';

const log = (message) => console.log(`• ${message}`);
const { browser, ctx, page } = await open({ fresh: true });

async function call({ method = 'GET', path, body }) {
  const { status, json } = await api({ page, method, path, body });
  if (status >= 300) throw new Error(`${method} ${path} → ${status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json.response;
}

async function signIn() {
  await page.goto(APP + '/sign-in');
  const signedIn = /welcome|dashboard/;
  await Promise.race([page.locator('input[type="email"]').waitFor(), page.waitForURL(signedIn)]);
  if (signedIn.test(page.url())) return true;
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  return page
    .waitForURL(/welcome|dashboard/, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

async function signUp() {
  await page.goto(APP + '/sign-up');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.getByPlaceholder('ie. John Snow').fill('Alex');
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/verify-email|welcome|dashboard/, { timeout: 30_000 });
}

async function makeAttachmentFiles() {
  const dir = mkdtempSync(join(tmpdir(), 'docs-attachments-'));
  const files = [join(dir, 'receipt-office-chair.jpg'), join(dir, 'invoice-office-chair.pdf')];
  const doc = await ctx.newPage();
  await doc.setViewportSize({ width: 380, height: 560 });
  await doc.setContent(`<body style="margin:0;padding:28px 24px;font:14px 'Courier New',monospace">
    <div style="text-align:center;font-weight:bold;font-size:18px">OFFICE DEPOT CO.</div>
    <div style="text-align:center;margin-bottom:16px">22/09/2026 11:30</div>
    <div style="display:flex;justify-content:space-between"><span>Ergonomic chair</span><span>179.99</span></div>
    <div style="display:flex;justify-content:space-between"><span>Chair mat</span><span>10.00</span></div>
    <hr style="border:none;border-top:1px dashed #555">
    <div style="display:flex;justify-content:space-between;font-weight:bold"><span>TOTAL USD</span><span>189.99</span></div></body>`);
  await doc.screenshot({ path: files[0], type: 'jpeg', quality: 85 });
  await doc.setContent(`<body style="font:14px Helvetica;padding:40px"><h1>Invoice #INV-2026-0922</h1>
    <p>Office Depot Co.</p><p>Ergonomic chair — $179.99<br>Chair mat — $10.00</p><p><b>Total — $189.99</b></p></body>`);
  await doc.pdf({ path: files[1], format: 'A4' });
  await doc.close();
  return files;
}

if (!(await signIn())) {
  log(`creating ${EMAIL}`);
  await signUp();
  if (!(await signIn())) {
    throw new Error(
      'Sign-in failed after sign-up. If email verification is on, clear RESEND_API_KEY for the local backend.',
    );
  }
}
log(`signed in as ${EMAIL}`);

if (page.url().includes('/welcome')) {
  // Confirm is a silent no-op until the currency list loads and preselects USD.
  await page.getByRole('combobox').filter({ hasText: 'USD' }).waitFor();
  await page.getByRole('button', { name: 'Confirm Currency' }).click();
  const deadline = Date.now() + 15_000;
  while (!(await call({ path: '/user/currencies/base' }))) {
    if (Date.now() > deadline) throw new Error('Confirm Currency did not set a base currency within 15s');
    await page.waitForTimeout(500);
  }
  log('base currency set to USD');
}

const connections = (await call({ path: '/bank-data-providers/connections' })).connections;
if (!connections.some((c) => c.providerType === 'simplefin')) {
  const { connectionId } = await call({
    method: 'POST',
    path: '/bank-data-providers/simplefin/connect',
    body: { credentials: { setupToken: SIMPLEFIN_DEMO_TOKEN } },
  });
  await call({
    method: 'POST',
    path: `/bank-data-providers/connections/${connectionId}/sync-selected-accounts`,
    body: { accountExternalIds: ['Demo Savings', 'Demo Checking'] },
  });
  log('SimpleFIN demo connected (Savings + Checking)');
}

const accounts = await call({ path: '/accounts' });
if (!accounts.some((a) => a.name === MANUAL_ACCOUNT)) {
  const account = await call({
    method: 'POST',
    path: '/accounts',
    body: { name: MANUAL_ACCOUNT, currencyCode: 'USD', initialBalance: 2450 },
  });
  const categories = await call({ path: '/categories' });
  const categoryId = (name) => categories.find((c) => c.name === name).id;
  const expenses = [
    { amount: 189.99, note: 'Office chair', category: 'Shopping', daysAgo: 2 },
    { amount: 84.2, note: 'Weekly groceries', category: 'Groceries', daysAgo: 3 },
    { amount: 42.5, note: 'Dinner with friends', category: 'Restaurant, fast-food', daysAgo: 4 },
  ];
  for (const { amount, note, category, daysAgo } of expenses) {
    await call({
      method: 'POST',
      path: '/transactions',
      body: {
        amount,
        note,
        categoryId: categoryId(category),
        accountId: account.id,
        time: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
        transactionType: 'expense',
        paymentType: 'debitCard',
        transferNature: 'not_transfer',
      },
    });
  }
  log(`${MANUAL_ACCOUNT} created with 3 expenses`);

  await page.goto(APP + '/transactions');
  await page.getByRole('row').filter({ hasText: 'Office chair' }).getByRole('button', { name: 'Open details' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add attachments' }).click();
  const attachments = page.getByRole('dialog', { name: /^Attachments/ });
  await attachments.locator('input[type="file"]').setInputFiles(await makeAttachmentFiles());
  await attachments.getByText('invoice-office-chair.pdf').waitFor({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  log('receipt and invoice attached to "Office chair"');
}

await seedShowcase({ call, log });

await page.goto(APP + '/settings/security/login-methods');
await page.getByText('Passkeys', { exact: true }).waitFor();
if (await page.getByText('No passkeys registered').isVisible()) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.getByRole('button', { name: 'Add Passkey' }).click();
  await page.getByText('Passkey added successfully').waitFor();
  log('passkey added');
}

await page.goto(APP + '/dashboard');
await page.waitForTimeout(3000);
const dismiss = page.getByText('Dismiss permanently');
if (await dismiss.isVisible()) {
  await dismiss.click();
  const confirm = page.getByRole('alertdialog');
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button').last().click();
  log('Quick Start dismissed');
}

if (!(await page.locator('[data-widget-id="net-worth"]').count())) {
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByText('Add widgets').scrollIntoViewIfNeeded();
  await page
    .getByText(/net worth/i)
    .last()
    .click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(1500);
  log('Net Worth widget added');
}

await ctx.storageState({ path: STATE });
await browser.close();
log(`session saved to ${STATE}`);
