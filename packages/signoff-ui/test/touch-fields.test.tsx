import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApprovalCard } from '../src/approval-card';
import { DiffReview } from '../src/diff-review';
import { APPROVAL_DECISIONS } from '../src/lib/policy';

/*
 * iOS zooms the page into a text field under 16px when it takes focus, and leaves it zoomed. Every
 * field the kit renders is 16px or more on a touch screen (`pointer: coarse`), and 12 to 13px
 * elsewhere. The key caps and key hints are for keyboards: a touch screen shows none of them.
 * jsdom has no media queries, so this checks the classes; `pnpm a11y` measures the sizes in a
 * phone's browser.
 */

const COARSE_16PX = 'pointer-coarse:text-[length:max(16px,1rem)]';

/** Every field a person types in. */
const fields = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLElement>('textarea, select, input:not([type="checkbox"]):not([type="radio"])'),
];

describe('on a touch screen, text fields are 16px', () => {
  it('in an approval card: the arguments as a form, the rule, and the reason', async () => {
    const user = userEvent.setup();
    render(
      <ApprovalCard
        toolName="run_command"
        input={{ command: 'pnpm add zod', cwd: '~/app', note: 'x'.repeat(100) }}
        decisions={APPROVAL_DECISIONS}
        editable
      />,
    );
    const card = screen.getByRole('group', { name: 'Run command' });
    await user.click(within(card).getByRole('button', { name: 'Edit arguments' }));
    await user.click(within(card).getByRole('button', { name: 'Deny with feedback' }));
    const found = fields(card);
    // command, cwd, a long note as a text area, the rule's pattern for the command, and the reason.
    expect(found.map((field) => field.tagName)).toEqual(['INPUT', 'INPUT', 'TEXTAREA', 'INPUT', 'TEXTAREA']);
    for (const field of found) expect(field).toHaveClass(COARSE_16PX);
  });

  it('in an approval card: the arguments as JSON', async () => {
    const user = userEvent.setup();
    render(<ApprovalCard toolName="run_command" input={{ list: [1, 2] }} editable />);
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    expect(screen.getByRole('textbox', { name: 'Arguments, as JSON' })).toHaveClass(COARSE_16PX);
  });

  it('in a review: the comment', async () => {
    const user = userEvent.setup();
    render(<DiffReview files={[{ path: 'a.ts', oldContent: 'a\n', newContent: 'b\n' }]} onSubmit={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Comment on hunk 1' }));
    const comment = screen.getByRole('textbox', { name: 'Comment on the hunk, for the agent' });
    expect(fields(document.body)).toEqual([comment]);
    expect(comment).toHaveClass(COARSE_16PX);
  });
});

describe('on a touch screen, no key caps or key hints', () => {
  it('on an approval card', () => {
    const { container } = render(
      <ApprovalCard toolName="run_command" input={{ command: 'ls' }} decisions={APPROVAL_DECISIONS} />,
    );
    const caps = [...container.querySelectorAll('kbd')];
    // Y, S, A, N and ⇧N on the buttons, then ⌘ or Ctrl and ↵ in the hint line, which hides them all.
    const hint = container.querySelector('p:has(> span > kbd)');
    expect(hint).toHaveClass('pointer-coarse:hidden');
    const onButtons = caps.filter((cap) => cap.closest('button'));
    expect(onButtons).toHaveLength(5);
    for (const cap of onButtons) expect(cap).toHaveClass('pointer-coarse:hidden');
  });

  it('in a review', () => {
    const { container } = render(
      <DiffReview files={[{ path: 'a.ts', oldContent: 'a\n', newContent: 'b\n' }]} onSubmit={() => {}} />,
    );
    const caps = [...container.querySelectorAll('kbd')];
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) expect(cap.closest('.pointer-coarse\\:hidden')).not.toBeNull();
  });
});
