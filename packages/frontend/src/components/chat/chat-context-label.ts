import { useAccountsStore } from '@/stores/accounts';
import { useCategoriesStore } from '@/stores/categories/categories';
import { useTagsStore } from '@/stores/tags';
import type { ChatEntityKind, ChatPageContext } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';

import { describeChatContext } from './chat-context';

/** `describeChatContext` with the app's translations and the names the stores already hold. */
export const useChatContextLabel = () => {
  const { t } = useI18n();
  const { accountsRecord } = storeToRefs(useAccountsStore());
  const { categoriesMap } = storeToRefs(useCategoriesStore());
  const { tagsMap } = storeToRefs(useTagsStore());

  /** `names` are the display names the server read for a stored context, by `kind:id`; a kind missing there falls back to the stores. */
  const entityNameFrom =
    ({ names }: { names: Record<string, string> }) =>
    ({ kind, id }: { kind: ChatEntityKind; id: string }): string | null => {
      const fromServer = names[`${kind}:${id}`];
      if (fromServer) return fromServer;
      if (kind === 'account') return accountsRecord.value[id]?.name ?? null;
      if (kind === 'category') return categoriesMap.value[id]?.name ?? null;
      if (kind === 'tag') return tagsMap.value[id]?.name ?? null;
      return null;
    };

  const label = ({ context, names = {} }: { context: ChatPageContext; names?: Record<string, string> }) =>
    describeChatContext({ context, t, entityName: entityNameFrom({ names }) });

  return { label };
};
