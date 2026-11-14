import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Users from '@models/users.model';
import { redisClient } from '@root/redis-client';

import {
  REDIS_KEYS,
  SyncStatus,
  clearAllSyncStatuses,
  getAccountSyncStatus,
  setAccountSyncStatus,
  updateLastAutoSync,
} from './sync-status-tracker';

// Test user ID - derived from the test user created in setupIntegrationTests.ts
let testUserId: number;

describe('Sync Status Tracker - clearAllSyncStatuses', () => {
  beforeEach(async () => {
    // Get the test user ID from the user created in setupIntegrationTests.ts
    const user = await Users.findOne({ where: { username: 'test1' } });
    if (!user) throw new Error('Test user not found');
    testUserId = user.id;
  });

  afterEach(async () => {
    // Clean up after each test
    const keys = await redisClient.keys('*account:*:sync-status*');
    const userKeys = await redisClient.keys('*user:*:last-auto-sync*');
    const priorityKeys = await redisClient.keys('*account:*:priority*');
    const allKeys = [...keys, ...userKeys, ...priorityKeys];
    if (allKeys.length > 0) {
      await redisClient.del(allKeys);
    }
  });

  it('should reset QUEUED status to IDLE on startup', async () => {
    const accountId = generateRandomRecordId();

    // Set account to QUEUED status
    await setAccountSyncStatus({ accountId, status: SyncStatus.QUEUED, userId: testUserId });

    // Verify it's QUEUED
    const beforeCleanup = await getAccountSyncStatus(accountId);
    expect(beforeCleanup?.status).toBe(SyncStatus.QUEUED);

    // Run cleanup
    await clearAllSyncStatuses();

    // Verify it's now IDLE with error message
    const afterCleanup = await getAccountSyncStatus(accountId);
    expect(afterCleanup?.status).toBe(SyncStatus.IDLE);
    expect(afterCleanup?.error).toBe('Sync interrupted by server restart');
    expect(afterCleanup?.startedAt).toBeNull();
    expect(afterCleanup?.completedAt).toBeNull();
  });

  it('should reset SYNCING status to IDLE on startup', async () => {
    const accountId = generateRandomRecordId();

    // Set account to SYNCING status
    await setAccountSyncStatus({ accountId, status: SyncStatus.SYNCING, userId: testUserId });

    // Verify it's SYNCING
    const beforeCleanup = await getAccountSyncStatus(accountId);
    expect(beforeCleanup?.status).toBe(SyncStatus.SYNCING);
    expect(beforeCleanup?.startedAt).not.toBeNull();

    // Run cleanup
    await clearAllSyncStatuses();

    // Verify it's now IDLE
    const afterCleanup = await getAccountSyncStatus(accountId);
    expect(afterCleanup?.status).toBe(SyncStatus.IDLE);
    expect(afterCleanup?.error).toBe('Sync interrupted by server restart');
    expect(afterCleanup?.startedAt).toBeNull();
  });

  it('should preserve COMPLETED status on startup', async () => {
    const accountId = generateRandomRecordId();

    // Set account to COMPLETED status
    await setAccountSyncStatus({ accountId, status: SyncStatus.COMPLETED, userId: testUserId });

    // Get the completed status before cleanup
    const beforeCleanup = await getAccountSyncStatus(accountId);
    expect(beforeCleanup?.status).toBe(SyncStatus.COMPLETED);
    const completedAt = beforeCleanup?.completedAt;

    // Run cleanup
    await clearAllSyncStatuses();

    // Verify it's still COMPLETED
    const afterCleanup = await getAccountSyncStatus(accountId);
    expect(afterCleanup?.status).toBe(SyncStatus.COMPLETED);
    expect(afterCleanup?.completedAt).toBe(completedAt);
    expect(afterCleanup?.error).toBeNull();
  });

  it('should preserve FAILED status on startup', async () => {
    const accountId = generateRandomRecordId();
    const originalError = 'Original sync error';

    // Set account to FAILED status
    await setAccountSyncStatus({ accountId, status: SyncStatus.FAILED, error: originalError, userId: testUserId });

    // Run cleanup
    await clearAllSyncStatuses();

    // Verify it's still FAILED with original error
    const afterCleanup = await getAccountSyncStatus(accountId);
    expect(afterCleanup?.status).toBe(SyncStatus.FAILED);
    expect(afterCleanup?.error).toBe(originalError);
    expect(afterCleanup?.completedAt).not.toBeNull();
  });

  it('should preserve IDLE status on startup', async () => {
    const accountId = generateRandomRecordId();

    // Set account to IDLE status
    await setAccountSyncStatus({ accountId, status: SyncStatus.IDLE, userId: testUserId });

    // Run cleanup
    await clearAllSyncStatuses();

    // Verify it's still IDLE
    const afterCleanup = await getAccountSyncStatus(accountId);
    expect(afterCleanup?.status).toBe(SyncStatus.IDLE);
  });

  it('should handle multiple accounts with different statuses', async () => {
    const queuedAccountId = generateRandomRecordId();
    const syncingAccountId = generateRandomRecordId();
    const completedAccountId = generateRandomRecordId();
    const failedAccountId = generateRandomRecordId();

    // Set up various statuses
    await setAccountSyncStatus({ accountId: queuedAccountId, status: SyncStatus.QUEUED, userId: testUserId });
    await setAccountSyncStatus({ accountId: syncingAccountId, status: SyncStatus.SYNCING, userId: testUserId });
    await setAccountSyncStatus({ accountId: completedAccountId, status: SyncStatus.COMPLETED, userId: testUserId });
    await setAccountSyncStatus({
      accountId: failedAccountId,
      status: SyncStatus.FAILED,
      error: 'Test error',
      userId: testUserId,
    });

    // Run cleanup
    await clearAllSyncStatuses();

    // Verify results
    const queuedStatus = await getAccountSyncStatus(queuedAccountId);
    const syncingStatus = await getAccountSyncStatus(syncingAccountId);
    const completedStatus = await getAccountSyncStatus(completedAccountId);
    const failedStatus = await getAccountSyncStatus(failedAccountId);

    expect(queuedStatus?.status).toBe(SyncStatus.IDLE);
    expect(queuedStatus?.error).toBe('Sync interrupted by server restart');

    expect(syncingStatus?.status).toBe(SyncStatus.IDLE);
    expect(syncingStatus?.error).toBe('Sync interrupted by server restart');

    expect(completedStatus?.status).toBe(SyncStatus.COMPLETED);
    expect(completedStatus?.error).toBeNull();

    expect(failedStatus?.status).toBe(SyncStatus.FAILED);
    expect(failedStatus?.error).toBe('Test error');
  });

  it('should not touch userLastAutoSync keys', async () => {
    const userId = 99999;
    const timestamp = Date.now();

    // Set last auto sync
    await updateLastAutoSync(userId);

    // Run cleanup
    await clearAllSyncStatuses();

    // Verify the key still exists
    const lastSync = await redisClient.get(REDIS_KEYS.userLastAutoSync(userId));
    expect(lastSync).not.toBeNull();
    expect(parseInt(lastSync!, 10)).toBeGreaterThanOrEqual(timestamp);
  });

  it('should delete invalid/corrupted keys', async () => {
    const corruptedKey = REDIS_KEYS.accountSyncStatus(generateRandomRecordId());

    // Set corrupted data (not valid JSON)
    await redisClient.set(corruptedKey, 'invalid json data');

    // Run cleanup
    await clearAllSyncStatuses();

    // Verify the corrupted key was deleted
    const value = await redisClient.get(corruptedKey);
    expect(value).toBeNull();
  });
});
