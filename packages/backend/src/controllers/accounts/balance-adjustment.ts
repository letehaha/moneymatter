import { decimalMoney, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransaction } from '@root/serializers';
import { serializeAccount } from '@root/serializers/accounts.serializer';
import { getAccountById } from '@services/accounts.service';
import { adjustAccountBalance } from '@services/accounts/balance-adjustment';
import { attachAccountCurrencyMeta } from '@services/currencies/effective-currency';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
    body: z.object({
      targetBalance: decimalMoney(),
      note: z.string().optional(),
      // ISO date string ("2025-04-12" or full ISO). Effective date the user
      // wants the adjustment recorded against — defaults to "now" server-side.
      time: z.coerce.date().optional(),
    }),
  }),
  async ({ user, params, body }) => {
    const { id: accountId } = params;
    const { id: userId } = user;
    const { targetBalance, note, time } = body;

    const result = await adjustAccountBalance({
      userId,
      accountId,
      targetBalance,
      note,
      time,
    });

    const account = await getAccountById({ id: accountId, userId });
    if (account) await attachAccountCurrencyMeta({ accounts: [account] });

    return {
      data: {
        transaction: result.transaction ? serializeTransaction(result.transaction) : null,
        previousBalance: result.previousBalance.toNumber(),
        newBalance: result.newBalance.toNumber(),
        account: account ? serializeAccount(account) : null,
      },
    };
  },
);
