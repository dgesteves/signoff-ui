import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import {
  ApprovalCard,
  ToolApprovalBatch,
  ToolApprovalCard,
  type ApprovalChoice,
  type ToolApprovalResponse,
} from '../src/approval-card';
import { APPROVAL_DECISIONS, type ApprovalRule } from '../src/lib/policy';
import type { ToolPart } from '../src/lib/ai';
import { useApprovalPolicy, type ApprovalPolicy } from '../src/use-approval-policy';
import { assistant, axe, toolPart } from './utils';

const command = (cmd: string, toolCallId = `c-${cmd}`) =>
  toolPart('approval-requested', { toolName: 'run_command', toolCallId, input: { command: cmd } });

function card(props: Partial<Parameters<typeof ApprovalCard>[0]> = {}) {
  const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
  const user = userEvent.setup();
  const utils = render(
    <ApprovalCard
      toolName="run_command"
      input={{ command: 'npm test -- --watch' }}
      decisions={APPROVAL_DECISIONS}
      onDecide={onDecide}
      {...props}
    />,
  );
  return { ...utils, user, onDecide, group: screen.getByRole('group', { name: 'Run command' }) };
}

describe('ApprovalCard choices', () => {
  it('offers once, this session and always, each a button with its key', async () => {
    const { user, onDecide, group } = card();
    expect(within(group).getByRole('button', { name: /^Approve/ })).toHaveAttribute(
      'aria-keyshortcuts',
      'Y Control+Enter',
    );
    expect(within(group).getByRole('button', { name: /^For this session/ })).toHaveAttribute('aria-keyshortcuts', 'S');
    expect(within(group).getByRole('button', { name: 'Always' })).toHaveAttribute('aria-keyshortcuts', 'A');
    expect(within(group).getByRole('button', { name: 'Deny' })).toHaveAttribute('aria-keyshortcuts', 'N');
    expect(within(group).getByRole('button', { name: /^Always deny/ })).toHaveAttribute('aria-keyshortcuts', 'Shift+N');
    // What runs, and what S or A would remember, before the keys.
    expect(group).toHaveAccessibleDescription(
      'Runs npm test -- --watch. A lasting decision covers run_command with command npm test*. Keyboard: press Y to approve, S to approve for this session, A to always approve, N to deny, Shift N to always deny, or Ctrl Enter to approve.',
    );
    group.focus();
    await user.keyboard('s');
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'allow-session', args: { command: 'npm test*' } });
    // The announcement names the rule it saved.
    expect(within(group).getByRole('status')).toHaveTextContent(
      'Approved for this session: run_command with command npm test*.',
    );
  });

  it.each([
    ['a', 'allow-always'],
    ['y', 'allow-once'],
    ['n', 'deny-once'],
    ['{Shift>}n{/Shift}', 'deny-always'],
  ] as const)('decides with %s: %s', async (keys, decision) => {
    const { user, onDecide, group } = card();
    group.focus();
    await user.keyboard(keys);
    expect(onDecide.mock.calls[0]![0].decision).toBe(decision);
  });

  it('narrows the rule to the arguments you write, or none with Any arguments', async () => {
    const { user, onDecide } = card();
    expect(screen.getByText(/Remembered for/)).toHaveTextContent('Remembered for run_command calls where:');
    const pattern = screen.getByRole('textbox', { name: 'command matches' });
    expect(pattern).toHaveValue('npm test*');
    await user.clear(pattern);
    await user.type(pattern, 'npm *');
    await user.click(screen.getByRole('button', { name: 'Always' }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'allow-always', args: { command: 'npm *' } });
  });

  it('covers every call of the tool with Any arguments', async () => {
    const { user, onDecide } = card();
    await user.click(screen.getByRole('checkbox', { name: 'Any arguments' }));
    expect(screen.getByText(/Remembered for/)).toHaveTextContent('Remembered for run_command with any arguments.');
    await user.click(screen.getByRole('button', { name: /^Always deny/ }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'deny-always' });
  });

  it('sends a denial reason with an always deny', async () => {
    const { user, onDecide } = card();
    await user.click(screen.getByRole('button', { name: 'Deny with feedback' }));
    await user.keyboard('Use the test script');
    await user.click(screen.getByRole('button', { name: /^Always deny/ }));
    expect(onDecide).toHaveBeenLastCalledWith({
      decision: 'deny-always',
      reason: 'Use the test script',
      args: { command: 'npm test*' },
    });
  });

  it('asks for a second press of the same choice on a critical action', async () => {
    const { user, onDecide } = card({ risk: 'critical' });
    await user.click(screen.getByRole('button', { name: 'Always' }));
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Confirm approval/ })).toHaveAttribute('data-decision', 'allow-always');
    // Another approve choice does not confirm this one.
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Confirm approval/ }));
    expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ decision: 'allow-once' }));
  });

  it('offers only the decisions you pass, and keys for nothing else', async () => {
    const { user, onDecide, group } = card({ decisions: ['allow-once', 'deny-once'] });
    expect(screen.queryByRole('button', { name: /session|Always/ })).toBeNull();
    expect(screen.queryByText(/Remembered for/)).toBeNull();
    group.focus();
    await user.keyboard('sa{Shift>}n{/Shift}');
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('calls onApprove and onDeny when there is no onDecide, as before', async () => {
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(<ApprovalCard toolName="run_command" decisions={APPROVAL_DECISIONS} onApprove={onApprove} />);
    await user.click(screen.getByRole('button', { name: /^For this session/ }));
    expect(onApprove).toHaveBeenCalledWith();
  });

  it('says how a resolved decision was made', () => {
    const { rerender } = render(<ApprovalCard toolName="run_command" status="approved" decision="allow-session" />);
    expect(screen.getByText('Approved for this session')).toBeInTheDocument();
    rerender(<ApprovalCard toolName="run_command" status="denied" decision="deny-always" />);
    expect(screen.getByText('Always denied')).toBeInTheDocument();
    rerender(<ApprovalCard toolName="run_command" status="approved" decidedByRule="run_command with command npm *" />);
    expect(screen.getByText('Allowed by your rule')).toBeInTheDocument();
    expect(screen.getByText('· run_command with command npm *')).toBeInTheDocument();
    rerender(<ApprovalCard toolName="run_command" status="denied" decidedByRule="run_command, any arguments" />);
    expect(screen.getByText('Denied by your rule')).toBeInTheDocument();
  });
});

describe('ApprovalCard editing', () => {
  it('edits a flat input as a form and sends the edited arguments', async () => {
    const { user, onDecide } = card({ editable: true, input: { command: 'rm -rf build', dryRun: false, retries: 2 } });
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    expect(screen.getByRole('button', { name: 'Done editing' })).toHaveAttribute('aria-expanded', 'true');
    const commandField = screen.getByRole('textbox', { name: 'command' });
    await user.clear(commandField);
    await user.type(commandField, 'rm -rf build/cache');
    await user.click(screen.getByRole('checkbox', { name: 'dryRun' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'retries' }));
    await user.type(screen.getByRole('spinbutton', { name: 'retries' }), '0');
    expect(screen.getByText('Edited: approving runs the new arguments.')).toBeInTheDocument();
    // The rule's suggestion follows the edit.
    expect(screen.getByRole('textbox', { name: 'command matches' })).toHaveValue('rm -rf build/cache');
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).toHaveBeenLastCalledWith({
      decision: 'allow-once',
      input: { command: 'rm -rf build/cache', dryRun: true, retries: 0 },
    });
  });

  it('edits any other input as JSON, and will not approve JSON that does not parse', async () => {
    const { user, onDecide } = card({ editable: true, input: { files: ['a.ts'], options: { force: true } } });
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    const json = screen.getByRole('textbox', { name: 'Arguments, as JSON' });
    await user.clear(json);
    await user.type(json, '{{"files": [[');
    expect(json).toHaveAttribute('aria-invalid', 'true');
    expect(json).toHaveAccessibleDescription(/^Not valid JSON/);
    const approve = screen.getByRole('button', { name: /^Approve/ });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    await user.click(approve);
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('The arguments are not valid JSON.');
    // Denying is still possible.
    await user.clear(json);
    await user.type(json, '{{"files": [["b.ts"]}');
    await user.click(approve);
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'allow-once', input: { files: ['b.ts'] } });
  });

  it('sends no input when the edit changed nothing, and undoes edits', async () => {
    const { user, onDecide } = card({ editable: true });
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    const field = screen.getByRole('textbox', { name: 'command' });
    await user.type(field, ' -u');
    await user.click(screen.getByRole('button', { name: 'Undo edits' }));
    expect(field).toHaveValue('npm test -- --watch');
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'allow-once' });
  });

  it("leaves the scope out when the agent keeps what 'always' means (ruleScope={false})", async () => {
    const { user, onDecide } = card({ ruleScope: false });
    expect(screen.queryByText(/Remembered for/)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Any arguments' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Always' }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'allow-always' });
  });

  it('has no axe violations while editing and with the rule scope', async () => {
    const { user, container } = card({ editable: true, input: { command: 'ls', cwd: '/repo' } });
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

function withPolicy(rules: ApprovalRule[] = []) {
  return renderHook(() => useApprovalPolicy({ defaultRules: rules })).result;
}

describe('ToolApprovalCard with a policy', () => {
  it('answers a call a rule decides without asking, and says so once answered', async () => {
    const policy = withPolicy([
      { id: 'r', tool: 'run_command', args: { command: 'npm test*' }, effect: 'allow', scope: 'session' },
    ]);
    await waitFor(() => expect(policy.current.ready).toBe(true));
    const onRespond = vi.fn<(r: ToolApprovalResponse) => void>();
    const part = command('npm test -- -u');
    const { rerender } = render(<ToolApprovalCard part={part} onRespond={onRespond} policy={policy.current} />);
    expect(screen.queryByRole('group')).toBeNull();
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1));
    expect(onRespond).toHaveBeenCalledWith({ id: 'approval_c-npm test -- -u', approved: true });
    // The SDK then marks the part approved.
    const approved = {
      ...part,
      state: 'approval-responded',
      approval: { ...part.approval!, approved: true },
    } as ToolPart;
    rerender(<ToolApprovalCard part={approved} onRespond={onRespond} policy={policy.current} />);
    expect(screen.getByRole('group')).toHaveTextContent('Allowed by your rule');
    expect(screen.getByRole('group')).toHaveTextContent('run_command with command npm test*');
    expect(onRespond).toHaveBeenCalledTimes(1);
  });

  it('offers every choice and records the rule a person makes', async () => {
    const policy = withPolicy();
    const onRespond = vi.fn<(r: ToolApprovalResponse) => void>();
    const user = userEvent.setup();
    render(<ToolApprovalCard part={command('npm ci')} onRespond={onRespond} policy={policy.current} />);
    await user.click(screen.getByRole('button', { name: 'Always' }));
    expect(onRespond).toHaveBeenCalledWith({ id: 'approval_c-npm ci', approved: true });
    await waitFor(() =>
      expect(policy.current.rules).toMatchObject([{ args: { command: 'npm ci*' }, scope: 'always' }]),
    );
    expect(policy.current.outcomeOf('approval_c-npm ci')).toMatchObject({ decision: 'allow-always', by: 'user' });
  });

  it('answers once when a person makes the rule, even while the call still reads pending', async () => {
    // A runtime that records the answer a moment later (assistant-ui) re-renders the card with the
    // new session rule while the part is still pending: the rule must not answer it a second time.
    const onRespond = vi.fn<(r: ToolApprovalResponse) => void>();
    function Card() {
      const policy = useApprovalPolicy();
      return <ToolApprovalCard part={command('npm ci')} onRespond={onRespond} policy={policy} />;
    }
    const user = userEvent.setup();
    render(<Card />);
    await user.click(screen.getByRole('button', { name: 'For this session' }));
    await act(async () => {});
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith({ id: 'approval_c-npm ci', approved: true });
  });

  it('edits arguments only where the edit can be applied, and applies it before answering', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const onEditInput = vi.fn((id: string, input: unknown) => void calls.push(`edit ${id} ${JSON.stringify(input)}`));
    const onRespond = vi.fn((r: ToolApprovalResponse) => void calls.push(`respond ${r.approved}`));
    const { rerender } = render(<ToolApprovalCard part={command('rm -rf build')} onRespond={onRespond} />);
    expect(screen.queryByRole('button', { name: 'Edit arguments' })).toBeNull();
    rerender(<ToolApprovalCard part={command('rm -rf build')} onRespond={onRespond} onEditInput={onEditInput} />);
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    const field = screen.getByRole('textbox', { name: 'command' });
    await user.clear(field);
    await user.type(field, 'rm -rf build/cache');
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(calls).toEqual(['edit c-rm -rf build {"command":"rm -rf build/cache"}', 'respond true']);
  });

  it('stays out of the way while the policy has not loaded', async () => {
    const onRespond = vi.fn();
    const policy = {
      rules: [{ id: 'r', tool: '*', effect: 'allow', scope: 'session' }],
      ready: false,
      answer: vi.fn(),
    } as unknown as ApprovalPolicy;
    render(<ToolApprovalCard part={command('ls')} onRespond={onRespond} policy={policy} />);
    await act(async () => {});
    expect(policy.answer).not.toHaveBeenCalled();
    expect(onRespond).not.toHaveBeenCalled();
  });
});

describe('ToolApprovalBatch', () => {
  const parts = [command('npm ci', 'a'), command('npm test', 'b'), toolPart('output-available', { toolCallId: 'c' })];

  it('approves or denies every waiting approval at once', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn<(r: ToolApprovalResponse) => void>();
    const { rerender } = render(<ToolApprovalBatch parts={parts} onRespond={onRespond} />);
    expect(screen.getByRole('group', { name: 'Approvals waiting' })).toHaveTextContent('2 approvals are waiting.');
    await user.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(onRespond.mock.calls.map(([r]) => r)).toEqual([
      { id: 'approval_a', approved: true },
      { id: 'approval_b', approved: true },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('2 approvals approved.');
    onRespond.mockClear();
    rerender(<ToolApprovalBatch parts={parts} onRespond={onRespond} />);
    await user.click(screen.getByRole('button', { name: 'Deny all' }));
    expect(onRespond.mock.calls.map(([r]) => r.approved)).toEqual([false, false]);
  });

  it('asks for a second press when one of them is critical', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(
      <ToolApprovalBatch
        parts={parts}
        onRespond={onRespond}
        tools={{
          run_command: { risk: (input) => ((input as { command: string }).command === 'npm ci' ? 'critical' : 'low') },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(onRespond).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm approve all' }));
    expect(onRespond).toHaveBeenCalledTimes(2);
  });

  /** Answers as `addToolApprovalResponse` does: the part it answers reads approval-responded. */
  const answered = (all: ToolPart[], response: ToolApprovalResponse) =>
    all.map((part) =>
      part.approval?.id === response.id
        ? ({
            ...part,
            state: 'approval-responded',
            approval: { ...part.approval, approved: response.approved },
          } as ToolPart)
        : part,
    );

  it.each([
    ['Approve all', '2 approvals approved.'],
    ['Deny all', '2 approvals denied.'],
  ])(
    'once %s has answered them and gone, says so, and leaves focus on the first card it answered',
    async (button, said) => {
      const user = userEvent.setup();
      function Run() {
        const [current, setCurrent] = useState<ToolPart[]>([command('npm ci', 'a'), command('npm test', 'b')]);
        const respond = (response: ToolApprovalResponse) => setCurrent((all) => answered(all, response));
        return (
          <>
            <ToolApprovalBatch parts={current} onRespond={respond} />
            {current.map((part) => (
              <ToolApprovalCard key={part.toolCallId} part={part} onRespond={respond} />
            ))}
          </>
        );
      }
      render(<Run />);
      await user.click(screen.getByRole('button', { name: button }));
      expect(screen.queryByRole('group', { name: 'Approvals waiting' })).toBeNull();
      expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain(said);
      const [first] = screen.getAllByRole('group', { name: 'Run command' });
      expect(first).toHaveFocus();
      expect(first).toHaveAttribute('data-status', button === 'Approve all' ? 'approved' : 'denied');
    },
  );

  it('does the same in an AgentMessage whose parts the answers update', async () => {
    const user = userEvent.setup();
    function Run() {
      const [current, setCurrent] = useState<ToolPart[]>([command('npm ci', 'a'), command('npm test', 'b')]);
      return (
        <AgentMessage
          message={assistant(current)}
          onToolApproval={(response) => setCurrent((all) => answered(all, response))}
        />
      );
    }
    render(<Run />);
    screen.getByRole('button', { name: 'Approve all' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('group', { name: 'Approvals waiting' })).toBeNull();
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain('2 approvals approved.');
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toHaveAttribute('data-slot', 'signoff-approval-card');
    expect(document.activeElement).toHaveAttribute('data-status', 'approved');
  });

  it('says it left a press of Approve all unconfirmed, on Escape or when focus leaves it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ToolApprovalBatch parts={parts} onRespond={vi.fn()} tools={{ run_command: { risk: 'critical' } }} />
        <button type="button">Elsewhere</button>
      </>,
    );
    const status = () => screen.getAllByRole('status').map((s) => s.textContent);
    await user.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(status()).toContain('One of them is critical. Press Approve all again to confirm.');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Approve all' })).toBeInTheDocument();
    expect(status()).toContain('Confirmation cancelled.');
    await user.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(status()).toContain('One of them is critical. Press Approve all again to confirm.');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.getByRole('button', { name: 'Approve all' })).toBeInTheDocument();
    expect(status()).toContain('Confirmation cancelled.');
  });

  it('shows from two waiting approvals, leaving out those a rule decides, and records them', async () => {
    const policy = withPolicy([
      { id: 'r', tool: 'run_command', args: { command: 'npm test*' }, effect: 'allow', scope: 'session' },
    ]);
    const onRespond = vi.fn();
    const { rerender } = render(<ToolApprovalBatch parts={parts} onRespond={onRespond} policy={policy.current} />);
    expect(screen.queryByRole('group')).toBeNull();
    const three = [...parts, command('npm run lint', 'd')];
    rerender(<ToolApprovalBatch parts={three} onRespond={onRespond} policy={policy.current} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(onRespond).toHaveBeenCalledTimes(2);
    expect(policy.current.outcomeOf('approval_d')).toMatchObject({ decision: 'allow-once', by: 'user' });
  });
});

describe('AgentMessage with approval rules', () => {
  it('passes the policy and edits to its cards, and offers Approve all', async () => {
    const user = userEvent.setup();
    function Run() {
      const policy = useApprovalPolicy();
      const [responses, setResponses] = useState<ToolApprovalResponse[]>([]);
      return (
        <>
          <AgentMessage
            message={assistant([command('npm ci', 'a'), command('npm test', 'b')])}
            onToolApproval={(r) => setResponses((all) => [...all, r])}
            approvalPolicy={policy}
            onToolInputEdit={() => {}}
          />
          <output>{responses.map((r) => `${r.id}:${r.approved}`).join(',')}</output>
        </>
      );
    }
    render(<Run />);
    expect(screen.getAllByRole('button', { name: 'Edit arguments' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^For this session/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(document.querySelector('output')).toHaveTextContent('approval_a:true,approval_b:true');
  });
});
