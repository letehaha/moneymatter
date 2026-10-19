import { TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS, type TrackerAiPreWindowDays } from '@bt/shared/types';
import { endOfDay, startOfDay } from 'date-fns';

interface BudgetFormValues {
  name: string;
  limitAmount: number | string | null | undefined;
  startDate: Date | null | undefined;
  endDate: Date | null | undefined;
  categoryIds?: string[];
}

interface BudgetPayload {
  name: string;
  limitAmount: number | null;
  startDate: string | null;
  endDate: string | null;
  categoryIds?: string[];
}

/** Anything but a positive finite number clears the limit (`null`). */
export const buildBudgetPayload = ({
  name,
  limitAmount,
  startDate,
  endDate,
  categoryIds,
}: BudgetFormValues): BudgetPayload => {
  const limit = limitAmount === '' || limitAmount == null ? NaN : Number(limitAmount);

  return {
    name,
    limitAmount: Number.isFinite(limit) && limit > 0 ? limit : null,
    startDate: startDate ? startOfDay(startDate).toISOString() : null,
    endDate: endDate ? endOfDay(endDate).toISOString() : null,
    ...(categoryIds ? { categoryIds } : {}),
  };
};

export interface SmartTrackingValues {
  aiEnabled: boolean;
  aiDescription: string | null;
  aiPreWindowDays: TrackerAiPreWindowDays;
}

export const SMART_TRACKING_DEFAULTS: SmartTrackingValues = {
  aiEnabled: false,
  aiDescription: null,
  aiPreWindowDays: TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS,
};

/** Only the fields that differ from `stored`: the API rejects AI fields from non-owners even when unchanged. */
export const buildSmartTrackingPatch = ({
  values,
  stored = SMART_TRACKING_DEFAULTS,
}: {
  values: SmartTrackingValues;
  stored?: SmartTrackingValues;
}): Partial<SmartTrackingValues> => {
  const patch: Partial<SmartTrackingValues> = {};
  const description = values.aiDescription?.trim() || null;

  if (values.aiEnabled !== stored.aiEnabled) patch.aiEnabled = values.aiEnabled;
  if (description !== (stored.aiDescription?.trim() || null)) patch.aiDescription = description;
  if (values.aiPreWindowDays !== stored.aiPreWindowDays) patch.aiPreWindowDays = values.aiPreWindowDays;

  return patch;
};

export const isSmartTrackingIncomplete = ({ values }: { values: SmartTrackingValues }) =>
  values.aiEnabled && !values.aiDescription?.trim();
