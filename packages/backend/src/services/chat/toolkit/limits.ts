import {
  CHAT_MAX_ANALYSES,
  CHAT_MAX_PROPOSALS,
  CHAT_MAX_THIRD_PARTY_READS,
  CHAT_MAX_TOOL_CALLS,
} from '@bt/shared/types';

export type ChatLimitKind = 'toolCalls' | 'proposals' | 'thirdPartyReads' | 'analyses';

export type ChatLimitTake = { ok: true } | { ok: false; limit: number; message: string; noticeKey: string };

export interface ChatRunLimits {
  /** Counts one use of `kind` when the cap allows it, and refuses without counting otherwise. */
  take: (params: { kind: ChatLimitKind }) => ChatLimitTake;
}

const CAPS: Record<ChatLimitKind, { limit: number; noticeKey: string; message: string }> = {
  toolCalls: {
    limit: CHAT_MAX_TOOL_CALLS,
    noticeKey: 'chat.notices.toolCallLimit',
    message: `This message reached its limit of ${CHAT_MAX_TOOL_CALLS} tool calls. Do not call more tools; finish your turn with what you have.`,
  },
  proposals: {
    limit: CHAT_MAX_PROPOSALS,
    noticeKey: 'chat.notices.proposalLimit',
    message: `This message reached its limit of ${CHAT_MAX_PROPOSALS} proposed changes. Do not propose more; finish your turn.`,
  },
  thirdPartyReads: {
    limit: CHAT_MAX_THIRD_PARTY_READS,
    noticeKey: 'chat.notices.thirdPartyReadLimit',
    message: `This message reached its limit of ${CHAT_MAX_THIRD_PARTY_READS} lookups in third-party services. Work with what you have.`,
  },
  analyses: {
    limit: CHAT_MAX_ANALYSES,
    noticeKey: 'chat.notices.analysisLimit',
    message: `This message reached its limit of ${CHAT_MAX_ANALYSES} analyses. Answer with the results you have.`,
  },
};

/** The per-message counters of one run. Both runners share them, because the toolkit owns them. */
export function createRunLimits(): ChatRunLimits {
  const used: Record<ChatLimitKind, number> = { toolCalls: 0, proposals: 0, thirdPartyReads: 0, analyses: 0 };

  return {
    take: ({ kind }) => {
      const { limit, noticeKey, message } = CAPS[kind];
      if (used[kind] >= limit) return { ok: false, limit, message, noticeKey };

      used[kind]++;
      return { ok: true };
    },
  };
}
