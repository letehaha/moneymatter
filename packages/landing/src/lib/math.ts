export const lerp = ({ from, to, k }: { from: number; to: number; k: number }) => from + (to - from) * k;
export const clamp = (v: number) => Math.min(1, Math.max(0, v));
export const ease = (k: number) => 1 - Math.pow(1 - k, 3);
