// Labels follow their node's center but never overlap: each one is pushed below the previous.
export const spreadTops = ({
  boxes,
  heights,
  limit,
}: {
  boxes: { y0: number; y1: number }[];
  heights: number[];
  limit: number;
}) => {
  let cursor = 0;
  const tops = boxes.map((box, i) => {
    const top = Math.max((box.y0 + box.y1) / 2 - heights[i]! / 2, cursor);
    cursor = top + heights[i]!;
    return top;
  });
  const overflow = Math.max(0, cursor - limit);
  return tops.map((top) => top - overflow);
};
