import type {
  ChatCardError,
  ChatConfirmationMode,
  ChatProposalPreview,
  ChatProposalSnapshot,
  ChatProposalStatus,
} from '@bt/shared/types';

import { confirmationFor, type ResolvedToolPolicy } from '../policies/rules';
import { errorMessage } from '../toolkit/result-text';
import { resolveCardLabels } from './card-labels';
import { PREVIEW_RESOLVERS } from './previews';
import { PreviewError } from './previews/preview-helpers';
import type { PreviewResolution, PreviewResolver } from './previews/types';
import { buildSnapshot } from './snapshot';

async function runPreview({
  userId,
  toolName,
  args,
  policy,
  lock,
}: {
  userId: number;
  toolName: string;
  args: Record<string, unknown>;
  policy: ResolvedToolPolicy;
  lock?: boolean;
}): Promise<{ resolution: PreviewResolution | null; error: ChatCardError | null }> {
  const resolver = policy.previewResolver
    ? (PREVIEW_RESOLVERS as Partial<Record<string, PreviewResolver>>)[policy.previewResolver]
    : undefined;
  if (!resolver) return { resolution: null, error: null };

  try {
    return { resolution: await resolver({ userId, toolName, args, policy, ...(lock ? { lock } : {}) }), error: null };
  } catch (error) {
    if (error instanceof PreviewError) {
      return { resolution: null, error: { messageKey: error.messageKey, message: error.message } };
    }
    return { resolution: null, error: { message: errorMessage({ error }) } };
  }
}

export interface CardState {
  /** Null when the policy declares no resolver, or the resolver failed (then `error` says why). */
  preview: ChatProposalPreview | null;
  error: ChatCardError | null;
  snapshot: ChatProposalSnapshot;
  confirmation: { mode: ChatConfirmationMode; phrase?: string };
}

/**
 * What a card shows and is checked against right now: the preview from the policy's resolver (a
 * resolver that fails leaves the card without one), the snapshot the preview rests on and the
 * confirmation the call asks for. A new card, an edit, a refresh and the stale check of an approval
 * all compute it the same way. The approval passes `lock`, so the rows the preview reads stay held
 * until its transaction ends.
 */
export async function computeCardState({
  userId,
  policy,
  args,
  parents,
  lock,
}: {
  userId: number;
  policy: ResolvedToolPolicy;
  args: Record<string, unknown>;
  parents: Array<{ id: string; status: ChatProposalStatus }>;
  lock?: boolean;
}): Promise<CardState> {
  const { resolution, error } = await runPreview({ userId, toolName: policy.name, args, policy, lock });

  // A card whose resolver failed stays without a preview, so it cannot be approved; every other card
  // carries the names of the records it points at, an args-only card included.
  const labels = error ? {} : await resolveCardLabels({ userId, policy, args });
  const named = Object.keys(labels).length > 0 ? { labels } : {};

  return {
    preview: resolution
      ? { ...resolution.preview, ...(resolution.warnings ? { warnings: resolution.warnings } : {}), ...named }
      : policy.previewResolver === null && !error && named.labels
        ? { ...named }
        : null,
    error,
    snapshot: await buildSnapshot({ userId, resolved: resolution?.snapshot, parents }),
    confirmation: confirmationFor({
      danger: policy.danger,
      egress: policy.egress,
      affectedCount: resolution?.affectedCount,
    }),
  };
}
