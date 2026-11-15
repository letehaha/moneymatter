import {
  CHAT_FIELD_LABEL_KEYS,
  chatCardTitleKey,
  type ChatCardTitle,
  type ChatProposalCard,
  type ChatCardWarning,
} from '@bt/shared/types';
import type ChatProposals from '@models/chat-proposals.model';

import { findToolCatalogEntry } from '../../mcp/tool-catalog';
import { resolveToolPolicy } from '../policies';
import { isSafeForApproveAll } from '../policies/safe-cards';
import { getModelSchema } from '../toolkit/model-schema';
import { describeField } from './card-fields';
import { buildCardTarget, moneyCurrenciesOf } from './card-target';

/** The columns a card is built from; a Sequelize row and a plain object both fit. */
type ChatProposalRow = Pick<
  ChatProposals,
  | 'id'
  | 'status'
  | 'statusReason'
  | 'revision'
  | 'toolName'
  | 'cardKind'
  | 'entity'
  | 'danger'
  | 'confirmation'
  | 'confirmationPhrase'
  | 'args'
  | 'editedFields'
  | 'preview'
  | 'uncertainFields'
  | 'sources'
  | 'dependsOn'
  | 'executedArgs'
  | 'result'
  | 'error'
  | 'createdAt'
  | 'expiresAt'
  | 'appliedAt'
> &
  Partial<Pick<ChatProposals, 'snapshot'>>;

/** Arguments and stored rows are JSON, so equal values serialize alike. */
const isSameValue = ({ a, b }: { a: unknown; b: unknown }) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The alternatives a tap can write into a field: the model sometimes lists prose for a numeric argument, so only
 * those of the value's type are offered. An empty field has no value to compare against and keeps them all.
 */
const replacementsFor = ({ value, alternatives }: { value: unknown; alternatives: unknown[] | undefined }) =>
  value === null || value === undefined
    ? alternatives
    : alternatives?.filter((alternative) => typeof alternative === typeof value);

/** The arguments that put an amount in a currency of their choosing, over the one its record stores. */
const currencyArgsOf = ({ path }: { path: string }) =>
  path === 'destinationAmount' ? ['destinationAccountId'] : ['accountId', 'currencyCode'];

/**
 * The currency to show a money argument in when the card's arguments do not decide it: the one the preview read.
 * The display wins over what the frontend works out from the arguments, so it is left out when they state one.
 */
const readCurrencyOf = ({
  path,
  args,
  before,
}: {
  path: string;
  args: Record<string, unknown>;
  before: Record<string, unknown> | null;
}): string | null =>
  currencyArgsOf({ path }).some((arg) => args[arg] !== null && args[arg] !== undefined && args[arg] !== '')
    ? null
    : (moneyCurrenciesOf({ before })[path] ?? null);

/** The related counts that are not zero, or `undefined` when none is: a card lists what is there, not what is not. */
const nonZeroCountsOf = ({ counts }: { counts: Record<string, number> | undefined }) => {
  const entries = Object.entries(counts ?? {}).filter(([, count]) => count > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const titleOf = ({ row }: { row: Pick<ChatProposalRow, 'cardKind' | 'entity'> }): ChatCardTitle => ({
  key: chatCardTitleKey({ kind: row.cardKind }),
  params: { entity: row.entity },
});

/** A warning of the preview says the service would refuse this call, so approving it could only fail. */
export const previewBlocksApproval = ({ preview }: { preview: ChatProposalRow['preview'] }): boolean =>
  (preview?.warnings ?? []).some((warning) => warning.blocksApproval);

/**
 * Whether a card can be approved now, from what is stored: a pending card whose policy declares a
 * preview needs that preview (a card without one is waiting for its resolver, or its resolver
 * failed), so a red card is never approvable on its arguments alone.
 */
function canApplyOf({
  row,
  needsPreview,
}: {
  row: ChatProposalRow;
  needsPreview: boolean;
}): ChatProposalCard['canApply'] {
  if (row.status !== 'pending') return { ok: false, reasonKey: 'chat.cards.notPending' };
  if (needsPreview && row.preview === null) {
    return { ok: false, reasonKey: row.error ? 'chat.cards.previewFailed' : 'chat.cards.previewPending' };
  }
  if (previewBlocksApproval({ preview: row.preview })) return { ok: false, reasonKey: 'chat.cards.refusedByWarning' };
  return { ok: true };
}

/**
 * The card the API and the run stream return for a proposal row. Text on it is never the model's:
 * the title is a key, the labels are keys, the values are the validated arguments. `parents` are the
 * cards the row depends on (a parent that no longer exists is left out).
 */
export function toChatProposalCard({
  row,
  parents,
}: {
  row: ChatProposalRow;
  parents: ChatProposalRow[];
}): ChatProposalCard {
  const policy = resolveToolPolicy({ name: row.toolName, args: row.args });
  const entry = findToolCatalogEntry({ name: row.toolName });
  const properties = (entry ? getModelSchema({ entry }).properties : undefined) as Record<string, unknown> | undefined;
  const uncertain = new Map((row.uncertainFields ?? []).map((field) => [field.field, field]));

  const rowBefore = row.preview?.before ?? null;

  const fields = Object.entries(row.args).map(([path, value]) => {
    const unsure = uncertain.get(path);
    const described = describeField({
      key: path,
      value,
      node: properties?.[path],
      entityKind: policy?.entityFields[path],
    });
    const currencyCode =
      described.display?.kind === 'money' ? readCurrencyOf({ path, args: row.args, before: rowBefore }) : null;

    return {
      path,
      labelKey: CHAT_FIELD_LABEL_KEYS[path] ?? `chat.fields.${path}`,
      value,
      ...described,
      ...(described.display && currencyCode ? { display: { ...described.display, currencyCode } } : {}),
      ...(policy?.targetFields.includes(path) ? { namesRecord: true as const } : {}),
      ...(rowBefore && path in rowBefore && !isSameValue({ a: rowBefore[path], b: value })
        ? { before: rowBefore[path] }
        : {}),
      ...(unsure
        ? {
            uncertain: {
              reason: unsure.reason,
              alternatives: replacementsFor({ value, alternatives: unsure.alternatives }),
            },
          }
        : {}),
    };
  });

  const target = row.cardKind === 'update' || row.cardKind === 'delete' ? buildCardTarget({ before: rowBefore }) : [];

  const warnings: ChatCardWarning[] = [
    ...(policy?.egress ? [{ key: 'chat.warnings.egress', params: { host: policy.egress.host } }] : []),
    ...(row.preview?.warnings ?? []),
  ];

  const nonZeroCounts = nonZeroCountsOf({ counts: row.preview?.counts });

  const card: ChatProposalCard = {
    id: row.id,
    status: row.status,
    revision: row.revision,
    toolName: row.toolName,
    kind: row.cardKind,
    entity: row.entity,
    danger: row.danger,
    confirmation: {
      mode: row.confirmation,
      ...(row.confirmationPhrase != null ? { phrase: row.confirmationPhrase } : {}),
    },
    title: titleOf({ row }),
    fields,
    ...(target.length > 0 ? { target } : {}),
    ...(row.preview?.affected ? { affected: row.preview.affected } : {}),
    ...(nonZeroCounts ? { counts: nonZeroCounts } : {}),
    ...(row.preview?.goalProgress ? { goalProgress: row.preview.goalProgress } : {}),
    ...(row.preview?.labels ? { labels: row.preview.labels } : {}),
    dependsOn: row.dependsOn.flatMap((id) => {
      const parent = parents.find((candidate) => candidate.id === id);
      return parent ? [{ id, title: titleOf({ row: parent }), status: parent.status, revision: parent.revision }] : [];
    }),
    ...(policy?.egress ? { egress: policy.egress } : {}),
    safe: false,
    warnings,
    sources: row.sources ?? [],
    canApply: canApplyOf({ row, needsPreview: policy !== null && policy.previewResolver !== null }),
    ...(row.status === 'stale'
      ? {
          stale: {
            reasonKey: row.statusReason ?? 'chat.cards.stale',
            ...row.snapshot?.staleDiff,
          },
        }
      : {}),
    ...(row.result && row.appliedAt
      ? {
          result: {
            refs: row.result.refs,
            executedArgs: row.executedArgs,
            appliedAt: row.appliedAt.toISOString(),
            ...(row.result.alsoApplied && row.result.alsoApplied.length > 0
              ? { alsoApplied: row.result.alsoApplied }
              : {}),
          },
        }
      : {}),
    ...(row.error ? { error: row.error } : {}),
    editedByUser: row.editedFields.length > 0,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };

  // A parent that has parents of its own is not looked through here: its chain is only known to the
  // approve-all pass over the whole message, so such a card is not offered as safe on its own.
  const chainKnown = parents.every((parent) => parent.dependsOn.length === 0);
  const parentCards = parents.map((parent) => toChatProposalCard({ row: parent, parents: [] }));
  card.safe = chainKnown && isSafeForApproveAll({ card, cards: parentCards });

  return card;
}
