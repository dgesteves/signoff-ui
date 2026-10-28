[AG-UI](https://docs.ag-ui.com) is the open protocol that LangGraph, CrewAI, Mastra, Pydantic AI and other agent frameworks use to stream runs to a frontend. `signoff-ui/ag-ui` turns an AG-UI agent into the same message parts the AI SDK produces, so every component works with it unchanged, approvals included.

Want to see it first? The [components page](/components#ag-ui) runs a real `@ag-ui/client` agent replaying a LangGraph-style run, with an interrupt you can approve or deny.

Building with CopilotKit? You don't need `useAgUiAgent`: see [Using CopilotKit?](/docs/ag-ui#using-copilotkit).

## Install

```package-install
npm i signoff-ui ai @ag-ui/client
```

`ai` is there for the message part types only. A custom agent, an `AbstractAgent` whose `run()` returns an RxJS `Observable`, needs `rxjs` too, at the version `@ag-ui/client` uses (`rxjs@7.8.1` for 1.0). Add the styles as in [Getting started](/docs/getting-started#add-the-styles). With the shadcn CLI, the adapter is the `ag-ui` item:

```package-install
npx shadcn@latest add https://signoff-ui.vercel.app/r/ag-ui.json
```

## Render an agent

`useAgUiAgent` takes any `@ag-ui/client` agent, `HttpAgent` or a framework integration's own `AbstractAgent`, and returns what the components need:

```tsx title="app/agent-run.tsx"
'use client';

import { HttpAgent } from '@ag-ui/client';
import { AgentMessage, AgentStatus, RunMeter, deriveAgentState } from 'signoff-ui';
import { useAgUiAgent } from 'signoff-ui/ag-ui';

const agent = new HttpAgent({ url: '/api/agent' });

export function AgentRun() {
  const { messages, status, usage, step, respond } = useAgUiAgent(agent);
  const last = messages.findLast((m) => m.role === 'assistant');
  const { state, detail } = deriveAgentState({ status, message: last });
  return (
    <>
      <AgentStatus state={state} detail={step ?? detail} />
      {last ? (
        <AgentMessage
          message={last}
          streaming={status === 'streaming'}
          active={state !== 'done' && state !== 'stopped' && state !== 'error'}
          failed={status === 'error'}
          onToolApproval={respond}
        />
      ) : null}
      <RunMeter usage={usage} />
    </>
  );
}

export async function send(text: string) {
  agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text });
  await agent.runAgent();
}
```

Create the agent once, outside the component or in a `useMemo`: the hook subscribes to the instance it's given.

| Returns      | What it is                                                                      |
| ------------ | ------------------------------------------------------------------------------- |
| `messages`   | The conversation as AI SDK `UIMessage`s: pass each to `AgentMessage`            |
| `status`     | `useChat`-style status, for `deriveAgentState` and `AgentStatus`                |
| `error`      | The run's error, if it failed                                                   |
| `usage`      | Token usage summed over the runs seen, for `RunMeter`                           |
| `step`       | The step in progress, such as the LangGraph node running                        |
| `interrupts` | Open interrupts; those bound to a tool call show as approval cards              |
| `respond`    | Answers a tool-call interrupt; pass it as `AgentMessage`'s `onToolApproval`     |
| `resolve`    | Answers any interrupt with your own payload                                     |
| `editInput`  | Arguments a person edited, sent with the approval; pass it as `onToolInputEdit` |
| `stop`       | Aborts the run in progress; it ends as canceled, so it reads as `stopped`       |

## How events map

| AG-UI 1.0                                                                | Becomes                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user message                                                             | `user` message with `text` parts, images and documents as `file` parts                                                                                        |
| the assistant, reasoning, tool and activity messages that follow it      | one `assistant` message, the way the AI SDK groups a multi-step run                                                                                           |
| `TEXT_MESSAGE_*`, `REASONING_*`                                          | `text` and `reasoning` parts, `state: 'streaming'` until their end event                                                                                      |
| `TOOL_CALL_START`, `TOOL_CALL_ARGS`                                      | `dynamic-tool` part, `input-streaming`, with the arguments parsed as they arrive                                                                              |
| `TOOL_CALL_END`                                                          | `input-available`                                                                                                                                             |
| `TOOL_CALL_RESULT`, tool message                                         | `output-available` (JSON results parsed), or `output-error` with the tool message's `error`; a denied call stays `output-denied`                              |
| `RUN_FINISHED` with an `interrupt` outcome bound to a tool call          | `approval-requested`, the interrupt's `message` as `approval.requestReason`                                                                                   |
| `respond({ id, approved, reason })`                                      | `approval-responded` or `output-denied`; the agent resumes with `payload: { approved, reason }`, plus `editedArgs` and `input` after an edit with `editInput` |
| `RUN_STARTED`, content, `RUN_FINISHED`, `RUN_ERROR`                      | `status`: `submitted`, `streaming`, then `ready` or `error`                                                                                                   |
| `RUN_FINISHED` with a `cancelled` outcome, or `stop()`                   | `status: 'ready'` with no `error`, before the first event too; what was streaming is left cut off: `deriveAgentState` reads `stopped`                         |
| `usage` on `RUN_FINISHED` and `RUN_ERROR`                                | `usage`, summed over runs, with cache and reasoning tokens                                                                                                    |
| `STEP_STARTED`                                                           | `step`                                                                                                                                                        |
| activity message                                                         | a `data-${activityType}` part, rendered by `renderData`                                                                                                       |
| `SUBAGENT_STARTED`, and the messages and events with its `subagentRunId` | a `data-signoff-subagent` part after the call that started it (`parentToolCallId`), with `{ subagentRunId, parentToolCallId, name, status, parts }`           |
| `SUBAGENT_FINISHED`, `SUBAGENT_ERROR`                                    | the part's `status`: `done`, `suspended` (paused until a later run) or `error`, with the message as `errorText`                                               |

Shared state (`STATE_SNAPSHOT`, `STATE_DELTA`) stays on `agent.state`.

## Sub-agents

A sub-agent's messages don't join its parent's parts one by one. Its text and tool calls, in the same shapes as the parent's, go in one `data-signoff-subagent` part, placed after the tool call that started it, and `ToolCallTimeline` (inside `AgentMessage` too) nests them under that call, collapsed. A sub-agent another one started goes inside that one's `parts`, after its call. One started by no call it can find shows where its first message was, and the timeline shows its calls in place.

Events can arrive in any order: a sub-agent's own events before its `SUBAGENT_STARTED` mark it running, and an end that came first stands. Messages restored from before the page (no events) still group by `subagentRunId`, without a name, `running` while one of their calls is. A call a sub-agent makes can wait on approval like any other: the interrupt names its `toolCallId`, the sub-agent opens to show the card, `deriveAgentState` reads `awaiting-approval`, and `respond` resumes the run. `subagents` in the run state (`reduceAgUiRun`) lists each one, with its name, parent call and status.

## Interrupts and approvals

AG-UI resumes every open interrupt in one run, so the hook waits until each has an answer before it calls `runAgent({ resume })`. A tool-call interrupt renders as an approval card, and `respond` answers it with `{ approved, reason }`. Pass `editInput` as `AgentMessage`'s `onToolInputEdit` and the cards let a person edit a call's arguments first; the payload then carries them as `editedArgs`, AG-UI's field for approve-with-edits, which replaces the call's arguments in full. It carries them as `input` too, the name earlier versions used; that is deprecated, so have your agent read `editedArgs`. The cards offer editing whenever you pass `editInput`, so pass it only for an agent that runs `editedArgs`: one whose tool-call interrupts list it in their `responseSchema`, or that declares `humanInTheLoop.approveWithEdits` in its capabilities. With an `approvalPolicy`, cards offer approving for the session or always, and answer what a rule covers without asking.

Interrupts that aren't tool approvals (`input_required`, or your own) are in `interrupts`. Answer them with `resolve`, matching the interrupt's `responseSchema`:

```ts
await resolve({ interruptId: interrupt.id, status: 'resolved', payload: { city: 'Lisbon' } });
```

## LangGraph

LangGraph agents speak AG-UI through [`ag-ui-langgraph`](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/langgraph/python), which serves a compiled graph from FastAPI:

```python title="server.py"
# pip install ag-ui-langgraph fastapi uvicorn
from fastapi import FastAPI
from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint

from my_agent import graph  # your compiled graph

app = FastAPI()
# emit_interrupt_outcome reports interrupts on RUN_FINISHED, where useAgUiAgent reads them. It's off by default.
add_langgraph_fastapi_endpoint(app, LangGraphAgent(name="agent", graph=graph, emit_interrupt_outcome=True), "/agent")
```

Point `HttpAgent` at it (`new HttpAgent({ url: 'http://localhost:8000/agent' })`), with FastAPI's `CORSMiddleware` or a rewrite in your app if the origins differ. An interrupt renders as an approval card when its value names the tool call it guards, and the hook resumes it with `{ approved, reason }`, plus `editedArgs` when the person edited the call's arguments:

```python
from langgraph.types import interrupt

answer = interrupt({"message": f"Run `{command}`?", "tool_call_id": tool_call["id"]})
if not answer["approved"]:
    ...  # answer.get("reason") is what the user typed, if anything
args = answer.get("editedArgs", tool_call["args"])  # run the call with these: an edit replaces its arguments in full
```

Interrupts without a tool call are in `interrupts`, for `resolve`.

## Other frameworks

CrewAI, Mastra, Pydantic AI and the protocol's other integrations each serve or wrap an AG-UI agent. Point an `HttpAgent` at the endpoint, or pass the integration's own `AbstractAgent` to `useAgUiAgent`; the components don't change. An interrupt becomes an approval card when it carries the `toolCallId` of the call it guards; how each framework sets that varies, so check its docs if you want approval cards rather than `interrupts`.

## Using CopilotKit?

[CopilotKit](https://docs.copilotkit.ai) is an AG-UI client of its own, so keep its hooks and render the components in their render props. `useAgUiAgent` is for apps without CopilotKit. Here `useHumanInTheLoop` gives the agent a `run_command` tool, and `CopilotChat` shows an approval card for each call:

```tsx title="app/run-command-approval.tsx"
'use client';

import { ToolCallStatus, useHumanInTheLoop } from '@copilotkit/react-core/v2';
import { ApprovalCard } from 'signoff-ui';
import { z } from 'zod';

/** The answer respond sent, or undefined when the result is something else, such as an error. */
function readAnswer(result: string) {
  try {
    return JSON.parse(result) as { approved: boolean; reason?: string };
  } catch {
    return undefined;
  }
}

export function RunCommandApproval() {
  useHumanInTheLoop({
    name: 'run_command',
    description: 'Run a shell command, once the user approves it',
    parameters: z.object({ command: z.string() }),
    render: ({ args, status, respond, result }) => {
      // The arguments are still streaming in, and there is no respond to answer with yet.
      if (status === ToolCallStatus.InProgress) return null;
      // Complete means the call has a result and respond is gone: an answer, or an error to show.
      const answer = status === ToolCallStatus.Complete ? readAnswer(result) : undefined;
      return (
        <ApprovalCard
          toolName="run_command"
          input={args}
          status={status === ToolCallStatus.Complete ? (answer?.approved ? 'approved' : 'denied') : 'pending'}
          reason={answer ? answer.reason : result}
          onDecide={({ decision, reason }) => respond?.({ approved: decision.startsWith('allow'), reason })}
        />
      );
    },
  });
  return null;
}
```

Render `<RunCommandApproval />` inside `CopilotKitProvider`. The agent gets `{ approved, reason }` as the call's result, so have it run the command only when `approved` is true. A call can also end without an answer: if the run is stopped while the card waits, or the model sends arguments that don't parse, CopilotKit sets the result to an `Error: ...` string. Parsing that in `render` would throw, and CopilotKit has no error boundary, so it would take the page down; `readAnswer` returns nothing instead, and the card reads Denied with the error. Tested with `@copilotkit/react-core` and `@copilotkit/runtime` 1.79.0 (the v2 hooks), under `next dev` and in a production build, including a run stopped while the card waits.

CopilotKit registers the tool and its `render` once, when the component mounts, so `render` should take what it shows from its props. A value it closes over stays as it was on the first render: the policy `useApprovalPolicy` returns would keep the rules it had before the storage loaded, so a rule added with Always would never answer a call. List such values in `useHumanInTheLoop`'s second argument, its deps, so the tool registers again when they change. CopilotKit compares the deps as JSON, so list data (`[policy.rules, policy.ready]` for a policy) and read a callback that changes through a ref: a function turns into `null` in JSON, so a new one never registers the tool again.

## Without the hook

The pure pieces behind it, `fromAgUiMessages`, `reduceAgUiRun`, `answerAgUiInterrupt` and `getAgUiResume`, work with your own store or a recorded event log. The adapter has no dependency on `@ag-ui/*`: it reads their objects structurally, and its tests run a real `@ag-ui/client` agent through an interrupt and a resumed run.
