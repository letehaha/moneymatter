export const sortTrackerRows = <T extends { utilizationRate: number | null; ended: boolean }>({
  rows,
}: {
  rows: T[];
}): T[] =>
  [...rows].sort((a, b) => Number(a.ended) - Number(b.ended) || (b.utilizationRate ?? -1) - (a.utilizationRate ?? -1));
