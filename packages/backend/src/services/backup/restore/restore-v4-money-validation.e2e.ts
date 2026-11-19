import { t } from '@i18n/index';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';

type Row = Record<string, unknown>;

describe('Restore of a format version 4 archive with amounts the columns cannot hold', () => {
  beforeEach(async () => {
    const user = (await helpers.makeRequest({ method: 'get', url: '/user', raw: true })) as { id: number };
    await RateLimitService.resetRateLimit(`backup:user:${user.id}`);
    await RateLimitService.resetRateLimit(`backup-restore:user:${user.id}`);
  });

  it.each(['NaN', '1e30', '1234567890123456789'])(
    'rejects a currentBalance of %p with a 422 and keeps the data',
    async (value) => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 100 }),
        raw: true,
      });
      const exported = await helpers.exportBackup();
      const { files } = helpers.parseBackupArchive({ buffer: exported.body });
      const accounts = JSON.parse(files.get('data/accounts.json')!.toString('utf8')) as Row[];
      accounts[0]!.currentBalance = value;
      files.set('data/accounts.json', Buffer.from(JSON.stringify(accounts)));

      const restore = await helpers.restoreBackup({ fileContent: await helpers.repackBackup({ files }) });

      expect(restore.statusCode).toBe(422);
      expect(restore.message).toBe(
        t({
          key: 'backup.restore.errors.amountNotCents',
          variables: { path: 'data/accounts.json (currentBalance)', value: JSON.stringify(value) },
        }),
      );
      expect(Number((await helpers.getAccount({ id: account.id, raw: true })).currentBalance)).toBe(100);
    },
  );
  it('rounds an amount with more decimals than its currency to the currency decimals', async () => {
    await helpers.createAccount({ payload: helpers.buildAccountPayload({ initialBalance: 100 }), raw: true });
    const exported = await helpers.exportBackup();
    const { files } = helpers.parseBackupArchive({ buffer: exported.body });
    const accounts = JSON.parse(files.get('data/accounts.json')!.toString('utf8')) as Row[];
    accounts[0]!.currentBalance = '100.125';
    files.set('data/accounts.json', Buffer.from(JSON.stringify(accounts)));

    await helpers.restoreBackupAndWait({ fileContent: await helpers.repackBackup({ files }) });

    const [restored] = helpers.backupRows({ archive: await helpers.exportParsedBackup(), name: 'accounts' });
    helpers.expectDecimal({ actual: restored!.currentBalance, expected: '100.13' });
  });
});
