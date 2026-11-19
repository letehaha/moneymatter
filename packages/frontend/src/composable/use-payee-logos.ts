import type { UserSettingsSchema } from '@/api/user-settings';
import { toLogoDisplayProps, toLogoSelection } from '@/components/common/logo-selection';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { userSettingsQueryOptions } from '@/composable/data-queries/user-settings';
import type { PayeeLookupItem, RecordId } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { createSharedComposable } from '@vueuse/core';
import { computed } from 'vue';

// Unset means on; settings not loaded yet means off, so opted-out users never see a flash of logos.
export const isPayeeLogosEnabled = ({ settings }: { settings: UserSettingsSchema | undefined }) =>
  !!settings && settings.showPayeeLogos !== false;

export const resolvePayeeLogo = ({
  enabled,
  payeeId,
  payeesById,
}: {
  enabled: boolean;
  payeeId: RecordId | null | undefined;
  payeesById: Map<string, PayeeLookupItem>;
}) => {
  if (!enabled || !payeeId) return null;
  const payee = payeesById.get(payeeId);
  const selection = payee ? toLogoSelection(payee) : null;
  return payee && selection ? { name: payee.name, ...toLogoDisplayProps({ selection }) } : null;
};

// Shared because every transaction row calls it and the lookup map spans all payees.
export const usePayeeLogos = createSharedComposable(() => {
  const { data: userSettings } = useQuery(userSettingsQueryOptions);
  const { byId } = usePayeeLookup();
  const enabled = computed(() => isPayeeLogosEnabled({ settings: userSettings.value }));

  const getPayeeLogo = ({ payeeId }: { payeeId: RecordId | null | undefined }) =>
    resolvePayeeLogo({ enabled: enabled.value, payeeId, payeesById: byId.value });

  return { getPayeeLogo };
});
