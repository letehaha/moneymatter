import type { UserModel } from '../users';

export interface VenturePlatformModel {
  id: string;
  userId: number;
  name: string;
  website: string | null;
  description: string | null;
  defaultEntryFeePct: string;
  defaultMgmtFeePct: string;
  defaultCarryPct: string;
  defaultHurdlePct: string;

  user?: UserModel;
}
