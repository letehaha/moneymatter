import { useNotificationCenter } from '@/components/notification-center';
import { RESOURCE_TYPES, type ResourceType } from '@bt/shared/types';
import { useI18n } from 'vue-i18n';

interface InviteLinkTarget {
  token: string;
  resourceType: ResourceType;
}

/**
 * Mirror of the deep-link the backend puts in invitation emails. The dashboard layout
 * watches `?invitation_token=…` and opens the share-invitation dialog on any route, so
 * the landing path only decides where the recipient lands behind the dialog.
 */
const buildShareInvitationLink = ({ token, resourceType }: InviteLinkTarget): string => {
  const landingPath = resourceType === RESOURCE_TYPES.budget ? '/budgets' : '/accounts';
  return `${window.location.origin}${landingPath}?invitation_token=${encodeURIComponent(token)}`;
};

/** Copies an invitation deep-link to the clipboard for owners who need to share it manually. */
export const useCopyInviteLink = () => {
  const { t } = useI18n();
  const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

  const copyInviteLink = async ({ token, resourceType }: InviteLinkTarget) => {
    try {
      await navigator.clipboard.writeText(buildShareInvitationLink({ token, resourceType }));
      addSuccessNotification(t('common.notifications.inviteLinkCopied'));
    } catch {
      addErrorNotification(t('common.errors.copyToClipboardFailed'));
    }
  };

  return { copyInviteLink };
};
