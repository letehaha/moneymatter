import { type Page, expect, test } from '@playwright/test';

import { completeOnboarding, createAccount, extractId, signInViaApi } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { type ChatStub, buildMessage, stubChatApi, textRun } from '../../helpers/chat-stubs';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'chat-page' });
let accountId: string;

const COMPOSER_PLACEHOLDER = 'Ask or describe a change';
const MOBILE_VIEWPORT = { width: 390, height: 844 };

const thread = ({ page, title }: { page: Page; title: string }) =>
  page.getByTestId('thread-item').filter({ hasText: title });

const CHART_RUN = {
  events: [
    { type: 'run.started', runId: 'run', messageId: 'assistant', provider: 'custom', modelId: 'test-model' },
    { type: 'part.started', part: { type: 'text', id: 'part-text', text: '' } },
    { type: 'text.delta', partId: 'part-text', delta: 'Groceries were ' },
    { type: 'text.delta', partId: 'part-text', delta: 'your biggest expense.' },
    {
      type: 'part.started',
      part: {
        type: 'visual',
        id: 'part-chart',
        spec: {
          type: 'chart',
          kind: 'bar',
          title: 'Spending by category',
          unit: { kind: 'money', currencyCode: CURRENCY },
          xAxis: { type: 'category', values: ['Groceries', 'Dining'] },
          series: [{ name: 'Spent', values: [420, 180] }],
        },
      },
    },
    { type: 'usage', inputTokens: 1200, outputTokens: 300, cachedInputTokens: 0 },
    { type: 'run.finished', status: 'complete' },
  ],
  finalParts: [
    { type: 'text', id: 'part-text', text: 'Groceries were your biggest expense.' },
    {
      type: 'visual',
      id: 'part-chart',
      spec: {
        type: 'chart',
        kind: 'bar',
        title: 'Spending by category',
        unit: { kind: 'money', currencyCode: CURRENCY },
        xAxis: { type: 'category', values: ['Groceries', 'Dining'] },
        series: [{ name: 'Spent', values: [420, 180] }],
      },
    },
  ],
};

test.describe('Chat page', () => {
  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    const request = await signInViaApi({ playwright, email: creds.email, password: creds.password });
    await completeOnboarding({ request, currencyCode: CURRENCY });
    accountId = extractId(
      await createAccount({ request, name: 'Main card', currencyCode: CURRENCY, initialBalance: 500 }),
    );
  });

  let stub: ChatStub;

  test.beforeEach(async ({ page }) => {
    stub = await stubChatApi({ page });
    await loginViaUI({ page, email: creds.email, password: creds.password });
  });

  test('streams an answer with text and a chart', async ({ page }) => {
    stub.nextRun = CHART_RUN;
    await page.goto('/chat');

    const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
    await composer.fill('Where did my money go?');
    await composer.press('Enter');

    await expect(page.getByTestId('user-message')).toContainText('Where did my money go?');
    await expect(page.getByText('Groceries were your biggest expense.')).toBeVisible();
    await expect(page.locator('figure', { hasText: 'Spending by category' })).toBeVisible();
    // The first message created the thread and the page moved to its address.
    await expect(page).toHaveURL(/\/chat\/thread-1$/);
  });

  test('searches the history, pins, renames and deletes a conversation', async ({ page }) => {
    stub.addThread({ id: 'thread-1', title: 'Grocery spending' });
    stub.addThread({ id: 'thread-2', title: 'Holiday budget' });
    stub.addThread({ id: 'thread-3', title: 'Car insurance' });
    await page.goto('/chat');

    await expect(page.getByTestId('thread-item')).toHaveCount(3);

    await page.getByPlaceholder('Search conversations').fill('holiday');
    await expect(page.getByTestId('thread-item')).toHaveCount(1);
    await expect(thread({ page, title: 'Holiday budget' })).toBeVisible();

    await page.getByPlaceholder('Search conversations').clear();
    await expect(page.getByTestId('thread-item')).toHaveCount(3);

    // Pin: the conversation moves under its own heading, first.
    await thread({ page, title: 'Car insurance' }).hover();
    await thread({ page, title: 'Car insurance' }).getByRole('button', { name: 'Pin' }).click();
    await expect(page.getByText('Conversation pinned')).toBeVisible();
    await expect(page.getByTestId('group-heading').first()).toHaveText('Pinned');
    await expect(page.getByTestId('thread-item').first()).toContainText('Car insurance');

    // Rename in place.
    await thread({ page, title: 'Holiday budget' }).hover();
    await thread({ page, title: 'Holiday budget' }).getByRole('button', { name: 'Rename' }).click();
    const field = page.getByPlaceholder('Conversation name');
    await field.fill('Holidays 2026');
    await field.press('Enter');
    await expect(thread({ page, title: 'Holidays 2026' })).toBeVisible();

    // Delete asks first.
    await thread({ page, title: 'Grocery spending' }).hover();
    await thread({ page, title: 'Grocery spending' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Delete this conversation?');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Conversation deleted')).toBeVisible();
    await expect(thread({ page, title: 'Grocery spending' })).toHaveCount(0);
  });

  test('says that no conversation exists yet', async ({ page }) => {
    await page.goto('/chat');

    await expect(page.getByText('No conversations yet')).toBeVisible();
    await expect(page.getByText('Ask anything about your money')).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test('the header button opens the Chat page with the page it was pressed on', async ({ page }) => {
      stub.nextRun = textRun({ text: 'Your balance is 500.' });
      await page.goto(`/account/${accountId}`);

      await page.getByTestId('chat-header-button').click();

      await expect(page).toHaveURL(/\/chat\?context=/);
      await expect(page.getByTestId('context-chip')).toContainText('Account: Main card');

      const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
      await composer.fill('What is my balance?');
      await composer.press('Enter');

      await expect(page.getByText('Your balance is 500.')).toBeVisible();
      // The conversation keeps the page it started on: the thread is created with it, the message carries none.
      const created = stub.calls.find((call) => call.method === 'POST' && call.path.endsWith('/threads'));
      expect(created?.body).toMatchObject({ pageContext: { entity: { kind: 'account', id: accountId } } });
      const sent = stub.calls.find((call) => call.method === 'POST' && call.path.endsWith('/messages'));
      expect(sent?.body).not.toHaveProperty('pageContext');
    });
  });
  test.describe('model picker', () => {
    const CONNECTIONS = [
      {
        id: 'conn-1',
        provider: 'custom',
        name: 'Home Ollama',
        baseUrl: 'http://ollama.lan/v1',
        model: 'llama3.2',
        status: 'valid',
        hasApiKey: false,
      },
      {
        id: 'conn-2',
        provider: 'custom',
        name: 'Studio vLLM',
        baseUrl: 'http://vllm.lan/v1',
        model: 'qwen2.5',
        status: 'valid',
        hasApiKey: false,
      },
    ];

    test.beforeEach(() => {
      stub.connections = CONNECTIONS.map((connection) => ({
        ...connection,
        createdAt: '2026-03-05T10:00:00.000Z',
        lastValidatedAt: '2026-03-05T10:00:00.000Z',
      }));
      stub.defaultConnectionId = 'conn-1';
    });

    test('switches the connection of a conversation', async ({ page }) => {
      stub.addThread({ id: 'thread-1', title: 'Budget talk', connectionId: 'conn-1' });
      await page.goto('/chat/thread-1');

      const picker = page.getByTestId('chat-connection-picker').getByRole('combobox').first();
      await expect(picker).toContainText('Home Ollama (llama3.2)');

      // The model is chosen above the message box.
      const pickerBox = await picker.boundingBox();
      const inputBox = await page.getByPlaceholder(COMPOSER_PLACEHOLDER).boundingBox();
      expect(pickerBox!.y).toBeLessThan(inputBox!.y);

      await picker.click();
      await page.getByRole('option', { name: 'Studio vLLM (qwen2.5)' }).click();

      await expect(picker).toContainText('Studio vLLM (qwen2.5)');
      const patch = stub.calls.find((call) => call.method === 'PATCH' && call.path === '/threads/thread-1');
      expect(patch?.body).toEqual({ connectionId: 'conn-2' });
    });

    test('starts a new conversation on the connection picked before the first message', async ({ page }) => {
      stub.nextRun = textRun({ text: 'Hello there.' });
      await page.goto('/chat');

      const picker = page.getByTestId('chat-connection-picker').getByRole('combobox').first();
      await expect(picker).toContainText('Home Ollama (llama3.2)');
      await picker.click();
      await page.getByRole('option', { name: 'Studio vLLM (qwen2.5)' }).click();

      await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill('Hi');
      await page.getByTestId('send').click();

      await expect(page.getByText('Hello there.')).toBeVisible();
      const created = stub.calls.find((call) => call.method === 'POST' && call.path === '/threads');
      // Switching connection starts on that connection's own model, sent outright.
      expect(created?.body).toEqual({ connectionId: 'conn-2', modelId: null });
    });

    test.describe('model within the connection', () => {
      test.beforeEach(() => {
        stub.connectionModels = ['llama3.2', 'llama3.2:70b', 'llama3.2:1b'];
      });

      test('picks a model for a conversation and returns to the default', async ({ page }) => {
        stub.addThread({ id: 'thread-1', title: 'Budget talk', connectionId: 'conn-1' });
        await page.goto('/chat/thread-1');

        const models = page.getByTestId('chat-connection-picker').getByRole('combobox').nth(1);
        await expect(models).toContainText('Default (llama3.2)');
        // The model select names the model, so the connection is named alone.
        await expect(page.getByTestId('chat-connection-picker').getByRole('combobox').first()).toHaveText(
          'Home Ollama',
        );

        // The page is wide, so the two selects share a row.
        const connectionBox = await page
          .getByTestId('chat-connection-picker')
          .getByRole('combobox')
          .first()
          .boundingBox();
        const modelBox = await models.boundingBox();
        expect(Math.abs(connectionBox!.y - modelBox!.y)).toBeLessThan(4);

        await models.click();
        await page.getByRole('option', { name: 'llama3.2:70b' }).click();

        await expect(models).toContainText('llama3.2:70b');
        const picked = stub.calls.findLast((call) => call.method === 'PATCH' && call.path === '/threads/thread-1');
        expect(picked?.body).toEqual({ modelId: 'llama3.2:70b' });

        await models.click();
        await page.getByRole('option', { name: 'Default (llama3.2)' }).click();

        await expect
          .poll(() => stub.calls.findLast((call) => call.method === 'PATCH' && call.path === '/threads/thread-1')?.body)
          .toEqual({ modelId: null });
      });

      test('starts a new conversation on the model picked before the first message', async ({ page }) => {
        stub.nextRun = textRun({ text: 'Hello there.' });
        await page.goto('/chat');

        const models = page.getByTestId('chat-connection-picker').getByRole('combobox').nth(1);
        await models.click();
        await page.getByRole('option', { name: 'llama3.2:1b' }).click();

        await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill('Hi');
        await page.getByTestId('send').click();

        await expect(page.getByText('Hello there.')).toBeVisible();
        const created = stub.calls.find((call) => call.method === 'POST' && call.path === '/threads');
        expect(created?.body).toEqual({ connectionId: 'conn-1', modelId: 'llama3.2:1b' });
      });

      test('sends the default outright when it is picked over an inherited model', async ({ page }) => {
        stub.defaultModelId = 'llama3.2:70b';
        stub.nextRun = textRun({ text: 'Hello there.' });
        await page.goto('/chat');

        const models = page.getByTestId('chat-connection-picker').getByRole('combobox').nth(1);
        await expect(models).toContainText('llama3.2:70b');
        await models.click();
        await page.getByRole('option', { name: 'Default (llama3.2)' }).click();

        await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill('Hi');
        await page.getByTestId('send').click();

        await expect(page.getByText('Hello there.')).toBeVisible();
        const created = stub.calls.find((call) => call.method === 'POST' && call.path === '/threads');
        expect(created?.body).toEqual({ modelId: null });
      });
    });
  });
  test('shows an attached image as a thumbnail that opens larger, and a PDF as a named chip', async ({ page }) => {
    stub.addThread({
      id: 'thread-img',
      title: 'Receipt',
      messages: [
        buildMessage({
          id: 'user-img',
          role: 'user',
          threadId: 'thread-img',
          parts: [
            {
              type: 'attachment',
              id: 'a1',
              attachmentId: 'att-img',
              fileName: 'receipt.png',
              mimeType: 'image/png',
              kind: 'image',
            },
            {
              type: 'attachment',
              id: 'a2',
              attachmentId: 'att-pdf',
              fileName: 'statement.pdf',
              mimeType: 'application/pdf',
              kind: 'pdf',
            },
          ],
        }),
      ],
    });
    await page.goto('/chat/thread-img');

    const thumbnail = page.getByTestId('attachment-thumbnail');
    await expect(thumbnail.locator('img')).toBeVisible();
    await expect(page.getByTestId('attachment-chip')).toContainText('statement.pdf');
    expect(stub.calls.filter((call) => call.path.endsWith('/image')).map((call) => call.path)).toEqual([
      '/attachments/att-img/image',
    ]);

    await thumbnail.click();
    await expect(page.getByRole('dialog').locator('img')).toBeVisible();
  });
});
