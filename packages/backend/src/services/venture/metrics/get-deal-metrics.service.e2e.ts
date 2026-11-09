import { TRANSACTION_TYPES } from '@bt/shared/types';
import { VENTURE_CASH_FLOW_MODE, VENTURE_DEAL_STATUS, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Get Deal Metrics E2E', () => {
  describe('GET /venture/deals/:id/metrics', () => {
    it('returns zero metrics for a brand-new deal with no events', async () => {
      const deal = await helpers.createVentureDeal({
        payload: { currencyCode: global.BASE_CURRENCY.code, principal: '10000', entryFeePct: '0' },
        raw: true,
      });

      const metrics = await helpers.getVentureDealMetrics({ dealId: deal.id, raw: true });

      expect(Number(metrics.costBasis)).toBe(10000);
      expect(Number(metrics.totalDistributions)).toBe(0);
      expect(Number(metrics.currentValue)).toBe(10000); // default = costBasis - cumDist
      expect(Number(metrics.pnlAbsolute)).toBe(0);
      expect(Number(metrics.tvpi)).toBe(1);
      expect(Number(metrics.dpi)).toBe(0);
    });

    it('open-deal IRR uses currentValue as residual NAV', async () => {
      const deal = await helpers.createVentureDeal({
        payload: { currencyCode: global.BASE_CURRENCY.code, principal: '10000', entryFeePct: '0' },
        raw: true,
      });

      await helpers.createVentureEvent({
        dealId: deal.id,
        payload: {
          type: VENTURE_EVENT_TYPE.initial_investment,
          eventDate: '2026-03-24',
          cashFlowMode: VENTURE_CASH_FLOW_MODE.out_of_wallet,
        },
      });
      await helpers.createVentureEvent({
        dealId: deal.id,
        payload: {
          type: VENTURE_EVENT_TYPE.nav_update,
          eventDate: '2027-03-24',
          cashFlowMode: VENTURE_CASH_FLOW_MODE.none,
          navAfter: '15000',
        },
      });

      const metrics = await helpers.getVentureDealMetrics({ dealId: deal.id, raw: true });

      expect(Number(metrics.currentValue)).toBe(15000);
      expect(Number(metrics.tvpi)).toBeCloseTo(15000 / 10000, 3);
      expect(Number(metrics.dpi)).toBe(0);
      // IRR exists (paper return)
      expect(metrics.irr).not.toBeNull();
    });

    it('capital_refund lowers cost basis without counting as a distribution', async () => {
      const deal = await helpers.createVentureDeal({
        payload: {
          currencyCode: global.BASE_CURRENCY.code,
          principal: '16000',
          entryFeePct: '0.085',
          investmentDate: '2026-02-04',
        },
        raw: true,
      });
      await helpers.createVentureEvent({
        dealId: deal.id,
        payload: {
          type: VENTURE_EVENT_TYPE.initial_investment,
          eventDate: '2026-02-04',
          cashFlowMode: VENTURE_CASH_FLOW_MODE.out_of_wallet,
        },
      });

      const account = await helpers.createAccount({ raw: true });
      const [refundTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1010.94,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      const refundResponse = await helpers.createVentureEvent({
        dealId: deal.id,
        payload: {
          type: VENTURE_EVENT_TYPE.capital_refund,
          eventDate: '2026-11-09',
          cashFlowMode: VENTURE_CASH_FLOW_MODE.linked,
          grossAmount: '1010.94',
          transactionIds: [refundTx!.id],
        },
      });
      expect(refundResponse.statusCode).toBe(200);
      const refund = helpers.extractResponse(refundResponse);
      expect(Number(refund.lpNetAmount)).toBeCloseTo(1010.94, 2);
      expect(refund.gpCarryAmount).toBeNull();

      const metrics = await helpers.getVentureDealMetrics({ dealId: deal.id, raw: true });
      expect(Number(metrics.costBasis)).toBeCloseTo(16349.06, 2);
      expect(Number(metrics.totalDistributions)).toBe(0);
      expect(Number(metrics.dpi)).toBe(0);
      expect(Number(metrics.currentValue)).toBeCloseTo(16349.06, 2);
      expect(Number(metrics.tvpi)).toBeCloseTo(1, 6);

      const dealAfter = await helpers.getVentureDeal({ dealId: deal.id, raw: true });
      expect(dealAfter.status).toBe(VENTURE_DEAL_STATUS.outstanding);
    });

    it('a later distribution computes carry against the refund-reduced cost basis', async () => {
      const deal = await helpers.createVentureDeal({
        payload: {
          currencyCode: global.BASE_CURRENCY.code,
          principal: '10000',
          entryFeePct: '0',
          carryPct: '0.2',
          hurdlePct: '0',
          investmentDate: '2026-02-04',
        },
        raw: true,
      });
      const oow = VENTURE_CASH_FLOW_MODE.out_of_wallet;
      await helpers.createVentureEvent({
        dealId: deal.id,
        payload: { type: VENTURE_EVENT_TYPE.initial_investment, eventDate: '2026-02-04', cashFlowMode: oow },
      });
      await helpers.createVentureEvent({
        dealId: deal.id,
        payload: {
          type: VENTURE_EVENT_TYPE.capital_refund,
          eventDate: '2026-03-01',
          grossAmount: '2000',
          cashFlowMode: oow,
        },
        raw: true,
      });
      const dist = await helpers.createVentureEvent({
        dealId: deal.id,
        payload: {
          type: VENTURE_EVENT_TYPE.distribution,
          eventDate: '2027-02-04',
          grossAmount: '10000',
          cashFlowMode: oow,
        },
        raw: true,
      });

      expect(Number(dist.principalReturnedThisEvent)).toBeCloseTo(8000, 2);
      expect(Number(dist.gpCarryAmount)).toBeCloseTo(400, 2);
      expect(Number(dist.lpNetAmount)).toBeCloseTo(9600, 2);
    });

    it('validates an edited capital_refund against the basis without counting itself', async () => {
      const deal = await helpers.createVentureDeal({
        payload: {
          currencyCode: global.BASE_CURRENCY.code,
          principal: '10000',
          entryFeePct: '0',
          investmentDate: '2026-02-04',
        },
        raw: true,
      });
      const oow = VENTURE_CASH_FLOW_MODE.out_of_wallet;
      await helpers.createVentureEvent({
        dealId: deal.id,
        payload: { type: VENTURE_EVENT_TYPE.initial_investment, eventDate: '2026-02-04', cashFlowMode: oow },
      });
      const refund = await helpers.createVentureEvent({
        dealId: deal.id,
        payload: {
          type: VENTURE_EVENT_TYPE.capital_refund,
          eventDate: '2026-03-01',
          grossAmount: '2000',
          cashFlowMode: oow,
        },
        raw: true,
      });

      const raised = await helpers.updateVentureEvent({ eventId: refund.id, payload: { grossAmount: '10000' } });
      expect(raised.statusCode).toBe(200);

      const tooHigh = await helpers.updateVentureEvent({ eventId: refund.id, payload: { grossAmount: '10000.01' } });
      expect(tooHigh.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it.each([
      ['missing grossAmount', {}],
      ['zero grossAmount', { grossAmount: '0' }],
      ['grossAmount above cost basis', { grossAmount: '10000.01' }],
    ])('rejects capital_refund with %s', async (_label, extra) => {
      const deal = await helpers.createVentureDeal({
        payload: {
          currencyCode: global.BASE_CURRENCY.code,
          principal: '10000',
          entryFeePct: '0',
          investmentDate: '2026-02-04',
        },
        raw: true,
      });
      await helpers.createVentureEvent({
        dealId: deal.id,
        payload: {
          type: VENTURE_EVENT_TYPE.initial_investment,
          eventDate: '2026-02-04',
          cashFlowMode: VENTURE_CASH_FLOW_MODE.out_of_wallet,
        },
      });

      const response = await helpers.createVentureEvent({
        dealId: deal.id,
        payload: {
          type: VENTURE_EVENT_TYPE.capital_refund,
          eventDate: '2026-11-09',
          cashFlowMode: VENTURE_CASH_FLOW_MODE.out_of_wallet,
          ...extra,
        },
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('returns 404 for unknown deal', async () => {
      const response = await helpers.getVentureDealMetrics({
        dealId: '00000000-0000-0000-0000-000000000000',
      });
      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });
});
