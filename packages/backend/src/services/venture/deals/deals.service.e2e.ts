import { VENTURE_DEAL_STATUS, VENTURE_SPV_SUBTYPE, VENTURE_VEHICLE_TYPE } from '@bt/shared/types/venture';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Venture Deals E2E', () => {
  describe('POST /venture/deals', () => {
    it('creates a deal with full payload', async () => {
      const response = await helpers.createVentureDeal({
        payload: helpers.buildVentureDealPayload({
          name: '  SK 116  ',
          targetCompany: 'Founder Factor YC W26',
          spvSubtype: VENTURE_SPV_SUBTYPE.multi_company,
          notes: 'Acme Ventures syndicate',
        }),
      });

      expect(response.statusCode).toBe(200);

      const deal = helpers.extractResponse(response);
      expect(deal).toMatchObject({
        name: 'SK 116',
        currencyCode: 'USD',
        vehicleType: VENTURE_VEHICLE_TYPE.spv,
        spvSubtype: VENTURE_SPV_SUBTYPE.multi_company,
        status: VENTURE_DEAL_STATUS.outstanding,
        targetCompany: 'Founder Factor YC W26',
        notes: 'Acme Ventures syndicate',
      });
      expect(Number(deal.principal)).toBe(16000);
      // entryFee auto-computed = principal * entryFeePct = 16000 * 0.085 = 1360
      expect(Number(deal.entryFee)).toBeCloseTo(1360, 2);
    });

    it('inherits platform fee defaults when platformId provided', async () => {
      const platform = await helpers.createVenturePlatform({
        payload: { name: 'Acme Ventures', defaultEntryFeePct: '0.085', defaultCarryPct: '0.2', defaultHurdlePct: '0' },
        raw: true,
      });

      const deal = await helpers.createVentureDeal({
        payload: {
          name: 'Deal w/ platform',
          platformId: platform.id,
          principal: '10000',
          entryFeePct: undefined,
          carryPct: undefined,
          hurdlePct: undefined,
          mgmtFeePct: undefined,
        },
        raw: true,
      });

      expect(Number(deal.entryFeePct)).toBe(0.085);
      expect(Number(deal.carryPct)).toBe(0.2);
      expect(deal.platformId).toBe(platform.id);
      // entryFee snapshot = 10000 * 0.085 = 850
      expect(Number(deal.entryFee)).toBeCloseTo(850, 2);
    });

    it('user-provided entryFee overrides auto-computed value', async () => {
      const deal = await helpers.createVentureDeal({
        payload: {
          name: 'Custom fee',
          principal: '10000',
          entryFeePct: '0.085',
          entryFee: '2000',
        },
        raw: true,
      });

      expect(Number(deal.entryFee)).toBe(2000);
    });
  });

  describe('GET /venture/deals/:id', () => {
    it('returns deal w/ platform + currency joins', async () => {
      const platform = await helpers.createVenturePlatform({ payload: { name: 'P1' }, raw: true });
      const created = await helpers.createVentureDeal({
        payload: { name: 'Detail Deal', platformId: platform.id },
        raw: true,
      });

      const response = await helpers.getVentureDeal({ dealId: created.id });
      expect(response.statusCode).toBe(200);

      const deal = helpers.extractResponse(response);
      expect(deal.id).toBe(created.id);
      expect(deal.platform).toMatchObject({ id: platform.id, name: 'P1' });
      expect(deal.currency).toMatchObject({ code: 'USD' });
    });

    it('returns 404 for nonexistent id', async () => {
      const response = await helpers.getVentureDeal({ dealId: generateRandomRecordId() });
      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('GET /venture/deals', () => {
    it('returns empty list when no deals', async () => {
      const response = await helpers.listVentureDeals({});
      expect(response.statusCode).toBe(200);

      const body = helpers.extractResponse(response);
      expect(body.data).toEqual([]);
      expect(body.pagination).toMatchObject({ limit: 20, offset: 0, page: 1 });
    });

    it('orders by investmentDate DESC and filters by status + platformId', async () => {
      const platform = await helpers.createVenturePlatform({ payload: { name: 'Filter Pf' }, raw: true });

      const dealA = await helpers.createVentureDeal({
        payload: { name: 'A', investmentDate: '2024-01-01', platformId: platform.id },
        raw: true,
      });
      const dealB = await helpers.createVentureDeal({
        payload: { name: 'B', investmentDate: '2026-06-01' },
        raw: true,
      });
      const dealC = await helpers.createVentureDeal({
        payload: { name: 'C', investmentDate: '2025-03-15' },
        raw: true,
      });

      await helpers.updateVentureDeal({
        dealId: dealC.id,
        payload: { status: VENTURE_DEAL_STATUS.fully_exited },
      });

      const all = await helpers.listVentureDeals({ raw: true });
      expect(all.data.map((d) => d.name)).toEqual(['B', 'C', 'A']);

      const onlyOutstanding = await helpers.listVentureDeals({
        status: VENTURE_DEAL_STATUS.outstanding,
        raw: true,
      });
      expect(onlyOutstanding.data.find((d) => d.id === dealA.id)).toBeDefined();
      expect(onlyOutstanding.data.find((d) => d.id === dealB.id)).toBeDefined();
      expect(onlyOutstanding.data.find((d) => d.id === dealC.id)).toBeUndefined();

      const onPlatform = await helpers.listVentureDeals({ platformId: platform.id, raw: true });
      expect(onPlatform.data).toHaveLength(1);
      expect(onPlatform.data[0]!.name).toBe('A');
    }, 30_000);
  });

  describe('PUT /venture/deals/:id', () => {
    it('updates basic fields and allows user-overridden status', async () => {
      const created = await helpers.createVentureDeal({ payload: { name: 'Old' }, raw: true });

      const updated = await helpers.updateVentureDeal({
        dealId: created.id,
        payload: { name: 'New', notes: 'Updated notes' },
        raw: true,
      });

      expect(updated.name).toBe('New');
      expect(updated.notes).toBe('Updated notes');

      const withStatus = await helpers.updateVentureDeal({
        dealId: created.id,
        payload: { status: VENTURE_DEAL_STATUS.partial_exit },
        raw: true,
      });

      expect(withStatus.status).toBe(VENTURE_DEAL_STATUS.partial_exit);
    });

    it('updates principal — historical entryFee snapshot not touched', async () => {
      const created = await helpers.createVentureDeal({
        payload: { principal: '10000', entryFee: '850' },
        raw: true,
      });

      const updated = await helpers.updateVentureDeal({
        dealId: created.id,
        payload: { principal: '20000' },
        raw: true,
      });

      expect(Number(updated.principal)).toBe(20000);
      expect(Number(updated.entryFee)).toBe(850);
    });

    it('switches platform association and clears it when platformId = null', async () => {
      const p1 = await helpers.createVenturePlatform({ payload: { name: 'Pf1' }, raw: true });
      const p2 = await helpers.createVenturePlatform({ payload: { name: 'Pf2' }, raw: true });

      const deal = await helpers.createVentureDeal({ payload: { platformId: p1.id }, raw: true });

      const switched = await helpers.updateVentureDeal({
        dealId: deal.id,
        payload: { platformId: p2.id },
        raw: true,
      });
      expect(switched.platformId).toBe(p2.id);

      const cleared = await helpers.updateVentureDeal({
        dealId: deal.id,
        payload: { platformId: null },
        raw: true,
      });
      expect(cleared.platformId).toBeNull();
    });

    it('returns 404 for nonexistent deal', async () => {
      const response = await helpers.updateVentureDeal({
        dealId: generateRandomRecordId(),
        payload: { name: 'X' },
      });
      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('rejects negative principal and empty body', async () => {
      const deal = await helpers.createVentureDeal({ raw: true });

      const negativePrincipal = await helpers.updateVentureDeal({
        dealId: deal.id,
        payload: { principal: '-1' },
      });
      expect(negativePrincipal.statusCode).toBe(ERROR_CODES.ValidationError);

      const emptyBody = await helpers.updateVentureDeal({ dealId: deal.id, payload: {} });
      expect(emptyBody.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('deal logo', () => {
    it('sets, swaps and clears the logo', async () => {
      const deal = await helpers.createVentureDeal({ payload: helpers.buildVentureDealPayload(), raw: true });
      expect(deal.logoDomain).toBeNull();

      const withBrand = await helpers.updateVentureDeal({
        dealId: deal.id,
        payload: { logoDomain: 'stripe.com' },
        raw: true,
      });
      expect(withBrand.logoDomain).toBe('stripe.com');

      const withMonogram = await helpers.updateVentureDeal({
        dealId: deal.id,
        payload: { logoInitials: 'ST', logoColor: '#7355be' },
        raw: true,
      });
      expect(withMonogram).toMatchObject({ logoDomain: null, logoInitials: 'ST', logoColor: '#7355be' });

      const cleared = await helpers.updateVentureDeal({
        dealId: deal.id,
        payload: { logoDomain: null, logoInitials: null, logoIcon: null },
        raw: true,
      });
      expect(cleared).toMatchObject({ logoDomain: null, logoInitials: null, logoColor: null, logoIcon: null });
    });

    it('recolors a stored monogram and rejects a color with nothing to paint', async () => {
      const created = await helpers.createVentureDeal({ payload: helpers.buildVentureDealPayload(), raw: true });

      const noMonogram = await helpers.updateVentureDeal({
        dealId: created.id,
        payload: { logoColor: '#7355be' },
      });
      expect(noMonogram.statusCode).toBe(ERROR_CODES.ValidationError);

      await helpers.updateVentureDeal({ dealId: created.id, payload: { logoInitials: 'ST' }, raw: true });
      const recolored = await helpers.updateVentureDeal({
        dealId: created.id,
        payload: { logoColor: '#16a34a' },
        raw: true,
      });
      expect(recolored).toMatchObject({ logoInitials: 'ST', logoColor: '#16a34a' });
    });

    it('keeps the logo on a non-logo update', async () => {
      const created = await helpers.createVentureDeal({ payload: helpers.buildVentureDealPayload(), raw: true });

      await helpers.updateVentureDeal({ dealId: created.id, payload: { logoDomain: 'example.com' }, raw: true });

      const renamed = await helpers.updateVentureDeal({ dealId: created.id, payload: { name: 'Renamed' }, raw: true });

      expect(renamed).toMatchObject({ name: 'Renamed', logoDomain: 'example.com' });
    });

    it('rejects two logo types in one request', async () => {
      const deal = await helpers.createVentureDeal({ payload: helpers.buildVentureDealPayload(), raw: true });

      const response = await helpers.updateVentureDeal({
        dealId: deal.id,
        payload: { logoDomain: 'stripe.com', logoInitials: 'ST' },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('DELETE /venture/deals/:id', () => {
    it('soft-deletes a deal', async () => {
      const created = await helpers.createVentureDeal({ payload: { name: 'Trash' }, raw: true });

      const response = await helpers.deleteVentureDeal({ dealId: created.id });
      expect(response.statusCode).toBe(200);

      const get = await helpers.getVentureDeal({ dealId: created.id });
      expect(get.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('hard-deletes when force=true', async () => {
      const created = await helpers.createVentureDeal({ raw: true });

      const response = await helpers.deleteVentureDeal({ dealId: created.id, force: true });
      expect(response.statusCode).toBe(200);

      const get = await helpers.getVentureDeal({ dealId: created.id });
      expect(get.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('is idempotent on nonexistent id', async () => {
      const response = await helpers.deleteVentureDeal({ dealId: generateRandomRecordId() });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('request validation', () => {
    it('rejects invalid deal payloads and ids', async () => {
      const emptyName = await helpers.createVentureDeal({ payload: { name: '' } });
      expect(emptyName.statusCode).toBe(ERROR_CODES.ValidationError);

      const negativePrincipal = await helpers.createVentureDeal({ payload: { principal: '-100' } });
      expect(negativePrincipal.statusCode).toBe(ERROR_CODES.ValidationError);

      const unknownCurrency = await helpers.createVentureDeal({ payload: { currencyCode: 'ZZZ' } });
      expect(unknownCurrency.statusCode).toBe(ERROR_CODES.ValidationError);

      const malformedDate = await helpers.createVentureDeal({ payload: { investmentDate: '03/24/2026' } });
      expect(malformedDate.statusCode).toBe(ERROR_CODES.ValidationError);

      const outOfRangePct = await helpers.createVentureDeal({ payload: { carryPct: '1.5' } });
      expect(outOfRangePct.statusCode).toBe(ERROR_CODES.ValidationError);

      const unknownPlatform = await helpers.createVentureDeal({
        payload: { platformId: generateRandomRecordId() },
      });
      expect(unknownPlatform.statusCode).toBe(ERROR_CODES.NotFoundError);
    }, 30_000);

    it('rejects malformed deal id on every route', async () => {
      const get = await helpers.getVentureDeal({ dealId: 'not-a-uuid' });
      expect(get.statusCode).toBe(ERROR_CODES.ValidationError);

      const update = await helpers.updateVentureDeal({ dealId: 'not-a-uuid', payload: { name: 'X' } });
      expect(update.statusCode).toBe(ERROR_CODES.ValidationError);

      const remove = await helpers.deleteVentureDeal({ dealId: 'not-a-uuid' });
      expect(remove.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});
