export interface DonutChartItem {
  categoryId: string;
  name: string;
  color: string;
  amount: number;
  isDrillable?: boolean;
  /** Drawn on the slice when it is wide enough. */
  label?: string;
}
