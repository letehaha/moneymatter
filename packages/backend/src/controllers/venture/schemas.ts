import {
  VENTURE_CASH_FLOW_MODE,
  VENTURE_DEAL_STATUS,
  VENTURE_SPV_SUBTYPE,
  VENTURE_VEHICLE_TYPE,
} from '@bt/shared/types/venture';
import { dateString, decimalString, isoCurrencyCode, percentageFraction, recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/** Fields of `POST /venture/deals`; the MCP `create_venture_deal` tool reads its shape. */
export const createVentureDealBodyShape = {
  name: z.string().trim().min(1).max(255),
  currencyCode: isoCurrencyCode(),
  principal: decimalString(),
  investmentDate: dateString(),
  platformId: recordId().nullable().optional(),
  vehicleType: z.nativeEnum(VENTURE_VEHICLE_TYPE).optional(),
  spvSubtype: z.nativeEnum(VENTURE_SPV_SUBTYPE).nullable().optional(),
  targetCompany: z.string().max(255).nullable().optional(),
  entryFeePct: percentageFraction().optional(),
  entryFee: decimalString().optional(),
  mgmtFeePct: percentageFraction().optional(),
  carryPct: percentageFraction().optional(),
  hurdlePct: percentageFraction().optional(),
  expectedExitDate: dateString().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  initialInvestment: z
    .object({
      cashFlowMode: z.nativeEnum(VENTURE_CASH_FLOW_MODE),
      transactionIds: z.array(recordId()).optional(),
    })
    .optional(),
};

/** Fields of `PATCH /venture/deals/:id`; the MCP `update_venture_deal` tool reads its shape. */
export const updateVentureDealBodyShape = {
  name: z.string().trim().min(1).max(255).optional(),
  platformId: recordId().nullable().optional(),
  spvSubtype: z.nativeEnum(VENTURE_SPV_SUBTYPE).nullable().optional(),
  targetCompany: z.string().max(255).nullable().optional(),
  currencyCode: isoCurrencyCode().optional(),
  status: z.nativeEnum(VENTURE_DEAL_STATUS).optional(),
  principal: decimalString().optional(),
  entryFee: decimalString().optional(),
  entryFeePct: percentageFraction().optional(),
  mgmtFeePct: percentageFraction().optional(),
  carryPct: percentageFraction().optional(),
  hurdlePct: percentageFraction().optional(),
  investmentDate: dateString().optional(),
  expectedExitDate: dateString().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
};

export const updateVentureDealBodySchema = z
  .object(updateVentureDealBodyShape)
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

/** Fields of `POST /venture/platforms`; the MCP `create_venture_platform` tool reads its shape. */
export const createVenturePlatformBodyShape = {
  name: z.string().trim().min(1).max(255),
  website: z.string().url().max(2000).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  defaultEntryFeePct: percentageFraction().optional(),
  defaultMgmtFeePct: percentageFraction().optional(),
  defaultCarryPct: percentageFraction().optional(),
  defaultHurdlePct: percentageFraction().optional(),
};

/** Fields of `PATCH /venture/platforms/:id`; the MCP `update_venture_platform` tool reads its shape. */
export const updateVenturePlatformBodyShape = {
  name: z.string().trim().min(1).max(255).optional(),
  website: z.string().url().max(2000).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  defaultEntryFeePct: percentageFraction().optional(),
  defaultMgmtFeePct: percentageFraction().optional(),
  defaultCarryPct: percentageFraction().optional(),
  defaultHurdlePct: percentageFraction().optional(),
};

export const updateVenturePlatformBodySchema = z
  .object(updateVenturePlatformBodyShape)
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });
