import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApprovalCard } from '../src/approval-card';
import { DiffReview } from '../src/diff-review';
import { APPROVAL_DECISIONS } from '../src/lib/policy';

/*
 * In a right-to-left page (Arabic or Hebrew labels), the bidi algorithm reorders text that has no
 * direction of its own: `~/acme/chat-app` showed as `acme/chat-app/~`, the pattern `pnpm add*` as
 * `*pnpm add`, and diff lines lost their trailing `;` to the other end. What runs, and the code
 * under review, are left to right wherever the page is not: `dir="ltr"`, which also isolates them.
 * What the reviewer writes takes the direction of its own text (`dir="auto"`).
 */

const ltr = (el: Element | null | undefined) => expect(el?.closest('[dir]')).toHaveAttribute('dir', 'ltr');

describe('in a right-to-left page', () => {
  it('an approval card shows the command, its directory and the JSON preview left to right', () => {
    render(
      <div dir="rtl">
        <ApprovalCard
          toolName="run_command"
          input={{ command: 'pnpm add @upstash/ratelimit', cwd: '~/acme/chat-app' }}
        />
        <ApprovalCard toolName="write_file" input={{ path: 'src/a.ts' }} />
      </div>,
    );
    ltr(screen.getByText('pnpm add @upstash/ratelimit'));
    ltr(screen.getByText('~/acme/chat-app'));
    ltr(screen.getByRole('group', { name: 'Arguments' }));
  });

  it('and the rule it would save, and the arguments as JSON', async () => {
    const user = userEvent.setup();
    render(
      <div dir="rtl">
        <ApprovalCard toolName="run_command" input={{ command: 'pnpm add zod' }} decisions={APPROVAL_DECISIONS} />
        <ApprovalCard toolName="run_command" input={{ list: [1] }} editable />
      </div>,
    );
    const rule = screen.getByRole('textbox', { name: 'command matches' });
    expect(rule).toHaveValue('pnpm add*');
    ltr(rule);
    ltr(screen.getAllByText('run_command')[0]);
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    ltr(screen.getByRole('textbox', { name: 'Arguments, as JSON' }));
  });

  it('and edits each argument in the direction its text has', async () => {
    const user = userEvent.setup();
    render(
      <div dir="rtl">
        <ApprovalCard toolName="send_message" input={{ text: 'مرحبا', to: 'team' }} editable />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    expect(screen.getByRole('textbox', { name: 'text' })).toHaveAttribute('dir', 'auto');
    expect(screen.getByRole('textbox', { name: 'to' })).toHaveAttribute('dir', 'auto');
  });

  it('a review shows paths, hunk ranges and code left to right, and comments in their own direction', async () => {
    const user = userEvent.setup();
    const before = Array.from({ length: 12 }, (_, i) => `line ${i};`).join('\n') + '\n';
    const after = before.replace('line 0;', "import { ratelimit } from '@/lib/ratelimit';");
    render(
      <div dir="rtl">
        <DiffReview
          files={[
            { path: '~/app/route.ts', oldContent: before, newContent: after },
            { path: 'b.ts', oldContent: 'b\n', newContent: 'c\n' },
          ]}
          onSubmit={() => {}}
        />
      </div>,
    );
    for (const path of screen.getAllByText('route.ts')) ltr(path);
    ltr(screen.getByText('@@ -1,4 +1,4 @@'));
    const hunk = screen.getAllByRole('group', { name: /^Hunk 1 of 2/ })[0]!;
    for (const line of hunk.querySelectorAll('[data-line]')) ltr(line);
    // Unchanged lines shown between hunks too.
    await user.click(within(document.body).getAllByRole('button', { name: /^Show all/, hidden: true })[0]!);
    for (const line of document.querySelectorAll('[data-slot="signoff-diff-gap"] [data-line]')) ltr(line);
    hunk.focus();
    await user.keyboard('c');
    const field = screen.getByRole('textbox', { name: 'Comment on the hunk, for the agent' });
    expect(field).toHaveAttribute('dir', 'auto');
    await user.type(field, 'لا{Control>}{Enter}{/Control}');
    expect(screen.getByText('لا')).toHaveAttribute('dir', 'auto');
  });
});
