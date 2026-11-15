import type { ChatCardDependency, ChatCardField, ChatEntityKind } from '@bt/shared/types';
import { useI18n } from 'vue-i18n';

import { useChatText } from '../chat-text';
import { chatEntityRoute } from '../entity-route';
import { formatVisualDate, formatVisualValue } from '../visuals/format-visual-value';
import { fieldEntityKind, proposalRefId, summarizeValue } from './card-values';
import { describeMatchingRules } from './matching-rules';
import type { CardLookups } from './use-card-lookups';

interface CardValuePart {
  text: string;
  to?: ReturnType<typeof chatEntityRoute>;
  /** The record this part names, for its logo; only a record the app holds is given. */
  entity?: { kind: ChatEntityKind; id: string };
  /** What goes quietly beside the name: an account's currency. */
  note?: string;
}

const LOOKS_LIKE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kinds the app names from lists it holds: an id among them that has no name there points at nothing. */
const NAMED_FROM_APP_LISTS: ReadonlySet<ChatEntityKind> = new Set([
  'account',
  'category',
  'tag',
  'payee',
  'userCurrency',
]);

/** A list of records longer than this shows its first ones and the count of the rest. */
const NAMED_RECORDS_LIMIT = 5;

const formatAmount = ({ value, currencyCode }: { value: number; currencyCode: string | null }) =>
  formatVisualValue({ value, kind: currencyCode ? 'money' : 'number', currencyCode: currencyCode ?? undefined });

interface ValueContext {
  /** The field as the value is read: the old value of a moved amount reads in the currency it was stored in. */
  field: ChatCardField;
  lookups: CardLookups;
  /** The currency of a money field; `null` when the card does not say. */
  currencyCode: string | null;
  /** The cards the card depends on, to name a `$proposal:` ref. */
  dependsOn: ChatCardDependency[];
}

/**
 * How a card shows the value of one of its fields, as the parts of its text, a named record linking to it. The field
 * row and the one-line summary of a folded card read values the same way.
 */
export const useCardFieldText = () => {
  const { t } = useI18n();
  const { entityLabel, titleText, enumValueText } = useChatText();

  const entityParts = ({
    field,
    lookups,
    dependsOn,
    value,
    current,
  }: ValueContext & { value: unknown; current: boolean }): CardValuePart[] => {
    const kind = fieldEntityKind({ field });
    const ids = Array.isArray(value) ? value : [value];
    const hidden = Math.max(0, ids.length - NAMED_RECORDS_LIMIT);

    const parts = ids.slice(0, NAMED_RECORDS_LIMIT).map((id): CardValuePart => {
      const ref = proposalRefId({ value: id });
      if (ref) {
        const parent = dependsOn.find((dependency) => dependency.id === ref);
        return { text: t('chat.cards.fromCard', { title: parent ? titleText({ title: parent.title }) : '…' }) };
      }
      if (!kind) return { text: summarizeValue({ value: id }) };

      const name = lookups.entityName({ kind, id: String(id) });
      // A model may offer an alternative by its name; that name reads better than the kind of record.
      const written = typeof id === 'string' && !LOOKS_LIKE_ID.test(id) ? id : null;
      const to = chatEntityRoute({ entity: { kind, id: String(id) } });
      // The kind's own name stands in for a record only where the server names it; an id the app's lists do not know is no record.
      const unknown = current && !name && !written && NAMED_FROM_APP_LISTS.has(kind) && LOOKS_LIKE_ID.test(String(id));
      if (unknown) return { text: t('chat.cards.noValue') };

      const hasLogo = name !== null && (kind === 'payee' || kind === 'account' || kind === 'category');
      const currency = kind === 'account' && name !== null ? lookups.accountCurrency({ id: String(id) }) : null;

      return {
        text: name ?? written ?? entityLabel({ kind }),
        ...(to && !(written && !name) ? { to } : {}),
        ...(hasLogo ? { entity: { kind, id: String(id) } } : {}),
        ...(currency ? { note: currency } : {}),
      };
    });

    return hidden > 0 ? [...parts, { text: t('chat.cards.affected.more', { count: hidden }) }] : parts;
  };

  /**
   * The parts of a payment paid from several accounts, one per leg: a new part names its account and its amount in
   * that account's currency (with its value in the transaction's currency when the model gave one); a linked
   * transaction is named as the server or the kind names it, since its own amount stays.
   */
  const paymentLegParts = ({
    lookups,
    currencyCode,
    legs,
  }: Pick<ValueContext, 'lookups' | 'currencyCode'> & { legs: unknown[] }): CardValuePart[] =>
    legs.flatMap((leg): CardValuePart[] => {
      const { accountId, transactionId, amount, paymentAmount } = (leg ?? {}) as {
        accountId?: unknown;
        transactionId?: unknown;
        amount?: unknown;
        paymentAmount?: unknown;
      };

      if (typeof transactionId === 'string') {
        const name =
          lookups.entityName({ kind: 'transaction', id: transactionId }) ?? entityLabel({ kind: 'transaction' });
        const to = chatEntityRoute({ entity: { kind: 'transaction', id: transactionId } });
        return [{ text: t('chat.cards.paymentLegs.linked', { name }), ...(to ? { to } : {}) }];
      }
      if (typeof accountId !== 'string' || typeof amount !== 'number') {
        return [{ text: summarizeValue({ value: leg }) }];
      }

      const name = lookups.entityName({ kind: 'account', id: accountId }) ?? entityLabel({ kind: 'account' });
      const legAmount = formatAmount({ value: amount, currencyCode: lookups.accountCurrency({ id: accountId }) });
      const to = chatEntityRoute({ entity: { kind: 'account', id: accountId } });
      const text =
        typeof paymentAmount === 'number'
          ? t('chat.cards.paymentLegs.accountConverted', {
              name,
              amount: legAmount,
              paymentAmount: formatAmount({ value: paymentAmount, currencyCode }),
            })
          : t('chat.cards.paymentLegs.account', { name, amount: legAmount });

      return [{ text, ...(to ? { to } : {}) }];
    });

  /** `current` is the value the card holds now; an alternative on offer is named by its kind when nothing names it. */
  const valueParts = ({
    value,
    current = false,
    ...context
  }: ValueContext & { value: unknown; current?: boolean }): CardValuePart[] => {
    const { field, lookups, currencyCode } = context;
    const displayKind = field.display?.kind ?? 'text';

    if (value === null || value === undefined || value === '') return [{ text: t('chat.cards.noValue') }];

    if (displayKind === 'entity') return entityParts({ ...context, value, current });
    if (displayKind === 'boolean' && typeof value === 'boolean') {
      return [{ text: t(value ? 'chat.cards.yes' : 'chat.cards.no') }];
    }
    if (displayKind === 'money' && typeof value === 'number') {
      return [{ text: formatAmount({ value, currencyCode: field.display?.currencyCode ?? currencyCode }) }];
    }
    if (displayKind === 'enum' && typeof value === 'string') {
      return [{ text: enumValueText({ path: field.path, value }) }];
    }
    if (displayKind === 'enum' && Array.isArray(value)) {
      return [{ text: value.map((item) => enumValueText({ path: field.path, value: String(item) })).join(', ') }];
    }
    if (displayKind === 'matchingRules') {
      return [{ text: describeMatchingRules({ value, t, entityName: lookups.entityName, enumValue: enumValueText }) }];
    }
    if (displayKind === 'goalAccounts' && Array.isArray(value)) {
      // Each linked account by name beside its share, as the goal holds it.
      return value.flatMap((item): CardValuePart[] => {
        const { accountId, sharePercent, fixedAmount } = (item ?? {}) as {
          accountId?: unknown;
          sharePercent?: unknown;
          fixedAmount?: unknown;
        };
        if (typeof accountId !== 'string') return [];
        const text =
          typeof sharePercent === 'number'
            ? 'chat.cards.goal.account'
            : typeof fixedAmount === 'number'
              ? 'chat.cards.goal.accountFixed'
              : null;
        if (!text) return [];

        const name = lookups.entityName({ kind: 'account', id: accountId }) ?? entityLabel({ kind: 'account' });
        const to = chatEntityRoute({ entity: { kind: 'account', id: accountId } });
        return [{ text: t(text, { name, percent: sharePercent, amount: fixedAmount }), ...(to ? { to } : {}) }];
      });
    }
    if (field.path === 'paymentLegs' && Array.isArray(value)) {
      return value.length > 0
        ? paymentLegParts({ lookups, currencyCode, legs: value })
        : [{ text: t('chat.cards.noValue') }];
    }
    if ((displayKind === 'date' || displayKind === 'datetime') && typeof value === 'string') {
      return [{ text: formatVisualDate({ value }) }];
    }

    return [{ text: summarizeValue({ value }) }];
  };

  return { valueParts };
};
