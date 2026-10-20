import {
  CHAT_MAX_ANALYSES,
  CHAT_MAX_PROPOSALS,
  CHAT_MAX_THIRD_PARTY_READS,
  CHAT_MAX_TOOL_CALLS,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { type ChatLimitKind, createRunLimits } from './limits';

const CAPS: Array<[ChatLimitKind, number]> = [
  ['toolCalls', CHAT_MAX_TOOL_CALLS],
  ['proposals', CHAT_MAX_PROPOSALS],
  ['thirdPartyReads', CHAT_MAX_THIRD_PARTY_READS],
  ['analyses', CHAT_MAX_ANALYSES],
];

describe('createRunLimits', () => {
  it.each(CAPS)('lets %s through up to its cap and refuses the next one with a notice key', (kind, cap) => {
    const limits = createRunLimits();

    for (let call = 0; call < cap; call++) expect(limits.take({ kind })).toEqual({ ok: true });
    const refused = limits.take({ kind });

    expect(refused).toMatchObject({ ok: false, limit: cap });
    expect(refused.ok === false && refused.message).toContain(String(cap));
    expect(refused.ok === false && refused.noticeKey).toMatch(/^chat\.notices\./);
  });

  it('counts each kind on its own', () => {
    const limits = createRunLimits();
    for (let call = 0; call < CHAT_MAX_TOOL_CALLS; call++) limits.take({ kind: 'toolCalls' });

    expect(limits.take({ kind: 'proposals' })).toEqual({ ok: true });
  });

  it('keeps counting nothing after a refusal, so the cap stays the cap', () => {
    const limits = createRunLimits();
    for (let call = 0; call < CHAT_MAX_ANALYSES + 3; call++) limits.take({ kind: 'analyses' });

    expect(limits.take({ kind: 'analyses' })).toMatchObject({ ok: false, limit: CHAT_MAX_ANALYSES });
  });

  it('starts every run with fresh counters', () => {
    const first = createRunLimits();
    for (let call = 0; call < CHAT_MAX_TOOL_CALLS; call++) first.take({ kind: 'toolCalls' });

    expect(createRunLimits().take({ kind: 'toolCalls' })).toEqual({ ok: true });
  });
});
