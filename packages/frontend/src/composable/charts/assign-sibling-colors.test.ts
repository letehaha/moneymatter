import { assignSiblingColors } from './assign-sibling-colors';

describe('assignSiblingColors', () => {
  it('keeps colors the user set', () => {
    expect(
      assignSiblingColors({
        items: [
          { id: 'a', color: '#ff0000' },
          { id: 'b', color: '#00FF00' },
        ],
        parentColor: '#0000ff',
      }),
    ).toEqual({ a: '#ff0000', b: '#00ff00' });
  });

  it('gives the largest copied color the parent color and shades the rest', () => {
    const result = assignSiblingColors({
      items: [
        { id: 'a', color: '#3366cc' },
        { id: 'b', color: '#3366CC' },
        { id: 'c', color: '#3366cc' },
      ],
      parentColor: '#3366cc',
    });

    expect(result.a).toBe('#3366cc');
    expect(result.b).not.toBe('#3366cc');
    expect(result.c).not.toBe('#3366cc');
    expect(result.b).not.toBe(result.c);
  });

  it('shades a repeated color among roots, where there is no parent', () => {
    const result = assignSiblingColors({
      items: [
        { id: 'a', color: '#3366cc' },
        { id: 'b', color: '#3366cc' },
      ],
    });

    expect(result.a).toBe('#3366cc');
    expect(result.b).not.toBe('#3366cc');
  });

  it('does not reuse a color a sibling set for itself', () => {
    const result = assignSiblingColors({
      items: [
        { id: 'own', color: '#ff0000' },
        { id: 'copied', color: '#ff0000' },
      ],
      parentColor: '#ff0000',
    });

    expect(result.own).toBe('#ff0000');
    expect(result.copied).not.toBe('#ff0000');
  });
});
