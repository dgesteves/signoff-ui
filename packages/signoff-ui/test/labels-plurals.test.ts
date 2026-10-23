import { describe, expect, it } from 'vitest';
import { diffReviewLabels } from '../src/lib/labels';

describe('the English counts lines as one or more', () => {
  it('in what screen readers hear on the unchanged-lines buttons', () => {
    expect(diffReviewLabels.showAll(1)).toEqual({ visible: 'Show all', hidden: ' 1 unchanged line' });
    expect(diffReviewLabels.showAll(2).hidden).toBe(' 2 unchanged lines');
    expect(diffReviewLabels.moreAfter(1, 3).hidden).toBe(' unchanged line after hunk 3');
    expect(diffReviewLabels.moreBefore(20, 3).hidden).toBe(' unchanged lines before hunk 3');
  });
});
