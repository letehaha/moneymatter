import { describe, expect, it } from 'vitest';

import { imageScale } from './fit-image-for-upload';

describe('imageScale', () => {
  it('leaves an image within both caps at full size', () => {
    expect(imageScale({ width: 1170, height: 2532 })).toBe(1);
  });

  it('brings a 12MP photo under the pixel cap, keeping the aspect ratio', () => {
    const scale = imageScale({ width: 4032, height: 3024 });

    expect(Math.floor(4032 * scale) * Math.floor(3024 * scale)).toBeLessThanOrEqual(4_000_000);
    expect(scale).toBeGreaterThan(0.5);
  });

  it('caps the long edge of a narrow scrolling screenshot', () => {
    const scale = imageScale({ width: 300, height: 12_000 });

    expect(12_000 * scale).toBeLessThanOrEqual(7500);
  });
});
