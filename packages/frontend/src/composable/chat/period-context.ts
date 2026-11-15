import type { Period } from '@/composable/use-period-navigation';
import { format } from 'date-fns';

import type { ProvidedChatPageContext } from './use-chat-page-context';

const DATE_FORMAT = 'yyyy-MM-dd';

/** What a page with a date range on screen tells the chat: the range, as calendar dates. */
export const buildPeriodChatContext = ({ period }: { period: Period }): ProvidedChatPageContext => ({
  period: { from: format(period.from, DATE_FORMAT), to: format(period.to, DATE_FORMAT) },
});
