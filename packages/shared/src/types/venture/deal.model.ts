import type { CurrencyModel } from '../currencies';
import type { UserModel } from '../users';
import { VENTURE_DEAL_STATUS, VENTURE_SPV_SUBTYPE, VENTURE_VEHICLE_TYPE } from './enums';
import { VentureEventModel } from './event.model';
import { VenturePlatformModel } from './platform.model';

export interface VentureDealModel {
  id: string;
  userId: number;
  platformId: string | null;
  name: string;
  vehicleType: VENTURE_VEHICLE_TYPE;
  spvSubtype: VENTURE_SPV_SUBTYPE | null;
  targetCompany: string | null;
  currencyCode: string;
  status: VENTURE_DEAL_STATUS;
  principal: string;
  entryFee: string;
  entryFeePct: string;
  mgmtFeePct: string;
  carryPct: string;
  hurdlePct: string;
  investmentDate: string;
  expectedExitDate: string | null;
  notes: string | null;

  user?: UserModel;
  platform?: VenturePlatformModel;
  currency?: CurrencyModel;
  events?: VentureEventModel[];
}
