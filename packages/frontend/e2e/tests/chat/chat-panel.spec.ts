import { type Locator, type Page, expect, test } from '@playwright/test';

import { completeOnboarding, createAccount, extractId, signInViaApi } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { type ChatStub, stubChatApi } from '../../helpers/chat-stubs';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'chat-panel' });
let accountId: string;

const DEFAULT_WIDTH = 420;
const KEYBOARD_STEP = 16;

test.describe('Chat panel', () => {
  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    const request = await signInViaApi({ playwright, email: creds.email, password: creds.password });
    await completeOnboarding({ request, currencyCode: CURRENCY });
    accountId = extractId(
      await createAccount({ request, name: 'Savings', currencyCode: CURRENCY, initialBalance: 100 }),
    );
  });

  let stub: ChatStub;

  test.beforeEach(async ({ page }) => {
    stub = await stubChatApi({ page });
    await loginViaUI({ page, email: creds.email, password: creds.password });
  });

  test('opens beside an account page and shows the account as the context', async ({ page }) => {
    await page.goto(`/account/${accountId}`);

    await page.getByTestId('chat-header-button').click();

    const panel = page.getByTestId('chat-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('context-chip')).toContainText('Account: Savings');
    // The page stays where it was, next to the panel.
    await expect(page).toHaveURL(new RegExp(`/account/${accountId}$`));
  });

  test('keeps its width and stays open across a reload, until it is closed', async ({ page }) => {
    await page.goto(`/account/${accountId}`);
    await page.getByTestId('chat-header-button').click();

    const handle = page.getByTestId('panel-resize');
    await handle.focus();
    await handle.press('ArrowLeft');
    await handle.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', String(DEFAULT_WIDTH + 2 * KEYBOARD_STEP));

    await page.reload();

    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page.getByTestId('panel-resize')).toHaveAttribute(
      'aria-valuenow',
      String(DEFAULT_WIDTH + 2 * KEYBOARD_STEP),
    );

    await page.getByTestId('panel-close').click();
    await expect(page.getByTestId('chat-panel')).toHaveCount(0);
  });

  test('can drop the page context before sending', async ({ page }) => {
    await page.goto(`/account/${accountId}`);
    await page.getByTestId('chat-header-button').click();

    await page.getByTestId('chat-panel').getByTestId('context-remove').click();

    await expect(page.getByTestId('context-chip')).toHaveCount(0);
  });

  const openPanelWithModels = async ({ page, width }: { page: Page; width: number }) => {
    stub.connections = [
      {
        id: 'conn-1',
        provider: 'anthropic',
        name: 'My Claude Account',
        model: 'claude-haiku-5-5',
        status: 'valid',
        hasApiKey: true,
        createdAt: '2026-03-05T10:00:00.000Z',
        lastValidatedAt: '2026-03-05T10:00:00.000Z',
      },
    ];
    stub.connectionModels = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
    stub.defaultConnectionId = 'conn-1';
    await page.addInitScript((panelWidth) => {
      localStorage.setItem('chat-panel', JSON.stringify({ isOpen: false, width: panelWidth }));
    }, width);
    await page.goto(`/account/${accountId}`);
    await page.getByTestId('chat-header-button').click();

    const panel = page.getByTestId('chat-panel');
    await expect(page.getByTestId('panel-resize')).toHaveAttribute('aria-valuenow', String(width));
    const selects = panel.getByTestId('chat-connection-picker').getByRole('combobox');
    await expect(selects).toHaveCount(2);

    return { panel, selects };
  };

  /** The label inside a select, which truncates when the select is narrow. */
  const selectLabel = ({ select }: { select: Locator }) => select.locator('.truncate');

  test('keeps the connection and model selects on one row in a panel at its minimum width', async ({ page }) => {
    const { panel, selects } = await openPanelWithModels({ page, width: 360 });

    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.width).toBeLessThanOrEqual(360);
    const [connection, model] = await Promise.all([selects.nth(0).boundingBox(), selects.nth(1).boundingBox()]);
    for (const box of [connection!, model!]) {
      expect(box.x).toBeGreaterThanOrEqual(panelBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
    }
    // One row, to save vertical space: the two selects share the width in equal halves.
    expect(Math.abs(connection!.y - model!.y)).toBeLessThan(4);
    expect(connection!.x + connection!.width).toBeLessThanOrEqual(model!.x);
    expect(Math.abs(connection!.width - model!.width)).toBeLessThan(2);
    expect(connection!.width).toBeGreaterThan(panelBox.width * 0.4);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    // The model select names the model, so the connection is named alone; a label cut short keeps its full text.
    await expect(selects.nth(0)).toHaveText('My Claude Account');
    await expect(selects.nth(1)).toContainText('Default (claude-haiku-5-5)');
    await expect(selectLabel({ select: selects.nth(0) })).toHaveAttribute('title', 'My Claude Account');
    await expect(selectLabel({ select: selects.nth(1) })).toHaveAttribute('title', /Default \(claude-haiku-5-5\)/);

    await panel.screenshot({ path: test.info().outputPath('panel-360.png') });
  });

  test('puts the connection and model selects side by side in a wide panel', async ({ page }) => {
    const { panel, selects } = await openPanelWithModels({ page, width: 560 });

    const [connection, model] = await Promise.all([selects.nth(0).boundingBox(), selects.nth(1).boundingBox()]);
    expect(Math.abs(connection!.y - model!.y)).toBeLessThan(4);
    expect(connection!.x + connection!.width).toBeLessThanOrEqual(model!.x);

    await panel.screenshot({ path: test.info().outputPath('panel-560.png') });
  });

  test('is not offered on the Chat page itself', async ({ page }) => {
    await page.goto('/chat');

    await expect(page.getByTestId('chat-header-button')).toHaveCount(0);
  });
});
