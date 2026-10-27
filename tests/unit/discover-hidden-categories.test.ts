import { describe, expect, it } from 'vitest';
import { hiddenCategoriesFilter } from '@/lib/discover/preferences';

describe('hiddenCategoriesFilter', () => {
  it('keeps recipes without category and excludes hidden ones', () => {
    expect(hiddenCategoriesFilter(['a', 'b'])).toBe('category_id.is.null,category_id.not.in.(a,b)');
  });
});
