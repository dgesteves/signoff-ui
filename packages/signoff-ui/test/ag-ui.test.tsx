import { AbstractAgent, HttpAgent, type BaseEvent, type RunAgentInput } from '@ag-ui/client';
import { EventType, type Event as AgUiCoreEvent, type Message } from '@ag-ui/core';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  answerAgUiInterrupt,
  createAgUiRun,
  fromAgUiMessages,
  getAgUiResume,
  parsePartialJson,
  reduceAgUiRun,
  useAgUiAgent,
  type AgUiAgentLike,
  type AgUiRunState,
} from '../src/ag-ui';
import { AgentMessage } from '../src/agent-message';
import { deriveAgentState, type SubagentPart } from '../src/lib/ai';

const fold = (events: readonly AgUiCoreEvent[], run: AgUiRunState = createAgUiRun()) =>
  events.reduce(reduceAgUiRun, run);

describe('parsePartialJson', () => {
  it.each([
    ['{"query": "stre', { query: 'stre' }],
    ['{"query": "streaming", "limit": 1', { query: 'streaming', limit: 1 }],
    ['{"query": "a", "lim', { query: 'a' }],
    ['{"query": "a", "limit":', { query: 'a' }],
    ['{"query": "a",', { query: 'a' }],
    ['{"flag": tr', {}],
    ['{"n": -', {}],
    ['{"paths": ["a.ts", "b', { paths: ['a.ts', 'b'] }],
    ['{"nested": {"deep": [1, {"x": "y\\', { nested: { deep: [1, { x: 'y' }] } }],
    ['{"text": "caf\\u00', { text: 'caf' }],
    ['{"done": true}', { done: true }],
    ['[', []],
  ])('%s', (text, expected) => {
    expect(parsePartialJson(text)).toEqual(expected);
  });

  it('returns undefined for nothing or garbage', () => {
    expect(parsePartialJson('')).toBeUndefined();
    expect(parsePartialJson('not json')).toBeUndefined();
  });
});

describe('reduceAgUiRun', () => {
  const started: AgUiCoreEvent = { type: EventType.RUN_STARTED, threadId: 't', runId: 'r1' };

  it('tracks status, streaming messages and tool calls, and the step', () => {
    let run = fold([started, { type: EventType.STEP_STARTED, stepName: 'planner' }]);
    expect(run).toMatchObject({ status: 'submitted', step: 'planner' });
    run = fold(
      [
        { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'search', parentMessageId: 'm1' },
      ],
      run,
    );
    expect(run).toMatchObject({ status: 'streaming', streaming: { messages: ['m1'], toolCalls: ['tc1'] } });
    run = fold(
      [
        { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc1' },
        { type: EventType.STEP_FINISHED, stepName: 'planner' },
      ],
      run,
    );
    expect(run).toMatchObject({ status: 'streaming', step: undefined, streaming: { messages: [], toolCalls: [] } });
  });

  it('sums token usage over runs, mapping cache and reasoning counts', () => {
    const finished = (runId: string): AgUiCoreEvent => ({
      type: EventType.RUN_FINISHED,
      threadId: 't',
      runId,
      outcome: { type: 'success' },
      usage: [
        { model: 'a', inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40, reasoningTokens: 5 },
        { model: 'b', inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheWriteInputTokens: 10 },
      ],
    });
    const run = fold([started, finished('r1'), { ...started, runId: 'r2' }, finished('r2')]);
    expect(run.status).toBe('ready');
    expect(run.usage).toMatchObject({
      inputTokens: 220,
      outputTokens: 44,
      totalTokens: 264,
      inputTokenDetails: { cacheReadTokens: 80, cacheWriteTokens: 20 },
      outputTokenDetails: { reasoningTokens: 10 },
    });
  });

  it('leaves what a cancelled run was streaming cut off, so it reads as stopped', () => {
    const streaming: AgUiCoreEvent[] = [
      started,
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
      { type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'search', parentMessageId: 'm1' },
    ];
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Find the limiter docs' },
      {
        id: 'm1',
        role: 'assistant',
        content: 'Searching for the',
        toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'search', arguments: '{"query": "rate' } }],
      },
    ];
    const finished = (type: 'success' | 'cancelled') =>
      fold([...streaming, { type: EventType.RUN_FINISHED, threadId: 't', runId: 'r1', outcome: { type } }]);

    const cancelled = finished('cancelled');
    expect(cancelled).toMatchObject({ status: 'ready', streaming: { messages: ['m1'], toolCalls: ['tc1'] } });
    const reply = fromAgUiMessages(messages, cancelled)[1];
    expect(reply?.parts).toMatchObject([
      { type: 'text', text: 'Searching for the', state: 'streaming' },
      { type: 'dynamic-tool', state: 'input-streaming', input: { query: 'rate' } },
    ]);
    expect(deriveAgentState({ status: cancelled.status, message: reply })).toEqual({ state: 'stopped' });

    // HttpAgent's abortRun() arrives as RUN_ERROR with code `abort`: stopped too, not failed.
    const aborted = fold([...streaming, { type: EventType.RUN_ERROR, message: 'Request aborted', code: 'abort' }]);
    expect(aborted).toMatchObject({ status: 'ready', error: undefined, streaming: cancelled.streaming });

    // A run that finished ends what it streamed; the next run starts clean.
    expect(finished('success').streaming).toEqual({ messages: [], toolCalls: [] });
    expect(fold([{ ...started, runId: 'r2' }], cancelled).streaming).toEqual({ messages: [], toolCalls: [] });
  });

  it('turns RUN_ERROR into an error status, and clears it on the next run', () => {
    let run = fold([started, { type: EventType.RUN_ERROR, message: 'Rate limited', code: '429' }]);
    expect(run).toMatchObject({ status: 'error', error: { message: 'Rate limited', code: '429' } });
    run = fold([started], run);
    expect(run).toMatchObject({ status: 'submitted', error: undefined });
  });

  it('keeps the interrupts a run ends with, and resumes only once every one is answered', () => {
    let run = fold([
      started,
      {
        type: EventType.RUN_FINISHED,
        threadId: 't',
        runId: 'r1',
        outcome: {
          type: 'interrupt',
          interrupts: [
            { id: 'int1', reason: 'tool_call', toolCallId: 'tc1', message: 'Delete the branch?' },
            { id: 'int2', reason: 'input_required', message: 'Which environment?' },
          ],
        },
      },
    ]);
    expect(run.interrupts.map((i) => i.id)).toEqual(['int1', 'int2']);
    expect(run.approvals).toEqual({ tc1: { id: 'int1', requestReason: 'Delete the branch?' } });

    run = answerAgUiInterrupt(run, { id: 'int1', approved: false, reason: 'Not yet' });
    expect(run.approvals.tc1).toMatchObject({ approved: false, reason: 'Not yet' });
    expect(getAgUiResume(run)).toBeUndefined();

    run = answerAgUiInterrupt(run, { interruptId: 'int2', status: 'resolved', payload: { environment: 'staging' } });
    expect(getAgUiResume(run)).toEqual([
      { interruptId: 'int1', status: 'resolved', payload: { approved: false, reason: 'Not yet' } },
      { interruptId: 'int2', status: 'resolved', payload: { environment: 'staging' } },
    ]);
    // Answers for interrupts that aren't open are ignored.
    expect(answerAgUiInterrupt(run, { id: 'nope', approved: true })).toBe(run);
  });

  it('sends edited arguments as editedArgs, the AG-UI field, with input as an alias', () => {
    const edited = answerAgUiInterrupt(withInterrupt(), { id: 'int1', approved: true, input: { command: 'npm test' } });
    expect(getAgUiResume(edited)).toEqual([
      {
        interruptId: 'int1',
        status: 'resolved',
        payload: { approved: true, editedArgs: { command: 'npm test' }, input: { command: 'npm test' } },
      },
    ]);
    // A denial carries no arguments to run.
    const denied = answerAgUiInterrupt(withInterrupt(), {
      id: 'int1',
      approved: false,
      input: { command: 'npm test' },
    });
    expect(getAgUiResume(denied)?.[0]?.payload).toEqual({ approved: false });
  });
});

describe('fromAgUiMessages', () => {
  const call = (id: string, name: string, args: string) => ({
    id,
    type: 'function' as const,
    function: { name, arguments: args },
  });
  const history: Message[] = [
    { id: 'sys', role: 'system', content: 'You are helpful.' },
    {
      id: 'u1',
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this screenshot?' },
        { type: 'image', source: { type: 'url', value: 'https://example.com/a.png', mimeType: 'image/png' } },
        { type: 'document', source: { type: 'data', value: 'aGk=', mimeType: 'text/plain' } },
      ],
    },
    { id: 'r1', role: 'reasoning', content: 'Look up the docs first.' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Searching.',
      toolCalls: [call('tc1', 'search_docs', '{"query":"streaming"}'), call('tc2', 'read_file', '{"path":"a.ts"}')],
    },
    { id: 't1', role: 'tool', toolCallId: 'tc1', content: '{"hits":3}' },
    { id: 't2', role: 'tool', toolCallId: 'tc2', content: '', error: 'ENOENT' },
    { id: 'act', role: 'activity', activityType: 'plan', content: { steps: ['search', 'answer'] } },
    { id: 'a2', role: 'assistant', content: 'Found it.' },
    { id: 'u2', role: 'user', content: 'Thanks' },
  ];

  it('groups each turn into one assistant message, with tool results on their calls', () => {
    expect(fromAgUiMessages(history)).toEqual([
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', text: 'What is in this screenshot?' },
          { type: 'file', mediaType: 'image/png', url: 'https://example.com/a.png' },
          { type: 'file', mediaType: 'text/plain', url: 'data:text/plain;base64,aGk=' },
        ],
      },
      {
        id: 'r1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Look up the docs first.', state: 'done' },
          { type: 'text', text: 'Searching.', state: 'done' },
          {
            type: 'dynamic-tool',
            toolName: 'search_docs',
            toolCallId: 'tc1',
            state: 'output-available',
            input: { query: 'streaming' },
            output: { hits: 3 },
          },
          {
            type: 'dynamic-tool',
            toolName: 'read_file',
            toolCallId: 'tc2',
            state: 'output-error',
            input: { path: 'a.ts' },
            errorText: 'ENOENT',
          },
          { type: 'data-plan', id: 'act', data: { steps: ['search', 'answer'] } },
          { type: 'text', text: 'Found it.', state: 'done' },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Thanks' }] },
    ]);
  });

  it('applies the run state: streaming text and arguments, and approvals', () => {
    const messages: Message[] = [
      { id: 'a1', role: 'assistant', content: 'Let me', toolCalls: [call('tc1', 'run_command', '{"command":"pnpm')] },
    ];
    let run = fold([
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'r1' },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'a1', role: 'assistant' },
      { type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'run_command', parentMessageId: 'a1' },
    ]);
    expect(fromAgUiMessages(messages, run)[0]!.parts).toEqual([
      { type: 'text', text: 'Let me', state: 'streaming' },
      {
        type: 'dynamic-tool',
        toolName: 'run_command',
        toolCallId: 'tc1',
        state: 'input-streaming',
        input: { command: 'pnpm' },
      },
    ]);

    messages[0] = {
      id: 'a1',
      role: 'assistant',
      content: 'Let me',
      toolCalls: [call('tc1', 'run_command', '{"command":"pnpm add zod"}')],
    };
    run = fold(
      [
        {
          type: EventType.RUN_FINISHED,
          threadId: 't',
          runId: 'r1',
          outcome: {
            type: 'interrupt',
            interrupts: [{ id: 'int1', reason: 'tool_call', toolCallId: 'tc1', message: 'Install zod?' }],
          },
        },
      ],
      run,
    );
    const tool = () => fromAgUiMessages(messages, run)[0]!.parts[1];
    expect(tool()).toMatchObject({
      state: 'approval-requested',
      input: { command: 'pnpm add zod' },
      approval: { id: 'int1', requestReason: 'Install zod?' },
    });
    expect(deriveAgentState({ status: run.status, message: fromAgUiMessages(messages, run)[0] })).toEqual({
      state: 'awaiting-approval',
      detail: 'run_command',
    });

    run = answerAgUiInterrupt(run, { id: 'int1', approved: true });
    expect(tool()).toMatchObject({ state: 'approval-responded', approval: { id: 'int1', approved: true } });
    // The resumed run clears the open interrupts but keeps the decision on the call.
    run = fold([{ type: EventType.RUN_STARTED, threadId: 't', runId: 'r2' }], run);
    messages.push({ id: 't1', role: 'tool', toolCallId: 'tc1', content: 'added zod' });
    expect(tool()).toMatchObject({ state: 'output-available', output: 'added zod', approval: { approved: true } });

    const denied = answerAgUiInterrupt(withInterrupt(), { id: 'int1', approved: false, reason: 'Pin it' });
    expect(fromAgUiMessages(messages.slice(0, 1), denied)[0]!.parts[1]).toMatchObject({
      state: 'output-denied',
      approval: { id: 'int1', approved: false, reason: 'Pin it' },
    });
  });

  it('keeps a denied call denied when the agent then reports a result for it', () => {
    // AG-UI's resumed run emits a ToolCallResult against the call, a denied one too.
    const messages: Message[] = [
      { id: 'a1', role: 'assistant', toolCalls: [call('tc1', 'run_command', '{"command":"rm -rf build"}')] },
      { id: 't1', role: 'tool', toolCallId: 'tc1', content: '{"denied":true}' },
    ];
    const denied = answerAgUiInterrupt(withInterrupt(), { id: 'int1', approved: false, reason: 'Not that' });
    const resumed = fold([{ type: EventType.RUN_STARTED, threadId: 't', runId: 'r2' }], denied);
    expect(fromAgUiMessages(messages, resumed)[0]!.parts[0]).toEqual({
      type: 'dynamic-tool',
      toolName: 'run_command',
      toolCallId: 'tc1',
      state: 'output-denied',
      input: { command: 'rm -rf build' },
      approval: { id: 'int1', requestReason: undefined, reason: 'Not that', approved: false },
    });
    // A result with an error, or an interrupt that was cancelled, is still a no.
    messages[1] = { id: 't1', role: 'tool', toolCallId: 'tc1', content: '', error: 'Denied by user' };
    expect(fromAgUiMessages(messages, denied)[0]!.parts[0]).toMatchObject({ state: 'output-denied' });
    const cancelled = answerAgUiInterrupt(withInterrupt(), { interruptId: 'int1', status: 'cancelled' });
    expect(fromAgUiMessages(messages, cancelled)[0]!.parts[0]).toMatchObject({
      state: 'output-denied',
      approval: { approved: false },
    });
  });
});

describe('sub-agents', () => {
  const started: AgUiCoreEvent = { type: EventType.RUN_STARTED, threadId: 't', runId: 'r1' };
  const start = (subagentRunId: string, extra: Record<string, string> = {}): AgUiCoreEvent => ({
    type: EventType.SUBAGENT_STARTED,
    subagentRunId,
    name: 'researcher',
    parentToolCallId: 'tc1',
    ...extra,
  });
  const finish = (subagentRunId: string, outcome?: 'suspended'): AgUiCoreEvent => ({
    type: EventType.SUBAGENT_FINISHED,
    subagentRunId,
    ...(outcome ? { outcome: { type: outcome } } : {}),
  });
  const fail = (subagentRunId: string): AgUiCoreEvent => ({
    type: EventType.SUBAGENT_ERROR,
    subagentRunId,
    message: 'Rate limited',
    code: '429',
  });
  const inside = (subagentRunId: string): AgUiCoreEvent => ({
    type: EventType.TOOL_CALL_START,
    toolCallId: 'stc1',
    toolCallName: 'web_search',
    subagentRunId,
  });

  describe('reduceAgUiRun', () => {
    it('follows a sub-agent from its start to its end, and keeps it across runs', () => {
      let run = fold([started, start('sa1'), inside('sa1')]);
      expect(run.subagents).toEqual([
        {
          subagentRunId: 'sa1',
          name: 'researcher',
          parentToolCallId: 'tc1',
          parentSubagentRunId: undefined,
          status: 'running',
        },
      ]);
      expect(run.streaming.toolCalls).toEqual(['stc1']);
      run = fold([finish('sa1'), { ...started, runId: 'r2' }], run);
      expect(run.subagents).toMatchObject([{ subagentRunId: 'sa1', status: 'done' }]);
    });

    it('records a failure, which a later end does not undo', () => {
      const run = fold([started, start('sa1'), fail('sa1'), finish('sa1')]);
      expect(run.subagents).toMatchObject([
        { subagentRunId: 'sa1', status: 'error', error: { message: 'Rate limited', code: '429' } },
      ]);
    });

    it('pauses a suspended sub-agent until a later run starts it again', () => {
      let run = fold([started, start('sa1'), finish('sa1', 'suspended')]);
      expect(run.subagents).toMatchObject([{ status: 'suspended' }]);
      run = fold([{ ...started, runId: 'r2' }, inside('sa1')], run);
      expect(run.subagents).toMatchObject([{ status: 'running' }]);
      run = fold([finish('sa1', 'suspended'), start('sa1')], run);
      expect(run.subagents).toMatchObject([{ status: 'running' }]);
    });

    it('takes events in any order: work or an end before the start', () => {
      // Its work first: running, with no name yet, then named by its start.
      let run = fold([started, inside('sa1')]);
      expect(run.subagents).toEqual([{ subagentRunId: 'sa1', status: 'running' }]);
      run = fold([start('sa1')], run);
      expect(run.subagents).toMatchObject([{ name: 'researcher', parentToolCallId: 'tc1', status: 'running' }]);
      // Its end first: a late start names it and leaves it ended.
      run = fold([finish('sa2'), start('sa2', { name: 'coder', parentSubagentRunId: 'sa1' })], run);
      expect(run.subagents?.[1]).toEqual({
        subagentRunId: 'sa2',
        name: 'coder',
        parentToolCallId: 'tc1',
        parentSubagentRunId: 'sa1',
        status: 'done',
      });
      run = fold([fail('sa3'), start('sa3')], run);
      expect(run.subagents?.[2]).toMatchObject({ status: 'error' });
      // Events without a sub-agent leave them as they are.
      expect(fold([{ type: EventType.SUBAGENT_FINISHED } as AgUiCoreEvent], run)).toBe(run);
    });
  });

  describe('fromAgUiMessages', () => {
    const call = (id: string, name: string, args = '{}') => ({
      id,
      type: 'function' as const,
      function: { name, arguments: args },
    });
    /** A turn where the agent delegates to a researcher, as `@ag-ui/client` keeps it. */
    const turn = (): Message[] => [
      { id: 'u1', role: 'user', content: 'Research rate limits' },
      {
        id: 'm1',
        role: 'assistant',
        content: 'Delegating.',
        toolCalls: [call('tc1', 'research', '{"topic":"limits"}')],
      },
      { id: 'tr1', role: 'tool', toolCallId: 'tc1', content: 'found 2' },
      {
        id: 's1',
        role: 'assistant',
        content: 'Searching.',
        subagentRunId: 'sa1',
        toolCalls: [call('stc1', 'web_search')],
      },
      { id: 'str1', role: 'tool', toolCallId: 'stc1', content: '["a","b"]', subagentRunId: 'sa1' },
      { id: 'sr1', role: 'reasoning', content: 'Two hits.', subagentRunId: 'sa1' },
      { id: 'stc2', role: 'assistant', subagentRunId: 'sa1', toolCalls: [call('stc2', 'read_page')] },
      { id: 'm2', role: 'assistant', content: 'Done.' },
    ];

    it('puts a sub-agent’s messages in one part, after the call that started it', () => {
      const run = fold([started, start('sa1'), finish('sa1')]);
      const [, reply] = fromAgUiMessages(turn(), run);
      expect(reply!.parts).toEqual([
        { type: 'text', text: 'Delegating.', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'research',
          toolCallId: 'tc1',
          state: 'output-available',
          input: { topic: 'limits' },
          output: 'found 2',
        },
        {
          type: 'data-signoff-subagent',
          id: 'sa1',
          data: {
            subagentRunId: 'sa1',
            parentToolCallId: 'tc1',
            name: 'researcher',
            status: 'done',
            errorText: undefined,
            parts: [
              { type: 'text', text: 'Searching.', state: 'done' },
              {
                type: 'dynamic-tool',
                toolName: 'web_search',
                toolCallId: 'stc1',
                state: 'output-available',
                input: {},
                output: ['a', 'b'],
              },
              { type: 'reasoning', text: 'Two hits.', state: 'done' },
              { type: 'dynamic-tool', toolName: 'read_page', toolCallId: 'stc2', state: 'input-available', input: {} },
            ],
          },
        },
        { type: 'text', text: 'Done.', state: 'done' },
      ]);
    });

    it('carries a failure’s message, and applies the run state inside', () => {
      const run = fold([
        started,
        start('sa1'),
        { type: EventType.TOOL_CALL_START, toolCallId: 'stc2', toolCallName: 'read_page', subagentRunId: 'sa1' },
        fail('sa1'),
      ]);
      const subagent = fromAgUiMessages(turn(), run)[1]!.parts[2] as SubagentPart;
      expect(subagent.data).toMatchObject({ status: 'error', errorText: 'Rate limited' });
      expect(subagent.data.parts[3]).toMatchObject({ toolCallId: 'stc2', state: 'input-streaming' });
    });

    it('nests a sub-agent another one started inside it, after the call that started it there', () => {
      const messages: Message[] = [
        ...turn().slice(0, 4),
        { id: 'c1', role: 'assistant', subagentRunId: 'sa2', toolCalls: [call('ctc1', 'edit_file')] },
      ];
      messages[3] = { ...messages[3]!, toolCalls: [call('stc1', 'ask_coder')] } as Message;
      const run = fold([
        started,
        start('sa1'),
        start('sa2', { name: 'coder', parentToolCallId: 'stc1', parentSubagentRunId: 'sa1' }),
      ]);
      const researcher = fromAgUiMessages(messages, run)[1]!.parts[2] as SubagentPart;
      expect(researcher.data.parts.map((p) => p.type)).toEqual(['text', 'dynamic-tool', 'data-signoff-subagent']);
      expect((researcher.data.parts[2] as SubagentPart).data).toMatchObject({
        name: 'coder',
        parentToolCallId: 'stc1',
        parts: [{ toolCallId: 'ctc1' }],
      });
      // One whose call is nowhere stays where its first message was.
      const lost = fold(
        [start('sa2', { name: 'coder', parentToolCallId: 'gone', parentSubagentRunId: 'sa1' })],
        fold([started, start('sa1')]),
      );
      const reply = fromAgUiMessages(messages, lost)[1]!.parts;
      expect(reply.map((p) => (p.type === 'data-signoff-subagent' ? p.id : p.type))).toEqual([
        'text',
        'dynamic-tool',
        'sa1',
        'sa2',
      ]);
    });

    it('never puts a sub-agent inside itself, whatever calls the events name', () => {
      const messages: Message[] = [
        { id: 'u1', role: 'user', content: 'Go' },
        { id: 'a1', role: 'assistant', subagentRunId: 'sa1', toolCalls: [call('a-call', 'ask_b')] },
        { id: 'b1', role: 'assistant', subagentRunId: 'sb', toolCalls: [call('b-call', 'ask_a')] },
      ];
      // Each says the other's call started it.
      const run = fold([
        started,
        start('sa1', { parentToolCallId: 'b-call' }),
        start('sb', { parentToolCallId: 'a-call' }),
      ]);
      const [a] = fromAgUiMessages(messages, run)[1]!.parts as SubagentPart[];
      expect(a!.id).toBe('sb');
      expect(a!.data.parts.map((p) => (p.type === 'data-signoff-subagent' ? p.id : p.type))).toEqual([
        'dynamic-tool',
        'sa1',
      ]);
      expect((a!.data.parts[1] as SubagentPart).data.parts.map((p) => p.type)).toEqual(['dynamic-tool']);
    });

    it('keeps sub-agents under one call in the order they started, wherever their messages are', () => {
      const messages: Message[] = [
        ...turn().slice(0, 3),
        { id: 'b1', role: 'assistant', content: 'B first.', subagentRunId: 'sb' },
        { id: 'a1', role: 'assistant', content: 'A second.', subagentRunId: 'sa' },
      ];
      const run = fold([started, start('sa'), start('sb')]);
      const parts = fromAgUiMessages(messages, run)[1]!.parts;
      expect(parts.map((p) => (p.type === 'data-signoff-subagent' ? p.id : p.type))).toEqual([
        'text',
        'dynamic-tool',
        'sa',
        'sb',
      ]);
    });

    it('nests under a call that comes later in the messages than the sub-agent’s own', () => {
      const messages: Message[] = [
        { id: 'u1', role: 'user', content: 'Go' },
        { id: 's1', role: 'assistant', content: 'Early.', subagentRunId: 'sa1' },
        { id: 'm1', role: 'assistant', content: 'Delegated.', toolCalls: [call('tc1', 'research')] },
      ];
      const parts = fromAgUiMessages(messages, fold([started, start('sa1')]))[1]!.parts;
      expect(parts.map((p) => p.type)).toEqual(['text', 'dynamic-tool', 'data-signoff-subagent']);
    });

    it('shows one started by no call it can find where its first message was, and one with no messages under its call', () => {
      const run = fold([started, start('sa1', { parentToolCallId: 'elsewhere' }), start('sa2')]);
      const parts = fromAgUiMessages(turn(), run)[1]!.parts;
      expect(parts.map((p) => (p.type === 'data-signoff-subagent' ? p.id : p.type))).toEqual([
        'text',
        'dynamic-tool',
        'sa2',
        'sa1',
        'text',
      ]);
      expect((parts[2] as SubagentPart).data).toEqual({
        subagentRunId: 'sa2',
        parentToolCallId: 'tc1',
        name: 'researcher',
        status: 'running',
        errorText: undefined,
        parts: [],
      });
      // Started by nothing it can find, with no messages: nothing to show.
      const unseen = fold([start('sa3', { parentToolCallId: 'elsewhere' })], run);
      expect(
        fromAgUiMessages(turn(), unseen)[1]!.parts.some((p) => p.type === 'data-signoff-subagent' && p.id === 'sa3'),
      ).toBe(false);
    });

    it('groups history from before its events, running while one of its calls is', () => {
      const parts = fromAgUiMessages(turn())[1]!.parts;
      expect(parts.map((p) => p.type)).toEqual(['text', 'dynamic-tool', 'data-signoff-subagent', 'text']);
      expect((parts[2] as SubagentPart).data).toMatchObject({
        subagentRunId: 'sa1',
        status: 'running',
        name: undefined,
      });
      const settled = turn().slice(0, 5);
      expect((fromAgUiMessages(settled)[1]!.parts[2] as SubagentPart).data.status).toBe('done');
    });
  });
});

function withInterrupt() {
  return createAgUiRun([{ id: 'int1', reason: 'tool_call', toolCallId: 'tc1' }]);
}

/** A real `@ag-ui/client` agent that plays one scripted event list per run. */
class ScriptedAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  constructor(readonly scripts: ((input: RunAgentInput) => BaseEvent[])[]) {
    super({ threadId: 'thread-1' });
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    const events = this.scripts[this.inputs.length - 1]!(input);
    return new Observable<BaseEvent>((subscriber) => {
      for (const event of events) subscriber.next(event);
      subscriber.complete();
    });
  }
}

const usage = [{ model: 'gpt-x', inputTokens: 50, outputTokens: 10, totalTokens: 60 }];

function interruptingAgent() {
  return new ScriptedAgent([
    ({ runId }) => [
      { type: EventType.RUN_STARTED, threadId: 'thread-1', runId },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Adding zod.' },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
      { type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'run_command', parentMessageId: 'm1' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '{"command":"pnpm add' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: ' zod"}' },
      { type: EventType.TOOL_CALL_END, toolCallId: 'tc1' },
      {
        type: EventType.RUN_FINISHED,
        threadId: 'thread-1',
        runId,
        usage,
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'int1', reason: 'tool_call', toolCallId: 'tc1', message: 'Install zod?' }],
        },
      } as BaseEvent,
    ],
    ({ runId }) => [
      { type: EventType.RUN_STARTED, threadId: 'thread-1', runId },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'tm1', toolCallId: 'tc1', content: '{"exitCode":0}' },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm2', role: 'assistant' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm2', delta: 'Installed.' },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm2' },
      { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId, usage, outcome: { type: 'success' } } as BaseEvent,
    ],
  ]);
}

describe('useAgUiAgent', () => {
  it('accepts @ag-ui/client agents as they are', () => {
    const agent: AgUiAgentLike = new HttpAgent({ url: 'https://example.com/agent' });
    expect(agent.messages).toEqual([]);
  });

  it('sends edited arguments as the approval payload’s editedArgs, and input', async () => {
    const agent = interruptingAgent();
    agent.addMessage({ id: 'u1', role: 'user', content: 'Add zod' });
    const { result } = renderHook(() => useAgUiAgent(agent));
    await act(() => agent.runAgent());
    act(() => result.current.editInput('tc1', { command: 'pnpm add zod@4' }));
    await act(() => result.current.respond({ id: 'int1', approved: true }));
    const edited = { command: 'pnpm add zod@4' };
    expect(agent.inputs[1]?.resume).toEqual([
      { interruptId: 'int1', status: 'resolved', payload: { approved: true, editedArgs: edited, input: edited } },
    ]);
  });

  it('runs the edited arguments on an agent that follows the spec and reads editedArgs', async () => {
    // As AWS Strands' AG-UI integration does: editedArgs replaces the call's arguments in full.
    const original = { command: 'rm -rf build && npm test' };
    const agent = new ScriptedAgent([
      ({ runId }) => [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'run_command' },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: JSON.stringify(original) },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc1' },
        {
          type: EventType.RUN_FINISHED,
          threadId: 'thread-1',
          runId,
          outcome: {
            type: 'interrupt',
            interrupts: [
              {
                id: 'int1',
                reason: 'tool_call',
                toolCallId: 'tc1',
                message: 'Run it?',
                responseSchema: {
                  type: 'object',
                  properties: { approved: { type: 'boolean' }, editedArgs: { type: 'object' } },
                  required: ['approved'],
                },
              },
            ],
          },
        } as BaseEvent,
      ],
      ({ runId, resume }) => {
        const payload = resume?.[0]?.payload as { approved?: boolean; editedArgs?: typeof original };
        const args = payload.editedArgs ?? original;
        return [
          { type: EventType.RUN_STARTED, threadId: 'thread-1', runId },
          { type: EventType.TOOL_CALL_RESULT, messageId: 'tm1', toolCallId: 'tc1', content: JSON.stringify(args) },
          { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId, outcome: { type: 'success' } } as BaseEvent,
        ];
      },
    ]);
    agent.addMessage({ id: 'u1', role: 'user', content: 'Run the tests' });
    const { result } = renderHook(() => useAgUiAgent(agent));
    await act(() => agent.runAgent());
    act(() => result.current.editInput('tc1', { command: 'npm test' }));
    await act(() => result.current.respond({ id: 'int1', approved: true }));
    expect(result.current.messages[1]!.parts[0]).toMatchObject({
      state: 'output-available',
      output: { command: 'npm test' },
      approval: { approved: true },
    });
  });

  it('shows a denied call as denied after the agent reports its result', async () => {
    const agent = new ScriptedAgent([
      interruptingAgent().scripts[0]!,
      ({ runId }) => [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tm1', toolCallId: 'tc1', content: '{"denied":true}' },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'm2', role: 'assistant' },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm2', delta: 'Okay, not running it.' },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'm2' },
        { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId, outcome: { type: 'success' } } as BaseEvent,
      ],
    ]);
    agent.addMessage({ id: 'u1', role: 'user', content: 'Add zod' });
    const { result } = renderHook(() => useAgUiAgent(agent));
    await act(() => agent.runAgent());
    await act(() => result.current.respond({ id: 'int1', approved: false, reason: 'Not now' }));
    const reply = result.current.messages[1]!;
    expect(reply.parts).toMatchObject([
      { type: 'text', text: 'Adding zod.' },
      { state: 'output-denied', approval: { id: 'int1', approved: false, reason: 'Not now' } },
      { type: 'text', text: 'Okay, not running it.' },
    ]);
    render(<AgentMessage message={reply} />);
    const row = screen.getByRole('button', { name: /^Run command/ });
    expect(row).toHaveTextContent('Denied');
    expect(row).not.toHaveTextContent('Done');
  });

  it('drops an edit when the call is denied', async () => {
    const agent = interruptingAgent();
    agent.addMessage({ id: 'u1', role: 'user', content: 'Add zod' });
    const { result } = renderHook(() => useAgUiAgent(agent));
    await act(() => agent.runAgent());
    act(() => result.current.editInput('tc1', { command: 'pnpm add zod@4' }));
    await act(() => result.current.respond({ id: 'int1', approved: false, reason: 'Not now' }));
    expect(agent.inputs[1]?.resume).toEqual([
      { interruptId: 'int1', status: 'resolved', payload: { approved: false, reason: 'Not now' } },
    ]);
  });

  describe('the resumed run, with runAgent', () => {
    // Frontend tools and context, as a CopilotKit app or any app that passes them to runAgent sends.
    const tools = [{ name: 'notify', description: 'Post in a channel', parameters: { type: 'object' } }];
    const context = [{ description: 'Branch', value: 'main' }];
    const resumed = [{ interruptId: 'int1', status: 'resolved', payload: { approved: true } }];

    it('resumes through runAgent, so the resumed run keeps the tools and context the run had', async () => {
      const agent = interruptingAgent();
      agent.addMessage({ id: 'u1', role: 'user', content: 'Add zod' });
      const { result } = renderHook(() =>
        useAgUiAgent(agent, { runAgent: (parameters) => agent.runAgent({ ...parameters, tools, context }) }),
      );
      await act(() => agent.runAgent({ tools, context }));
      await act(() => result.current.respond({ id: 'int1', approved: true }));
      expect(agent.inputs.map((input) => input.tools.map((tool) => tool.name))).toEqual([['notify'], ['notify']]);
      expect(agent.inputs[1]).toMatchObject({ context, resume: resumed });
      expect(result.current.messages[1]!.parts).toMatchObject([
        { type: 'text', text: 'Adding zod.' },
        { state: 'output-available', output: { exitCode: 0 } },
        { type: 'text', text: 'Installed.' },
      ]);
    });

    it('resolves an interrupt that is not a tool approval through runAgent too', async () => {
      const agent = new ScriptedAgent([
        ({ runId }) => [
          { type: EventType.RUN_STARTED, threadId: 'thread-1', runId },
          {
            type: EventType.RUN_FINISHED,
            threadId: 'thread-1',
            runId,
            outcome: {
              type: 'interrupt',
              interrupts: [{ id: 'int1', reason: 'input_required', message: 'Which city?' }],
            },
          } as BaseEvent,
        ],
        ({ runId }) => [
          { type: EventType.RUN_STARTED, threadId: 'thread-1', runId },
          { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId, outcome: { type: 'success' } } as BaseEvent,
        ],
      ]);
      const runs: unknown[] = [];
      const { result } = renderHook(() =>
        useAgUiAgent(agent, {
          runAgent: (parameters) => {
            runs.push(parameters);
            return agent.runAgent({ ...parameters, tools });
          },
        }),
      );
      await act(() => agent.runAgent({ tools }));
      const entry = { interruptId: 'int1', status: 'resolved', payload: { city: 'Lisbon' } } as const;
      await act(() => result.current.resolve(entry));
      expect(runs).toEqual([{ resume: [entry] }]);
      expect(agent.inputs[1]).toMatchObject({ tools, resume: [entry] });
      expect(result.current.interrupts).toEqual([]);
    });

    it('calls the runAgent of the latest render, and respond stays the same function', async () => {
      const agent = interruptingAgent();
      agent.addMessage({ id: 'u1', role: 'user', content: 'Add zod' });
      const calls: string[] = [];
      const { result, rerender } = renderHook(
        ({ name }: { name: string }) =>
          // A new function on every render, as an inline arrow is.
          useAgUiAgent(agent, {
            runAgent: (parameters) => {
              calls.push(name);
              return agent.runAgent(parameters);
            },
          }),
        { initialProps: { name: 'first' } },
      );
      const respond = result.current.respond;
      await act(() => agent.runAgent());
      rerender({ name: 'second' });
      expect(result.current.respond).toBe(respond);
      await act(() => result.current.respond({ id: 'int1', approved: true }));
      expect(calls).toEqual(['second']);
      expect(agent.inputs[1]?.resume).toEqual(resumed);
    });

    it('rejects when runAgent fails, as respond does without it', async () => {
      const agent = interruptingAgent();
      agent.addMessage({ id: 'u1', role: 'user', content: 'Add zod' });
      const { result } = renderHook(() =>
        useAgUiAgent(agent, { runAgent: () => Promise.reject(new Error('Runtime unreachable')) }),
      );
      await act(() => agent.runAgent());
      await expect(act(() => result.current.respond({ id: 'int1', approved: true }))).rejects.toThrow(
        'Runtime unreachable',
      );
      expect(agent.inputs).toHaveLength(1);
    });
  });

  it('follows a run through an interrupt, the approval and the resumed run', async () => {
    const agent = interruptingAgent();
    agent.addMessage({ id: 'u1', role: 'user', content: 'Add zod' });
    const { result } = renderHook(() => useAgUiAgent(agent));
    expect(result.current.messages).toEqual([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Add zod' }] }]);

    await act(() => agent.runAgent());
    expect(result.current.status).toBe('ready');
    expect(result.current.interrupts).toHaveLength(1);
    expect(result.current.messages[1]).toMatchObject({
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Adding zod.', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'run_command',
          state: 'approval-requested',
          input: { command: 'pnpm add zod' },
          approval: { id: 'int1', requestReason: 'Install zod?' },
        },
      ],
    });

    await act(() => result.current.respond({ id: 'int1', approved: true }));
    expect(agent.inputs[1]?.resume).toEqual([{ interruptId: 'int1', status: 'resolved', payload: { approved: true } }]);
    expect(result.current.interrupts).toEqual([]);
    expect(result.current.messages[1]!.parts).toMatchObject([
      { type: 'text', text: 'Adding zod.' },
      { state: 'output-available', output: { exitCode: 0 }, approval: { approved: true } },
      { type: 'text', text: 'Installed.' },
    ]);
    expect(result.current.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  });

  it('drives AgentMessage approval cards', async () => {
    const agent = interruptingAgent();
    function Chat() {
      const { messages, status, respond } = useAgUiAgent(agent);
      return (
        <>
          <p>{status}</p>
          {messages
            .filter((m) => m.role === 'assistant')
            .map((m) => (
              <AgentMessage key={m.id} message={m} onToolApproval={respond} />
            ))}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Chat />);
    await act(() => agent.runAgent());
    expect(screen.getByText('Install zod?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^approve/i }));
    await waitFor(() => {
      expect(screen.getByText('Installed.')).toBeInTheDocument();
    });
    expect(agent.inputs).toHaveLength(2);
  });

  it('nests a sub-agent under the call that started it, and resumes it once its call is approved', async () => {
    const inside = { subagentRunId: 'sa1' };
    const agent = new ScriptedAgent([
      ({ runId }) => [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Delegating.' },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'research', parentMessageId: 'm1' },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc1' },
        { type: EventType.SUBAGENT_STARTED, subagentRunId: 'sa1', name: 'Researcher', parentToolCallId: 'tc1' },
        { type: EventType.TOOL_CALL_START, toolCallId: 'stc1', toolCallName: 'web_search', ...inside },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'stc1', delta: '{"query":"rate limits"}', ...inside },
        { type: EventType.TOOL_CALL_END, toolCallId: 'stc1', ...inside },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'str1', toolCallId: 'stc1', content: '["a"]', ...inside },
        { type: EventType.TOOL_CALL_START, toolCallId: 'stc2', toolCallName: 'fetch_page', ...inside },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'stc2', delta: '{"url":"https://a.test"}', ...inside },
        { type: EventType.TOOL_CALL_END, toolCallId: 'stc2', ...inside },
        {
          type: EventType.SUBAGENT_FINISHED,
          subagentRunId: 'sa1',
          outcome: { type: 'suspended', interruptIds: ['int1'] },
        },
        {
          type: EventType.RUN_FINISHED,
          threadId: 'thread-1',
          runId,
          outcome: {
            type: 'interrupt',
            interrupts: [{ id: 'int1', reason: 'tool_call', toolCallId: 'stc2', message: 'Fetch a.test?' }],
          },
        } as BaseEvent,
      ],
      ({ runId }) => [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId },
        { type: EventType.SUBAGENT_STARTED, subagentRunId: 'sa1', name: 'Researcher', parentToolCallId: 'tc1' },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'str2', toolCallId: 'stc2', content: 'page', ...inside },
        { type: EventType.SUBAGENT_FINISHED, subagentRunId: 'sa1' },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tr1', toolCallId: 'tc1', content: 'found a' },
        { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId, outcome: { type: 'success' } } as BaseEvent,
      ],
    ]);
    agent.addMessage({ id: 'u1', role: 'user', content: 'Research rate limits' });
    let state: ReturnType<typeof deriveAgentState> | undefined;
    function Chat() {
      const { messages, status, respond } = useAgUiAgent(agent);
      const last = messages.findLast((m) => m.role === 'assistant');
      state = deriveAgentState({ status, message: last });
      return last ? <AgentMessage message={last} onToolApproval={respond} /> : null;
    }
    const user = userEvent.setup();
    render(<Chat />);
    await act(() => agent.runAgent());
    // Paused on its call's approval, the sub-agent is open under the call that started it.
    const group = screen.getByRole('button', { name: /^Researcher/ });
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(group).toHaveTextContent('Needs approval');
    const calls = screen.getByRole('list', { name: 'Researcher’s tool calls' });
    expect(within(calls).getByRole('button', { name: /Web search/ })).toHaveTextContent('rate limits');
    expect(within(calls).getByText('Fetch a.test?')).toBeInTheDocument();
    expect(state).toEqual({ state: 'awaiting-approval', detail: 'fetch_page' });

    await user.click(within(calls).getByRole('button', { name: /^approve/i }));
    await waitFor(() => expect(state).toEqual({ state: 'done' }));
    expect(agent.inputs[1]?.resume).toEqual([{ interruptId: 'int1', status: 'resolved', payload: { approved: true } }]);
    expect(screen.getByRole('button', { name: /^Researcher/ })).toHaveTextContent('Done');
    // The call that started it got its result.
    expect(screen.getByRole('button', { name: /^Research(?!er)/ })).toHaveTextContent('Done');
  });

  it('reads a run aborted mid-stream as stopped, not failed', async () => {
    // A real HttpAgent: the server streams half a reply, then keeps the connection open.
    const encoder = new TextEncoder();
    const agent = new HttpAgent({
      url: 'https://agent.test/run',
      fetch: async (_url, init) => {
        const { threadId, runId } = JSON.parse(String(init.body)) as RunAgentInput;
        const events = [
          { type: EventType.RUN_STARTED, threadId, runId },
          { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
          { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Adding zod to' },
        ];
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
          },
        });
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    agent.addMessage({ id: 'u1', role: 'user', content: 'Add zod' });
    const { result } = renderHook(() => useAgUiAgent(agent));
    let running: Promise<unknown> = Promise.resolve();
    act(() => {
      running = agent.runAgent().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.status).toBe('streaming'));
    await act(async () => {
      result.current.stop();
      await running;
    });
    const last = result.current.messages.findLast((m) => m.role === 'assistant');
    expect(result.current).toMatchObject({ status: 'ready', error: undefined });
    expect(last?.parts).toMatchObject([{ type: 'text', text: 'Adding zod to', state: 'streaming' }]);
    expect(deriveAgentState({ status: result.current.status, message: last })).toEqual({ state: 'stopped' });
  });

  it('ends a run stopped before the server answered with no error, not as failed', async () => {
    // A real HttpAgent whose request is still waiting for its response: no event has arrived, so
    // the abort reaches onRunFailed rather than a RUN_ERROR with code `abort`.
    const agent = new HttpAgent({
      url: 'https://agent.test/run',
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    });
    agent.addMessage({ id: 'u1', role: 'user', content: 'Add zod' });
    const { result } = renderHook(() => useAgUiAgent(agent));
    let running: Promise<unknown> = Promise.resolve();
    act(() => {
      running = agent.runAgent();
    });
    await waitFor(() => expect(result.current.status).toBe('submitted'));
    await act(async () => {
      result.current.stop();
      // The client ends an aborted run without throwing.
      await expect(running).resolves.toBeDefined();
    });
    expect(result.current).toMatchObject({ status: 'ready', error: undefined });
    const last = result.current.messages.findLast((m) => m.role === 'assistant');
    expect(last).toBeUndefined();
    expect(deriveAgentState({ status: result.current.status, message: last })).toEqual({ state: 'idle' });
  });

  it('still reports a request that fails before the server answered', async () => {
    const agent = new HttpAgent({
      url: 'https://agent.test/run',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    agent.addMessage({ id: 'u1', role: 'user', content: 'Add zod' });
    const { result } = renderHook(() => useAgUiAgent(agent));
    await act(() => agent.runAgent().catch(() => undefined));
    expect(result.current).toMatchObject({ status: 'error', error: { message: 'Failed to fetch' } });
  });

  it('reports a failed run', async () => {
    const agent = new ScriptedAgent([
      ({ runId }) => [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId },
        { type: EventType.RUN_ERROR, message: 'Model overloaded', code: 'overloaded' },
      ],
    ]);
    const { result } = renderHook(() => useAgUiAgent(agent));
    await act(() => agent.runAgent().catch(() => undefined));
    expect(result.current).toMatchObject({
      status: 'error',
      error: { message: 'Model overloaded', code: 'overloaded' },
    });
  });
});
