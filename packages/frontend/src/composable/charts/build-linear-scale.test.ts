import { buildLinearScale } from './build-linear-scale';

describe('buildLinearScale', () => {
  it('maps the value range onto the height, top to bottom', () => {
    const scale = buildLinearScale({ values: [10, 20, 30], height: 100 });
    expect(scale.domain()).toEqual([10, 30]);
    expect(scale(30)).toBe(0);
    expect(scale(10)).toBe(100);
  });

  it('pads a flat series so it plots mid-height', () => {
    expect(buildLinearScale({ values: [100, 100], height: 100 }).domain()).toEqual([90, 110]);
    expect(buildLinearScale({ values: [0], height: 100 }).domain()).toEqual([-1, 1]);
  });

  it('stretches the domain to zero on request', () => {
    expect(buildLinearScale({ values: [5, 10], height: 100, includeZero: true }).domain()).toEqual([0, 10]);
  });
});
