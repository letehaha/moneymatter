import { ACCOUNT_STATUSES, ACCOUNT_TYPES, DEDICATED_FLOW_ACCOUNT_CATEGORIES } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { Op } from 'sequelize';

const onlyOne = <T>({ items }: { items: T[] }): T | undefined => (items.length === 1 ? items[0] : undefined);

// Enable Banking is an aggregator, so only its connection names the bank; every other type is the bank's own brand.
const bankLabel = ({
  account,
}: {
  account: Accounts & { bankDataProviderConnection?: BankDataProviderConnections };
}) => {
  if (account.type === ACCOUNT_TYPES.system) return 'manual';
  if (account.type === ACCOUNT_TYPES.enableBanking)
    return account.bankDataProviderConnection?.providerName ?? account.type;
  return account.type;
};

/**
 * The accounts the user owns that a card message can be filed to, and a resolver that names one
 * only when it is the single fit: the client creates a transaction on whatever is suggested.
 */
export async function loadAccountMatcher({ userId }: { userId: number }) {
  const accounts = await Accounts.findAll({
    where: {
      userId,
      status: ACCOUNT_STATUSES.active,
      accountCategory: { [Op.notIn]: DEDICATED_FLOW_ACCOUNT_CATEGORIES },
    },
    attributes: ['id', 'name', 'currencyCode', 'type', 'externalData'],
    include: [{ model: BankDataProviderConnections, as: 'bankDataProviderConnection', attributes: ['providerName'] }],
  });

  const entries = accounts.map((account) => {
    // ponytail: only Monobank stores card numbers. Read other providers' fields here once they keep them.
    const maskedPans = account.externalData?.maskedPan;

    return {
      id: account.id,
      name: account.name,
      text: `${account.name} (${account.currencyCode}, ${bankLabel({ account })})`,
      cardTails: Array.isArray(maskedPans) ? maskedPans.map((pan) => String(pan).slice(-4)) : [],
    };
  });

  return {
    knownAccountNames: entries.map((entry) => entry.text),
    resolveAccount: ({
      accountName,
      cardHint,
      text,
    }: {
      accountName: string | null;
      cardHint: string | null;
      text: string;
    }) => {
      const lastDigits = cardHint?.match(/\d{4}/g)?.at(-1);
      const cardDigits = lastDigits && text.includes(lastDigits) ? lastDigits : null;
      const wanted = accountName?.trim().toLowerCase();

      const cardMatches = cardDigits ? entries.filter((entry) => entry.cardTails.includes(cardDigits)) : [];
      const byCard = onlyOne({ items: cardMatches });
      // Card digits the message states rule out an account known to hold other cards, whatever the model named.
      const candidates = cardMatches.length
        ? cardMatches
        : entries.filter((entry) => !cardDigits || !entry.cardTails.length);
      // The model is asked for the whole entry, and a bare account name is the usual way it falls short of that.
      const byModel = wanted
        ? (onlyOne({ items: candidates.filter((entry) => entry.text.toLowerCase() === wanted) }) ??
          onlyOne({ items: candidates.filter((entry) => entry.name.trim().toLowerCase() === wanted) }))
        : undefined;

      return {
        suggestedAccountId: (byCard ?? byModel)?.id ?? null,
        resolvedBy: byCard ? 'card' : byModel ? 'model' : 'none',
        cardDigits,
      };
    },
  };
}
