import type { ChatSource } from '@bt/shared/types';
import { randomUUID } from 'crypto';

import type { ToolCatalogEntry } from '../../mcp/tool-catalog';
import { resolveToolPolicy } from '../policies';
import { createProposal } from '../proposals/create-proposal';
import { assertKnownRecords } from '../proposals/known-records';
import { assertCardUsesPickedRecords } from '../proposals/picked-records';
import { proposalRef, ToolInputError } from '../proposals/placeholders';
import { assertSubscriptionAmountHasCurrency } from '../proposals/subscription-amount';
import { assertNoTwinLegUpdate } from '../proposals/twin-leg-update';
import { parseWriteInput } from './model-schema';
import { errorMessage, toolFailure, toolSuccess } from './result-text';
import { reviseOfPendingCreate } from './revise-pending-create';
import type { ChatToolContext, ChatToolResult } from './types';

/** The reads of the run the card rests on, the message's attachments and the page the panel was opened on. */
function sourcesFor({ ctx, sourceCallIds }: { ctx: ChatToolContext; sourceCallIds?: string[] }): ChatSource[] {
  const reads = sourceCallIds
    ? ctx.state.sources.filter(
        (source) =>
          (source.type === 'toolCall' && sourceCallIds.includes(source.callId)) ||
          (source.type === 'analysis' && sourceCallIds.includes(source.partId)),
      )
    : ctx.state.sources;

  return [
    ...reads,
    ...ctx.run.attachments.map(({ id, fileName }): ChatSource => ({ type: 'attachment', attachmentId: id, fileName })),
    ...(ctx.run.pageContext ? [{ type: 'pageContext' as const, context: ctx.run.pageContext }] : []),
  ];
}

/**
 * A write tool never runs its handler in the chat: the call becomes a card. The input is checked
 * against the tool's real schema and `validateArgs` first (with `$proposal:` refs standing in for
 * ids that do not exist yet), so a card that would fail on its arguments is never shown as
 * approvable: the model gets the reason as a tool error and can fix the call in the same run.
 */
export async function proposeToolCall({
  ctx,
  entry: called,
  input: calledInput,
}: {
  ctx: ChatToolContext;
  entry: ToolCatalogEntry;
  input: unknown;
}): Promise<ChatToolResult> {
  try {
    // An edit of a card that is still pending revises that card; it never becomes an update of a record that does not exist.
    const revised = await reviseOfPendingCreate({
      userId: ctx.run.user.id,
      threadId: ctx.run.threadId,
      entry: called,
      catalog: ctx.catalog,
      input: calledInput,
    });
    const entry = revised?.entry ?? called;
    const { args, meta, refs } = parseWriteInput({ entry, input: revised?.input ?? calledInput });

    const policy = resolveToolPolicy({ name: entry.name, args });
    if (!policy) throw new ToolInputError(`${entry.name} is not available in the chat`);

    await assertKnownRecords({ userId: ctx.run.user.id, policy, args });
    // The card must use the record the user tapped when the model asked which one.
    assertCardUsesPickedRecords({
      picked: ctx.run.pickedRecords ?? [],
      entityFields: policy.entityFields,
      args,
    });
    // One edit of a transfer leg changes both legs, so the same edit for the other leg is not a second card.
    if (entry.name === 'update_transaction') {
      await assertNoTwinLegUpdate({ userId: ctx.run.user.id, threadId: ctx.run.threadId, args });
    }
    // An amount without its currency (or the reverse) fails at approval, so the model passes the other half now.
    if (entry.name === 'update_subscription') {
      await assertSubscriptionAmountHasCurrency({ userId: ctx.run.user.id, args });
    }

    const taken = ctx.state.limits.take({ kind: 'proposals' });
    if (!taken.ok) {
      await ctx.notice({ key: taken.noticeKey, params: { limit: taken.limit } });
      return toolFailure({ text: taken.message });
    }

    const { card, replacedCard } = await createProposal({
      run: ctx.run,
      policy,
      args,
      meta,
      refs,
      sources: sourcesFor({ ctx, sourceCallIds: meta.sourceCallIds }),
    });

    await ctx.run.emit({ type: 'part.started', part: { type: 'proposal', id: randomUUID(), proposalId: card.id } });
    await ctx.run.emit({ type: 'proposal.upserted', card });
    if (replacedCard) await ctx.run.emit({ type: 'proposal.upserted', card: replacedCard });
    await ctx.run.textPolicy.cardCreated();

    // A card the user cannot approve still shows, so the model has to say so and may correct the call.
    const cannotApprove = card.canApply.ok
      ? null
      : (card.error?.message ??
        card.warnings.find((warning) => warning.blocksApproval)?.key ??
        card.canApply.reasonKey);

    return toolSuccess({
      text: JSON.stringify({
        proposalId: card.id,
        ref: proposalRef({ id: card.id }),
        status: 'proposed',
        ...(cannotApprove ? { cannotApprove } : {}),
      }),
    });
  } catch (error) {
    if (error instanceof ToolInputError) return toolFailure({ text: error.message });
    return toolFailure({ text: errorMessage({ error }) });
  }
}
