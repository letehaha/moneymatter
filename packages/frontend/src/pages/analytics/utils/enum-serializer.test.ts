import { createEnumSerializer } from './enum-serializer';

const serializer = createEnumSerializer({ values: ['monthly', 'yearly'] as const, fallback: 'monthly' });

describe('createEnumSerializer', () => {
  it('reads a listed value back as is', () => {
    expect(serializer.read('yearly')).toBe('yearly');
  });

  it('falls back for an unlisted value', () => {
    expect(serializer.read('weekly')).toBe('monthly');
    expect(serializer.read('')).toBe('monthly');
  });

  it('writes the value unchanged', () => {
    expect(serializer.write('yearly')).toBe('yearly');
  });
});
