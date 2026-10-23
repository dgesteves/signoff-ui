import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DiffReview } from '../src/diff-review';

/*
 * Applying a review is the last thing a reviewer does: the review says it went, in its own live
 * region, as it says every decision. What replaces the review afterwards is the app's to focus.
 */

const files = [
  { path: 'a.ts', oldContent: 'a\n', newContent: 'A\n' },
  { path: 'b.ts', oldContent: 'b\n', newContent: 'B\n' },
];

const status = () => screen.getByRole('status');

describe('Apply', () => {
  it('says what was sent: how many accepted, of how many, and the comments', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DiffReview files={files} onSubmit={onSubmit} />);
    const [first] = screen.getAllByRole('group', { name: /^Hunk 1 of 2/ });
    first!.focus();
    await user.keyboard('a');
    expect(status()).toHaveTextContent('Hunk 1 of 2 accepted.');
    await user.keyboard('c');
    await user.keyboard('Keep it{Control>}{Enter}{/Control}');
    await user.click(screen.getByRole('button', { name: 'Apply 1 of 2' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(status()).toHaveTextContent('Review sent: 1 of 2 accepted, 1 comment.');
  });

  it('with ⌘/Ctrl+Enter too, and gives way to what the review says next', async () => {
    const user = userEvent.setup();
    render(<DiffReview files={files} onSubmit={() => {}} />);
    const [first, second] = screen.getAllByRole('group', { name: /^Hunk \d of 2/ });
    first!.focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(status()).toHaveTextContent('Review sent: 0 of 2 accepted.');
    second!.focus();
    await user.keyboard('r');
    expect(status()).toHaveTextContent(/^Hunk 2 of 2 rejected\./);
  });
});
