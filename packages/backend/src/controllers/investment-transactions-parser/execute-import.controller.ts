import { ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { UnexpectedError } from '@js/errors';
import { executeInvestmentImport } from '@services/import-export/investment-transactions-parser';
import { z } from 'zod';

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number string');

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

const resolvedSecuritySchema = z
  .object({
    securityId: recordId().nullable(),
    providerSymbol: z.string().min(1),
    symbol: z.string().min(1),
    name: z.string().min(1),
    assetClass: z.enum(ASSET_CLASS),
    providerName: z.enum(SECURITY_PROVIDER),
    currencyCode: z.string().min(1),
    exchangeName: z.string().optional(),
    cryptoCurrencyCode: z.string().optional(),
    alreadyInDb: z.boolean(),
  })
  .nullable();

const transactionSchema = z.object({
  tempId: z.string().min(1),
  date: dateString,
  side: z.enum(['buy', 'sell', 'dividend']),
  quantity: decimalString,
  price: decimalString,
  fees: decimalString,
  amount: decimalString,
  possibleDuplicateOf: z.string().nullable(),
});

const holdingSchema = z.object({
  tempId: z.string().min(1),
  parsedSymbol: z.string().min(1),
  parsedName: z.string().nullable(),
  resolvedSecurity: resolvedSecuritySchema,
  resolvedConfidence: z.enum(['auto', 'ambiguous', 'unmapped']),
  portfolioId: recordId(),
  currencyCode: z.string().min(1).nullable(),
  hasExistingHolding: z.boolean(),
  transactions: z.array(transactionSchema).min(1),
});

/**
 * Persist a reviewed batch of parsed investment transactions.
 * The request body is the same shape the extract endpoint returned, with the
 * user's edits (and any deletions) applied. Server re-validates every row.
 * Each holding carries its own asset class via `resolvedSecurity.assetClass`,
 * so mixed batches (stocks + crypto in the same import) are allowed.
 */
export const executeImportController = createController(
  z.object({
    body: z.object({
      holdings: z.array(holdingSchema).min(1),
      skipTempIds: z.array(z.string().min(1)),
    }),
  }),
  async ({ user, body }) => {
    const { holdings, skipTempIds } = body;

    // Server-side defense in depth: refuse to commit if any holding is invalid.
    // The UI already blocks this case, but the API contract still has to enforce it.
    for (const holding of holdings) {
      if (!holding.resolvedSecurity) {
        throw new UnexpectedError({
          message: `Holding "${holding.parsedSymbol}" has no resolved security.`,
        });
      }
      if (!holding.currencyCode) {
        throw new UnexpectedError({
          message: `Holding "${holding.parsedSymbol}" has no currency selected.`,
        });
      }
    }

    // Also defend against the user picking the same security twice — the UI
    // blocks this but the API has to as well, otherwise we'd silently create
    // two transactions against the same merged holding from "different" rows.
    const seenSecurities = new Set<string>();
    for (const holding of holdings) {
      const key = holding.resolvedSecurity!.securityId ?? holding.resolvedSecurity!.providerSymbol;
      if (seenSecurities.has(key)) {
        throw new UnexpectedError({
          message: `Security "${holding.resolvedSecurity!.symbol}" is selected on more than one holding row.`,
        });
      }
      seenSecurities.add(key);
    }

    const result = await executeInvestmentImport({
      userId: user.id,
      holdings,
      skipTempIds,
    });

    return { data: result };
  },
);
