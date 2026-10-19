import { requestContext } from '@common/request-context';
import { i18nextReady, t } from '@i18n/index';
import { beforeAll, describe, expect, it } from '@jest/globals';
/**
 * Runs against real Microsoft Money sample databases. They are not committed —
 * see `src/tests/fixtures/ms-money-fixtures.ts`. Without them the whole file
 * skips, so a checkout that never ran `npm run fixtures:ms-money` stays green.
 */
import { ValidationError } from '@js/errors';
import {
  MS_MONEY_FIXTURES,
  MS_MONEY_FIXTURES_MISSING_MESSAGE,
  msMoneyFixturesAvailable,
  readMsMoneyFixture,
} from '@tests/fixtures/ms-money-fixtures';

import { decryptMsisam, isMsMoneyFile } from './decrypt-msisam';

const PAGE_SIZE = 4096;
/** Money enciphers pages 1..14 only; page 0 and the rest of the file are plain. */
const LAST_ENCRYPTED_PAGE = 14;

const page = ({ buffer, index }: { buffer: Buffer; index: number }): Buffer =>
  buffer.subarray(index * PAGE_SIZE, (index + 1) * PAGE_SIZE);

/** Compared as booleans rather than with `toEqual`: these buffers are megabytes
 *  long, and Jest's structural diff on them costs tens of seconds per call. */
const sameBytes = ({ left, right }: { left: Buffer; right: Buffer }): boolean => left.equals(right);

const hasFixtures = msMoneyFixturesAvailable();
if (!hasFixtures) console.warn(`[decrypt-msisam.unit] skipped. ${MS_MONEY_FIXTURES_MISSING_MESSAGE}`);
const describeWithFixtures = hasFixtures ? describe : describe.skip;

beforeAll(async () => {
  await i18nextReady;
});

describe('decryptMsisam error language', () => {
  it("reports a rejected file in the requester's locale", () => {
    expect(() => requestContext.run({ locale: 'uk' }, () => decryptMsisam({ buffer: Buffer.alloc(0) }))).toThrow(
      t({ key: 'importExport.msMoney.notMsMoneyFile', locale: 'uk' }),
    );
  });
});

describe('isMsMoneyFile', () => {
  it('rejects buffers that are not Money databases', () => {
    expect(isMsMoneyFile({ buffer: Buffer.alloc(0) })).toBe(false);
    expect(isMsMoneyFile({ buffer: Buffer.from('hello') })).toBe(false);
    // Full page, right size, wrong engine marker.
    expect(isMsMoneyFile({ buffer: Buffer.alloc(PAGE_SIZE, 0x07) })).toBe(false);
  });
});

describeWithFixtures('decryptMsisam', () => {
  it.each(MS_MONEY_FIXTURES)('recognises $file as a Money database', ({ file }) => {
    expect(isMsMoneyFile({ buffer: readMsMoneyFixture({ file }) })).toBe(true);
  });

  it.each(MS_MONEY_FIXTURES)('decrypts $file as $encryption', ({ file, password, encryption }) => {
    const result = decryptMsisam({ buffer: readMsMoneyFixture({ file }), password });

    expect(result.encryption).toBe(encryption);
    expect(result.buffer.length).toBe(readMsMoneyFixture({ file }).length);
  });

  it.each(MS_MONEY_FIXTURES)('leaves everything outside pages 1..14 of $file untouched', ({ file, password }) => {
    const buffer = readMsMoneyFixture({ file });
    const { buffer: plaintext } = decryptMsisam({ buffer, password });

    expect(sameBytes({ left: page({ buffer: plaintext, index: 0 }), right: page({ buffer, index: 0 }) })).toBe(true);
    expect(sameBytes({ left: page({ buffer: plaintext, index: 1 }), right: page({ buffer, index: 1 }) })).toBe(false);
    expect(
      sameBytes({
        left: page({ buffer: plaintext, index: LAST_ENCRYPTED_PAGE }),
        right: page({ buffer, index: LAST_ENCRYPTED_PAGE }),
      }),
    ).toBe(false);
    expect(
      sameBytes({
        left: plaintext.subarray((LAST_ENCRYPTED_PAGE + 1) * PAGE_SIZE),
        right: buffer.subarray((LAST_ENCRYPTED_PAGE + 1) * PAGE_SIZE),
      }),
    ).toBe(true);
  });

  it('does not mutate the uploaded buffer', () => {
    const buffer = readMsMoneyFixture({ file: 'money2005-pwd.mny' });
    const untouched = Buffer.from(buffer);

    decryptMsisam({ buffer, password: '123@abc!' });

    expect(sameBytes({ left: buffer, right: untouched })).toBe(true);
  });

  describe('password check bytes', () => {
    it('reports a verified password for a protected file', () => {
      const result = decryptMsisam({ buffer: readMsMoneyFixture({ file: 'money2005-pwd.mny' }), password: '123@abc!' });

      expect(result.passwordVerified).toBe(true);
    });

    it('reports no verification for a file that carries no check bytes', () => {
      const result = decryptMsisam({ buffer: readMsMoneyFixture({ file: 'money2002.mny' }), password: null });

      expect(result.passwordVerified).toBe(false);
    });

    it('matches passwords case-insensitively, the way Jet hashes them', () => {
      const buffer = readMsMoneyFixture({ file: 'money2005-pwd.mny' });

      expect(
        sameBytes({
          left: decryptMsisam({ buffer, password: '123@ABC!' }).buffer,
          right: decryptMsisam({ buffer, password: '123@abc!' }).buffer,
        }),
      ).toBe(true);
    });

    it('does not tolerate surrounding whitespace', () => {
      expect(() =>
        decryptMsisam({ buffer: readMsMoneyFixture({ file: 'money2005-pwd.mny' }), password: ' 123@abc!' }),
      ).toThrow(t({ key: 'importExport.msMoney.incorrectPassword' }));
    });
  });

  describe('rejections', () => {
    it('throws a user-readable ValidationError for a wrong password', () => {
      const buffer = readMsMoneyFixture({ file: 'money2005-pwd.mny' });

      expect(() => decryptMsisam({ buffer, password: 'not-the-password' })).toThrow(ValidationError);
      expect(() => decryptMsisam({ buffer, password: 'not-the-password' })).toThrow(
        t({ key: 'importExport.msMoney.incorrectPassword' }),
      );
    });

    it('asks for the password when a protected file is opened without one', () => {
      const buffer = readMsMoneyFixture({ file: 'money2005-pwd.mny' });

      expect(() => decryptMsisam({ buffer })).toThrow(ValidationError);
      expect(() => decryptMsisam({ buffer })).toThrow(t({ key: 'importExport.msMoney.passwordRequired' }));
    });

    it('rejects a wrong password on a file whose password is not the empty one', () => {
      // sunset02 is protected too, and its check bytes are written for a
      // non-empty password, unlike its sibling sunset01.
      expect(() => decryptMsisam({ buffer: readMsMoneyFixture({ file: 'sunset02.mny' }), password: 'wrong' })).toThrow(
        t({ key: 'importExport.msMoney.incorrectPassword' }),
      );
    });

    it.each([
      ['an empty buffer', Buffer.alloc(0)],
      ['a short buffer', Buffer.from('not a database')],
      ['a full page of noise', Buffer.alloc(PAGE_SIZE * 4, 0x07)],
    ])('rejects %s as not a Money database', (_label, buffer) => {
      expect(() => decryptMsisam({ buffer })).toThrow(ValidationError);
      expect(() => decryptMsisam({ buffer })).toThrow(t({ key: 'importExport.msMoney.notMsMoneyFile' }));
    });
  });

  describe('legacy Jet files', () => {
    // Money 2001 derives its key from the header alone, so the password the user
    // set is never part of decryption. Documented here because it looks like a
    // missing check otherwise.
    it('decrypts identically regardless of the password supplied', () => {
      const buffer = readMsMoneyFixture({ file: 'money2001-pwd.mny' });
      const correct = decryptMsisam({ buffer, password: 'TEST12345' });

      expect(
        sameBytes({ left: decryptMsisam({ buffer, password: 'anything-at-all' }).buffer, right: correct.buffer }),
      ).toBe(true);
      expect(sameBytes({ left: decryptMsisam({ buffer }).buffer, right: correct.buffer })).toBe(true);
      expect(correct.passwordVerified).toBe(false);
    });
  });
});
