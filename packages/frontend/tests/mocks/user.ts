import { USER_ROLES, UserInfoResponse, UserRole, type RecordId } from '@bt/shared/types';

export const USER: UserInfoResponse = {
  id: 1,
  username: 'letehaha1',
  email: '',
  firstName: '',
  lastName: '',
  middleName: '',
  avatar: '',
  totalBalance: 0,
  defaultCategoryId: '00000000-0000-0000-0000-000000003131' as RecordId,
  role: USER_ROLES.common as UserRole,
  appStoreAccountToken: '00000000-0000-4000-8000-000000000001',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

export const DEMO_USER = {
  ...USER,
  id: 999,
  username: 'demo-user',
  email: 'demo@demo.local',
  role: USER_ROLES.demo as UserRole,
};

export const ADMIN_USER = {
  ...USER,
  id: 2,
  username: 'admin',
  email: 'admin@example.com',
  role: USER_ROLES.admin as UserRole,
};
