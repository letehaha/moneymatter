import { VENTURE_DEAL_STATUS, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { describe, expect, it } from '@jest/globals';

import { progressDealStatus } from './progress-status';

describe('progressDealStatus', () => {
  it('no events → outstanding', () => {
    expect(progressDealStatus({ events: [] })).toBe(VENTURE_DEAL_STATUS.outstanding);
  });

  it('only initial_investment → outstanding', () => {
    expect(
      progressDealStatus({
        events: [{ type: VENTURE_EVENT_TYPE.initial_investment, navAfter: null }],
      }),
    ).toBe(VENTURE_DEAL_STATUS.outstanding);
  });

  it('only nav_update → outstanding (no cash flow)', () => {
    expect(
      progressDealStatus({
        events: [
          { type: VENTURE_EVENT_TYPE.initial_investment, navAfter: null },
          { type: VENTURE_EVENT_TYPE.nav_update, navAfter: '18500' },
        ],
      }),
    ).toBe(VENTURE_DEAL_STATUS.outstanding);
  });

  it('first distribution → partial_exit', () => {
    expect(
      progressDealStatus({
        events: [
          { type: VENTURE_EVENT_TYPE.initial_investment, navAfter: null },
          { type: VENTURE_EVENT_TYPE.distribution, navAfter: null },
        ],
      }),
    ).toBe(VENTURE_DEAL_STATUS.partial_exit);
  });

  it('exit with navAfter=0 → fully_exited', () => {
    expect(
      progressDealStatus({
        events: [
          { type: VENTURE_EVENT_TYPE.initial_investment, navAfter: null },
          { type: VENTURE_EVENT_TYPE.distribution, navAfter: null },
          { type: VENTURE_EVENT_TYPE.exit, navAfter: '0' },
        ],
      }),
    ).toBe(VENTURE_DEAL_STATUS.fully_exited);
  });

  it('exit with navAfter>0 → partial_exit (still NAV remaining)', () => {
    expect(
      progressDealStatus({
        events: [
          { type: VENTURE_EVENT_TYPE.initial_investment, navAfter: null },
          { type: VENTURE_EVENT_TYPE.exit, navAfter: '5000' },
        ],
      }),
    ).toBe(VENTURE_DEAL_STATUS.partial_exit);
  });

  it('writedown to zero → written_off (overrides exit-to-zero)', () => {
    expect(
      progressDealStatus({
        events: [
          { type: VENTURE_EVENT_TYPE.initial_investment, navAfter: null },
          { type: VENTURE_EVENT_TYPE.writedown, navAfter: '0' },
        ],
      }),
    ).toBe(VENTURE_DEAL_STATUS.written_off);
  });

  it('writedown with navAfter>0 → outstanding (no money moved)', () => {
    expect(
      progressDealStatus({
        events: [
          { type: VENTURE_EVENT_TYPE.initial_investment, navAfter: null },
          { type: VENTURE_EVENT_TYPE.writedown, navAfter: '5000' },
        ],
      }),
    ).toBe(VENTURE_DEAL_STATUS.outstanding);
  });

  it('writedown with navAfter>0 after a distribution → partial_exit', () => {
    expect(
      progressDealStatus({
        events: [
          { type: VENTURE_EVENT_TYPE.initial_investment, navAfter: null },
          { type: VENTURE_EVENT_TYPE.distribution, navAfter: null },
          { type: VENTURE_EVENT_TYPE.writedown, navAfter: '5000' },
        ],
      }),
    ).toBe(VENTURE_DEAL_STATUS.partial_exit);
  });

  it('reverts terminal state when triggering event removed (delete simulation)', () => {
    // Was: initial + dist + exit($0) → fully_exited
    // After exit deletion: only initial + dist → partial_exit
    const afterExitDeletion = [
      { type: VENTURE_EVENT_TYPE.initial_investment, navAfter: null },
      { type: VENTURE_EVENT_TYPE.distribution, navAfter: null },
    ];
    expect(progressDealStatus({ events: afterExitDeletion })).toBe(VENTURE_DEAL_STATUS.partial_exit);
  });

  it('all events deleted → reverts to outstanding', () => {
    expect(progressDealStatus({ events: [] })).toBe(VENTURE_DEAL_STATUS.outstanding);
  });

  it('writedown wins over exit when both present (most pessimistic)', () => {
    expect(
      progressDealStatus({
        events: [
          { type: VENTURE_EVENT_TYPE.exit, navAfter: '0' },
          { type: VENTURE_EVENT_TYPE.writedown, navAfter: '0' },
        ],
      }),
    ).toBe(VENTURE_DEAL_STATUS.written_off);
  });

  it('navAfter near-zero (floating-point drift) counts as zero', () => {
    expect(
      progressDealStatus({
        events: [{ type: VENTURE_EVENT_TYPE.exit, navAfter: '0.00000000001' }],
      }),
    ).toBe(VENTURE_DEAL_STATUS.fully_exited);
  });

  it('capital_call + fee_payment do not progress status (not exit events)', () => {
    expect(
      progressDealStatus({
        events: [
          { type: VENTURE_EVENT_TYPE.initial_investment, navAfter: null },
          { type: VENTURE_EVENT_TYPE.capital_call, navAfter: null },
          { type: VENTURE_EVENT_TYPE.fee_payment, navAfter: null },
        ],
      }),
    ).toBe(VENTURE_DEAL_STATUS.outstanding);
  });
});
