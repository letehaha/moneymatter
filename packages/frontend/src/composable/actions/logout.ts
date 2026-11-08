import { ROUTES_NAMES } from '@/routes';
import { useAuthStore } from '@/stores';
import { useRouter } from 'vue-router';

export const useLogout = () => {
  const router = useRouter();
  const { logout } = useAuthStore();

  const logOutHandler = async () => {
    // An explicit sign-out also removes this device's push subscription.
    logout({ disablePush: true });
    // Use replace instead of push to prevent going back to authenticated pages
    await router.replace({ name: ROUTES_NAMES.signIn });
  };

  return logOutHandler;
};
