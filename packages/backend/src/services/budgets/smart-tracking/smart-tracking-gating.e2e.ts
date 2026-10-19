import { FEATURES, FEATURE_TRIAL_DAYS, PLANS, SHARE_PERMISSIONS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { enableServerModel, runAsCloud, useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { createOpenAiConnection } from '@tests/helpers/user-settings';
import { GEMINI_API_URL } from '@tests/mocks/gemini/mock-api';
import { OPENAI_RESPONSES_URL } from '@tests/mocks/openai/mock-api';
import { addDays, subDays } from 'date-fns';
import { HttpResponse, http } from 'msw';

const DAY_MS = 24 * 60 * 60 * 1000;
const feature = FEATURES.smart_tracking;
const description = 'Everything spent on the Lisbon trip';

const getEntitlements = async () => (await helpers.getUserInfo({ raw: true })).entitlements!;
const getUserId = async () => (await helpers.getUserInfo({ raw: true })).id;

const createTracker = ({ aiEnabled }: { aiEnabled: boolean }) =>
  helpers.createCustomBudget({
    name: 'Lisbon trip',
    startDate: subDays(new Date(), 30).toISOString(),
    ...(aiEnabled && { aiEnabled, aiDescription: description }),
    raw: true,
  });

const createSmartTracker = async () => {
  const tracker = await createTracker({ aiEnabled: true });
  await helpers.waitForTrackerScanToSettle({ id: tracker.id });
  return tracker;
};

const enableSmartTracking = async ({ id }: { id: string }) => {
  const response = await helpers.editCustomBudget({
    id,
    params: { aiEnabled: true, aiDescription: description },
    raw: false,
  });
  expect(response.statusCode).toBe(200);
  await helpers.waitForTrackerScanToSettle({ id });
};

const getScan = async ({ id }: { id: string }) => (await helpers.getTrackerSuggestions({ id, raw: true })).scan;

const getPausedReason = async ({ id }: { id: string }) => (await getScan({ id })).pausedReason;

const editTracker = async ({
  id,
  params,
}: {
  id: string;
  params: Parameters<typeof helpers.editCustomBudget>[0]['params'];
}) => {
  const response = await helpers.editCustomBudget({ id, params, raw: false });
  expect(response.statusCode).toBe(200);
};

const createExpense = async () => {
  const account = await helpers.createAccount({ raw: true });
  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      note: 'Hotel Lisbon',
      time: subDays(new Date(), 5).toISOString(),
      amount: 100,
    }),
    raw: true,
  });
};

const countServerModelCalls = () => {
  const counter = { calls: 0 };
  global.mswMockServer.use(
    http.post(GEMINI_API_URL, () => {
      counter.calls++;
      return HttpResponse.json({}, { status: 500 });
    }),
  );
  return counter;
};

const countOpenAiCalls = () => {
  const counter = { calls: 0 };
  global.mswMockServer.use(
    http.post(OPENAI_RESPONSES_URL, () => {
      counter.calls++;
      return HttpResponse.json({
        id: 'resp_test',
        object: 'response',
        created_at: 1_700_000_000,
        model: 'gpt-5.4-nano',
        output: [
          {
            type: 'message',
            role: 'assistant',
            id: 'msg_test',
            content: [{ type: 'output_text', text: JSON.stringify({ matches: [] }), annotations: [] }],
          },
        ],
        usage: { input_tokens: 12, output_tokens: 1 },
      });
    }),
  );
  return counter;
};

const endTrial = async () => {
  await helpers.startFeatureTrial({ feature, raw: true });
  await helpers.backdateFeatureTrial({ userId: await getUserId(), feature });
};

/** Plus never records a trial, so the downgraded owner has smart tracking on and no trial row. */
const createSmartTrackerThenDowngrade = async () => {
  await helpers.setUserBilling({ plan: PLANS.plus });
  const tracker = await createSmartTracker();
  await helpers.setUserBilling({ plan: PLANS.essential });
  return tracker;
};

describe('Smart tracking plan gating', () => {
  useSelfHostWithoutServerAiKeys();

  it('starts a 14-day trial for an early adopter on first enable and serves the server model', async () => {
    runAsCloud();
    enableServerModel();
    await helpers.setUserBilling({ plan: PLANS.early_adopter });
    expect((await getEntitlements()).features).not.toContain(feature);

    const tracker = await createSmartTracker();

    const entitlements = await getEntitlements();
    const trial = entitlements.featureTrials[feature]!;
    expect(entitlements.features).toContain(feature);
    expect(new Date(trial.endsAt).getTime() - new Date(trial.startedAt).getTime()).toBe(
      FEATURE_TRIAL_DAYS[feature] * DAY_MS,
    );
    expect(await getPausedReason({ id: tracker.id })).toBeNull();
  });

  it('pauses with reason plan once the trial ends and the user has no AI connection', async () => {
    runAsCloud();
    enableServerModel();
    await helpers.setUserBilling({ plan: PLANS.early_adopter });
    const tracker = await createSmartTracker();

    await helpers.backdateFeatureTrial({ userId: await getUserId(), feature });

    expect((await getEntitlements()).features).not.toContain(feature);
    expect(await getPausedReason({ id: tracker.id })).toBe('plan');
  });

  it('never calls the server model once the trial has ended and the user has no AI connection', async () => {
    runAsCloud();
    enableServerModel();
    await helpers.setUserBilling({ plan: PLANS.early_adopter });
    await endTrial();
    await createExpense();
    const serverModel = countServerModelCalls();

    const tracker = await createSmartTracker();
    await editTracker({ id: tracker.id, params: { aiDescription: 'Hotels and food in Lisbon' } });
    await helpers.waitForTrackerScanToSettle({ id: tracker.id });

    expect(serverModel.calls).toBe(0);
    expect(await getScan({ id: tracker.id })).toMatchObject({ lastScannedAt: null, pausedReason: 'plan' });
  });

  it('scans on the user own AI connection, not the server model, once the trial has ended', async () => {
    runAsCloud();
    enableServerModel();
    await helpers.setUserBilling({ plan: PLANS.early_adopter });
    await createOpenAiConnection();
    await endTrial();
    await createExpense();
    const serverModel = countServerModelCalls();
    const connection = countOpenAiCalls();

    const tracker = await createSmartTracker();

    expect(connection.calls).toBeGreaterThan(0);
    expect(serverModel.calls).toBe(0);
    const scan = await getScan({ id: tracker.id });
    expect(scan.pausedReason).toBeNull();
    expect(scan.lastScannedAt).not.toBeNull();
  });

  it('gives an essential subscriber the trial when smart tracking is turned on by an edit', async () => {
    runAsCloud();
    enableServerModel();
    await helpers.setUserBilling({ plan: PLANS.essential });
    const tracker = await createTracker({ aiEnabled: false });
    expect((await getEntitlements()).featureTrials[feature]).toBeUndefined();

    await enableSmartTracking({ id: tracker.id });

    const entitlements = await getEntitlements();
    expect(entitlements.features).toContain(feature);
    expect(entitlements.featureTrials[feature]).toBeDefined();
    expect(await getPausedReason({ id: tracker.id })).toBeNull();
  });

  it('records no trial for a plus user', async () => {
    runAsCloud();
    enableServerModel();
    await helpers.setUserBilling({ plan: PLANS.plus });

    const tracker = await createSmartTracker();

    expect(await getPausedReason({ id: tracker.id })).toBeNull();
    await helpers.setUserBilling({ plan: PLANS.essential });
    expect((await getEntitlements()).featureTrials[feature]).toBeUndefined();
  });

  it('does not start the trial when a tracker without smart tracking is renamed', async () => {
    runAsCloud();
    enableServerModel();
    await helpers.setUserBilling({ plan: PLANS.essential });
    const tracker = await createTracker({ aiEnabled: false });

    await editTracker({ id: tracker.id, params: { name: 'Lisbon' } });

    expect((await getEntitlements()).featureTrials[feature]).toBeUndefined();
  });

  it('does not start the trial when smart tracking is turned off', async () => {
    runAsCloud();
    enableServerModel();
    const tracker = await createSmartTrackerThenDowngrade();

    await editTracker({ id: tracker.id, params: { aiEnabled: false } });

    expect((await getEntitlements()).featureTrials[feature]).toBeUndefined();
  });

  it('does not start the trial on unrelated edits of a tracker switched on while the user was entitled', async () => {
    runAsCloud();
    enableServerModel();
    const tracker = await createSmartTrackerThenDowngrade();

    await editTracker({ id: tracker.id, params: { name: 'Lisbon' } });
    await editTracker({ id: tracker.id, params: { archivePromptDismissed: true } });

    expect((await getEntitlements()).featureTrials[feature]).toBeUndefined();
    expect(await getPausedReason({ id: tracker.id })).toBe('plan');
  });

  it('starts no trial for the owner or a manage recipient when the recipient renames the tracker', async () => {
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const { authUserId } = await helpers.findAppUserByEmail({ email: recipient.email });
    await helpers.setUserBilling({ authUserId, plan: PLANS.essential });
    runAsCloud();
    enableServerModel();
    const tracker = await createSmartTrackerThenDowngrade();
    await helpers.shareBudgetWith({ budgetId: tracker.id, recipient, permission: SHARE_PERMISSIONS.manage });

    const recipientTrials = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        await editTracker({ id: tracker.id, params: { name: 'Our Lisbon trip' } });
        return (await getEntitlements()).featureTrials;
      },
    });

    expect(recipientTrials[feature]).toBeUndefined();
    expect((await getEntitlements()).featureTrials[feature]).toBeUndefined();
  });

  it('starts the trial on request for a tracker switched on while the user was entitled', async () => {
    runAsCloud();
    enableServerModel();
    const tracker = await createSmartTrackerThenDowngrade();
    expect(await getPausedReason({ id: tracker.id })).toBe('plan');

    const entitlements = await helpers.startFeatureTrial({ feature, raw: true });

    expect(entitlements.features).toContain(feature);
    expect(entitlements.featureTrials[feature]).toBeDefined();
    expect(await getPausedReason({ id: tracker.id })).toBeNull();
  });

  it('records no trial for a user on the account trial', async () => {
    runAsCloud();
    enableServerModel();
    await helpers.setUserBilling({ plan: null, trialEndsAt: addDays(new Date(), 10) });

    const tracker = await createSmartTracker();

    const entitlements = await getEntitlements();
    expect(entitlements.features).toContain(feature);
    expect(entitlements.featureTrials[feature]).toBeUndefined();
    expect(await getPausedReason({ id: tracker.id })).toBeNull();
  });

  it('does not restart an ended trial when smart tracking is turned on for another tracker', async () => {
    runAsCloud();
    enableServerModel();
    await helpers.setUserBilling({ plan: PLANS.essential });
    await createSmartTracker();
    await helpers.backdateFeatureTrial({ userId: await getUserId(), feature });
    const endedTrial = (await getEntitlements()).featureTrials[feature]!;

    const second = await createTracker({ aiEnabled: false });
    await enableSmartTracking({ id: second.id });

    expect((await getEntitlements()).featureTrials[feature]).toEqual(endedTrial);
    expect(await getPausedReason({ id: second.id })).toBe('plan');
  });
});
