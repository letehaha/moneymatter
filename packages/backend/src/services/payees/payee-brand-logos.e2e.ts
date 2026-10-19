import { until } from '@common/helpers';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BrandLogos from '@models/brand-logos.model';
import { PNG_1X1_DATA_URL } from '@tests/fixtures/logo-images';
import * as helpers from '@tests/helpers';
import { getLogoDevSearchMock } from '@tests/mocks/logo-dev/mock-api';

// ---------------------------------------------------------------------------
// GET /api/brand-logos/search?q=...  – shared brand-logo search backing the
// payee + subscription logo pickers. Kept first: these tests must run before
// any payee exists, so an in-flight logo-resolution job can't observe the
// per-test MSW override below.
// ---------------------------------------------------------------------------

describe('Brand-logo search', () => {
  describe('GET /brand-logos/search', () => {
    it('returns matching results when the provider returns brands', async () => {
      global.mswMockServer.use(
        getLogoDevSearchMock({
          results: [
            { name: 'Amazon', domain: 'amazon.com', logoUrl: 'https://img.logo.dev/amazon.com' },
            { name: 'Amazon Web Services', domain: 'aws.amazon.com', logoUrl: 'https://img.logo.dev/aws.amazon.com' },
          ],
        }),
      );

      const data = await helpers.searchBrandLogos({ q: 'amazon', raw: true });

      expect(data.results).toHaveLength(2);
      expect(data.results[0]).toMatchObject({
        name: 'Amazon',
        domain: 'amazon.com',
        logoUrl: 'https://img.logo.dev/amazon.com',
      });
      expect(data.results[1]).toMatchObject({
        name: 'Amazon Web Services',
        domain: 'aws.amazon.com',
      });
    });

    it('returns empty results when the provider returns nothing', async () => {
      // Default MSW handler already returns [] – no override needed.
      const data = await helpers.searchBrandLogos({ q: 'xyznonexistentbrand', raw: true });

      expect(data.results).toEqual([]);
    });

    it('returns empty results when q is absent', async () => {
      // The controller short-circuits before calling searchBrands when q is empty / missing.
      const data = await helpers.searchBrandLogos({ raw: true });

      expect(data.results).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/payees  – logoDomain field (manual logo at creation time)
// ---------------------------------------------------------------------------

describe('Payee POST logoDomain', () => {
  describe('POST /payees', () => {
    it('creates with logoDomain and stamps logoSource as manual', async () => {
      const created = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Netflix', logoDomain: 'netflix.com' }),
        raw: true,
      });

      const fetched = await helpers.getPayeeById({ id: created.id, raw: true });
      expect(fetched.logoDomain).toBe('netflix.com');
      expect(fetched.logoSource).toBe('manual');
    });

    it('keeps a manual logoDomain even when a matching BrandLogos cache entry exists', async () => {
      // A cache entry that WOULD be picked up by auto-resolution – the manual
      // override must win because the resolver bails on logoSource = 'manual'.
      await BrandLogos.create({
        normalizedName: 'dropbox',
        domain: 'dropbox.com',
        brandName: 'Dropbox',
        source: 'seed',
      });

      const created = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Dropbox', logoDomain: 'custom.example' }),
        raw: true,
      });

      // Give the post-commit worker a window to (wrongly) clobber the manual
      // choice; the guard must keep it intact.
      await until(
        async () => {
          const fetched = await helpers.getPayeeById({ id: created.id, raw: true });
          return fetched.logoSource === 'manual' && fetched.logoDomain === 'custom.example';
        },
        { timeout: 3_000, interval: 200 },
      );

      const after = await helpers.getPayeeById({ id: created.id, raw: true });
      expect(after.logoSource).toBe('manual');
      expect(after.logoDomain).toBe('custom.example');
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/payees/:id  – logoDomain field
// ---------------------------------------------------------------------------

describe('Payee PATCH logoDomain', () => {
  describe('PATCH /payees/:id', () => {
    it('sets logoDomain and stamps logoSource as manual', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Netflix' }),
        raw: true,
      });

      const updated = await helpers.updatePayee({
        id: payee.id,
        payload: { logoDomain: 'netflix.com' },
        raw: true,
      });

      expect(updated.logoDomain).toBe('netflix.com');
      expect(updated.logoSource).toBe('manual');
    });

    it('treats null logoDomain as a no-op when no logo is stored (resolver keeps ownership)', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Netflix' }),
        raw: true,
      });

      const updated = await helpers.updatePayee({
        id: payee.id,
        payload: { logoDomain: null },
        raw: true,
      });

      expect(updated.logoDomain).toBeNull();
      // Nothing stored changed, so no 'manual' stamp – the background resolver
      // stays free to fill this logo in later. (logoSource may already be
      // 'auto' here if the create-time resolution negative-resolved first.)
      expect(updated.logoSource).not.toBe('manual');
    });

    it('leaves logo fields untouched when logoDomain is not included in the payload', async () => {
      // Pre-set a logo so there is something to check against.
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Spotify' }),
        raw: true,
      });
      await helpers.updatePayee({
        id: payee.id,
        payload: { logoDomain: 'spotify.com' },
        raw: true,
      });

      // Update a different field – logo fields must remain unchanged.
      const updated = await helpers.updatePayee({
        id: payee.id,
        payload: { name: 'Spotify Premium' },
        raw: true,
      });

      expect(updated.logoDomain).toBe('spotify.com');
      expect(updated.logoSource).toBe('manual');
    });

    it('returns 404 for a payee that does not exist', async () => {
      const res = await helpers.updatePayee({
        id: generateRandomRecordId(),
        payload: { logoDomain: 'example.com' },
        raw: false,
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/payees/:id/reset-logo
// ---------------------------------------------------------------------------

describe('Payee reset-logo', () => {
  describe('POST /payees/:id/reset-logo', () => {
    it('is idempotent – resetting a payee that already has no logo succeeds', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'No Logo Co' }),
        raw: true,
      });

      const reset = await helpers.resetPayeeLogo({ id: payee.id, raw: true });

      expect(reset.logoDomain).toBeNull();
      expect(reset.logoSource).toBeNull();
    });

    it('returns 404 for a payee that does not exist', async () => {
      const res = await helpers.resetPayeeLogo({ id: generateRandomRecordId(), raw: false });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it("refuses a second user's attempts to set or reset another user's logo", async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'LogoCrossUserGuard' }),
        raw: true,
      });
      await helpers.updatePayee({ id: payee.id, payload: { logoDomain: 'owned.com' }, raw: true });

      const handle = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: handle.cookies,
        fn: async () => {
          const hijack = await helpers.updatePayee({
            id: payee.id,
            payload: { logoDomain: 'hijack.com' },
            raw: false,
          });
          expect(hijack.statusCode).toBe(ERROR_CODES.NotFoundError);

          const reset = await helpers.resetPayeeLogo({ id: payee.id, raw: false });
          expect(reset.statusCode).toBe(ERROR_CODES.NotFoundError);
        },
      });

      const after = await helpers.getPayeeById({ id: payee.id, raw: true });
      expect(after.logoDomain).toBe('owned.com');
      expect(after.logoSource).toBe('manual');
    }, 30000);
  });
});

// ---------------------------------------------------------------------------
// Auto-resolution via BullMQ queue (cache hit path)
//
// The logo-resolution worker is running in the test environment (started by
// setupIntegrationTests). We seed the shared BrandLogos cache directly (via
// the Sequelize model – allowed here because this is background-data seeding,
// not the endpoint under test). When a new Payee is created its name matches
// a BrandLogos row, the worker picks it up and writes logoDomain + 'auto'.
// We poll GET /payees/:id until logoDomain is populated.
// ---------------------------------------------------------------------------

describe('Payee logo auto-resolution', () => {
  it('resolves logoDomain automatically from the BrandLogos cache after payee creation', async () => {
    // Seed the shared cache so the worker hits it without any logo.dev call.
    await BrandLogos.create({
      normalizedName: 'github',
      domain: 'github.com',
      brandName: 'GitHub',
      source: 'seed',
    });

    const payee = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: 'GitHub' }),
      raw: true,
    });

    // Poll GET /payees/:id until the worker stamps the logo fields.
    await until(
      async () => {
        const fetched = await helpers.getPayeeById({ id: payee.id, raw: true });
        return fetched.logoDomain !== null && fetched.logoSource !== null;
      },
      { timeout: 10_000, interval: 200 },
    );

    const resolved = await helpers.getPayeeById({ id: payee.id, raw: true });
    expect(resolved.logoDomain).toBe('github.com');
    expect(resolved.logoSource).toBe('auto');
  });

  it('resolves from the logo.dev provider and writes the result back to the cache on a cache miss', async () => {
    // No BrandLogos seed → the worker falls through to the provider, then
    // persists the winning result so the next Payee with this name skips the API.
    global.mswMockServer.use(
      getLogoDevSearchMock({
        results: [{ name: 'Figma', domain: 'figma.com', logoUrl: 'https://img.logo.dev/figma.com' }],
      }),
    );

    const payee = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: 'Figma' }),
      raw: true,
    });

    await until(
      async () => {
        const fetched = await helpers.getPayeeById({ id: payee.id, raw: true });
        return fetched.logoSource !== null;
      },
      { timeout: 10_000, interval: 200 },
    );

    const resolved = await helpers.getPayeeById({ id: payee.id, raw: true });
    expect(resolved.logoDomain).toBe('figma.com');
    expect(resolved.logoSource).toBe('auto');

    const cached = await BrandLogos.findOne({ where: { normalizedName: 'figma' } });
    expect(cached).not.toBeNull();
    expect(cached?.domain).toBe('figma.com');
    expect(cached?.source).toBe('logodev');
  });

  it('clamps an over-long provider brand name to the cache column width', async () => {
    global.mswMockServer.use(
      getLogoDevSearchMock({
        results: [{ name: 'L'.repeat(300), domain: 'longbrand.com', logoUrl: null }],
      }),
    );

    const payee = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: 'Longbrand Co' }),
      raw: true,
    });

    await until(
      async () => {
        const fetched = await helpers.getPayeeById({ id: payee.id, raw: true });
        return fetched.logoSource !== null;
      },
      { timeout: 10_000, interval: 200 },
    );

    const cached = await BrandLogos.findOne({ where: { normalizedName: 'longbrand co' } });
    expect(cached?.brandName).toHaveLength(200);
    expect(cached?.domain).toBe('longbrand.com');
  });

  it('records a negative result (logoSource auto, logoDomain null) when neither cache nor provider matches', async () => {
    // Empty cache + the default MSW handler returns [] → no match anywhere. The
    // worker must still stamp logoSource so the lazy-on-read backfill stops
    // re-enqueuing this Payee on every list/detail request.
    const payee = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: `Unbranded Co ${Date.now()}` }),
      raw: true,
    });

    await until(
      async () => {
        const fetched = await helpers.getPayeeById({ id: payee.id, raw: true });
        return fetched.logoSource !== null;
      },
      { timeout: 10_000, interval: 200 },
    );

    const resolved = await helpers.getPayeeById({ id: payee.id, raw: true });
    expect(resolved.logoSource).toBe('auto');
    expect(resolved.logoDomain).toBeNull();
  });

  it('re-resolves automatically after a monogram or a manual domain is reset', async () => {
    // A cache entry the resolver picks up once the manual override is cleared.
    await BrandLogos.create({
      normalizedName: 'twilio',
      domain: 'twilio.com',
      brandName: 'Twilio',
      source: 'seed',
    });

    // The monogram stamps logoSource 'manual' at create, so the create-time
    // resolver pass never races the overrides below.
    const payee = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: 'Twilio', logoInitials: 'TW', logoColor: '#7355be' }),
      raw: true,
    });
    expect(payee.logoSource).toBe('manual');

    // Reset enqueues a fresh resolution after the transaction commits, so the
    // worker reads the committed null logoSource and re-resolves from the cache.
    const monogramReset = await helpers.resetPayeeLogo({ id: payee.id, raw: true });
    expect(monogramReset.logoInitials).toBeNull();
    expect(monogramReset.logoColor).toBeNull();
    expect(monogramReset.logoDomain).toBeNull();
    expect(monogramReset.logoSource).toBeNull();

    await until(
      async () => {
        const fetched = await helpers.getPayeeById({ id: payee.id, raw: true });
        return fetched.logoSource === 'auto';
      },
      { timeout: 10_000, interval: 200 },
    );

    const afterMonogramReset = await helpers.getPayeeById({ id: payee.id, raw: true });
    expect(afterMonogramReset.logoDomain).toBe('twilio.com');
    expect(afterMonogramReset.logoInitials).toBeNull();

    const manual = await helpers.updatePayee({
      id: payee.id,
      payload: { logoDomain: 'custom.example' },
      raw: true,
    });
    expect(manual.logoSource).toBe('manual');

    const domainReset = await helpers.resetPayeeLogo({ id: payee.id, raw: true });
    expect(domainReset.logoSource).toBeNull();
    expect(domainReset.logoDomain).toBeNull();

    await until(
      async () => {
        const fetched = await helpers.getPayeeById({ id: payee.id, raw: true });
        return fetched.logoSource === 'auto';
      },
      { timeout: 10_000, interval: 200 },
    );

    const reResolved = await helpers.getPayeeById({ id: payee.id, raw: true });
    expect(reResolved.logoSource).toBe('auto');
    expect(reResolved.logoDomain).toBe('twilio.com');
  }, 40000);
});

// ---------------------------------------------------------------------------
// Custom monogram (logoInitials + logoColor) – the alternative to a brand logo
// ---------------------------------------------------------------------------

describe('Payee monogram', () => {
  describe('POST /payees', () => {
    it('stores monogram values as sent, normalizing the color', async () => {
      const bakery = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Local Bakery', logoInitials: 'LB', logoColor: '#7355be' }),
        raw: true,
      });

      expect(bakery.logoInitials).toBe('LB');
      expect(bakery.logoColor).toBe('#7355be');
      expect(bakery.logoDomain).toBeNull();
      expect(bakery.logoSource).toBe('manual');

      const bakeryFetched = await helpers.getPayeeById({ id: bakery.id, raw: true });
      expect(bakeryFetched.logoInitials).toBe('LB');
      expect(bakeryFetched.logoColor).toBe('#7355be');
      expect(bakeryFetched.logoDomain).toBeNull();
      expect(bakeryFetched.logoSource).toBe('manual');

      const upperHex = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Upper Hex', logoInitials: 'UH', logoColor: '#7355BE' }),
        raw: true,
      });
      expect(upperHex.logoColor).toBe('#7355be');

      const singleFamily = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Family Fund', logoInitials: '👨‍👩‍👧' }),
        raw: true,
      });
      expect(singleFamily.logoInitials).toBe('👨‍👩‍👧');
      expect(singleFamily.logoColor).toBeNull();

      // Each family emoji is 7 code points (11 UTF-16 units); two of them are 2
      // graphemes / 14 code points, which fits VARCHAR(16) – Postgres counts
      // code points, so a UTF-16-based length cap would wrongly reject this.
      const twoFamilies = '👨‍👩‍👧‍👦👨‍👩‍👧‍👦';
      const created = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Two Families', logoInitials: twoFamilies }),
        raw: true,
      });
      expect(created.logoInitials).toBe(twoFamilies);

      const fetched = await helpers.getPayeeById({ id: created.id, raw: true });
      expect(fetched.logoInitials).toBe(twoFamilies);
    }, 30000);

    it('keeps the monogram even when a matching BrandLogos cache entry exists', async () => {
      // A cache entry the resolver WOULD pick up – the manual stamp must win.
      await BrandLogos.create({
        normalizedName: 'dropbox',
        domain: 'dropbox.com',
        brandName: 'Dropbox',
        source: 'seed',
      });

      const created = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Dropbox', logoInitials: 'DB' }),
        raw: true,
      });

      // Give the post-commit worker a window to (wrongly) clobber the monogram.
      await until(
        async () => {
          const fetched = await helpers.getPayeeById({ id: created.id, raw: true });
          return fetched.logoSource === 'manual' && fetched.logoInitials === 'DB';
        },
        { timeout: 3_000, interval: 200 },
      );

      const after = await helpers.getPayeeById({ id: created.id, raw: true });
      expect(after.logoInitials).toBe('DB');
      expect(after.logoDomain).toBeNull();
    });

    it('returns 422 when logoDomain and logoInitials are both set', async () => {
      const res = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Both Logos', logoDomain: 'netflix.com', logoInitials: 'NF' }),
        raw: false,
      });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('PATCH /payees/:id', () => {
    it('applies the domain/monogram exclusivity rules across successive PATCHes', async () => {
      // logoSource stays 'manual' for the whole sequence, so the background
      // resolver never interferes with any step.
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Corner Shop', logoDomain: 'shop.example' }),
        raw: true,
      });

      const monogramSet = await helpers.updatePayee({
        id: payee.id,
        payload: { logoInitials: 'CS', logoColor: '#22c55e' },
        raw: true,
      });
      expect(monogramSet.logoInitials).toBe('CS');
      expect(monogramSet.logoColor).toBe('#22c55e');
      expect(monogramSet.logoDomain).toBeNull();
      expect(monogramSet.logoSource).toBe('manual');

      const recolored = await helpers.updatePayee({
        id: payee.id,
        payload: { logoColor: '#0ea5e9' },
        raw: true,
      });
      expect(recolored.logoColor).toBe('#0ea5e9');
      expect(recolored.logoInitials).toBe('CS');

      // Domain and initials are asymmetric on purpose: setting a domain evicts
      // the monogram, but clearing the (already null) domain must not touch it.
      const domainCleared = await helpers.updatePayee({
        id: payee.id,
        payload: { logoDomain: null },
        raw: true,
      });
      expect(domainCleared.logoDomain).toBeNull();
      expect(domainCleared.logoInitials).toBe('CS');
      expect(domainCleared.logoColor).toBe('#0ea5e9');

      const renamed = await helpers.updatePayee({
        id: payee.id,
        payload: { name: 'Corner Shop Renamed' },
        raw: true,
      });
      expect(renamed.logoInitials).toBe('CS');
      expect(renamed.logoColor).toBe('#0ea5e9');
      expect(renamed.logoSource).toBe('manual');

      const monogramCleared = await helpers.updatePayee({
        id: payee.id,
        payload: { logoInitials: null },
        raw: true,
      });
      expect(monogramCleared.logoInitials).toBeNull();
      expect(monogramCleared.logoColor).toBeNull();
      expect(monogramCleared.logoSource).toBe('manual');

      await helpers.updatePayee({
        id: payee.id,
        payload: { logoInitials: 'SW', logoColor: '#ef4444' },
        raw: true,
      });
      const domainPicked = await helpers.updatePayee({
        id: payee.id,
        payload: { logoDomain: 'netflix.com' },
        raw: true,
      });
      expect(domainPicked.logoDomain).toBe('netflix.com');
      expect(domainPicked.logoInitials).toBeNull();
      expect(domainPicked.logoColor).toBeNull();
      expect(domainPicked.logoSource).toBe('manual');
    }, 30000);

    it('returns 422 when the payload carries both logoDomain and logoInitials', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Both On Update' }),
        raw: true,
      });

      const res = await helpers.updatePayee({
        id: payee.id,
        payload: { logoDomain: 'netflix.com', logoInitials: 'NF' },
        raw: false,
      });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});

describe('Payee logo icon and image slots', () => {
  it('creates with logoIcon and stamps logoSource as manual', async () => {
    const created = await helpers.createPayee({
      payload: { ...helpers.buildPayeePayload({ name: 'Bakery' }), logoIcon: 'food-24-regular' },
      raw: true,
    });

    expect(created).toMatchObject({ logoIcon: 'food-24-regular', logoSource: 'manual', logoDomain: null });
  });

  it('sets logoIcon on update and evicts the domain', async () => {
    const payee = await helpers.createPayee({
      payload: { ...helpers.buildPayeePayload({ name: 'Coffee' }), logoDomain: 'starbucks.com' },
      raw: true,
    });

    const updated = await helpers.updatePayee({ id: payee.id, payload: { logoIcon: 'food-24-regular' }, raw: true });

    expect(updated).toMatchObject({ logoIcon: 'food-24-regular', logoDomain: null, logoSource: 'manual' });
  });

  it('ignores logoImage', async () => {
    const payee = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Plain' }), raw: true });

    const response = await helpers.updatePayee({
      id: payee.id,
      payload: { ...({ logoImage: PNG_1X1_DATA_URL } as object) },
      raw: false,
    });

    expect(response.statusCode).toBe(200);
    expect((await helpers.getPayeeById({ id: payee.id, raw: true })).logoImageId).toBeNull();
  });
});
