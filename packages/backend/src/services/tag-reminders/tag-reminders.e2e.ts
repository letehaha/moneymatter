import { NOTIFICATION_TYPES, TAG_REMINDER_FREQUENCIES, TAG_REMINDER_TYPES, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Notifications from '@models/notifications.model';
import TagReminders from '@models/tag-reminders.model';
import Users from '@models/users.model';
import * as helpers from '@tests/helpers';

import {
  checkRealTimeReminders,
  checkScheduledReminders,
  getDateRangeForRealTimeReminder,
  getDateRangeForScheduledReminder,
  shouldCheckReminderToday,
} from './check-reminders';

describe('Tag Reminders API', () => {
  describe('POST /tags/:tagId/reminders (createTagReminder)', () => {
    it('creates every reminder shape and rejects an exact duplicate', async () => {
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Create Shapes Tag' }),
        raw: true,
      });

      const scheduled = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.amountThreshold,
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
          dayOfMonth: 15,
          settings: { amountThreshold: 500 },
        }),
        raw: true,
      });

      expect(scheduled.id).toBeDefined();
      expect(scheduled.tagId).toBe(tag.id);
      expect(scheduled.type).toBe(TAG_REMINDER_TYPES.amountThreshold);
      expect(scheduled.frequency).toBe(TAG_REMINDER_FREQUENCIES.monthly);
      expect(scheduled.dayOfMonth).toBe(15);
      expect((scheduled.settings as { amountThreshold?: number })?.amountThreshold).toBe(500);
      expect(scheduled.isEnabled).toBe(true);

      const realTime = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildRealTimeReminderPayload({
          type: TAG_REMINDER_TYPES.amountThreshold,
          settings: { amountThreshold: 200 },
        }),
        raw: true,
      });

      expect(realTime.type).toBe(TAG_REMINDER_TYPES.amountThreshold);
      expect(realTime.frequency).toBeNull();
      expect(realTime.dayOfMonth).toBeNull();

      const existenceCheck = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.existenceCheck,
          frequency: TAG_REMINDER_FREQUENCIES.weekly,
          settings: {},
        }),
        raw: true,
      });

      expect(existenceCheck.type).toBe(TAG_REMINDER_TYPES.existenceCheck);
      expect(existenceCheck.frequency).toBe(TAG_REMINDER_FREQUENCIES.weekly);

      const quarterly = await helpers.createTagReminder({
        tagId: tag.id,
        payload: {
          type: TAG_REMINDER_TYPES.amountThreshold,
          frequency: TAG_REMINDER_FREQUENCIES.quarterly,
          dayOfMonth: 15,
          settings: { amountThreshold: 500 },
        },
        raw: true,
      });

      expect(quarterly.frequency).toBe(TAG_REMINDER_FREQUENCIES.quarterly);
      expect(quarterly.dayOfMonth).toBe(15);

      const sameScheduleOtherThreshold = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.amountThreshold,
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
          dayOfMonth: 15,
          settings: { amountThreshold: 100 },
        }),
        raw: true,
      });

      expect(sameScheduleOtherThreshold.id).not.toBe(scheduled.id);
      expect((sameScheduleOtherThreshold.settings as { amountThreshold?: number })?.amountThreshold).toBe(100);
      expect((scheduled.settings as { amountThreshold?: number })?.amountThreshold).toBe(500);

      const disabled = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({ isEnabled: false }),
        raw: true,
      });

      expect(disabled.isEnabled).toBe(false);

      const duplicateResponse = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.amountThreshold,
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
          dayOfMonth: 15,
          settings: { amountThreshold: 500 },
        }),
        raw: false,
      });

      expect(duplicateResponse.statusCode).toBe(409);
    });
  });

  describe('GET + PUT /tags/:tagId/reminders (read and update)', () => {
    it('lists reminders per tag and for the user, then patches one of them', async () => {
      const tag1 = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Lifecycle Tag 1' }),
        raw: true,
      });
      const tag2 = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Lifecycle Tag 2' }),
        raw: true,
      });
      const tag3 = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Lifecycle Tag 3' }),
        raw: true,
      });

      const amountReminder = await helpers.createTagReminder({
        tagId: tag1.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.amountThreshold,
          settings: { amountThreshold: 100 },
        }),
        raw: true,
      });
      await helpers.createTagReminder({
        tagId: tag1.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.existenceCheck,
          settings: {},
        }),
        raw: true,
      });
      await helpers.createTagReminder({
        tagId: tag2.id,
        payload: helpers.buildTagReminderPayload({ settings: { amountThreshold: 2000 } }),
        raw: true,
      });

      const tag1Reminders = await helpers.getRemindersForTag({ tagId: tag1.id, raw: true });
      const tag3Reminders = await helpers.getRemindersForTag({ tagId: tag3.id, raw: true });
      const allReminders = await helpers.getAllReminders({ raw: true });

      expect(tag1Reminders).toHaveLength(2);
      expect(tag3Reminders).toEqual([]);
      expect(allReminders).toHaveLength(3);

      const fetched = await helpers.getReminderById({
        tagId: tag1.id,
        id: amountReminder.id,
        raw: true,
      });

      expect(fetched.id).toBe(amountReminder.id);
      expect((fetched.settings as { amountThreshold?: number })?.amountThreshold).toBe(100);

      const updated = await helpers.updateTagReminder({
        tagId: tag1.id,
        id: amountReminder.id,
        payload: {
          settings: { amountThreshold: 2000 },
          frequency: TAG_REMINDER_FREQUENCIES.weekly,
        },
        raw: true,
      });

      expect(updated.id).toBe(amountReminder.id);
      expect((updated.settings as { amountThreshold?: number })?.amountThreshold).toBe(2000);
      expect(updated.frequency).toBe(TAG_REMINDER_FREQUENCIES.weekly);

      const disabled = await helpers.updateTagReminder({
        tagId: tag1.id,
        id: amountReminder.id,
        payload: { isEnabled: false },
        raw: true,
      });

      expect(disabled.isEnabled).toBe(false);
    });
  });

  describe('DELETE /tags/:tagId/reminders/:id (deleteTagReminder)', () => {
    it('deletes an existing reminder', async () => {
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Delete Reminder Tag' }),
        raw: true,
      });

      const created = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload(),
        raw: true,
      });

      const deleteResponse = await helpers.deleteTagReminder({
        tagId: tag.id,
        id: created.id,
        raw: false,
      });
      expect(deleteResponse.statusCode).toBe(200);

      const getResponse = await helpers.getReminderById({
        tagId: tag.id,
        id: created.id,
        raw: false,
      });
      expect(getResponse.statusCode).toBe(404);
    });
  });

  describe('request validation', () => {
    it('rejects a malformed create body and a malformed update body', async () => {
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Validation Tag' }),
        raw: true,
      });
      const create = (payload: Record<string, unknown>) =>
        helpers.createTagReminder({ tagId: tag.id, payload: payload as never, raw: false });
      const valid = helpers.buildTagReminderPayload();

      expect((await create({ ...valid, type: 'weekly' })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await create({ ...valid, frequency: 'hourly' })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await create({ ...valid, dayOfMonth: 0 })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await create({ ...valid, dayOfMonth: 32 })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await create({ ...valid, dayOfMonth: 1.5 })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await create({ ...valid, settings: { amountThreshold: 0 } })).statusCode).toBe(
        ERROR_CODES.ValidationError,
      );
      expect((await create({ ...valid, settings: { amountThreshold: -5 } })).statusCode).toBe(
        ERROR_CODES.ValidationError,
      );
      expect((await create({ ...valid, isEnabled: 'yes' })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await create({ frequency: 'daily' })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await create({ ...valid, settings: {} })).statusCode).toBe(ERROR_CODES.ValidationError);

      const reminder = await helpers.createTagReminder({ tagId: tag.id, payload: valid, raw: true });
      const update = (payload: Record<string, unknown>) =>
        helpers.updateTagReminder({ tagId: tag.id, id: reminder.id, payload: payload as never, raw: false });

      expect((await update({ type: 'weekly' })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await update({ frequency: 'hourly' })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await update({ dayOfMonth: 32 })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await update({ settings: { amountThreshold: 0 } })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await update({ settings: {} })).statusCode).toBe(ERROR_CODES.ValidationError);

      const untouched = await helpers.getReminderById({ tagId: tag.id, id: reminder.id, raw: true });
      expect(untouched.frequency).toBe(valid.frequency);
      expect(untouched.dayOfMonth).toBe(valid.dayOfMonth);
    });
  });

  describe('cross-user isolation', () => {
    it('shows another user no reminders and refuses every route on a foreign tag or reminder', async () => {
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Foreign Tag' }),
        raw: true,
      });
      const reminder = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload(),
        raw: true,
      });

      const stranger = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: stranger.cookies,
        fn: async () => {
          expect(await helpers.getAllReminders({ raw: true })).toEqual([]);
          const notFound = ERROR_CODES.NotFoundError;
          expect((await helpers.getRemindersForTag({ tagId: tag.id, raw: false })).statusCode).toBe(notFound);
          expect((await helpers.getReminderById({ tagId: tag.id, id: reminder.id, raw: false })).statusCode).toBe(
            notFound,
          );
          expect(
            (
              await helpers.createTagReminder({
                tagId: tag.id,
                payload: helpers.buildTagReminderPayload({ dayOfMonth: 2 }),
                raw: false,
              })
            ).statusCode,
          ).toBe(notFound);
          expect(
            (
              await helpers.updateTagReminder({
                tagId: tag.id,
                id: reminder.id,
                payload: { isEnabled: false },
                raw: false,
              })
            ).statusCode,
          ).toBe(notFound);
          expect((await helpers.deleteTagReminder({ tagId: tag.id, id: reminder.id, raw: false })).statusCode).toBe(
            notFound,
          );
        },
      });

      const survivor = await helpers.getReminderById({ tagId: tag.id, id: reminder.id, raw: true });
      expect(survivor.isEnabled).toBe(true);
    });
  });

  describe('unknown ids', () => {
    it('returns 404 on every reminder route', async () => {
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Unknown Ids Tag' }),
        raw: true,
      });

      const createResponse = await helpers.createTagReminder({
        tagId: NONEXISTENT_ID,
        payload: helpers.buildTagReminderPayload(),
        raw: false,
      });
      const getResponse = await helpers.getReminderById({
        tagId: tag.id,
        id: NONEXISTENT_ID,
        raw: false,
      });
      const updateResponse = await helpers.updateTagReminder({
        tagId: tag.id,
        id: NONEXISTENT_ID,
        payload: { isEnabled: false },
        raw: false,
      });
      const deleteResponse = await helpers.deleteTagReminder({
        tagId: tag.id,
        id: NONEXISTENT_ID,
        raw: false,
      });

      expect(createResponse.statusCode).toBe(404);
      expect(getResponse.statusCode).toBe(404);
      expect(updateResponse.statusCode).toBe(404);
      expect(deleteResponse.statusCode).toBe(404);
    });

    it('keeps a reminder invisible under another tag id', async () => {
      const tag1 = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Cross Tag 1' }),
        raw: true,
      });
      const tag2 = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Cross Tag 2' }),
        raw: true,
      });

      const reminder = await helpers.createTagReminder({
        tagId: tag1.id,
        payload: helpers.buildTagReminderPayload(),
        raw: true,
      });

      const getResponse = await helpers.getReminderById({
        tagId: tag2.id,
        id: reminder.id,
        raw: false,
      });
      const updateResponse = await helpers.updateTagReminder({
        tagId: tag2.id,
        id: reminder.id,
        payload: { isEnabled: false },
        raw: false,
      });
      const deleteResponse = await helpers.deleteTagReminder({
        tagId: tag2.id,
        id: reminder.id,
        raw: false,
      });

      expect(getResponse.statusCode).toBe(404);
      expect(updateResponse.statusCode).toBe(404);
      expect(deleteResponse.statusCode).toBe(404);

      const survivor = await helpers.getReminderById({
        tagId: tag1.id,
        id: reminder.id,
        raw: true,
      });
      expect(survivor.id).toBe(reminder.id);
    });
  });
});

describe('Tag Reminders Check Service', () => {
  let testUserId: number;

  beforeEach(async () => {
    const user = await Users.findOne({ where: { username: 'test1' } });
    testUserId = user!.id;
  });

  describe('shouldCheckReminderToday', () => {
    it('returns a verdict per frequency', async () => {
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Should Check Tag' }),
        raw: true,
      });

      const today = new Date();
      const currentDay = today.getDate();
      let differentDay = currentDay + 1;
      if (differentDay > 28) differentDay = 1;

      const realTime = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildRealTimeReminderPayload(),
        raw: true,
      });
      const monthlyToday = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
          dayOfMonth: currentDay,
        }),
        raw: true,
      });
      const monthlyOtherDay = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
          dayOfMonth: differentDay,
        }),
        raw: true,
      });
      const daily = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({
          frequency: TAG_REMINDER_FREQUENCIES.daily,
        }),
        raw: true,
      });

      const verdictFor = async ({ id }: { id: string }) => {
        const dbReminder = await TagReminders.findByPk(id);
        return shouldCheckReminderToday({ reminder: dbReminder! });
      };

      // Real-time reminders fire when transactions get tagged, so the daily cron skips them.
      expect(await verdictFor({ id: realTime.id })).toBe(false);
      expect(await verdictFor({ id: monthlyToday.id })).toBe(true);
      expect(await verdictFor({ id: monthlyOtherDay.id })).toBe(false);
      expect(await verdictFor({ id: daily.id })).toBe(true);
    });
  });

  describe('reminder date ranges', () => {
    it('spans the frequency window for scheduled reminders and the month for real-time ones', async () => {
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Date Range Tag' }),
        raw: true,
      });

      const monthly = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
        }),
        raw: true,
      });
      const weekly = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({
          frequency: TAG_REMINDER_FREQUENCIES.weekly,
          dayOfMonth: null,
        }),
        raw: true,
      });

      const daysBetween = ({ from, to }: { from: Date; to: Date }) =>
        Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

      const monthlyReminder = await TagReminders.findByPk(monthly.id);
      const monthlyDays = daysBetween(getDateRangeForScheduledReminder({ reminder: monthlyReminder! }));

      expect(monthlyDays).toBeGreaterThanOrEqual(28);
      expect(monthlyDays).toBeLessThanOrEqual(31);

      const weeklyReminder = await TagReminders.findByPk(weekly.id);
      const weeklyDays = daysBetween(getDateRangeForScheduledReminder({ reminder: weeklyReminder! }));

      expect(weeklyDays).toBeGreaterThanOrEqual(6);
      expect(weeklyDays).toBeLessThanOrEqual(7);

      const realTimeRange = getDateRangeForRealTimeReminder();

      expect(realTimeRange.from.getDate()).toBe(1);
      expect(realTimeRange.to.getDate()).toBe(new Date().getDate());
    });
  });

  describe('checkScheduledReminders - amount threshold', () => {
    it('sums all tagged transactions, not just the newest page of them', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Pagination Sum Test' }),
        raw: true,
      });

      const today = new Date();
      const currentDay = today.getDate();

      // 25 x 10 = 250 total, while any 20 of them add up to 200 – below the 220 threshold
      const transactionIds: string[] = [];
      for (let i = 0; i < 25; i++) {
        const [tx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 10,
            transactionType: TRANSACTION_TYPES.expense,
            time: today.toISOString(),
          }),
          raw: true,
        });

        transactionIds.push(tx.id);
      }

      await helpers.addTransactionsToTag({
        tagId: tag.id,
        transactionIds,
        raw: true,
      });

      await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.amountThreshold,
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
          dayOfMonth: currentDay,
          settings: { amountThreshold: 220 },
          isEnabled: true,
        }),
        raw: true,
      });

      const result = await checkScheduledReminders();

      const checkResult = result.results.find((r) => r.tagName === 'Pagination Sum Test');

      expect(checkResult?.transactionCount).toBe(25);
      expect(checkResult?.triggered).toBe(true);
    });
  });

  describe('checkScheduledReminders - sweep outcomes', () => {
    it('notifies only the reminders whose condition is met and leaves disabled ones unchecked', async () => {
      const account = await helpers.createAccount({ raw: true });

      const today = new Date();
      const currentDay = today.getDate();

      const aboveThresholdTag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Above Threshold Test' }),
        raw: true,
      });
      const belowThresholdTag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Below Threshold Test' }),
        raw: true,
      });
      const existenceTag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Existence Check Tag' }),
        raw: true,
      });
      const disabledTag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Disabled Reminder Test' }),
        raw: true,
      });

      const createTaggedTransaction = async ({ tagId, amount }: { tagId: string; amount: number }) => {
        const [tx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount,
            transactionType: TRANSACTION_TYPES.expense,
            time: today.toISOString(),
          }),
          raw: true,
        });

        await helpers.addTransactionsToTag({
          tagId,
          transactionIds: [tx.id],
          raw: true,
        });
      };

      await createTaggedTransaction({ tagId: aboveThresholdTag.id, amount: 600 });
      await createTaggedTransaction({ tagId: belowThresholdTag.id, amount: 100 });
      await createTaggedTransaction({ tagId: existenceTag.id, amount: 50 });

      await helpers.createTagReminder({
        tagId: aboveThresholdTag.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.amountThreshold,
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
          dayOfMonth: currentDay,
          settings: { amountThreshold: 500 },
          isEnabled: true,
        }),
        raw: true,
      });
      await helpers.createTagReminder({
        tagId: belowThresholdTag.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.amountThreshold,
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
          dayOfMonth: currentDay,
          settings: { amountThreshold: 500 },
          isEnabled: true,
        }),
        raw: true,
      });
      await helpers.createTagReminder({
        tagId: existenceTag.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.existenceCheck,
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
          dayOfMonth: currentDay,
          settings: {},
          isEnabled: true,
        }),
        raw: true,
      });
      await helpers.createTagReminder({
        tagId: disabledTag.id,
        payload: helpers.buildTagReminderPayload({
          type: TAG_REMINDER_TYPES.existenceCheck,
          frequency: TAG_REMINDER_FREQUENCIES.monthly,
          dayOfMonth: currentDay,
          isEnabled: false,
        }),
        raw: true,
      });

      const result = await checkScheduledReminders();
      const outcomeFor = ({ tagName }: { tagName: string }) => result.results.find((r) => r.tagName === tagName);

      expect(result.totalChecked).toBe(3);
      expect(result.triggered).toBe(2);
      expect(outcomeFor({ tagName: 'Above Threshold Test' })?.triggered).toBe(true);
      expect(outcomeFor({ tagName: 'Below Threshold Test' })?.triggered).toBe(false);
      expect(outcomeFor({ tagName: 'Existence Check Tag' })?.triggered).toBe(true);
      expect(result.results.map((r) => r.tagName)).not.toContain('Disabled Reminder Test');

      const notifications = await Notifications.findAll({
        where: {
          userId: testUserId,
          type: NOTIFICATION_TYPES.tagReminder,
        },
      });

      expect(notifications).toHaveLength(2);
    }, 20000);
  });

  describe('checkRealTimeReminders', () => {
    it('triggers notification for real-time reminder when threshold exceeded', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Real-time Trigger Test' }),
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 600, // More than threshold
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date().toISOString(),
        }),
        raw: true,
      });

      await helpers.addTransactionsToTag({
        tagId: tag.id,
        transactionIds: [tx.id],
        raw: true,
      });

      const reminder = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildRealTimeReminderPayload({
          type: TAG_REMINDER_TYPES.amountThreshold,
          settings: { amountThreshold: 500 },
          isEnabled: true,
        }),
        raw: true,
      });

      const dbReminder = await TagReminders.findByPk(reminder.id);
      const result = await checkRealTimeReminders({ reminders: [dbReminder!] });

      expect(result.triggered).toBe(1);
    });

    it('respects 24h cooldown', async () => {
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Cooldown Test' }),
        raw: true,
      });

      const reminder = await helpers.createTagReminder({
        tagId: tag.id,
        payload: helpers.buildRealTimeReminderPayload({
          type: TAG_REMINDER_TYPES.existenceCheck,
          settings: {},
          isEnabled: true,
        }),
        raw: true,
      });

      // Set lastTriggeredAt to recent (within 24h)
      await TagReminders.update({ lastTriggeredAt: new Date() }, { where: { id: reminder.id } });

      const dbReminder = await TagReminders.findByPk(reminder.id);
      const result = await checkRealTimeReminders({ reminders: [dbReminder!] });

      expect(result.skipped).toBe(1);
      expect(result.triggered).toBe(0);
    });
  });
});
