export interface Slice {
  categoryId: string;
  name: string;
  color: string;
  amount: number;
}

export const OTHERS_SLICE_ID = 'others';
const OTHERS_COLOR = '#8b8b8b';

/** Folds slices under `minShare` of the total into one grey slice; nothing folds when only one slice, or every slice, is small. */
export const foldSmallSlices = ({
  slices,
  minShare,
  othersName,
}: {
  slices: Slice[];
  minShare: number;
  othersName: string;
}): Slice[] => {
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);
  if (total <= 0) return slices;

  const small = slices.filter((slice) => slice.amount / total < minShare);
  if (small.length < 2 || small.length === slices.length) return slices;

  return [
    ...slices.filter((slice) => !small.includes(slice)),
    {
      categoryId: OTHERS_SLICE_ID,
      name: othersName,
      color: OTHERS_COLOR,
      amount: small.reduce((sum, slice) => sum + slice.amount, 0),
    },
  ];
};
