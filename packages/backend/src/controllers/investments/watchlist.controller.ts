import {
  type CreateWatchlistAlertBody,
  type SetWatchlistLayoutBody,
  type UpdateWatchlistAlertBody,
  WATCHLIST_ALERT_FREQUENCIES,
  WATCHLIST_ALERT_TYPES,
  WATCHLIST_LIMITS,
  type WatchlistItemFields,
} from '@bt/shared/types';
import { decimalString, recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { SecuritySearchResultSchema } from '@controllers/investments/holdings/schemas';
import { createAlert, deleteAlert, updateAlert } from '@services/investments/watchlist/alerts.service';
import { getWatchlist } from '@services/investments/watchlist/get-watchlist.service';
import { createItem, deleteItem, updateItem } from '@services/investments/watchlist/items.service';
import {
  createSection,
  deleteSection,
  setLayout,
  updateSection,
} from '@services/investments/watchlist/sections.service';
import { z } from 'zod';

const portfolioParams = z.object({ id: recordId() });
const sectionParams = portfolioParams.extend({ sectionId: recordId() });
const itemParams = portfolioParams.extend({ itemId: recordId() });
const alertParams = itemParams.extend({ alertId: recordId() });

const sectionName = z.string().trim().min(1).max(WATCHLIST_LIMITS.sectionNameMaxLength);
const note = z.string().trim().max(WATCHLIST_LIMITS.noteMaxLength).nullable();
/** DECIMAL(20,10) holds up to 10 integer digits. */
const price = decimalString().refine((value) => Number(value) > 0 && Number(value) < WATCHLIST_LIMITS.priceBelow, {
  message: 'Price must be greater than 0 and below 10 billion',
});
const percent = z.number().min(WATCHLIST_LIMITS.movePercent.min).max(WATCHLIST_LIMITS.movePercent.max);
const frequency = z.enum(Object.values(WATCHLIST_ALERT_FREQUENCIES));
const itemFields = {
  sectionId: recordId().nullable().optional(),
  note: note.optional(),
  targetPrice: price.nullable().optional(),
};

export const getWatchlistController = createController(
  z.object({ params: portfolioParams }),
  async ({ user, params }) => ({
    data: await getWatchlist({ userId: user.id, portfolioId: params.id }),
  }),
);

export const createSectionController = createController(
  z.object({ params: portfolioParams, body: z.strictObject({ name: sectionName }) }),
  async ({ user, params, body }) => ({
    data: await createSection({ userId: user.id, portfolioId: params.id, name: body.name }),
    statusCode: 201,
  }),
);

export const updateSectionController = createController(
  z.object({ params: sectionParams, body: z.strictObject({ name: sectionName }) }),
  async ({ user, params, body }) => ({
    data: await updateSection({
      userId: user.id,
      portfolioId: params.id,
      sectionId: params.sectionId,
      name: body.name,
    }),
  }),
);

export const deleteSectionController = createController(
  z.object({ params: sectionParams }),
  async ({ user, params }) => {
    await deleteSection({ userId: user.id, portfolioId: params.id, sectionId: params.sectionId });
  },
);

export const setLayoutController = createController(
  z.object({
    params: portfolioParams,
    body: z.strictObject({
      sections: z.array(z.strictObject({ id: recordId(), itemIds: uniqueRecordIds() })),
      ungroupedItemIds: uniqueRecordIds(),
    }) satisfies z.ZodType<SetWatchlistLayoutBody>,
  }),
  async ({ user, params, body }) => {
    await setLayout({ userId: user.id, portfolioId: params.id, ...body });
  },
);

export const createItemController = createController(
  z.object({
    params: portfolioParams,
    body: z.union([
      z.strictObject({ securityId: recordId(), ...itemFields }),
      z.strictObject({ searchResult: SecuritySearchResultSchema, ...itemFields }),
    ]),
  }),
  async ({ user, params, body }) => ({
    data: await createItem({ userId: user.id, portfolioId: params.id, ...body }),
    statusCode: 201,
  }),
);

export const updateItemController = createController(
  z.object({
    params: itemParams,
    body: z.strictObject(itemFields) satisfies z.ZodType<WatchlistItemFields>,
  }),
  async ({ user, params, body }) => ({
    data: await updateItem({ userId: user.id, portfolioId: params.id, itemId: params.itemId, ...body }),
  }),
);

export const deleteItemController = createController(z.object({ params: itemParams }), async ({ user, params }) => {
  await deleteItem({ userId: user.id, portfolioId: params.id, itemId: params.itemId });
});

const channels = { notifyInApp: z.boolean().optional(), notifyEmail: z.boolean().optional() };

export const createAlertController = createController(
  z.object({
    params: itemParams,
    body: z.discriminatedUnion('type', [
      z.strictObject({
        type: z.enum([WATCHLIST_ALERT_TYPES.closeAbove, WATCHLIST_ALERT_TYPES.closeBelow]),
        price,
        frequency: frequency.optional(),
        ...channels,
      }),
      z.strictObject({
        type: z.literal(WATCHLIST_ALERT_TYPES.dailyMove),
        percent,
        frequency: frequency.optional(),
        ...channels,
      }),
    ]) satisfies z.ZodType<CreateWatchlistAlertBody>,
  }),
  async ({ user, params, body }) => ({
    data: await createAlert({ userId: user.id, portfolioId: params.id, itemId: params.itemId, ...body }),
    statusCode: 201,
  }),
);

export const updateAlertController = createController(
  z.object({
    params: alertParams,
    body: z.strictObject({
      price: price.optional(),
      percent: percent.optional(),
      frequency: frequency.optional(),
      isActive: z.boolean().optional(),
      ...channels,
    }) satisfies z.ZodType<UpdateWatchlistAlertBody>,
  }),
  async ({ user, params, body }) => ({
    data: await updateAlert({
      userId: user.id,
      portfolioId: params.id,
      itemId: params.itemId,
      alertId: params.alertId,
      ...body,
    }),
  }),
);

export const deleteAlertController = createController(z.object({ params: alertParams }), async ({ user, params }) => {
  await deleteAlert({ userId: user.id, portfolioId: params.id, itemId: params.itemId, alertId: params.alertId });
});
