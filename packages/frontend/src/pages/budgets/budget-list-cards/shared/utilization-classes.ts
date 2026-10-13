export const utilizationClasses = ({ rate }: { rate: number }) => {
  if (rate > 90) return { text: 'text-app-expense-color', bg: 'bg-app-expense-color' };
  if (rate > 70) return { text: 'text-warning-text', bg: 'bg-warning-text' };
  return { text: 'text-success-text', bg: 'bg-success-text' };
};
