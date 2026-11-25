import { api } from '@/api/_api';
import type {
  CreateWatchlistAlertBody,
  SetWatchlistLayoutBody,
  UpdateWatchlistAlertBody,
  WatchlistAlertModel,
  WatchlistItemFields,
  WatchlistItemModel,
  WatchlistModel,
  WatchlistSectionModel,
} from '@bt/shared/types';
import type { SecuritySearchResult } from '@bt/shared/types/investments';

const base = ({ portfolioId }: { portfolioId: string }) => `/investments/portfolios/${portfolioId}/watchlist`;

export const getWatchlist = ({ portfolioId }: { portfolioId: string }): Promise<WatchlistModel> =>
  api.get(base({ portfolioId }));

export const createWatchlistSection = ({
  portfolioId,
  name,
}: {
  portfolioId: string;
  name: string;
}): Promise<WatchlistSectionModel> => api.post(`${base({ portfolioId })}/sections`, { name });

export const updateWatchlistSection = ({
  portfolioId,
  sectionId,
  name,
}: {
  portfolioId: string;
  sectionId: string;
  name: string;
}): Promise<WatchlistSectionModel> => api.patch(`${base({ portfolioId })}/sections/${sectionId}`, { name });

export const deleteWatchlistSection = ({
  portfolioId,
  sectionId,
}: {
  portfolioId: string;
  sectionId: string;
}): Promise<void> => api.delete(`${base({ portfolioId })}/sections/${sectionId}`);

export const setWatchlistLayout = ({
  portfolioId,
  payload,
}: {
  portfolioId: string;
  payload: SetWatchlistLayoutBody;
}): Promise<void> => api.put(`${base({ portfolioId })}/layout`, payload);

export const createWatchlistItem = ({
  portfolioId,
  ...body
}: { portfolioId: string } & ({ securityId: string } | { searchResult: SecuritySearchResult }) &
  WatchlistItemFields): Promise<WatchlistItemModel> => api.post(`${base({ portfolioId })}/items`, body);

export const updateWatchlistItem = ({
  portfolioId,
  itemId,
  ...body
}: { portfolioId: string; itemId: string } & WatchlistItemFields): Promise<WatchlistItemModel> =>
  api.patch(`${base({ portfolioId })}/items/${itemId}`, body);

export const deleteWatchlistItem = ({ portfolioId, itemId }: { portfolioId: string; itemId: string }): Promise<void> =>
  api.delete(`${base({ portfolioId })}/items/${itemId}`);

export type { CreateWatchlistAlertBody, UpdateWatchlistAlertBody };

export const createWatchlistAlert = ({
  portfolioId,
  itemId,
  body,
}: {
  portfolioId: string;
  itemId: string;
  body: CreateWatchlistAlertBody;
}): Promise<WatchlistAlertModel> => api.post(`${base({ portfolioId })}/items/${itemId}/alerts`, body);

export const updateWatchlistAlert = ({
  portfolioId,
  itemId,
  alertId,
  body,
}: {
  portfolioId: string;
  itemId: string;
  alertId: string;
  body: UpdateWatchlistAlertBody;
}): Promise<WatchlistAlertModel> => api.patch(`${base({ portfolioId })}/items/${itemId}/alerts/${alertId}`, body);

export const deleteWatchlistAlert = ({
  portfolioId,
  itemId,
  alertId,
}: {
  portfolioId: string;
  itemId: string;
  alertId: string;
}): Promise<void> => api.delete(`${base({ portfolioId })}/items/${itemId}/alerts/${alertId}`);
