import { getChartWindow } from './chart-window';

const month = ({ year, monthIndex }: { year: number; monthIndex: number }) => ({
  from: new Date(year, monthIndex, 1),
  to: new Date(year, monthIndex + 1, 0, 23, 59, 59),
});

describe('getChartWindow', () => {
  it('ends at the selected month', () => {
    const window = getChartWindow({ period: month({ year: 2025, monthIndex: 5 }) });
    expect(window.from).toEqual(new Date(2024, 6, 1));
    expect(window.to).toEqual(new Date(2025, 5, 30, 23, 59, 59, 999));
  });

  it('ends at the last month of a multi-month period', () => {
    const period = { from: new Date(2026, 6, 1), to: new Date(2026, 8, 30) };
    const window = getChartWindow({ period });
    expect(window.from).toEqual(new Date(2025, 9, 1));
    expect(window.to).toEqual(new Date(2026, 8, 30, 23, 59, 59, 999));
  });

  it('snaps a mid-month pay period to whole months', () => {
    const period = { from: new Date(2025, 11, 15), to: new Date(2026, 0, 14) };
    const window = getChartWindow({ period });
    expect(window.from).toEqual(new Date(2025, 1, 1));
    expect(window.to).toEqual(new Date(2026, 0, 31, 23, 59, 59, 999));
  });

  it('uses a period of a year or more as is', () => {
    const period = { from: new Date(2024, 0, 15), to: new Date(2025, 5, 10) };
    const window = getChartWindow({ period });
    expect(window.from).toEqual(new Date(2024, 0, 1));
    expect(window.to.getMonth()).toBe(5);
  });

  it('uses a period of exactly 12 months as is', () => {
    const period = { from: new Date(2025, 0, 1), to: new Date(2025, 11, 31) };
    const window = getChartWindow({ period });
    expect(window.from).toEqual(new Date(2025, 0, 1));
    expect(window.to).toEqual(new Date(2025, 11, 31, 23, 59, 59, 999));
  });

  it('pads an 11-month period to 12 months ending with it', () => {
    const period = { from: new Date(2025, 0, 1), to: new Date(2025, 10, 30) };
    const window = getChartWindow({ period });
    expect(window.from).toEqual(new Date(2024, 11, 1));
    expect(window.to).toEqual(new Date(2025, 10, 30, 23, 59, 59, 999));
  });
});
