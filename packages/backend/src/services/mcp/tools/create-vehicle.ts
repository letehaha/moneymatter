import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createVehicle } from '@services/vehicles/create-vehicle.service';
import { createVehicleBodyFields, createVehicleBodySchema } from '@services/vehicles/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope, type ToolArgs } from './helpers';
import { presentVehicle } from './vehicle-output';

const inputSchema = {
  ...createVehicleBodyFields,
  name: createVehicleBodyFields.name.describe('Name of the vehicle account, e.g. "Toyota Camry 2020"'),
  currencyCode: createVehicleBodyFields.currencyCode.describe('ISO currency code of the vehicle (e.g. "USD")'),
  make: createVehicleBodyFields.make.describe('Manufacturer, e.g. "Toyota"'),
  model: createVehicleBodyFields.model.describe('Model, e.g. "Camry"'),
  trim: createVehicleBodyFields.trim.describe('Trim level, e.g. "XSE"; null for none'),
  year: createVehicleBodyFields.year.describe('Model year, 1900 up to next year'),
  vehicleClass: createVehicleBodyFields.vehicleClass.describe(
    'Class of the vehicle; it picks the default depreciation curve',
  ),
  purchasePrice: createVehicleBodyFields.purchasePrice.describe(
    'Price paid, a positive decimal in the vehicle currency. The depreciation starts from it',
  ),
  purchaseDate: createVehicleBodyFields.purchaseDate.describe('Date of purchase, YYYY-MM-DD'),
  depreciationPreset: createVehicleBodyFields.depreciationPreset.describe(
    'Depreciation curve. Defaults to the class default; "custom" needs customAnnualRatePct',
  ),
  customAnnualRatePct: createVehicleBodyFields.customAnnualRatePct.describe(
    'Flat yearly depreciation in percent (0-100). Required when depreciationPreset is "custom"',
  ),
  salvageFloorPct: createVehicleBodyFields.salvageFloorPct.describe(
    'Lowest value as a percent of the purchase price (0-100), default 10',
  ),
  currentMileage: createVehicleBodyFields.currentMileage.describe('Odometer reading, a whole number; null for unknown'),
};

export function validateCreateVehicleArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  return createVehicleBodySchema.parse(args);
}

export function registerCreateVehicle(server: McpServer) {
  server.registerTool(
    'create_vehicle',
    {
      description:
        'Create a vehicle: an asset account whose value follows a depreciation curve from the purchase price and date. The vehicle gets its own account (in the vehicle category), opened at the estimated value today. Required: name, currencyCode, make, model, year, vehicleClass, purchasePrice (positive decimal), purchaseDate. Optional: trim, depreciationPreset (the class default unless given; "custom" needs customAnnualRatePct), customAnnualRatePct, salvageFloorPct, currentMileage. Returns the vehicle with its estimated value. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_vehicle', clientId: extra.authInfo?.clientId });

      const vehicle = await createVehicle({ userId, ...validateCreateVehicleArgs({ args }) });

      return jsonContent({ data: presentVehicle({ vehicle, userId }) });
    },
  );
}
