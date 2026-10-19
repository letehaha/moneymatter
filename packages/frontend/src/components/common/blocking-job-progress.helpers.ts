export type ChecklistRowStatus = 'done' | 'now' | 'pending';

interface ChecklistRow {
  labelKey: string;
  status: ChecklistRowStatus;
}

/** Checklist rows: preparing, one per step, finishing. A running job with an
 *  unknown step marks the preparing row current. */
export function checklistRows({
  orderedStepKeys,
  stepLabelKeys,
  state,
  currentStepKey,
  preparingLabelKey,
  finishingLabelKey,
}: {
  orderedStepKeys: string[];
  stepLabelKeys: Record<string, string>;
  state: 'preparing' | 'running' | 'finishing';
  currentStepKey?: string | null;
  preparingLabelKey: string;
  finishingLabelKey: string;
}): ChecklistRow[] {
  const labelKeys = [preparingLabelKey, ...orderedStepKeys.map((key) => stepLabelKeys[key] ?? key), finishingLabelKey];
  const stepIndex = state === 'running' && currentStepKey ? orderedStepKeys.indexOf(currentStepKey) : -1;
  const nowIndex = state === 'finishing' ? labelKeys.length - 1 : stepIndex + 1;
  return labelKeys.map((labelKey, index) => ({
    labelKey,
    status: index < nowIndex ? 'done' : index === nowIndex ? 'now' : 'pending',
  }));
}
