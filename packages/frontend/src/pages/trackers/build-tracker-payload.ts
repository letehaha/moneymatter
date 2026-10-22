import { TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS, type TrackerAiPreWindowDays } from '@bt/shared/types';
import { endOfDay, startOfDay } from 'date-fns';
import { xor } from 'lodash-es';

interface TrackerFormValues {
  name: string;
  limitAmount: number | string | null | undefined;
  startDate: Date | null | undefined;
  endDate: Date | null | undefined;
}

interface TrackerPayload {
  name: string;
  limitAmount: number | null;
  startDate: string | null;
  endDate: string | null;
}

export const buildTrackerDates = ({
  startDate,
  endDate,
}: Pick<TrackerFormValues, 'startDate' | 'endDate'>): Pick<TrackerPayload, 'startDate' | 'endDate'> => ({
  startDate: startDate ? startOfDay(startDate).toISOString() : null,
  endDate: endDate ? endOfDay(endDate).toISOString() : null,
});

/** Anything but a positive finite number clears the limit (`null`). */
export const buildTrackerPayload = ({ name, limitAmount, startDate, endDate }: TrackerFormValues): TrackerPayload => {
  const limit = limitAmount === '' || limitAmount == null ? NaN : Number(limitAmount);

  return {
    name,
    limitAmount: Number.isFinite(limit) && limit > 0 ? limit : null,
    ...buildTrackerDates({ startDate, endDate }),
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

export interface TrackerRulesValues {
  rulesEnabled: boolean;
  rulesCleanup: boolean;
  categoryIds: string[];
  tagIds: string[];
}

export const TRACKER_RULES_DEFAULTS: TrackerRulesValues = {
  rulesEnabled: false,
  rulesCleanup: true,
  categoryIds: [],
  tagIds: [],
};

export const isTrackerRulesIncomplete = ({ values }: { values: TrackerRulesValues }) =>
  values.rulesEnabled && !values.categoryIds.length && !values.tagIds.length;

const isSameIdSet = ({ a, b }: { a: string[]; b: string[] }) => xor(a, b).length === 0;

/** A save re-checks every transaction against the rules; worth a confirm only when that can change what is linked. */
export const changesRuleMatches = ({
  values,
  stored,
  dates,
  storedDates,
}: {
  values: TrackerRulesValues;
  stored: TrackerRulesValues;
  dates: Pick<TrackerPayload, 'startDate' | 'endDate'>;
  storedDates: Pick<TrackerPayload, 'startDate' | 'endDate'>;
}) =>
  values.rulesEnabled &&
  (!stored.rulesEnabled ||
    (values.rulesCleanup && !stored.rulesCleanup) ||
    dates.startDate !== storedDates.startDate ||
    dates.endDate !== storedDates.endDate ||
    !isSameIdSet({ a: values.categoryIds, b: stored.categoryIds }) ||
    !isSameIdSet({ a: values.tagIds, b: stored.tagIds }));
