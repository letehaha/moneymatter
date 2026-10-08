import { api } from '@/api/_api';
import { type Entitlements, type Feature, UserInfoResponse } from '@bt/shared/types';

export const loadUserData = async (): Promise<UserInfoResponse> => {
  const result = await api.get('/user');

  return result;
};

export const deleteUserAccount = async (): Promise<void> => {
  await api.delete('/user/delete');
};

export const wipeUserData = async ({ acknowledgeSharing }: { acknowledgeSharing: boolean }): Promise<void> => {
  await api.post('/user/wipe-data', { acknowledgeSharing });
};

export const startFeatureTrial = ({ feature }: { feature: Feature }): Promise<Entitlements> =>
  api.post(`/user/feature-trials/${feature}`);
