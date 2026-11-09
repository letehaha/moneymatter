import { getChartWindow } from './chart-window';

const now = new Date(2026, 10, 8);
const month = ({ year, monthIndex }: { year: number; monthIndex: number }) => ({
  from: new Date(year, monthIndex, 1),
  to: new Date(year, monthIndex + 1, 0, 23, 59, 59),
});

describe('getChartWindow', () => {
  it('ends at the current month for the current month', () => {
    const window = getChartWindow({ period: month({ year: 2026, monthIndex: 10 }), now });
    expect(window.from).toEqual(new Date(2025, 11, 1));
    expect(window.to.getMonth()).toBe(10);
    expect(window.to.getFullYear()).toBe(2026);
  });

  it('stays put for a month inside the last 12', () => {
    const window = getChartWindow({ period: month({ year: 2026, monthIndex: 0 }), now });
    expect(window.from).toEqual(new Date(2025, 11, 1));
  });

  it('ends at an older month that falls outside the last 12', () => {
    const window = getChartWindow({ period: month({ year: 2025, monthIndex: 5 }), now });
    expect(window.from).toEqual(new Date(2024, 6, 1));
    expect(window.to.getMonth()).toBe(5);
    expect(window.to.getFullYear()).toBe(2025);
  });

  it('uses a period of a year or more as is', () => {
    const period = { from: new Date(2024, 0, 15), to: new Date(2025, 5, 10) };
    const window = getChartWindow({ period, now });
    expect(window.from).toEqual(new Date(2024, 0, 1));
    expect(window.to.getMonth()).toBe(5);
  });

  it('uses a period of exactly 12 months as is', () => {
    const period = { from: new Date(2025, 0, 1), to: new Date(2025, 11, 31) };
    const window = getChartWindow({ period, now });
    expect(window.from).toEqual(new Date(2025, 0, 1));
    expect(window.to).toEqual(new Date(2025, 11, 31, 23, 59, 59, 999));
  });

  it('pads an older 11-month period to 12 months ending with it', () => {
    const period = { from: new Date(2025, 0, 1), to: new Date(2025, 10, 30) };
    const window = getChartWindow({ period, now });
    expect(window.from).toEqual(new Date(2024, 11, 1));
    expect(window.to).toEqual(new Date(2025, 10, 30, 23, 59, 59, 999));
  });
});
