import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Payee Ignored Names', () => {
  describe('CRUD endpoints', () => {
    it('adds, lists, and removes an ignored name', async () => {
      const empty = await helpers.listIgnoredNames({ raw: true });
      expect(empty).toEqual([]);

      const added = await helpers.addIgnoredName({ rawName: 'Переказ на картку', raw: true });
      expect(added.id).toBeDefined();
      expect(added.normalizedName).toBe('переказ на картку');
      expect(added.rawSample).toBe('Переказ на картку');

      const duplicate = await helpers.addIgnoredName({ rawName: 'Переказ на картку', raw: true });
      expect(duplicate.id).toBe(added.id);

      const emptyName = await helpers.addIgnoredName({ rawName: '   ', raw: false });
      expect(emptyName.statusCode).toBe(ERROR_CODES.ValidationError);

      const tooLong = await helpers.addIgnoredName({ rawName: 'x'.repeat(501), raw: false });
      expect(tooLong.statusCode).toBe(ERROR_CODES.ValidationError);

      const after = await helpers.listIgnoredNames({ raw: true });
      expect(after.some((r) => r.id === added.id)).toBe(true);

      await helpers.removeIgnoredName({ id: added.id, raw: false });

      const final = await helpers.listIgnoredNames({ raw: true });
      expect(final.some((r) => r.id === added.id)).toBe(false);
    });

    it('adopts the existing row when the same name is added concurrently', async () => {
      const [first, second] = await Promise.all([
        helpers.addIgnoredName({ rawName: 'Same Name', raw: false }),
        helpers.addIgnoredName({ rawName: 'Same Name', raw: false }),
      ]);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(helpers.extractResponse(first).id).toBe(helpers.extractResponse(second).id);

      const rows = await helpers.listIgnoredNames({ raw: true });
      expect(rows.filter((r) => r.normalizedName === 'same name')).toHaveLength(1);
    });

    it('returns 409 when an existing Payee matches the normalized name, and force=true deletes it', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Glovo' }),
        raw: true,
      });

      const rejected = await helpers.addIgnoredName({ rawName: 'glovo', raw: false });
      expect(rejected.statusCode).toBe(ERROR_CODES.ConflictError);

      const added = await helpers.addIgnoredName({ rawName: 'glovo', force: true, raw: true });
      expect(added.normalizedName).toBe('glovo');

      const lookup = await helpers.getPayeeById({ id: payee.id, raw: false });
      expect(lookup.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it("returns 409 when the name matches a Payee's alias, and force=true deletes that Payee", async () => {
      // An alias-resolvable name would make the ignore a silent no-op:
      // extraction links at the exact-match step before the blocklist is
      // consulted. Same force handshake as the canonical-name collision.
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Cloudflare' }),
        raw: true,
      });
      await helpers.createPayeeAlias({ payeeId: payee.id, rawName: 'CF Net', raw: true });

      const rejected = await helpers.addIgnoredName({ rawName: 'cf net', raw: false });
      expect(rejected.statusCode).toBe(ERROR_CODES.ConflictError);

      const added = await helpers.addIgnoredName({ rawName: 'cf net', force: true, raw: true });
      expect(added.normalizedName).toBe('cf net');

      const lookup = await helpers.getPayeeById({ id: payee.id, raw: false });
      expect(lookup.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('extraction Step 3 suppression', () => {
    it('does NOT auto-promote a Payee for a normalizedName on the ignored list', async () => {
      // Opt the user into description-based extraction so manual tx creates
      // funnel `note` into the inline sync-time extractor — that's the only
      // way to exercise Step 3 promotion without a real bank sync.
      await helpers.updateUserSettings({
        settings: { locale: 'en', payeeExtractionUsesDescription: true },
      });
      await helpers.addIgnoredName({ rawName: 'Переказ на картку', raw: true });

      const account = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, note: 'Переказ на картку' }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, note: 'Переказ на картку' }),
        raw: true,
      });

      const payees = await helpers.listPayees({ raw: true });
      expect(payees.find((p) => p.normalizedName === 'переказ на картку')).toBeUndefined();
    });

    it('still respects manual Payee creation with the same normalizedName as an ignored entry', async () => {
      // The block only gates Step 3 auto-promotion. The user can still
      // explicitly create the Payee through the UI — they're saying "I
      // changed my mind, this IS a real merchant".
      await helpers.addIgnoredName({ rawName: 'ManualOverride', raw: true });

      const created = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'ManualOverride' }),
        raw: true,
      });
      expect(created.id).toBeDefined();
      expect(created.normalizedName).toBe('manualoverride');
    });
  });

  describe('DELETE /payees/:id?ignoreFuture=true', () => {
    it('deletes the Payee and adds canonical + every alias to the ignored set', async () => {
      // Build a Payee with aliases by chaining renames.
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'OriginalName' }),
        raw: true,
      });
      await helpers.updatePayee({ id: payee.id, payload: { name: 'SecondName' }, raw: true });
      await helpers.updatePayee({ id: payee.id, payload: { name: 'ThirdName' }, raw: true });
      const detail = await helpers.getPayeeById({ id: payee.id, raw: true });
      const aliasCount = detail.aliases?.length ?? 0;
      expect(aliasCount).toBeGreaterThan(0);

      const result = await helpers.deletePayeeAndIgnore({ id: payee.id, raw: true });
      // Canonical + every distinct alias normalizedName lands on the list.
      expect(result.ignoredAddedCount).toBe(aliasCount + 1);

      const lookup = await helpers.getPayeeById({ id: payee.id, raw: false });
      expect(lookup.statusCode).toBe(ERROR_CODES.NotFoundError);

      const ignored = await helpers.listIgnoredNames({ raw: true });
      const normalizedNames = new Set(ignored.map((r) => r.normalizedName));
      expect(normalizedNames.has('thirdname')).toBe(true);
      expect(normalizedNames.has('originalname')).toBe(true);
      expect(normalizedNames.has('secondname')).toBe(true);

      const unknown = await helpers.deletePayeeAndIgnore({ id: NONEXISTENT_ID, raw: false });
      expect(unknown.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });
});
