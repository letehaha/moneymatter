import { RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { UnexpectedError } from '@js/errors';
import AccountGrouping from '@models/accounts-groups/account-grouping.model';
import AccountGroups from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import { extractRawFromTransaction } from '@services/payees/extraction.service';

export interface AutomationContext {
  userId: number;
  note: string;
  merchant: string;
  payeeId: RecordId | null;
  amountCents: number;
  currencyCode: string;
  /** `null` while a custom currency has no rate: a base-currency amount condition never matches. */
  refAmountCents: number | null;
  transactionType: TRANSACTION_TYPES;
  accountId: RecordId;
  time: Date;
  dayOfMonth: number;
  accountGroupIds: () => Promise<RecordId[]>;
  bankConnectionId: () => Promise<RecordId | null>;
}

export interface AutomationResolvers {
  accountGroupIds: (accountId: RecordId) => Promise<RecordId[]>;
  bankConnectionId: (accountId: RecordId) => Promise<RecordId | null>;
}

export interface AutomationTransactionInput {
  amount: Money;
  refAmount: Money | null;
  note: string | null;
  externalData: Record<string, unknown> | null;
  payeeId: RecordId | null;
  currencyCode: string;
  transactionType: TRANSACTION_TYPES;
  accountId: RecordId;
  time: Date;
}

/** Every group the account belongs to, plus each group's ancestors. */
export const resolveGroupAncestry = ({
  groups,
  memberships,
}: {
  groups: { id: RecordId; parentGroupId: RecordId | null }[];
  memberships: { groupId: RecordId }[];
}): RecordId[] => {
  const parentById = new Map(groups.map((group) => [group.id, group.parentGroupId]));
  const visited = new Set<RecordId>();

  for (const { groupId } of memberships) {
    let current: RecordId | null = groupId;
    while (current && !visited.has(current)) {
      visited.add(current);
      current = parentById.get(current) ?? null;
    }
  }

  return [...visited];
};

export const createLiveResolvers = ({ userId }: { userId: number }): AutomationResolvers => ({
  accountGroupIds: async (accountId) => {
    const [groups, memberships] = await Promise.all([
      AccountGroups.findAll({ where: { userId }, attributes: ['id', 'parentGroupId'] }),
      AccountGrouping.findAll({ where: { accountId }, attributes: ['groupId'] }),
    ]);
    return resolveGroupAncestry({ groups, memberships });
  },
  bankConnectionId: async (accountId) => {
    // A missing row must not read as "no connection": under `not_in` an empty value list matches.
    const account = await Accounts.findByPk(accountId, { attributes: ['bankDataProviderConnectionId'] });
    if (!account) throw new UnexpectedError({ message: `Account ${accountId} not found` });
    return account.bankDataProviderConnectionId ?? null;
  },
});

export const buildAutomationContext = ({
  transaction,
  userId,
  resolvers,
}: {
  transaction: AutomationTransactionInput;
  userId: number;
  resolvers: AutomationResolvers;
}): AutomationContext => {
  const { accountId, currencyCode, time } = transaction;
  const amountCents = transaction.amount.abs().toCents();

  let groupIds: Promise<RecordId[]> | undefined;
  let connectionId: Promise<RecordId | null> | undefined;

  return {
    userId,
    note: transaction.note ?? '',
    merchant: extractRawFromTransaction({ externalData: transaction.externalData, note: transaction.note }),
    payeeId: transaction.payeeId,
    amountCents,
    currencyCode,
    refAmountCents: transaction.refAmount?.abs().toCents() ?? null,
    transactionType: transaction.transactionType,
    accountId,
    time,
    dayOfMonth: time.getUTCDate(),
    accountGroupIds: () => (groupIds ??= resolvers.accountGroupIds(accountId)),
    bankConnectionId: () => (connectionId ??= resolvers.bankConnectionId(accountId)),
  };
};
