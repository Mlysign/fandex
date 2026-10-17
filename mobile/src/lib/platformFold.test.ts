import { describe, expect, it } from 'vitest';


describe('folding a platform group at two rows', () => {
  it('cuts at the first chip on a third row, and not at all when there are two', async () => {
    const { foldAt } = await import('~/lib/foldAt');
    expect(foldAt([0, 0, 0, 40, 40, 80, 80])).toBe(5);
    expect(foldAt([0, 0, 40.4, 40])).toBeNull();
    expect(foldAt([])).toBeNull();
  });
});
