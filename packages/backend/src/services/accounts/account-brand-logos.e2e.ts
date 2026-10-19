import { RESOURCE_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BrandLogos from '@models/brand-logos.model';
import { PNG_1X1_DATA_URL } from '@tests/fixtures/logo-images';
import * as helpers from '@tests/helpers';

// ---------------------------------------------------------------------------
// Account logos are manual-only: no brand resolver, no enqueue, no read-path
// backfill, and no `logoSource` column. A user picks a brand domain or a
// monogram, or the frontend renders the tinted account-type chip instead.
// Clearing is a plain PUT with null logo fields.
// ---------------------------------------------------------------------------

/** Owner shares an account read-only and the recipient accepts. Requires owner cookies. */
async function shareAccountReadOnly({
  accountId,
  recipient,
}: {
  accountId: string;
  recipient: helpers.SecondUserHandle;
}) {
  const invitation = await helpers.createShareInvitation({
    inviteeEmail: recipient.email,
    resourceType: RESOURCE_TYPES.account,
    resourceId: accountId,
    permission: SHARE_PERMISSIONS.read,
    raw: true,
  });
  await helpers.asUser({
    cookies: recipient.cookies,
    fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
  });
}

describe('Account logo', () => {
  describe('POST /accounts', () => {
    it('creates with logoDomain', async () => {
      const created = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Netflix', logoDomain: 'netflix.com' }),
        raw: true,
      });
      expect(created.logoDomain).toBe('netflix.com');
      expect(created).not.toHaveProperty('logoSource');

      const fetched = await helpers.getAccount({ id: created.id, raw: true });
      expect(fetched.logoDomain).toBe('netflix.com');
      expect(fetched.logoInitials).toBeNull();
      expect(fetched.logoColor).toBeNull();
      expect(fetched).not.toHaveProperty('logoSource');
    });

    it('creates with logoInitials + logoColor', async () => {
      const created = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Local Savings', logoInitials: 'LS', logoColor: '#7355be' }),
        raw: true,
      });

      expect(created.logoInitials).toBe('LS');
      expect(created.logoColor).toBe('#7355be');
      expect(created.logoDomain).toBeNull();

      const fetched = await helpers.getAccount({ id: created.id, raw: true });
      expect(fetched.logoInitials).toBe('LS');
      expect(fetched.logoColor).toBe('#7355be');
      expect(fetched.logoDomain).toBeNull();
    });

    it('normalizes logoColor to lowercase', async () => {
      const created = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Upper Hex', logoInitials: 'UH', logoColor: '#7355BE' }),
        raw: true,
      });

      expect(created.logoColor).toBe('#7355be');
    });

    it('leaves every logo field null when the payload carries none', async () => {
      const created = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Plain Account' }),
        raw: true,
      });

      expect(created.logoDomain).toBeNull();
      expect(created.logoInitials).toBeNull();
      expect(created.logoColor).toBeNull();
    });

    it('never resolves a logo from a matching BrandLogos cache entry', async () => {
      // A cache entry that WOULD be picked up if accounts had auto-resolution.
      await BrandLogos.create({
        normalizedName: 'gitlab',
        domain: 'gitlab.com',
        brandName: 'GitLab',
        source: 'seed',
      });

      const created = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'GitLab' }),
        raw: true,
      });
      expect(created.logoDomain).toBeNull();

      const fetched = await helpers.getAccount({ id: created.id, raw: true });
      expect(fetched.logoDomain).toBeNull();
      expect(fetched.logoInitials).toBeNull();
      expect(fetched.logoColor).toBeNull();
      expect(fetched).not.toHaveProperty('logoSource');
    });

    it('keeps a manual logoDomain even when a matching BrandLogos cache entry exists', async () => {
      await BrandLogos.create({
        normalizedName: 'dropbox',
        domain: 'dropbox.com',
        brandName: 'Dropbox',
        source: 'seed',
      });

      const created = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Dropbox', logoDomain: 'custom.example' }),
        raw: true,
      });

      const after = await helpers.getAccount({ id: created.id, raw: true });
      expect(after.logoDomain).toBe('custom.example');
    });

    it('accepts ZWJ emoji monograms of one and two graphemes', async () => {
      const single = '👨‍👩‍👧';
      // Each family emoji is 7 code points (11 UTF-16 units); two of them are 2
      // graphemes / 14 code points, which fits VARCHAR(16) – Postgres counts
      // code points, so a UTF-16-based length cap would wrongly reject this.
      const pair = '👨‍👩‍👧‍👦👨‍👩‍👧‍👦';

      const createdSingle = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Family Fund', logoInitials: single }),
        raw: true,
      });
      expect(createdSingle.logoInitials).toBe(single);
      expect(createdSingle.logoColor).toBeNull();

      const createdPair = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Two Families', logoInitials: pair }),
        raw: true,
      });
      expect(createdPair.logoInitials).toBe(pair);

      const fetchedSingle = await helpers.getAccount({ id: createdSingle.id, raw: true });
      expect(fetchedSingle.logoInitials).toBe(single);
      const fetchedPair = await helpers.getAccount({ id: createdPair.id, raw: true });
      expect(fetchedPair.logoInitials).toBe(pair);
    });

    it('returns 422 for every malformed logo payload', async () => {
      const cases: [string, Record<string, unknown>][] = [
        ['logoDomain contains a space', { logoDomain: 'has space' }],
        ['logoDomain contains a slash', { logoDomain: 'x/y' }],
        ['logoDomain of 254 characters', { logoDomain: `${'a'.repeat(250)}.com` }],
        ['logoDomain and logoInitials both set', { logoDomain: 'netflix.com', logoInitials: 'NF' }],
        ['whitespace-only logoInitials', { logoInitials: '   ' }],
        ['three graphemes', { logoInitials: 'ABC' }],
        // A letter plus 20 combining accents is one grapheme but 21 code points, which
        // overflows the VARCHAR(16) column. The schema must reject it before Postgres raises.
        ['one grapheme built from more than 16 code points', { logoInitials: `a${'\u0301'.repeat(20)}` }],
        ['malformed logoColor', { logoInitials: 'BC', logoColor: 'violet' }],
        ['logoColor without logoInitials', { logoColor: '#7355be' }],
      ];

      for (const [label, logoFields] of cases) {
        const res = await helpers.createAccount({
          payload: helpers.buildAccountPayload({ name: `Bad - ${label}`, ...logoFields }),
          raw: false,
        });

        expect([label, res.statusCode]).toEqual([label, ERROR_CODES.ValidationError]);
      }
    }, 60_000);
  });

  describe('PUT /accounts/:id', () => {
    it('sets logoDomain', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Netflix' }),
        raw: true,
      });

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { logoDomain: 'netflix.com' },
        raw: true,
      });

      expect(updated.logoDomain).toBe('netflix.com');
      expect(updated).not.toHaveProperty('logoSource');
    });

    it('sets a monogram and evicts an existing logoDomain', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Corner Bank', logoDomain: 'bank.example' }),
        raw: true,
      });

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { logoInitials: 'CB', logoColor: '#22c55e' },
        raw: true,
      });

      expect(updated.logoInitials).toBe('CB');
      expect(updated.logoColor).toBe('#22c55e');
      expect(updated.logoDomain).toBeNull();
    });

    it('evicts a monogram when a brand domain is picked', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Switcheroo', logoInitials: 'SW', logoColor: '#ef4444' }),
        raw: true,
      });

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { logoDomain: 'netflix.com' },
        raw: true,
      });

      expect(updated.logoDomain).toBe('netflix.com');
      expect(updated.logoInitials).toBeNull();
      expect(updated.logoColor).toBeNull();
    });

    it('keeps the monogram when logoDomain is explicitly cleared', async () => {
      // Domain and initials are asymmetric on purpose: setting a domain evicts
      // the monogram, but clearing the (already null) domain must not touch it.
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Mono Survives', logoInitials: 'MS', logoColor: '#7355be' }),
        raw: true,
      });

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { logoDomain: null },
        raw: true,
      });

      expect(updated.logoDomain).toBeNull();
      expect(updated.logoInitials).toBe('MS');
      expect(updated.logoColor).toBe('#7355be');
    });

    it('updates logoColor alone when the account already has initials', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Recolor', logoInitials: 'RC', logoColor: '#7355be' }),
        raw: true,
      });

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { logoColor: '#0ea5e9' },
        raw: true,
      });

      expect(updated.logoColor).toBe('#0ea5e9');
      expect(updated.logoInitials).toBe('RC');
    });

    it('leaves logo fields untouched when the payload omits the logo keys', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Keep Mono', logoInitials: 'KM', logoColor: '#7355be' }),
        raw: true,
      });

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { name: 'Keep Mono Renamed' },
        raw: true,
      });

      expect(updated.logoInitials).toBe('KM');
      expect(updated.logoColor).toBe('#7355be');
      expect(updated.logoDomain).toBeNull();
    });

    it('returns 422 for malformed logo PUT payloads', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Bad Logo Updates' }),
        raw: true,
      });

      const colorWithoutInitials = await helpers.updateAccount({
        id: account.id,
        payload: { logoColor: '#7355be' },
        raw: false,
      });
      expect(colorWithoutInitials.statusCode).toBe(ERROR_CODES.ValidationError);

      const domainAndInitials = await helpers.updateAccount({
        id: account.id,
        payload: { logoDomain: 'netflix.com', logoInitials: 'NF' },
        raw: false,
      });
      expect(domainAndInitials.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('returns 404 for an account that does not exist', async () => {
      const res = await helpers.updateAccount({
        id: generateRandomRecordId(),
        payload: { logoDomain: 'example.com' },
        raw: false,
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it("returns 404 when a different user tries to clear another user's logo", async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'ClearCrossUserGuard', logoDomain: 'owned.com' }),
        raw: true,
      });

      const handle = await helpers.signUpSecondUser();
      const response = await helpers.asUser({
        cookies: handle.cookies,
        fn: () =>
          helpers.updateAccount({
            id: account.id,
            payload: { logoDomain: null, logoInitials: null },
            raw: false,
          }),
      });
      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);

      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(after.logoDomain).toBe('owned.com');
    });
  });

  describe('PUT /accounts/:id – clearing the logo', () => {
    it('clears a brand logo when logoDomain is null and stays cleared on a repeat clear', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Apple', logoDomain: 'apple.com' }),
        raw: true,
      });

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { logoDomain: null },
        raw: true,
      });

      expect(updated.logoDomain).toBeNull();
      expect(updated.logoInitials).toBeNull();
      expect(updated.logoColor).toBeNull();
      expect(updated).not.toHaveProperty('logoSource');

      const recleared = await helpers.updateAccount({
        id: account.id,
        payload: { logoDomain: null, logoInitials: null },
        raw: true,
      });

      expect(recleared.logoDomain).toBeNull();
      expect(recleared.logoInitials).toBeNull();
      expect(recleared.logoColor).toBeNull();
    });

    it('clears initials and color when logoInitials is null, leaving the account indistinguishable from a never-branded one', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Clear Me', logoInitials: 'CM', logoColor: '#ef4444' }),
        raw: true,
      });
      const untouched = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Never Branded' }),
        raw: true,
      });

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { logoInitials: null },
        raw: true,
      });

      expect(updated.logoInitials).toBeNull();
      expect(updated.logoColor).toBeNull();
      expect(updated.logoDomain).toBeNull();

      const clearedAfter = await helpers.getAccount({ id: account.id, raw: true });
      const untouchedAfter = await helpers.getAccount({ id: untouched.id, raw: true });

      expect({
        logoDomain: clearedAfter.logoDomain,
        logoInitials: clearedAfter.logoInitials,
        logoColor: clearedAfter.logoColor,
      }).toEqual({
        logoDomain: untouchedAfter.logoDomain,
        logoInitials: untouchedAfter.logoInitials,
        logoColor: untouchedAfter.logoColor,
      });
      expect(clearedAfter).not.toHaveProperty('logoSource');
    });
  });

  describe('GET /accounts', () => {
    it('exposes the logo fields on every list item', async () => {
      const withDomain = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Listed Domain', logoDomain: 'listed.example' }),
        raw: true,
      });
      const withMonogram = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Listed Mono', logoInitials: 'LM', logoColor: '#7355be' }),
        raw: true,
      });

      const list = await helpers.getAccounts();

      const domainItem = list.find((account) => account.id === withDomain.id);
      expect(domainItem?.logoDomain).toBe('listed.example');
      expect(domainItem?.logoInitials).toBeNull();
      expect(domainItem?.logoColor).toBeNull();
      expect(domainItem).not.toHaveProperty('logoSource');

      const monogramItem = list.find((account) => account.id === withMonogram.id);
      expect(monogramItem?.logoInitials).toBe('LM');
      expect(monogramItem?.logoColor).toBe('#7355be');
      expect(monogramItem?.logoDomain).toBeNull();
    });

    it("exposes the owner's logo fields to a share recipient", async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Shared Mono', logoInitials: 'SM', logoColor: '#7355be' }),
        raw: true,
      });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccountReadOnly({ accountId: account.id, recipient });

      const list = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getAccounts(),
      });

      const shared = list.find((item) => item.id === account.id);
      expect(shared).toBeDefined();
      expect(shared?.logoInitials).toBe('SM');
      expect(shared?.logoColor).toBe('#7355be');
      expect(shared?.logoDomain).toBeNull();
      expect(shared).not.toHaveProperty('logoSource');
    });
  });
});

describe('Account logo icon and image slots', () => {
  it('creates with logoIcon + logoColor', async () => {
    const created = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Groceries', logoIcon: 'food-24-regular', logoColor: '#7355be' }),
      raw: true,
    });

    expect(created).toMatchObject({ logoIcon: 'food-24-regular', logoColor: '#7355be', logoInitials: null });
  });

  it('sets logoIcon on update and evicts the monogram', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Monogram', logoInitials: 'MO' }),
      raw: true,
    });

    const updated = await helpers.updateAccount({
      id: account.id,
      payload: { logoIcon: 'food-24-regular' },
      raw: true,
    });

    expect(updated).toMatchObject({ logoIcon: 'food-24-regular', logoInitials: null, logoDomain: null });
  });

  it('clears every slot with the three-null payload', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Icon', logoIcon: 'food-24-regular' }),
      raw: true,
    });

    const response = await helpers.updateAccount({
      id: account.id,
      payload: { logoDomain: null, logoInitials: null, logoIcon: null },
      raw: false,
    });

    expect(response.statusCode).toBe(200);
    expect(await helpers.getAccount({ id: account.id, raw: true })).toMatchObject({
      logoDomain: null,
      logoInitials: null,
      logoIcon: null,
    });
  });

  it('ignores logoImage', async () => {
    const account = await helpers.createAccount({ payload: helpers.buildAccountPayload({ name: 'Plain' }), raw: true });

    const response = await helpers.updateAccount({
      id: account.id,
      payload: { ...({ logoImage: PNG_1X1_DATA_URL } as object) },
      raw: false,
    });

    expect(response.statusCode).toBe(200);
    expect((await helpers.getAccount({ id: account.id, raw: true })).logoImageId).toBeNull();
  });
});
