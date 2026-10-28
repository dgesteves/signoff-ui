import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  acpToolName,
  answerAcpPermission,
  createAcpTurn,
  decisionsFromAcpOptions,
  endAcpTurn,
  fromAcpDiffs,
  reduceAcpTurn,
  requestAcpPermission,
  toAcpDiffs,
  toAcpMessage,
  toAcpPermissionResponse,
  type AcpPermission,
  type AcpPermissionOption,
  type AcpSessionUpdate,
  type AcpTurn,
} from '../src/acp';
import { AgentMessage } from '../src/agent-message';
import { ApprovalCard, ToolApprovalCard } from '../src/approval-card';
import { deriveAgentState, type ToolPart } from '../src/lib/ai';

/*
 * signoff-ui/acp: an Agent Client Protocol prompt turn (`session/update` notifications and
 * `session/request_permission` requests) as the message parts the components render.
 */

const play = (...updates: (AcpSessionUpdate & Record<string, unknown>)[]) =>
  updates.reduce<AcpTurn>((turn, update) => reduceAcpTurn(turn, { sessionId: 's1', update }), createAcpTurn());

const chunk = (sessionUpdate: string, text: string) => ({ sessionUpdate, content: { type: 'text', text } });

const options: AcpPermissionOption[] = [
  { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
  { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'no', name: 'Reject', kind: 'reject_once' },
];

const edit = {
  toolCallId: 'edit-1',
  title: 'Edit lib/format.ts',
  kind: 'edit',
  status: 'pending' as const,
  rawInput: { path: '/repo/lib/format.ts' },
  content: [
    {
      type: 'diff' as const,
      path: '/repo/lib/format.ts',
      oldText: 'export const s = (ms) => ms / 1000;\n',
      newText: 'export const s = (ms) => Math.floor(ms / 100) / 10;\n',
    },
  ],
};

describe('reduceAcpTurn', () => {
  it('streams message and thought chunks into text and reasoning, in the order they arrive', () => {
    const turn = play(
      chunk('agent_thought_chunk', 'The test '),
      chunk('agent_thought_chunk', 'rounds up.'),
      chunk('agent_message_chunk', "I'll read "),
      chunk('agent_message_chunk', 'the formatter.'),
    );
    expect(turn.status).toBe('streaming');
    expect(turn.items).toEqual([
      { type: 'reasoning', text: 'The test rounds up.' },
      { type: 'text', text: "I'll read the formatter." },
    ]);
    expect(toAcpMessage(turn).parts).toEqual([
      { type: 'reasoning', text: 'The test rounds up.', state: 'done' },
      { type: 'text', text: "I'll read the formatter.", state: 'streaming' },
    ]);
  });

  it('takes the notification or its update, and leaves out what is not part of the reply', () => {
    const start = createAcpTurn();
    expect(start.status).toBe('submitted');
    const update = chunk('agent_message_chunk', 'Hi');
    expect(reduceAcpTurn(start, update)).toEqual(reduceAcpTurn(start, { sessionId: 's1', update }));
    for (const ignored of [
      chunk('user_message_chunk', 'Fix the test'),
      { sessionUpdate: 'plan', entries: [] },
      { sessionUpdate: 'available_commands_update', availableCommands: [] },
      { sessionUpdate: 'tool_call' },
    ])
      expect(reduceAcpTurn(start, ignored)).toBe(start);
    // An image says the agent is replying, but adds no text.
    expect(
      reduceAcpTurn(start, { sessionUpdate: 'agent_message_chunk', content: { type: 'image' } } as AcpSessionUpdate),
    ).toMatchObject({ status: 'streaming', items: [] });
  });

  it('merges tool call updates by id: content replaced, null and missing fields kept', () => {
    const turn = play(
      { sessionUpdate: 'tool_call', toolCallId: 'r1', title: 'Read lib/format.ts', kind: 'read', status: 'pending' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'r1', status: 'in_progress', title: null },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'r1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'export const s = …' } }],
      },
      // An update for a call never announced is taken as the call.
      { sessionUpdate: 'tool_call_update', toolCallId: 'x1', kind: 'search', status: 'in_progress' },
    );
    expect(turn.items).toEqual([
      { type: 'tool', toolCallId: 'r1' },
      { type: 'tool', toolCallId: 'x1' },
    ]);
    expect(turn.toolCalls.r1).toMatchObject({ title: 'Read lib/format.ts', kind: 'read', status: 'completed' });
    expect(toAcpMessage(turn).parts).toEqual([
      {
        type: 'dynamic-tool',
        toolName: 'read',
        toolCallId: 'r1',
        title: 'Read lib/format.ts',
        input: {},
        state: 'output-available',
        output: 'export const s = …',
      },
      { type: 'dynamic-tool', toolName: 'search', toolCallId: 'x1', input: {}, state: 'input-available' },
    ]);
  });

  it('names a tool by its name, else its kind, else its title, and reports a failure with its text', () => {
    const turn = play(
      { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'Run tests', name: 'Bash', kind: 'execute' },
      { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'Think it over' },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'c',
        kind: 'execute',
        status: 'failed',
        content: [{ type: 'content', content: { type: 'text', text: 'exit code 1' } }],
      },
      { sessionUpdate: 'tool_call', toolCallId: 'd', kind: 'fetch', status: 'completed', rawOutput: { status: 200 } },
      { sessionUpdate: 'tool_call', toolCallId: 'e', kind: 'execute', status: 'failed' },
    );
    const parts = toAcpMessage(turn).parts as ToolPart[];
    expect(parts.map((p) => (p.type === 'dynamic-tool' ? p.toolName : ''))).toEqual([
      'Bash',
      'Think it over',
      'execute',
      'fetch',
      'execute',
    ]);
    expect(parts[2]).toMatchObject({ state: 'output-error', errorText: 'exit code 1' });
    expect(parts[3]).toMatchObject({ state: 'output-available', output: { status: 200 } });
    expect(parts[4]).toMatchObject({ state: 'output-error', errorText: 'Failed' });
  });
});

describe('permission requests', () => {
  const asked = () =>
    requestAcpPermission(play(chunk('agent_message_chunk', 'Fixing it.')), {
      sessionId: 's1',
      toolCall: edit,
      options,
    });

  it('waits on a person: an approval request whose id is the tool call id', () => {
    const turn = asked();
    expect(turn.permissions['edit-1']).toEqual({ options });
    const message = toAcpMessage(turn);
    expect(message.parts[1]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'edit',
      title: 'Edit lib/format.ts',
      state: 'approval-requested',
      approval: { id: 'edit-1' },
      input: { path: '/repo/lib/format.ts' },
    });
    expect(deriveAgentState({ status: 'streaming', message }).state).toBe('awaiting-approval');
  });

  it('records the decision, and keeps the approval once the call has run', () => {
    let turn = answerAcpPermission(asked(), 'edit-1', 'allow-always');
    expect(turn.permissions['edit-1']!.decision).toBe('allow-always');
    expect(toAcpMessage(turn).parts[1]).toMatchObject({
      state: 'approval-responded',
      approval: { id: 'edit-1', approved: true },
    });
    turn = reduceAcpTurn(turn, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'edit-1',
      status: 'completed',
    } as AcpSessionUpdate);
    expect(toAcpMessage(turn).parts[1]).toMatchObject({
      state: 'output-available',
      output: null,
      approval: { id: 'edit-1', approved: true },
    });
  });

  it('shows a denial, and a cancelled request as denied', () => {
    expect(toAcpMessage(answerAcpPermission(asked(), 'edit-1', 'deny-once')).parts[1]).toMatchObject({
      state: 'output-denied',
      approval: { id: 'edit-1', approved: false },
    });
    expect(toAcpMessage(answerAcpPermission(asked(), 'edit-1', 'cancelled')).parts[1]).toMatchObject({
      state: 'output-denied',
      approval: { id: 'edit-1', approved: false, reason: 'Cancelled' },
    });
    // The agent then reports the call failed: it still reads as the person's no.
    const failed = reduceAcpTurn(answerAcpPermission(asked(), 'edit-1', 'deny-once'), {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'edit-1',
      status: 'failed',
    } as AcpSessionUpdate);
    expect(toAcpMessage(failed).parts[1]).toMatchObject({ state: 'output-denied' });
    const turn = asked();
    expect(answerAcpPermission(turn, 'unknown', 'allow-once')).toBe(turn);
  });

  it('goes through the kit: the card offers the agent options, and its decision is the response', () => {
    const turn = asked();
    const part = toAcpMessage(turn).parts[1] as ToolPart;
    render(<ToolApprovalCard part={part} onRespond={() => {}} decisions={decisionsFromAcpOptions(options)} />);
    expect(screen.getByRole('group', { name: /Edit lib\/format\.ts/ })).toHaveAttribute('data-status', 'pending');
    expect(screen.getByRole('button', { name: 'Always' })).toBeInTheDocument();
    expect(toAcpPermissionResponse('allow-always', turn.permissions['edit-1']!.options)).toEqual({
      outcome: { outcome: 'selected', optionId: 'always' },
    });
  });

  /**
   * The card as the ACP docs render it, for the agent's tool call, answering the agent with
   * `toAcpPermissionResponse`. Like the use-approval-policy docs, it names a single allow_always
   * option in the description and the resolved line, and keeps the button's short label: a long name
   * on a button that doesn't wrap pushes Approve and Deny off a phone-width card.
   */
  function DocsCard({
    call,
    permission,
    onAnswer,
    resolved = false,
  }: {
    call: { kind: string; title: string; rawInput: unknown };
    permission: AcpPermission;
    onAnswer: (r: unknown) => void;
    resolved?: boolean;
  }) {
    const decisions = decisionsFromAcpOptions(permission.options).filter((d) => d !== 'allow-session');
    const always = decisions.includes('allow-always')
      ? permission.options.find((o) => o.kind === 'allow_always')?.name
      : undefined;
    return (
      <ApprovalCard
        toolName={acpToolName(call)}
        title={call.title}
        input={call.rawInput}
        ruleScope={false}
        decisions={decisions}
        description={always ? `Always: ${always}` : undefined}
        labels={{ approvalCard: { resolved: { 'allow-always': always } } }}
        onDecide={(choice) => onAnswer(toAcpPermissionResponse(choice.decision, permission.options))}
        {...(resolved ? { status: 'approved' as const, decision: 'allow-always' as const } : {})}
      />
    );
  }

  // The tool calls these agents send: claude-agent-acp's ExitPlanMode (its permission title) and Edit,
  // and a codex-acp command, whose title is the command.
  const exitPlanCall = { kind: 'switch_mode', title: 'Ready to code?', rawInput: { plan: '1. Fix the rounding.' } };
  const editCall = {
    kind: 'edit',
    title: 'Edit src/money.ts',
    rawInput: { file_path: '/repo/src/money.ts', old_string: 'Math.round(x)', new_string: 'Math.round(x * 100) / 100' },
  };
  const execCall = { kind: 'execute', title: 'pnpm test', rawInput: { command: ['pnpm', 'test'] } };

  it('offers no Always that would pick one of several grants: Claude Code’s ExitPlanMode', async () => {
    // @agentclientprotocol/claude-agent-acp 0.90.0, with a plan and auto and bypass modes on: three allow_always.
    const options: AcpPermissionOption[] = [
      { optionId: 'exit-plan-default', name: 'Yes, manually approve edits', kind: 'allow_once' },
      {
        optionId: 'exit-plan-clear-auto',
        name: 'Yes, clear context (26% used) and use auto mode',
        kind: 'allow_always',
      },
      { optionId: 'exit-plan-auto', name: 'Yes, and use auto mode', kind: 'allow_always' },
      { optionId: 'exit-plan-bypass', name: 'Yes, and bypass permissions', kind: 'allow_always' },
      { optionId: 'reject', name: 'No, keep planning', kind: 'reject_once' },
    ];
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    render(<DocsCard call={exitPlanCall} permission={{ options }} onAnswer={onAnswer} />);
    expect(screen.queryByRole('button', { name: /Always/ })).not.toBeInTheDocument();
    // Nor a description naming one of the three.
    expect(screen.queryByText(/^Always:/)).not.toBeInTheDocument();
    screen.getByRole('group', { name: 'Ready to code?' }).focus();
    await user.keyboard('a');
    expect(onAnswer).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Approve/ }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      outcome: { outcome: 'selected', optionId: 'exit-plan-default' },
    });
  });

  it('keeps Always when the agent sends one allow_always option: Claude Code’s Edit', async () => {
    const options: AcpPermissionOption[] = [
      { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
      { optionId: 'allow-with-updates', name: 'Yes, allow all edits during this session', kind: 'allow_always' },
      { optionId: 'reject', name: 'No', kind: 'reject_once' },
    ];
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<DocsCard call={editCall} permission={{ options }} onAnswer={onAnswer} />);
    // The button keeps its short label; the card's description says what it grants.
    expect(screen.getByRole('group', { name: 'Edit src/money.ts' })).toHaveAccessibleDescription(
      /^Always: Yes, allow all edits during this session/,
    );
    await user.click(screen.getByRole('button', { name: 'Always' }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      outcome: { outcome: 'selected', optionId: 'allow-with-updates' },
    });
    // Once decided, the card's line names the option, and so does the announcement.
    rerender(<DocsCard call={editCall} permission={{ options }} onAnswer={onAnswer} resolved />);
    expect(screen.getByText('Yes, allow all edits during this session', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Yes, allow all edits during this session');
  });

  it('keeps Deny when the agent sends several reject_once options: codex-acp’s Denied and Abort', async () => {
    const options: AcpPermissionOption[] = [
      { optionId: 'approved', name: 'Yes, proceed', kind: 'allow_once' },
      { optionId: 'denied', name: 'No, continue without running it', kind: 'reject_once' },
      { optionId: 'abort', name: 'No, and tell Codex what to do differently', kind: 'reject_once' },
    ];
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    render(<DocsCard call={execCall} permission={{ options }} onAnswer={onAnswer} />);
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ outcome: { outcome: 'selected', optionId: 'denied' } });
  });
});

describe('the end of a turn', () => {
  it('is ready with its stop reason, or failed with the error', () => {
    const turn = play(chunk('agent_message_chunk', 'Done.'));
    const ended = endAcpTurn(turn, { stopReason: 'end_turn' });
    expect(ended).toMatchObject({ status: 'ready', stopReason: 'end_turn' });
    expect(toAcpMessage(ended).parts).toEqual([{ type: 'text', text: 'Done.', state: 'done' }]);
    expect(endAcpTurn(turn, { error: { message: 'Internal error' } })).toMatchObject({
      status: 'error',
      error: { message: 'Internal error' },
    });
  });

  it('leaves the text it was writing cut off when the turn is cancelled, so the run reads as stopped', () => {
    const writing = play(chunk('agent_message_chunk', 'I will refactor the'));
    const cancelled = endAcpTurn(writing, { stopReason: 'cancelled' });
    const message = toAcpMessage(cancelled);
    expect(message.parts).toEqual([{ type: 'text', text: 'I will refactor the', state: 'streaming' }]);
    expect(deriveAgentState({ status: cancelled.status, message })).toEqual({ state: 'stopped' });
    // The same for a thought cut off.
    const thinking = endAcpTurn(play(chunk('agent_thought_chunk', 'First the')), { stopReason: 'cancelled' });
    expect(toAcpMessage(thinking).parts).toEqual([{ type: 'reasoning', text: 'First the', state: 'streaming' }]);
    // A turn that ended on its own is done, however it ended.
    for (const stopReason of ['end_turn', 'max_tokens', 'refusal']) {
      const ended = endAcpTurn(writing, { stopReason });
      const done = toAcpMessage(ended);
      expect(done.parts).toEqual([{ type: 'text', text: 'I will refactor the', state: 'done' }]);
      expect(deriveAgentState({ status: ended.status, message: done })).toEqual({ state: 'done' });
    }
    // Text before a call is finished, cancelled or not: only the last part can be cut off.
    const before = endAcpTurn(
      play(chunk('agent_message_chunk', 'Running the tests.'), {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'pnpm test',
        kind: 'execute',
        status: 'completed',
      }),
      { stopReason: 'cancelled' },
    );
    expect(toAcpMessage(before).parts[0]).toEqual({ type: 'text', text: 'Running the tests.', state: 'done' });
  });

  it('renders in AgentMessage, with a call left running read as stopped once the turn is cancelled', () => {
    const turn = endAcpTurn(
      play(chunk('agent_message_chunk', 'Running the tests.'), {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'pnpm test',
        kind: 'execute',
        status: 'in_progress',
      }),
      { stopReason: 'cancelled' },
    );
    const message = toAcpMessage(turn, 'm1');
    expect(message).toMatchObject({ id: 'm1', role: 'assistant' });
    expect(deriveAgentState({ status: turn.status, message }).state).toBe('stopped');
    render(<AgentMessage message={message} active={false} />);
    expect(screen.getByText('Running the tests.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pnpm test/ })).toHaveTextContent(/Stopped/);
  });
});

describe('diff content', () => {
  it('becomes DiffReview files, relative to the session root, new files with no old text', () => {
    const content = [
      ...edit.content,
      { type: 'diff' as const, path: '/repo/lib/new.ts', newText: 'export {};\n' },
      { type: 'diff' as const, path: '/elsewhere/a.ts', oldText: null, newText: 'a\n' },
      { type: 'content' as const, content: { type: 'text', text: 'not a file' } },
      { type: 'terminal' as const, terminalId: 'term-1' },
    ];
    expect(fromAcpDiffs(content, { root: '/repo/' })).toEqual([
      { path: 'lib/format.ts', oldContent: edit.content[0]!.oldText, newContent: edit.content[0]!.newText },
      { path: 'lib/new.ts', oldContent: '', newContent: 'export {};\n' },
      { path: '/elsewhere/a.ts', oldContent: '', newContent: 'a\n' },
    ]);
    expect(fromAcpDiffs(content).map((f) => f.path)).toEqual([
      '/repo/lib/format.ts',
      '/repo/lib/new.ts',
      '/elsewhere/a.ts',
    ]);
    expect(fromAcpDiffs(undefined)).toEqual([]);
  });

  it('comes back from files, round trip', () => {
    const files = fromAcpDiffs(edit.content, { root: '/repo' });
    expect(toAcpDiffs(files, { root: '/repo' })).toEqual(edit.content);
    expect(
      toAcpDiffs([
        { path: '/abs/new.ts', newContent: 'x\n' },
        { path: 'gone.ts', oldContent: 'y\n' },
      ]),
    ).toEqual([
      { type: 'diff', path: '/abs/new.ts', newText: 'x\n' },
      { type: 'diff', path: 'gone.ts', oldText: 'y\n', newText: '' },
    ]);
  });

  it('takes a root with any number of slashes at its end', () => {
    for (const root of ['/repo', '/repo/', '/repo///']) {
      expect(fromAcpDiffs([{ type: 'diff', path: '/repo/a.ts', newText: '' }], { root })[0]!.path).toBe('a.ts');
      expect(toAcpDiffs([{ path: 'a.ts', newContent: '' }], { root })[0]!.path).toBe('/repo/a.ts');
    }
    for (const root of ['/', '///']) {
      expect(fromAcpDiffs([{ type: 'diff', path: '/a.ts', newText: '' }], { root })[0]!.path).toBe('a.ts');
      expect(toAcpDiffs([{ path: 'a.ts', newContent: '' }], { root })[0]!.path).toBe('/a.ts');
    }
  });

  it('reads a root with a long run of slashes once, not once from each of them', () => {
    const root = `${'/'.repeat(100_000)}x`;
    const start = performance.now();
    expect(fromAcpDiffs([{ type: 'diff', path: `${root}/a.ts`, newText: '' }], { root })[0]!.path).toBe('a.ts');
    expect(toAcpDiffs([{ path: 'a.ts', newContent: '' }], { root })[0]!.path).toBe(`${root}/a.ts`);
    // Read again from each slash, each takes about 20 seconds.
    expect(performance.now() - start).toBeLessThan(100);
  });
});
