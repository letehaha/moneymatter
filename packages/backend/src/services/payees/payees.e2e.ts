import { CATEGORIZATION_MODE, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID, generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Payees API', () => {
  describe('POST /payees (createPayee)', () => {
    it('creates a Payee with the supplied name', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Amazon' }),
        raw: true,
      });

      expect(payee.id).toBeDefined();
      expect(payee.name).toBe('Amazon');
      expect(payee.normalizedName).toBe('amazon');
      expect(payee.defaultCategoryId).toBeNull();
      expect(payee.categorizationMode).toBe(CATEGORIZATION_MODE.enforce);
    });

    it('honors optional fields supplied on create', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({
          name: 'Netflix',
          defaultCategoryId: global.DEFAULT_CATEGORY_ID,
          categorizationMode: CATEGORIZATION_MODE.hint,
        }),
        raw: true,
      });
      expect(payee.defaultCategoryId).toBe(global.DEFAULT_CATEGORY_ID);
      expect(payee.categorizationMode).toBe(CATEGORIZATION_MODE.hint);
    });

    it('rejects invalid create payloads', async () => {
      const emptyName = await helpers.createPayee({
        payload: { name: '   ' },
        raw: false,
      });
      expect(emptyName.statusCode).toBe(ERROR_CODES.ValidationError);

      const unknownMode = await helpers.createPayee({
        payload: { name: 'BadMode Co', categorizationMode: 'whatever' as CATEGORIZATION_MODE },
        raw: false,
      });
      expect(unknownMode.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects a duplicate Payee for the same user', async () => {
      await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Duplicate Co' }),
        raw: true,
      });
      const response = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Duplicate Co' }),
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
    });

    it('rejects a name that is already an alias of another Payee, with conflictingPayee details', async () => {
      // A canonical name shadows an equal alias in `resolveNormalizedName`
      // (canonical wins), which would silently re-route extractions that used
      // to hit the alias — so the create is refused with a pointer to the
      // alias's owner.
      const owner = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Stripe' }),
        raw: true,
      });
      await helpers.createPayeeAlias({ payeeId: owner.id, rawName: 'Stripe Payments', raw: true });

      const response = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'STRIPE PAYMENTS' }),
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
      const errorBody = response.body.response as unknown as { details?: { conflictingPayee?: unknown } };
      expect(errorBody.details?.conflictingPayee).toEqual({ id: owner.id, name: 'Stripe' });
    });
  });

  describe('GET /payees (listPayees)', () => {
    it('returns an empty list for a fresh user', async () => {
      const payees = await helpers.listPayees({ raw: true });
      expect(Array.isArray(payees)).toBe(true);
    });

    it('returns Payees created by the user', async () => {
      await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'List One' }),
        raw: true,
      });
      await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'List Two' }),
        raw: true,
      });

      const payees = await helpers.listPayees({ raw: true });
      expect(payees.some((p) => p.name === 'List One')).toBe(true);
      expect(payees.some((p) => p.name === 'List Two')).toBe(true);
    });

    it('filters by `q` substring (normalized)', async () => {
      await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Starbucks Coffee' }),
        raw: true,
      });
      await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Walmart' }),
        raw: true,
      });

      const filtered = await helpers.listPayees({ q: 'star', raw: true });
      expect(filtered.some((p) => p.name === 'Starbucks Coffee')).toBe(true);
      expect(filtered.some((p) => p.name === 'Walmart')).toBe(false);
    });

    it('matches payees by their aliases', async () => {
      const silpo = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Silpo' }),
        raw: true,
      });
      await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Walmart' }),
        raw: true,
      });
      await helpers.createPayeeAlias({ payeeId: silpo.id, rawName: 'SILPO MARKET KYIV 123', raw: true });

      const filtered = await helpers.listPayees({ q: 'market kyiv', raw: true });
      expect(filtered.map((p) => p.id)).toEqual([silpo.id]);

      const noMatch = await helpers.listPayees({ q: 'nonexistent alias', raw: true });
      expect(noMatch).toEqual([]);
    });

    it('sorts by the number of default tags in both directions', async () => {
      const [tagA, tagB] = await Promise.all([
        helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Sort Tag A' }), raw: true }),
        helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Sort Tag B' }), raw: true }),
      ]);

      const [twoTags, oneTag, noTags] = await Promise.all([
        helpers.createPayee({
          payload: helpers.buildPayeePayload({ name: 'Tags Two Co', defaultTagIds: [tagA.id, tagB.id] }),
          raw: true,
        }),
        helpers.createPayee({
          payload: helpers.buildPayeePayload({ name: 'Tags One Co', defaultTagIds: [tagA.id] }),
          raw: true,
        }),
        helpers.createPayee({
          payload: helpers.buildPayeePayload({ name: 'Tags None Co' }),
          raw: true,
        }),
      ]);

      const desc = await helpers.listPayees({ sortBy: 'defaultTagsCount', sortDir: 'desc', raw: true });
      const descIds = desc.map((p) => p.id);
      expect(descIds.indexOf(twoTags.id)).toBeLessThan(descIds.indexOf(oneTag.id));
      expect(descIds.indexOf(oneTag.id)).toBeLessThan(descIds.indexOf(noTags.id));

      const asc = await helpers.listPayees({ sortBy: 'defaultTagsCount', sortDir: 'asc', raw: true });
      const ascIds = asc.map((p) => p.id);
      expect(ascIds.indexOf(noTags.id)).toBeLessThan(ascIds.indexOf(oneTag.id));
      expect(ascIds.indexOf(oneTag.id)).toBeLessThan(ascIds.indexOf(twoTags.id));
    }, 30000);
  });

  describe('GET /payees/lookup (getPayeesLookup)', () => {
    it('returns all payees as a minimal {id, name, logo fields} projection with no stats', async () => {
      const withLogo = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Aaa Lookup', logoDomain: 'stripe.com' }),
        raw: true,
      });
      const explicitNoLogo = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Bbb Lookup', logoDomain: null }),
        raw: true,
      });
      const defaultLogo = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Ccc Lookup' }),
        raw: true,
      });
      const withMonogram = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Ddd Lookup', logoInitials: 'DL', logoColor: '#7355be' }),
        raw: true,
      });

      const lookup = await helpers.lookupPayees({ raw: true });

      expect(lookup.map((p) => p.name)).toEqual(['Aaa Lookup', 'Bbb Lookup', 'Ccc Lookup', 'Ddd Lookup']);

      for (const item of lookup) {
        expect(Object.keys(item).toSorted()).toEqual([
          'id',
          'logoColor',
          'logoDomain',
          'logoIcon',
          'logoImageId',
          'logoInitials',
          'name',
        ]);
        expect(item).not.toHaveProperty('stats');
      }

      expect(lookup.find((p) => p.id === withLogo.id)?.logoDomain).toBe('stripe.com');
      expect(lookup.find((p) => p.id === explicitNoLogo.id)?.logoDomain).toBeNull();
      expect(lookup.find((p) => p.id === defaultLogo.id)).toBeDefined();

      const monogramItem = lookup.find((p) => p.id === withMonogram.id);
      expect(monogramItem?.logoInitials).toBe('DL');
      expect(monogramItem?.logoColor).toBe('#7355be');
    });

    it('returns an empty array for a fresh user, and 401 without a session', async () => {
      const lookup = await helpers.lookupPayees({ raw: true });
      expect(lookup).toEqual([]);

      const unauthenticated = await helpers.withoutSession(() => helpers.lookupPayees({ raw: false }));
      expect(unauthenticated.statusCode).toBe(401);
    });

    it('returns every payee even past the top-50, including a zero-transaction one', async () => {
      // The `/payees` list endpoint caps at the top 50 by transaction count, so
      // 55 payees push the zero-transaction one past that cap.
      const totalPayees = 55;
      const fillerNames = Array.from({ length: totalPayees - 1 }, () => `Filler ${generateRandomRecordId()}`);

      // `logoInitials` stamps logoSource 'manual' at create, so the logo-resolution
      // worker skips all 54 fillers.
      for (let i = 0; i < fillerNames.length; i += 10) {
        await Promise.all(
          fillerNames.slice(i, i + 10).map((name) =>
            helpers.createPayee({
              payload: helpers.buildPayeePayload({ name, logoInitials: 'FL' }),
              raw: true,
            }),
          ),
        );
      }

      const zeroTxTarget = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: `Target ${generateRandomRecordId()}` }),
        raw: true,
      });

      const lookup = await helpers.lookupPayees({ raw: true });

      expect(lookup).toHaveLength(totalPayees);
      expect(lookup.some((p) => p.id === zeroTxTarget.id)).toBe(true);
    }, 30000);
  });

  describe('GET /payees/:id (getPayee)', () => {
    it('returns the Payee with aliases array', async () => {
      const created = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Detail Co' }),
        raw: true,
      });
      const detail = await helpers.getPayeeById({ id: created.id, raw: true });

      expect(detail.id).toBe(created.id);
      expect(detail.aliases).toBeDefined();
      expect(Array.isArray(detail.aliases)).toBe(true);
    });

    it('returns 404 for an unknown id', async () => {
      const response = await helpers.getPayeeById({ id: NONEXISTENT_ID, raw: false });
      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('PATCH /payees/:id (updatePayee)', () => {
    it('renames and adds the old canonical name as an alias', async () => {
      const created = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Old Brand' }),
        raw: true,
      });

      const updated = await helpers.updatePayee({
        id: created.id,
        payload: { name: 'New Brand' },
        raw: true,
      });
      expect(updated.name).toBe('New Brand');

      const detail = await helpers.getPayeeById({ id: created.id, raw: true });
      expect(detail.aliases?.some((a) => a.normalizedName === 'old brand')).toBe(true);
    });

    it('sets, switches, and clears the optional fields', async () => {
      const created = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Cat Test' }),
        raw: true,
      });

      const withCategory = await helpers.updatePayee({
        id: created.id,
        payload: { defaultCategoryId: global.DEFAULT_CATEGORY_ID },
        raw: true,
      });
      expect(withCategory.defaultCategoryId).toBe(global.DEFAULT_CATEGORY_ID);

      const modeSwitched = await helpers.updatePayee({
        id: created.id,
        payload: { categorizationMode: CATEGORIZATION_MODE.off },
        raw: true,
      });
      expect(modeSwitched.categorizationMode).toBe(CATEGORIZATION_MODE.off);

      const cleared = await helpers.updatePayee({
        id: created.id,
        payload: { defaultCategoryId: null },
        raw: true,
      });
      expect(cleared.defaultCategoryId).toBeNull();
    });

    it('returns 409 when renaming to a colliding name', async () => {
      await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Existing One' }),
        raw: true,
      });
      const other = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Other Brand' }),
        raw: true,
      });

      const response = await helpers.updatePayee({
        id: other.id,
        payload: { name: 'Existing One' },
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
    });

    it("returns 409 when renaming onto another Payee's alias", async () => {
      const owner = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Alias Owner' }),
        raw: true,
      });
      await helpers.createPayeeAlias({ payeeId: owner.id, rawName: 'Shadowed Alias', raw: true });
      const other = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Renamer' }),
        raw: true,
      });

      const response = await helpers.updatePayee({
        id: other.id,
        payload: { name: 'Shadowed Alias' },
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
      const errorBody = response.body.response as unknown as { details?: { conflictingPayee?: unknown } };
      expect(errorBody.details?.conflictingPayee).toEqual({ id: owner.id, name: 'Alias Owner' });
    });

    it('allows renaming a Payee back onto one of its own aliases', async () => {
      // 'Round Trip' becomes an alias after the first rename; renaming back
      // must not be treated as a collision — the hit resolves to the payee
      // being renamed.
      const created = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Round Trip' }),
        raw: true,
      });
      await helpers.updatePayee({ id: created.id, payload: { name: 'Detour' }, raw: true });
      const updated = await helpers.updatePayee({ id: created.id, payload: { name: 'Round Trip' }, raw: true });
      expect(updated.name).toBe('Round Trip');
    });
  });

  describe('DELETE /payees/:id (deletePayee)', () => {
    it('deletes the Payee', async () => {
      const created = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Doomed' }),
        raw: true,
      });

      await helpers.deletePayee({ id: created.id, raw: false });
      const getResponse = await helpers.getPayeeById({ id: created.id, raw: false });
      expect(getResponse.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('unlinks transactions but keeps them on delete', async () => {
      const account = await helpers.createAccount({ raw: true });
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Linked Payee' }),
        raw: true,
      });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          payeeId: payee.id,
        }),
        raw: true,
      });
      expect(tx).toBeDefined();

      await helpers.deletePayee({ id: payee.id, raw: false });
      const refetched = await helpers.getTransactionById({ id: tx!.id, raw: true });
      if (!refetched) throw new Error('Refetched transaction missing');
      expect(refetched.payeeId).toBeNull();
    });
  });

  describe('POST /payees/:id/merge', () => {
    it('moves transactions from source to target and deletes source', async () => {
      const account = await helpers.createAccount({ raw: true });
      const source = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Src' }),
        raw: true,
      });
      const target = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Tgt' }),
        raw: true,
      });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          payeeId: source.id,
        }),
        raw: true,
      });
      expect(tx).toBeDefined();

      await helpers.mergePayees({ sourceId: source.id, targetId: target.id, raw: true });

      const refetched = await helpers.getTransactionById({ id: tx!.id, raw: true });
      if (!refetched) throw new Error('Refetched transaction missing');
      expect(refetched.payeeId).toBe(target.id);

      const sourceGone = await helpers.getPayeeById({ id: source.id, raw: false });
      expect(sourceGone.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('rejects merging a Payee into itself', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Self Merge' }),
        raw: true,
      });
      const response = await helpers.mergePayees({
        sourceId: payee.id,
        targetId: payee.id,
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('handles a source whose self-canonical alias matches a freshly-created target alias', async () => {
      // Repro of the (target_id, normalized_name) UNIQUE collision: the merge
      // inserts source.canonicalName as a target alias, then iterates source's
      // aliases – without the stale-snapshot fix, the just-inserted alias is
      // missing from the "already-on-target" set and the alias UPDATE blows up.
      //
      // Building the scenario via the public API:
      //   1. Create T, rename it to seed an alias (any non-conflicting one is fine).
      //   2. Create S with the same name T was renamed to, then rename S back to
      //      its original name twice so it ends up with a self-canonical alias.
      const target = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'TargetMerchant' }),
        raw: true,
      });
      const sourcePending = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'SourceMerchant' }),
        raw: true,
      });
      // Rename SourceMerchant → AltName, then back to SourceMerchant. After
      // the second rename, the row carries an alias matching its OWN canonical
      // normalizedName – the precise shape that triggered the bug.
      await helpers.updatePayee({
        id: sourcePending.id,
        payload: { name: 'AltName' },
        raw: true,
      });
      await helpers.updatePayee({
        id: sourcePending.id,
        payload: { name: 'SourceMerchant' },
        raw: true,
      });
      const sourceWithSelfAlias = await helpers.getPayeeById({ id: sourcePending.id, raw: true });
      expect(sourceWithSelfAlias.aliases?.some((a) => a.normalizedName === 'sourcemerchant')).toBe(true);

      const merged = await helpers.mergePayees({
        sourceId: sourcePending.id,
        targetId: target.id,
        raw: true,
      });
      expect(merged.id).toBe(target.id);

      const targetAfter = await helpers.getPayeeById({ id: target.id, raw: true });
      expect(targetAfter.aliases?.some((a) => a.normalizedName === 'sourcemerchant')).toBe(true);

      const sourceGone = await helpers.getPayeeById({ id: sourcePending.id, raw: false });
      expect(sourceGone.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('POST /payees/:id/aliases', () => {
    it('adds an alias to the Payee', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'wFirma' }),
        raw: true,
      });

      const updated = await helpers.createPayeeAlias({
        payeeId: payee.id,
        rawName: 'WEB INNOVATIVE SOFTWARE',
        raw: true,
      });

      expect(updated.id).toBe(payee.id);
      expect(updated.aliases?.some((a) => a.normalizedName === 'web innovative software')).toBe(true);
      expect(updated.aliases?.some((a) => a.rawName === 'WEB INNOVATIVE SOFTWARE')).toBe(true);
    });

    it('makes future transactions with the alias text link to the Payee', async () => {
      // The point of a user-curated alias: the extraction pipeline's Step 1
      // exact-match path picks the alias up on the next sync and links the
      // incoming tx to this Payee. Verified through the note-fallback so the
      // HTTP create endpoint can drive the same code path the bank sync uses.
      await helpers.updateUserSettings({
        settings: { locale: 'en', payeeExtractionUsesDescription: true },
      });

      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'wFirma' }),
        raw: true,
      });
      await helpers.createPayeeAlias({
        payeeId: payee.id,
        rawName: 'WEB INNOVATIVE SOFTWARE',
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          note: 'WEB INNOVATIVE SOFTWARE',
        }),
        raw: true,
      });

      expect(tx!.payeeId).toBe(payee.id);
    });

    it('rejects invalid and conflicting alias payloads', async () => {
      // Every request below is a 4xx that leaves the DB untouched, so one
      // fixture serves them all.
      const owner = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Acme' }),
        raw: true,
      });
      await helpers.createPayeeAlias({ payeeId: owner.id, rawName: 'Acme Holdings', raw: true });
      const other = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Hooli' }),
        raw: true,
      });
      await helpers.createPayeeAlias({ payeeId: other.id, rawName: 'Variant A', raw: true });

      const emptyName = await helpers.createPayeeAlias({ payeeId: other.id, rawName: '   ', raw: false });
      expect(emptyName.statusCode).toBe(ERROR_CODES.ValidationError);

      // Same normalized form ("variant a") – the second insert must fail
      // before hitting the UNIQUE index so the caller gets a friendly 409.
      const duplicate = await helpers.createPayeeAlias({ payeeId: other.id, rawName: 'VARIANT A', raw: false });
      expect(duplicate.statusCode).toBe(ERROR_CODES.ConflictError);

      const unknownPayee = await helpers.createPayeeAlias({
        payeeId: NONEXISTENT_ID,
        rawName: 'Whatever',
        raw: false,
      });
      expect(unknownPayee.statusCode).toBe(ERROR_CODES.NotFoundError);

      // A string another Payee already owns, as its canonical name or as one of
      // its aliases, would make extraction's exact-match step ambiguous. The 409
      // names the owning Payee so the UI can offer "go to Acme" or "merge".
      const canonicalClash = await helpers.createPayeeAlias({ payeeId: other.id, rawName: 'Acme', raw: false });
      expect(canonicalClash.statusCode).toBe(ERROR_CODES.ConflictError);
      const canonicalBody = canonicalClash.body.response as unknown as {
        details?: { conflictingPayee?: unknown };
      };
      expect(canonicalBody.details?.conflictingPayee).toEqual({ id: owner.id, name: 'Acme' });

      const aliasClash = await helpers.createPayeeAlias({ payeeId: other.id, rawName: 'ACME HOLDINGS', raw: false });
      expect(aliasClash.statusCode).toBe(ERROR_CODES.ConflictError);
      const aliasBody = aliasClash.body.response as unknown as { details?: { conflictingPayee?: unknown } };
      expect(aliasBody.details?.conflictingPayee).toEqual({ id: owner.id, name: 'Acme' });
    }, 30000);

    it('still detects the own-namespace conflict when another user has the same alias text', async () => {
      // Conflict detection must resolve the alias within THIS user's payee
      // set. If the lookup matches an arbitrary user's alias row, the other
      // user's row shadows the current user's own duplicate and the insert
      // slips through — leaving the same normalizedName on two of the
      // current user's Payees, which makes `findExactMatch` ambiguous.
      const aliasText = 'Coyote Logistics';

      // Another user owns the same alias text first, so a naive
      // `findOne({ normalizedName })` returns their row, not ours.
      const handle = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: handle.cookies,
        fn: async () => {
          const foreignPayee = await helpers.createPayee({
            payload: helpers.buildPayeePayload({ name: 'Foreign Coyote Owner' }),
            raw: true,
          });
          await helpers.createPayeeAlias({ payeeId: foreignPayee.id, rawName: aliasText, raw: true });
        },
      });

      const first = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Coyote Holder' }),
        raw: true,
      });
      await helpers.createPayeeAlias({ payeeId: first.id, rawName: aliasText, raw: true });

      const second = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Coyote Pretender' }),
        raw: true,
      });
      const response = await helpers.createPayeeAlias({
        payeeId: second.id,
        rawName: aliasText,
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
      const errorBody = response.body.response as unknown as { details?: { conflictingPayee?: unknown } };
      expect(errorBody.details?.conflictingPayee).toEqual({ id: first.id, name: 'Coyote Holder' });
    });
  });

  describe('DELETE /payees/:id/aliases/:aliasId', () => {
    it('removes an alias from the Payee', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'WithAliasOriginal' }),
        raw: true,
      });
      // Force an alias by renaming – the old canonical name lands as an alias.
      await helpers.updatePayee({
        id: payee.id,
        payload: { name: 'NewCanonical' },
        raw: true,
      });
      const detail = await helpers.getPayeeById({ id: payee.id, raw: true });
      const alias = detail.aliases?.find((a) => a.normalizedName === 'withaliasoriginal');
      expect(alias).toBeDefined();

      await helpers.deletePayeeAlias({
        payeeId: payee.id,
        aliasId: alias!.id,
        raw: false,
      });
      const after = await helpers.getPayeeById({ id: payee.id, raw: true });
      expect(after.aliases?.some((a) => a.id === alias!.id)).toBe(false);
    });

    it('refuses to delete the alias matching the Payee canonical name', async () => {
      // Set up: rename Payee twice so it ends up with an alias matching its
      // current canonical normalizedName. Deleting that one would leave the
      // canonical without an alias representation – and a follow-up sync
      // would just re-create it, so the operation is rejected.
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'CanonGuard' }),
        raw: true,
      });
      await helpers.updatePayee({ id: payee.id, payload: { name: 'TempName' }, raw: true });
      await helpers.updatePayee({ id: payee.id, payload: { name: 'CanonGuard' }, raw: true });
      const detail = await helpers.getPayeeById({ id: payee.id, raw: true });
      const selfAlias = detail.aliases?.find((a) => a.normalizedName === 'canonguard');
      expect(selfAlias).toBeDefined();

      const response = await helpers.deletePayeeAlias({
        payeeId: payee.id,
        aliasId: selfAlias!.id,
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const after = await helpers.getPayeeById({ id: payee.id, raw: true });
      expect(after.aliases?.some((a) => a.id === selfAlias!.id)).toBe(true);
    });
  });

  describe('PATCH /payees/bulk-categorization-mode', () => {
    it('updates every Payee owned by the caller', async () => {
      const first = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Bulk One' }),
        raw: true,
      });
      const second = await helpers.createPayee({
        payload: helpers.buildPayeePayload({
          name: 'Bulk Two',
          categorizationMode: CATEGORIZATION_MODE.hint,
        }),
        raw: true,
      });

      const result = await helpers.bulkUpdatePayeeCategorizationMode({
        mode: CATEGORIZATION_MODE.off,
        raw: true,
      });
      expect(result.updatedCount).toBeGreaterThanOrEqual(2);

      const firstAfter = await helpers.getPayeeById({ id: first.id, raw: true });
      const secondAfter = await helpers.getPayeeById({ id: second.id, raw: true });
      expect(firstAfter.categorizationMode).toBe(CATEGORIZATION_MODE.off);
      expect(secondAfter.categorizationMode).toBe(CATEGORIZATION_MODE.off);
    });

    it('rejects an unknown mode, and returns updatedCount=0 when the user has no Payees', async () => {
      const rejected = await helpers.bulkUpdatePayeeCategorizationMode({
        mode: 'nope' as CATEGORIZATION_MODE,
        raw: false,
      });
      expect(rejected.statusCode).toBe(ERROR_CODES.ValidationError);

      const result = await helpers.bulkUpdatePayeeCategorizationMode({
        mode: CATEGORIZATION_MODE.enforce,
        raw: true,
      });
      expect(result.updatedCount).toBe(0);
    });

    it("leaves another user's Payees alone", async () => {
      const userAPayee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'UserAOwned' }),
        raw: true,
      });

      const handle = await helpers.signUpSecondUser();
      const userBPayee = await helpers.asUser({
        cookies: handle.cookies,
        fn: () =>
          helpers.createPayee({
            payload: helpers.buildPayeePayload({ name: 'UserBOwned' }),
            raw: true,
          }),
      });

      // User B flips their fleet to `off`. User A's payee must stay on the
      // default `enforce` – the WHERE clause must be scoped to userId.
      await helpers.asUser({
        cookies: handle.cookies,
        fn: () =>
          helpers.bulkUpdatePayeeCategorizationMode({
            mode: CATEGORIZATION_MODE.off,
            raw: true,
          }),
      });

      const userAAfter = await helpers.getPayeeById({ id: userAPayee.id, raw: true });
      const userBAfter = await helpers.asUser({
        cookies: handle.cookies,
        fn: () => helpers.getPayeeById({ id: userBPayee.id, raw: true }),
      });
      expect(userAAfter.categorizationMode).toBe(CATEGORIZATION_MODE.enforce);
      expect(userBAfter.categorizationMode).toBe(CATEGORIZATION_MODE.off);
    });
  });

  describe('cross-user isolation', () => {
    // Payees are user-scoped. A second user must not be able to read, mutate,
    // merge, or peel aliases off the first user's records – the service must
    // produce 404, not silently leak or destroy data.
    it('rejects every mutation from a second user', async () => {
      // Build a payee with an alias by renaming – the previous canonical name
      // sticks around as an alias.
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'AliasGuardOriginal' }),
        raw: true,
      });
      await helpers.updatePayee({
        id: payee.id,
        payload: { name: 'AliasGuardRenamed' },
        raw: true,
      });
      const detail = await helpers.getPayeeById({ id: payee.id, raw: true });
      const alias = detail.aliases?.find((a) => a.normalizedName === 'aliasguardoriginal');
      expect(alias).toBeDefined();

      const handle = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: handle.cookies,
        fn: async () => {
          const fetched = await helpers.getPayeeById({ id: payee.id, raw: false });
          expect(fetched.statusCode).toBe(ERROR_CODES.NotFoundError);

          const updated = await helpers.updatePayee({ id: payee.id, payload: { name: 'Hijacked' }, raw: false });
          expect(updated.statusCode).toBe(ERROR_CODES.NotFoundError);

          const aliasAdded = await helpers.createPayeeAlias({
            payeeId: payee.id,
            rawName: 'Hijack Attempt',
            raw: false,
          });
          expect(aliasAdded.statusCode).toBe(ERROR_CODES.NotFoundError);

          // B's source payee is legitimate, so only the foreign target slot can
          // refuse the merge.
          const userBPayee = await helpers.createPayee({
            payload: helpers.buildPayeePayload({ name: 'UserBPayee' }),
            raw: true,
          });
          const merged = await helpers.mergePayees({
            sourceId: userBPayee.id,
            targetId: payee.id,
            raw: false,
          });
          expect(merged.statusCode).toBe(ERROR_CODES.NotFoundError);

          const aliasDeleted = await helpers.deletePayeeAlias({
            payeeId: payee.id,
            aliasId: alias!.id,
            raw: false,
          });
          expect(aliasDeleted.statusCode).toBe(ERROR_CODES.NotFoundError);

          const deleted = await helpers.deletePayee({ id: payee.id, raw: false });
          expect(deleted.statusCode).toBe(ERROR_CODES.NotFoundError);
        },
      });

      const after = await helpers.getPayeeById({ id: payee.id, raw: true });
      expect(after.id).toBe(payee.id);
      expect(after.aliases?.some((a) => a.id === alias!.id)).toBe(true);
      expect(after.aliases?.some((a) => a.normalizedName === 'hijack attempt')).toBe(false);
    }, 30000);
  });
});
