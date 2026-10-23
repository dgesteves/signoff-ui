import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from '../src/approval-card';
import { APPROVAL_DECISIONS } from '../src/lib/policy';

/*
 * Focus on a card reads its title and its description. The description says what a sighted
 * person sees around the buttons: the risk, what will run, and which calls S or A would remember,
 * so a press made from what was heard approves what was meant.
 */

const KEYS = 'Keyboard: press Y to approve, N to deny, or Ctrl Enter to approve.';

describe('a pending card describes', () => {
  it('its risk and the command, where it runs', () => {
    render(
      <ApprovalCard
        toolName="git_push"
        title="Delete branch main"
        input={{ command: 'git push origin --delete main', cwd: '~/acme/chat-app' }}
        risk="critical"
      />,
    );
    expect(screen.getByRole('group', { name: 'Delete branch main' })).toHaveAccessibleDescription(
      `Critical. Runs git push origin --delete main in ~/acme/chat-app. ${KEYS}`,
    );
  });

  it('the reason first, as before, then the rest', () => {
    render(
      <ApprovalCard
        toolName="run_command"
        description="Installs a package from the npm registry."
        input={{ command: 'pnpm add @upstash/ratelimit' }}
        risk="high"
      />,
    );
    expect(screen.getByRole('group', { name: 'Run command' })).toHaveAccessibleDescription(
      `Installs a package from the npm registry. High risk. Runs pnpm add @upstash/ratelimit. ${KEYS}`,
    );
  });

  it('the first arguments of a call with no command, cut short when long', () => {
    render(
      <ApprovalCard
        toolName="write_file"
        input={{ path: 'src/a.ts', mode: 'w', lines: 3, content: 'x'.repeat(200), more: 'not read' }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Write file' })).toHaveAccessibleDescription(
      `Arguments: path src/a.ts, mode w, lines 3. ${KEYS}`,
    );
  });

  it('characters that do not show, named, as the preview marks them', () => {
    render(<ApprovalCard toolName="run_command" input={{ command: 'npm‮test' }} />);
    expect(screen.getByRole('group', { name: 'Run command' })).toHaveAccessibleDescription(
      `Runs npm Invisible character U+202E test. ${KEYS}`,
    );
  });

  it('the arguments an edit will run with', async () => {
    const user = userEvent.setup();
    render(<ApprovalCard toolName="run_command" input={{ command: 'npm test' }} editable />);
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    await user.type(screen.getByRole('textbox', { name: 'command' }), ' -- --watch');
    expect(screen.getByRole('group', { name: 'Run command' })).toHaveAccessibleDescription(
      `Runs npm test -- --watch. ${KEYS}`,
    );
  });

  it('the calls a lasting decision covers, as the scope is set', async () => {
    const user = userEvent.setup();
    render(<ApprovalCard toolName="run_command" input={{ command: 'pnpm add zod' }} decisions={APPROVAL_DECISIONS} />);
    const group = screen.getByRole('group', { name: 'Run command' });
    expect(group).toHaveAccessibleDescription(
      /^Runs pnpm add zod\. A lasting decision covers run_command with command pnpm add\*\. Keyboard: /,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Any arguments' }));
    expect(group).toHaveAccessibleDescription(/ A lasting decision covers run_command, any arguments\. Keyboard: /);
  });

  it('no rule where the agent keeps what Always means (ruleScope={false})', () => {
    render(
      <ApprovalCard
        toolName="run_command"
        input={{ command: 'pnpm add zod' }}
        decisions={['allow-once', 'allow-always', 'deny-once']}
        ruleScope={false}
      />,
    );
    expect(screen.getByRole('group', { name: 'Run command' })).toHaveAccessibleDescription(
      /^Runs pnpm add zod\. Keyboard: /,
    );
  });

  it('nothing it does not know: no input and no risk is the keys alone', () => {
    render(<ApprovalCard toolName="run_command" />);
    expect(screen.getByRole('group', { name: 'Run command' })).toHaveAccessibleDescription(KEYS);
  });
});

describe('a lasting decision', () => {
  it('is announced with the calls it covers', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(
      <ApprovalCard
        toolName="run_command"
        input={{ command: 'rm -rf build' }}
        decisions={APPROVAL_DECISIONS}
        onDecide={onDecide}
      />,
    );
    const group = screen.getByRole('group', { name: 'Run command' });
    await user.click(screen.getByRole('checkbox', { name: 'Any arguments' }));
    group.focus();
    await user.keyboard('{Shift>}n{/Shift}');
    expect(onDecide).toHaveBeenCalledWith({ decision: 'deny-always' });
    expect(within(group).getByRole('status')).toHaveTextContent('Always denied: run_command, any arguments.');
  });

  it('a once decision is announced as before', async () => {
    const user = userEvent.setup();
    render(<ApprovalCard toolName="run_command" input={{ command: 'ls' }} decisions={APPROVAL_DECISIONS} />);
    const group = screen.getByRole('group', { name: 'Run command' });
    group.focus();
    await user.keyboard('y');
    expect(within(group).getByRole('status')).toHaveTextContent(/^Approved$/);
  });
});

describe('a critical press let go', () => {
  const critical = (props: Partial<Parameters<typeof ApprovalCard>[0]> = {}) => (
    <ApprovalCard toolName="run_command" input={{ command: 'rm -rf ~' }} risk="critical" {...props} />
  );

  it('says so on Escape', async () => {
    const user = userEvent.setup();
    render(critical());
    const group = screen.getByRole('group', { name: 'Run command' });
    await user.click(within(group).getByRole('button', { name: /^Approve/ }));
    expect(within(group).getByRole('status')).toHaveTextContent('Critical action. Press approve again to confirm.');
    await user.keyboard('{Escape}');
    expect(within(group).getByRole('button', { name: /^Approve/ })).toBeInTheDocument();
    expect(within(group).getByRole('status')).toHaveTextContent('Confirmation cancelled.');
  });

  it('says so when focus leaves the card', async () => {
    const user = userEvent.setup();
    render(
      <>
        {critical()}
        <button type="button">Elsewhere</button>
      </>,
    );
    const group = screen.getByRole('group', { name: 'Run command' });
    await user.click(within(group).getByRole('button', { name: /^Approve/ }));
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(within(group).getByRole('button', { name: /^Approve/ })).toBeInTheDocument();
    expect(within(group).getByRole('status')).toHaveTextContent('Confirmation cancelled.');
  });

  it('says so when a newer card takes the page-wide shortcut', async () => {
    const user = userEvent.setup();
    const { rerender } = render(critical({ globalShortcut: true }));
    const group = screen.getByRole('group', { name: 'Run command' });
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(within(group).getByRole('button', { name: /^Confirm approval/ })).toBeInTheDocument();
    rerender(
      <>
        {critical({ globalShortcut: true })}
        <ApprovalCard toolName="read_file" input={{ path: 'a' }} globalShortcut />
      </>,
    );
    expect(within(group).getByRole('button', { name: /^Approve/ })).toBeInTheDocument();
    expect(within(group).getByRole('status')).toHaveTextContent('Confirmation cancelled.');
  });

  it('says nothing more once confirmed, and the announcement clears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const onApprove = vi.fn();
      render(critical({ onApprove }));
      const group = screen.getByRole('group', { name: 'Run command' });
      await user.click(within(group).getByRole('button', { name: /^Approve/ }));
      await user.click(within(group).getByRole('button', { name: /^Confirm approval/ }));
      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(within(group).getByRole('status')).toHaveTextContent('Approved');
      act(() => vi.advanceTimersByTime(3000));
      expect(within(group).getByRole('status')).toHaveTextContent(/^$/);
    } finally {
      vi.useRealTimers();
    }
  });
});
