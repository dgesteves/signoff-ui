'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ChatStatus, RunUsage, UIMessage } from './lib/ai-types';
import {
  answerAgUiInterrupt,
  createAgUiRun,
  fromAgUiMessages,
  getAgUiResume,
  reduceAgUiRun,
  type AgUiApprovalResponse,
  type AgUiEvent,
  type AgUiInterrupt,
  type AgUiMessage,
  type AgUiResumeEntry,
  type AgUiRunState,
} from './lib/ag-ui';

/** What `useAgUiAgent` uses of an agent. Any `@ag-ui/client` agent fits: `HttpAgent`, or an integration's own `AbstractAgent`. */
export interface AgUiAgentLike {
  messages: readonly AgUiMessage[];
  pendingInterrupts?: readonly AgUiInterrupt[] | undefined;
  subscribe(subscriber: AgUiSubscriber): { unsubscribe(): void };
  runAgent(parameters?: { resume?: AgUiResumeEntry[] }): Promise<unknown>;
  abortRun?(): void;
}

/** The subscriber callbacks `useAgUiAgent` registers (a subset of `@ag-ui/client`'s `AgentSubscriber`). */
export interface AgUiSubscriber {
  onRunInitialized?(params: { messages: readonly AgUiMessage[] }): void;
  onEvent?(params: { event: AgUiEvent }): void;
  onMessagesChanged?(params: { messages: readonly AgUiMessage[] }): void;
  onRunFailed?(params: { error: Error }): void;
  onRunFinalized?(params: { messages: readonly AgUiMessage[] }): void;
}

export interface UseAgUiAgentOptions {
  /**
   * Starts the run that resumes the agent once every open interrupt has an answer. By default the
   * hook calls `agent.runAgent({ resume })`, which sends no tools, context or forwarded props, so a
   * run you started with them resumes without them. Pass the ones your runs send:
   * `(parameters) => agent.runAgent({ ...parameters, tools, context })`. In CopilotKit, resume
   * through it, so the run gets the frontend tools you registered:
   * `(parameters) => copilotkit.runAgent({ agent, ...parameters })`.
   */
  runAgent?: ((parameters: { resume: AgUiResumeEntry[] }) => Promise<unknown>) | undefined;
}

export interface UseAgUiAgentResult {
  /** The conversation as AI SDK messages: pass each to `AgentMessage`. */
  messages: UIMessage[];
  /** `useChat`-style status, for `deriveAgentState` and `AgentStatus`. */
  status: ChatStatus;
  error: AgUiRunState['error'];
  /** Token usage summed over the runs seen, for `RunMeter`. */
  usage: RunUsage | undefined;
  /** The step in progress, e.g. a LangGraph node. */
  step: string | undefined;
  /** Open interrupts. Those bound to a tool call show as approval cards; answer the rest with `resolve`. */
  interrupts: AgUiInterrupt[];
  /**
   * Answer a tool-call interrupt. Pass it as `AgentMessage`'s `onToolApproval`. The agent resumes
   * once every open interrupt has an answer, since AG-UI resumes them all in one run.
   */
  respond: (response: AgUiApprovalResponse) => Promise<void>;
  /** Answer any interrupt with your own payload (match its `responseSchema`). */
  resolve: (entry: AgUiResumeEntry) => Promise<void>;
  /**
   * Arguments a person edited for a tool call, sent as the approval payload's `editedArgs` (and as
   * `input`, deprecated) when it is approved. Pass it as `AgentMessage`'s `onToolInputEdit`, so
   * approval cards offer editing.
   */
  editInput: (toolCallId: string, input: unknown) => void;
  /**
   * Abort the run in progress. It ends like a cancelled run, with no `error`, also when the server
   * has not answered yet: what was streaming stays cut off, which `deriveAgentState` reads as `stopped`.
   */
  stop: () => void;
}

const CANCELLED = { type: 'RUN_FINISHED', outcome: { type: 'cancelled' } };

/**
 * Whether a run failed because it was aborted, as `stop()` aborts it (`abortRun()`): the request's
 * `AbortError`. Before the server's first response, no `RUN_ERROR` with code `abort` comes, as it
 * does mid-stream: `@ag-ui/client` calls `onRunFailed` with the abort, then ends the run without
 * throwing.
 */
const isAbort = (error: Error | undefined) => error?.name === 'AbortError';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface Snapshot {
  messages: readonly AgUiMessage[];
  run: AgUiRunState;
}

/** The agent's messages and run state as an external store, subscribed while a component reads it. */
function createStore(agent: AgUiAgentLike) {
  let snapshot: Snapshot = { messages: [...agent.messages], run: createAgUiRun(agent.pendingInterrupts) };
  const listeners = new Set<() => void>();
  let subscription: { unsubscribe(): void } | undefined;
  /** Edited arguments by tool call id, until the approval that carries them is answered. */
  const edits = new Map<string, unknown>();
  const set = (next: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  const update = (next: (run: AgUiRunState) => AgUiRunState) => {
    set({ run: next(snapshot.run) });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!subscription) {
        // Catch up on anything that happened before the first subscriber.
        snapshot = { ...snapshot, messages: [...agent.messages] };
        subscription = agent.subscribe({
          onRunInitialized: ({ messages }) => {
            set({ messages: [...messages], run: { ...snapshot.run, status: 'submitted', error: undefined } });
          },
          onEvent: ({ event }) => {
            update((run) => reduceAgUiRun(run, event));
          },
          onMessagesChanged: ({ messages }) => {
            set({ messages: [...messages] });
          },
          onRunFailed: ({ error }) => {
            // Stopped, not failed: what was streaming stays cut off, as for a cancelled run.
            if (isAbort(error)) return update((run) => reduceAgUiRun(run, CANCELLED));
            update((run) => ({
              ...reduceAgUiRun(run, { type: 'RUN_ERROR' }),
              error: { message: error.message || 'Run failed' },
            }));
          },
          onRunFinalized: ({ messages }) => {
            set({ messages: [...messages] });
            // Aborted runs end without RUN_FINISHED: as a cancelled run, what was streaming stays cut off.
            update((run) =>
              run.status === 'submitted' || run.status === 'streaming' ? reduceAgUiRun(run, CANCELLED) : run,
            );
          },
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          subscription?.unsubscribe();
          subscription = undefined;
        }
      };
    },
    /** Record an answer; returns the resume entries once every open interrupt has one. */
    answer(response: AgUiApprovalResponse | AgUiResumeEntry) {
      let answer = response;
      if (!('interruptId' in response)) {
        const toolCallId = snapshot.run.interrupts.find((i) => i.id === response.id)?.toolCallId;
        if (toolCallId && edits.has(toolCallId)) {
          if (response.approved && response.input === undefined) answer = { ...response, input: edits.get(toolCallId) };
          edits.delete(toolCallId);
        }
      }
      update((run) => answerAgUiInterrupt(run, answer));
      return getAgUiResume(snapshot.run);
    },
    editInput(toolCallId: string, input: unknown) {
      edits.set(toolCallId, input);
    },
  };
}

/**
 * Render an AG-UI agent with these components: its messages as AI SDK parts, run status, usage,
 * and tool-call interrupts as approvals.
 *
 * ```tsx
 * const agent = useMemo(() => new HttpAgent({ url: '/api/agent' }), []);
 * const { messages, status, respond } = useAgUiAgent(agent);
 * ```
 *
 * When your runs send tools or context, pass `runAgent` so the run that resumes an interrupt sends
 * them too.
 */
export function useAgUiAgent(agent: AgUiAgentLike, options: UseAgUiAgentOptions = {}): UseAgUiAgentResult {
  const store = useMemo(() => createStore(agent), [agent]);
  const { messages, run } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // The latest render's runAgent, so an inline function doesn't make respond a new one each render.
  const runAgent = useRef(options.runAgent);
  useIsoLayoutEffect(() => {
    runAgent.current = options.runAgent;
  });
  const answer = useCallback(
    async (response: AgUiApprovalResponse | AgUiResumeEntry) => {
      const resume = store.answer(response);
      if (!resume) return;
      await (runAgent.current ? runAgent.current({ resume }) : agent.runAgent({ resume }));
    },
    [agent, store],
  );

  return {
    messages: useMemo(() => fromAgUiMessages(messages, run), [messages, run]),
    status: run.status,
    error: run.error,
    usage: run.usage,
    step: run.step,
    interrupts: run.interrupts,
    respond: answer,
    resolve: answer,
    editInput: store.editInput,
    stop: useCallback(() => agent.abortRun?.(), [agent]),
  };
}
