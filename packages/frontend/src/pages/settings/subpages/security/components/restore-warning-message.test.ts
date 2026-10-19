import type { BackupRestoreWarning } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { getRestoreWarningMessage } from './restore-warning-message';

describe('getRestoreWarningMessage', () => {
  it('maps a known code to its key with table, column and count params', () => {
    expect(
      getRestoreWarningMessage({
        warning: { code: 'foreign_reference_nulled', table: 'transactions', column: 'categoryId', count: 3 },
      }),
    ).toEqual({
      key: 'settings.security.backup.restore.warnings.foreignReferenceNulled',
      params: { count: 3, table: 'transactions', column: 'categoryId', columns: '' },
      plural: 3,
    });
  });

  it('joins dropped column names into one param', () => {
    const { key, params } = getRestoreWarningMessage({
      warning: { code: 'unknown_column_dropped', table: 'accounts', columns: ['legacyFlag', 'oldName'], count: 2 },
    });

    expect(key).toBe('settings.security.backup.restore.warnings.unknownColumnDropped');
    expect(params.columns).toBe('legacyFlag, oldName');
  });

  it('defaults the plural count to one for uncountable warnings', () => {
    expect(getRestoreWarningMessage({ warning: { code: 'no_settings', table: 'user-settings' } })).toMatchObject({
      key: 'settings.security.backup.restore.warnings.noSettings',
      plural: 1,
    });
  });

  it('falls back to the generic key for a code this frontend does not know', () => {
    const warning = { code: 'brand_new_code', table: 'accounts' } as unknown as BackupRestoreWarning;

    expect(getRestoreWarningMessage({ warning }).key).toBe('settings.security.backup.restore.warnings.unknown');
  });
});
