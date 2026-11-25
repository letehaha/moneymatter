import * as d3 from 'd3';

const FLAT_DOMAIN_PADDING = 0.1;

/** Y scale over `values`; a flat series is padded by 10% (±1 at zero) so it plots mid-height. */
export const buildLinearScale = ({
  values,
  height,
  includeZero = false,
}: {
  values: number[];
  height: number;
  includeZero?: boolean;
}) => {
  let min = d3.min(values) ?? 0;
  let max = d3.max(values) ?? 0;
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const pad = Math.abs(max) * FLAT_DOMAIN_PADDING || 1;
    min -= pad;
    max += pad;
  }
  return d3.scaleLinear().domain([min, max]).range([height, 0]).nice();
};
