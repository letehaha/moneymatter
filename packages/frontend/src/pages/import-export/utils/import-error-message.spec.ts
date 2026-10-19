import type { ImportError } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';
import type { ComposerTranslation } from 'vue-i18n';

import { importErrorMessage, importJobFailureMessage } from './import-error-message';

const t = ((key: string, named?: Record<string, unknown>) =>
  named && Object.keys(named).length ? `${key}:${JSON.stringify(named)}` : key) as unknown as ComposerTranslation;

describe('importErrorMessage', () => {
  it('names the account of a balance desync and picks the created or linked wording', () => {
    const created: ImportError = {
      rowIndex: null,
      error: 'English',
      code: 'account-balance-desync',
      accountName: 'Cash',
      accountCreated: true,
    };
    const linked: ImportError = { ...created, accountCreated: false };

    expect(importErrorMessage({ error: created, t })).toBe(
      'pages.importExport.balanceDesync.createdAccount:{"account":"Cash"}',
    );
    expect(importErrorMessage({ error: linked, t })).toBe(
      'pages.importExport.balanceDesync.linkedAccount:{"account":"Cash"}',
    );
  });

  it('falls back to an unnamed desync message when the account name is missing', () => {
    const error: ImportError = { rowIndex: null, error: 'English', code: 'account-balance-desync' };

    expect(importErrorMessage({ error, t })).toBe('pages.importExport.balanceDesync.unnamedAccount');
  });

  it('maps known row codes and never returns the English error', () => {
    expect(importErrorMessage({ error: { rowIndex: 2, error: 'English', code: 'account-unresolved' }, t })).toBe(
      'pages.importExport.importResults.rowErrors.accountUnresolved',
    );
    expect(importErrorMessage({ error: { rowIndex: 2, error: 'English' }, t })).toBe(
      'pages.importExport.importResults.rowErrors.generic',
    );
    expect(
      importErrorMessage({
        error: { rowIndex: 2, error: 'English', code: 'rows-suppressed', params: { count: 3, listed: 1 } },
        t,
      }),
    ).toBe('pages.importExport.importResults.rowErrors.generic');
  });
});

describe('importJobFailureMessage', () => {
  it('translates a known failure code with its params', () => {
    expect(
      importJobFailureMessage({
        failure: { code: 'category-name-too-long', params: { name: 'A…', length: 300, max: 255 } },
        t,
      }),
    ).toBe('pages.importExport.jobFailure.categoryNameTooLong:{"name":"A…","length":300,"max":255}');
    expect(importJobFailureMessage({ failure: { code: 'interrupted' }, t })).toBe(
      'pages.importExport.jobFailure.interrupted',
    );
  });

  it('returns null for a missing or unknown code', () => {
    expect(importJobFailureMessage({ failure: undefined, t })).toBeNull();
    expect(importJobFailureMessage({ failure: { code: 'brand-new' as never }, t })).toBeNull();
  });
});
