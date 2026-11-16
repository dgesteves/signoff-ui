import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { convertToModelMessages, jsonSchema, readUIMessageStream, streamText, tool, type UIMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import { deriveAgentState, getToolPhase } from '../src/lib/ai';
import { ToolCallTimeline } from '../src/tool-call-timeline';
import { useApprovalPolicy } from '../src/use-approval-policy';
import { AI_SDK_MAJOR, toolPart } from './utils';

/** Every intermediate message useChat would render for a run whose approvals a policy decides. */
async function policyRun() {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'stream-start', warnings: [] });
          c.enqueue({ type: 'tool-call', toolCallId: 'c_ls', toolName: 'run_command', input: '{"command":"ls"}' });
          c.enqueue({
            type: 'tool-call',
            toolCallId: 'c_rm',
            toolName: 'run_command',
            input: '{"command":"rm -rf /"}',
          });
          c.enqueue({
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          });
          c.close();
        },
      }),
    }),
  });
  const tools = {
    run_command: tool({
      inputSchema: jsonSchema<{ command: string }>({ type: 'object', properties: { command: { type: 'string' } } }),
      execute: async () => 'ok',
    }),
  };
  const messages: UIMessage[] = [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'go' }] }];
  const stream = streamText({
    model,
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    // No human involved: safe commands run, destructive ones are blocked.
    toolApproval: {
      run_command: (input) => (input.command === 'ls' ? 'approved' : { type: 'denied', reason: 'Destructive command' }),
    },
  }).toUIMessageStream({ originalMessages: messages });
  const snapshots: UIMessage[] = [];
  for await (const message of readUIMessageStream({ stream })) snapshots.push(message);
  return snapshots;
}

// `toolApproval` policies and the V4 mock models are AI SDK 7.
describe.skipIf(AI_SDK_MAJOR < 7)('approvals decided automatically by a policy', () => {
  it('never shows an approval prompt, steals focus or reports a wait on the user', async () => {
    const snapshots = await policyRun();
    // The SDK streams a policy decision as a request (isAutomatic) followed by its response.
    expect(
      snapshots.some((m) =>
        m.parts.some((p) => 'state' in p && p.state === 'approval-requested' && p.approval?.isAutomatic),
      ),
    ).toBe(true);
    for (const message of snapshots) {
      expect(deriveAgentState({ status: 'streaming', message }).state).not.toBe('awaiting-approval');
      render(<AgentMessage message={message} onToolApproval={() => {}} approvalProps={{ autoFocus: true }} />);
      expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
      expect(screen.queryByText('Needs approval')).toBeNull();
      expect(document.activeElement).toBe(document.body);
      cleanup();
    }
  });

  it('labels the outcome as a policy decision, not a human one', async () => {
    const snapshots = await policyRun();
    render(<AgentMessage message={snapshots.at(-1)!} onToolApproval={() => {}} />);
    const [ls, rm] = screen.getAllByRole('group');
    expect(ls).toHaveTextContent('Auto-approved');
    expect(rm).toHaveTextContent('Blocked by policy');
    expect(rm).toHaveTextContent('Destructive command');
    expect(within(ls!).queryByText('Approved')).toBeNull();
    expect(within(rm!).queryByText('Denied')).toBeNull();
    const denied = screen.getAllByRole('button', { name: /Run command/ })[1]!;
    await userEvent.click(denied);
    const details = denied.closest('li')!;
    expect(within(details).getByText(/Blocked by policy/, { selector: 'p' })).toHaveTextContent(
      'Blocked by policy: Destructive command',
    );
    expect(within(details).queryByText(/by user/)).toBeNull();
  });

  it("leaves the SDK's decision to the SDK, even when the page's own rule covers the call", async () => {
    // The request (isAutomatic) and its response are two chunks: a render can fall between them.
    // The card then sees a pending call that the page's rule covers too. Answering it from the
    // policy sent a second response, here approving the rm the SDK blocked, and labelled the
    // outcome "Allowed by your rule" (examples/coding-agent counted 2 auto-approved calls, not 3).
    const snapshots = await policyRun();
    const pending = snapshots.filter((m) =>
      m.parts.some((p) => 'state' in p && p.state === 'approval-requested' && p.approval?.isAutomatic),
    );
    expect(pending.length).toBeGreaterThan(0);
    const onToolApproval = vi.fn();
    function Chat({ message }: { message: UIMessage }) {
      const policy = useApprovalPolicy({
        defaultRules: [{ id: 'mine', tool: 'run_command', effect: 'allow', scope: 'always' }],
      });
      return (
        <>
          <output>{policy.ready ? 'ready' : 'loading'}</output>
          <AgentMessage message={message} onToolApproval={onToolApproval} approvalPolicy={policy} />
        </>
      );
    }
    const { rerender } = render(<Chat message={pending[0]!} />);
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
    for (const message of [...pending, ...snapshots.slice(snapshots.indexOf(pending.at(-1)!) + 1)])
      rerender(<Chat message={message} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onToolApproval).not.toHaveBeenCalled();
    const [ls, rm] = screen.getAllByRole('group');
    expect(ls).toHaveTextContent('Auto-approved');
    expect(rm).toHaveTextContent('Blocked by policy');
    expect(screen.queryByText('Allowed by your rule')).toBeNull();
  });

  it('keeps human decisions labelled as such', async () => {
    render(
      <ToolCallTimeline
        parts={[toolPart('output-denied', { toolCallId: 'h' })]}
        defaultExpanded={['h']}
        announce={false}
      />,
    );
    expect(screen.getByText(/Denied by user/)).toBeInTheDocument();
  });

  it('maps a pending automatic decision to running rather than awaiting approval', () => {
    const part = toolPart('approval-requested', { approval: { id: 'a', isAutomatic: true } });
    expect(getToolPhase(part)).toBe('running');
    expect(getToolPhase(toolPart('approval-requested'))).toBe('awaiting-approval');
  });
});
