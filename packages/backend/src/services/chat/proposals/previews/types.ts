import type { ChatCardWarning, ChatProposalPreview, ChatProposalSnapshot } from '@bt/shared/types';

import type { ResolvedToolPolicy } from '../../policies/rules';

/** What a preview resolver computed: the card's preview and the part of the snapshot it owns. */
export interface PreviewResolution {
  preview: ChatProposalPreview;
  /** Merged into the snapshot next to the base currency and the parents' statuses. */
  snapshot: Partial<ChatProposalSnapshot>;
  /** Rows the call affects; decides the typed confirmation of a red card. */
  affectedCount?: number;
  warnings?: ChatCardWarning[];
}

/**
 * Computes what a call will do, reading only: no handler runs and nothing is written. `args` are the
 * proposal's arguments with `$proposal:` refs still in place.
 */
export type PreviewResolver = (params: {
  userId: number;
  toolName: string;
  args: Record<string, unknown>;
  policy: ResolvedToolPolicy;
  /**
   * Hold the rows the card targets `FOR UPDATE`, so nothing changes them between this read and the
   * write that follows in the same transaction. Set by the approval, never by a proposal or an edit.
   */
  lock?: boolean;
}) => Promise<PreviewResolution>;
