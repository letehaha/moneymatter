import { api } from '@/api/_api';
import { AuthFeaturesResponse } from '@bt/shared/types';

export const getSignupsOpen = async (): Promise<{ signupsOpen: boolean }> => api.get('/auth/signups-open');

export const getAuthFeatures = async (): Promise<AuthFeaturesResponse> => api.get('/auth/features');
