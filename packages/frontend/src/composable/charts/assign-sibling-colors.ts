import { color as parseColor, interpolateLab } from 'd3';

// Positive steps mix toward white, negative toward black; alternating keeps neighbours apart.
const SHADE_STEPS = [0, 0.3, -0.25, 0.52, -0.42, 0.68, -0.55];

const shade = ({ base, step }: { base: string; step: number }) =>
  step === 0
    ? base
    : (parseColor(interpolateLab(base, step > 0 ? '#ffffff' : '#000000')(Math.abs(step)))?.formatHex() ?? base);

/**
 * Subcategories copy their parent's color by default. A color the user set keeps its own value;
 * copied or repeated ones become shades of the parent, so a level still reads as one family.
 * Items are expected largest first: the largest copied one gets the parent color itself.
 */
export const assignSiblingColors = ({
  items,
  parentColor,
}: {
  items: { id: string; color: string }[];
  parentColor?: string;
}): Record<string, string> => {
  const used = new Set<string>();
  const result: Record<string, string> = {};
  let nextStep = 0;

  for (const { id, color } of items) {
    const own = color.toLowerCase();
    const isCopied = parentColor !== undefined && own === parentColor.toLowerCase();
    let assigned = own;

    if (isCopied || used.has(own)) {
      const base = (parentColor ?? color).toLowerCase();
      // ponytail: capped at 2 passes, so past ~14 shaded siblings colors can repeat; generate more shade steps if that bites.
      do {
        assigned = shade({ base, step: SHADE_STEPS[nextStep % SHADE_STEPS.length]! });
        nextStep++;
      } while (used.has(assigned) && nextStep < SHADE_STEPS.length * 2);
    }

    used.add(assigned);
    result[id] = assigned;
  }

  return result;
};
