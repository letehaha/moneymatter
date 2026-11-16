/**
 * The one height scale for interactive controls: buttons and every field surface
 * (inputs, select triggers, composite field wrappers). Heights never change with
 * the viewport; a denser or roomier control picks another size instead.
 */
export type ControlSize = 'xs' | 'sm' | 'default' | 'lg';

export const controlHeight: Record<ControlSize, string> = {
  xs: 'h-8',
  sm: 'h-9',
  default: 'h-10',
  lg: 'h-11',
};

/** For surfaces that grow with their content (tag inputs, multi-line triggers). */
export const controlMinHeight: Record<ControlSize, string> = {
  xs: 'min-h-8',
  sm: 'min-h-9',
  default: 'min-h-10',
  lg: 'min-h-11',
};
