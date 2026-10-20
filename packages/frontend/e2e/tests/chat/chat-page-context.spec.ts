import { type Page, expect, test } from '@playwright/test';

import {
  completeOnboarding,
  createAccount,
  createSubscription,
  createTracker,
  extractId,
  signInViaApi,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { type ChatStub, stubChatApi, textRun } from '../../helpers/chat-stubs';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const COMPOSER_PLACEHOLDER = 'Ask or describe a change';
const creds = buildTestCredentials({ prefix: 'chat-page-context' });

let subscriptionId: string;
let trackerId: string;

test.describe('Chat page context', () => {
  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    const request = await signInViaApi({ playwright, email: creds.email, password: creds.password });
    await completeOnboarding({ request, currencyCode: CURRENCY });
    const accountId = extractId(
      await createAccount({ request, name: 'Main card', currencyCode: CURRENCY, initialBalance: 500 }),
    );
    subscriptionId = extractId(
      await createSubscription({
        request,
        payload: {
          name: 'Netflix',
          type: 'subscription',
          transactionType: 'expense',
          frequency: 'monthly',
          expectedAmount: 15,
          expectedCurrencyCode: CURRENCY,
          startDate: new Date().toISOString().slice(0, 10),
          accountId,
        },
      }),
    );
    trackerId = extractId(await createTracker({ request, payload: { name: 'Groceries limit', limitAmount: 400 } }));
  });

  let stub: ChatStub;

  test.beforeEach(async ({ page }) => {
    stub = await stubChatApi({ page });
    await loginViaUI({ page, email: creds.email, password: creds.password });
  });

  /** Opens the panel on the current page, asks something and returns the page context the new thread was created with. */
  const askFromPanel = async ({ page }: { page: Page }) => {
    stub.nextRun = textRun({ text: 'Done.' });
    stub.calls.length = 0;
    await page.getByTestId('chat-header-button').click();
    const panel = page.getByTestId('chat-panel');
    await expect(panel).toBeVisible();
    return {
      panel,
      send: async () => {
        const composer = panel.getByPlaceholder(COMPOSER_PLACEHOLDER);
        await composer.fill('What about this?');
        await composer.press('Enter');
        await expect(panel.getByText('Done.')).toBeVisible();
        // A conversation takes the page it starts on, as part of the thread.
        const created = stub.calls.find((call) => call.method === 'POST' && call.path.endsWith('/threads'));
        return (created?.body as { pageContext?: unknown } | undefined)?.pageContext;
      },
    };
  };

  test('the recurring payments list tells the chat which page it is and how it is sorted', async ({ page }) => {
    await page.goto('/planned/recurring-payments');

    const { panel, send } = await askFromPanel({ page });

    await expect(panel.getByTestId('context-chip')).toContainText('Recurring payments');
    expect(await send()).toMatchObject({
      route: 'dashboard.planned.subscriptions',
      filters: { sortBy: expect.any(String) },
    });
  });

  test('a subscription page sends the subscription', async ({ page }) => {
    await page.goto(`/planned/recurring-payments/${subscriptionId}`);

    const { panel, send } = await askFromPanel({ page });

    await expect(panel.getByTestId('context-chip')).toContainText('Subscription');
    expect(await send()).toMatchObject({ entity: { kind: 'subscription', id: subscriptionId } });
  });

  test('the trackers list and a tracker page both reach the chat', async ({ page }) => {
    await page.goto('/planned/trackers');
    const list = await askFromPanel({ page });
    await expect(list.panel.getByTestId('context-chip')).toContainText('Trackers');
    expect(await list.send()).toMatchObject({ route: 'dashboard.planned.trackers' });

    await page.getByTestId('panel-close').click();
    await page.goto(`/planned/trackers/${trackerId}`);
    const detail = await askFromPanel({ page });
    // The panel still holds the conversation from the list page; a new one takes this page.
    await detail.panel.getByTestId('panel-new-chat').click();
    await expect(detail.panel.getByTestId('context-chip')).toContainText('Tracker');
    expect(await detail.send()).toMatchObject({ entity: { kind: 'tracker', id: trackerId } });
  });

  test('a page with secrets sends its name and nothing else', async ({ page }) => {
    await page.goto('/settings/ai/models');

    const { panel, send } = await askFromPanel({ page });

    await expect(panel.getByTestId('context-chip')).toContainText('AI models');
    expect(await send()).toEqual({ route: 'dashboard.settings.ai.models' });
  });

  test('a conversation keeps its page on the Chat page and in the list', async ({ page }) => {
    stub.addThread({
      id: 'thread-sub',
      title: 'Renewal date',
      pageContext: {
        route: 'dashboard.planned.subscription-details',
        entity: { kind: 'subscription', id: subscriptionId },
      },
    });

    // On the Chat page the thread shows its own page and never offers to switch.
    await page.goto('/chat/thread-sub');
    await expect(page.getByTestId('context-chip')).toContainText('Subscription');
    await expect(page.getByTestId('context-use-page')).toHaveCount(0);
    await expect(page.getByTestId('thread-item').first().getByTestId('thread-context')).toContainText('Subscription');
  });
});
