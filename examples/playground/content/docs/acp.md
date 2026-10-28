The [Agent Client Protocol](https://agentclientprotocol.com) (ACP) is the JSON-RPC protocol editors use to run coding agents. `signoff-ui/acp` turns one prompt turn into the parts the components render: the agent's message and thought chunks, its tool calls and their status, each permission request as an approval card, and an edit's diff content as `DiffReview` files. The card offers Always only when the agent sent a single `allow_always` option: a kind the agent sent several options of gets no button (Deny aside), and answering with one cancels the request rather than pick a grant for the person.

Want to see it first? The [components page](/components#acp) plays a scripted ACP turn, no real agent: a read, an edit that shows its diff and asks permission, then the tests, which ask too.

## Install

```package-install
npm i signoff-ui ai
```

`ai` is there for the message part types only. The entry is pure functions with no React and no dependency on an ACP library: its types mirror what it reads, and `@agentclientprotocol/sdk`'s objects fit them as they are (a type test checks it). Add the styles as in [Getting started](/docs/getting-started#add-the-styles).

## Fold a turn

A client receives `session/update` notifications while `session/prompt` runs, and `session/request_permission` requests it has to answer. Fold both into an `AcpTurn`, and render `toAcpMessage(turn)`. This hook holds one turn, and is the client half of the connection:

```tsx title="components/use-acp-turn.tsx"
'use client';

import * as acp from '@agentclientprotocol/sdk';
import { useRef, useState } from 'react';
import type { ApprovalDecision } from 'signoff-ui';
import {
  answerAcpPermission,
  createAcpTurn,
  endAcpTurn,
  reduceAcpTurn,
  requestAcpPermission,
  toAcpPermissionResponse,
  type AcpTurn,
} from 'signoff-ui/acp';

/** One prompt turn at a time: the client half of the connection, and what the components render. */
export function useAcpTurn() {
  const [turn, setTurn] = useState<AcpTurn>();
  const waiting = useRef(new Map<string, (response: acp.RequestPermissionResponse) => void>());
  // Connect it to the agent: client.connect(stream).agent is what prompt and cancel take.
  const [client] = useState(() =>
    acp
      .client()
      .onNotification(acp.methods.client.session.update, ({ params }) => setTurn((t) => t && reduceAcpTurn(t, params)))
      .onRequest(
        acp.methods.client.session.requestPermission,
        ({ params }) =>
          new Promise((resolve) => {
            waiting.current.set(params.toolCall.toolCallId, resolve);
            setTurn((t) => t && requestAcpPermission(t, params));
          }),
      ),
  );

  async function prompt(agent: acp.ClientContext, sessionId: string, text: string) {
    setTurn(createAcpTurn());
    try {
      const response = await agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text }],
      });
      setTurn((t) => t && endAcpTurn(t, response));
    } catch (error) {
      setTurn((t) => t && endAcpTurn(t, { error: { message: String(error) } }));
    }
  }

  function decide(toolCallId: string, decision: ApprovalDecision) {
    const options = turn?.permissions[toolCallId]?.options ?? [];
    setTurn((t) => t && answerAcpPermission(t, toolCallId, decision));
    waiting.current.get(toolCallId)?.(toAcpPermissionResponse(decision, options));
    waiting.current.delete(toolCallId);
  }

  // For a Stop button. After session/cancel, ACP has the client answer each open request with cancelled.
  async function cancel(agent: acp.ClientContext, sessionId: string) {
    await agent.notify(acp.methods.agent.session.cancel, { sessionId });
    for (const [toolCallId, resolve] of waiting.current) {
      resolve({ outcome: { outcome: 'cancelled' } });
      setTurn((t) => t && answerAcpPermission(t, toolCallId, 'cancelled'));
    }
    waiting.current.clear();
  }

  return { turn, client, prompt, decide, cancel };
}
```

`cancel` stops the turn. It sends `session/cancel`, then answers each permission request still open with `cancelled`, as ACP requires of a client that cancels: an agent that waits on that answer would otherwise never return from `session/prompt`, and the turn would stay `streaming`. The agent then ends the turn with `stopReason: 'cancelled'`, and a call whose request was canceled reads as denied.

The connection itself is up to your app: `client.connect(stream)`, with `ndJsonStream` over the agent's stdio or a bridge, returns a connection. Its `agent` is what `prompt` and `cancel` take, once your app has sent `initialize` and `session/new` through it. These functions only fold what it receives. The hook uses the app API of `@agentclientprotocol/sdk` (`client()` and `methods`), which SDK 1 has from 1.0 and SDK 2 keeps: SDK 2 removed `ClientSideConnection` and the `Client` and `Agent` interfaces.

## Render it

`AgentMessage` renders the turn. For a call waiting on its permission request, render an `ApprovalCard` that offers the agent's options, with the diff of an edit as its preview. Once the call is decided, return `undefined`: the default row then shows how it ended, Done with its output, Failed with its error, or Denied.

```tsx title="components/acp-turn.tsx"
'use client';

import { AgentMessage, ApprovalCard, DiffReview, type ApprovalDecision } from 'signoff-ui';
import { acpToolName, decisionsFromAcpOptions, fromAcpDiffs, toAcpMessage, type AcpTurn } from 'signoff-ui/acp';

export function AcpTurnView({
  turn,
  cwd,
  decide,
}: {
  turn: AcpTurn;
  cwd: string;
  decide: (id: string, d: ApprovalDecision) => void;
}) {
  const active = turn.status === 'submitted' || turn.status === 'streaming';
  return (
    <AgentMessage
      message={toAcpMessage(turn)}
      streaming={turn.status === 'streaming'}
      active={active}
      failed={turn.status === 'error'}
      renderTool={(part) => {
        const permission = turn.permissions[part.toolCallId];
        // Only while the call waits: a decided one gets the default row, with its result.
        if (!permission || part.state !== 'approval-requested') return undefined;
        const call = turn.toolCalls[part.toolCallId]!;
        const files = fromAcpDiffs(call.content, { root: cwd });
        const decisions = decisionsFromAcpOptions(permission.options).filter((d) => d !== 'allow-session');
        // Always is offered only when the agent sent one allow_always option: name what it grants.
        const always = decisions.includes('allow-always')
          ? permission.options.find((o) => o.kind === 'allow_always')?.name
          : undefined;
        return (
          <ApprovalCard
            toolName={acpToolName(call)}
            title={call.title ?? undefined}
            input={call.rawInput}
            description={always ? `Always: ${always}` : undefined}
            preview={files.length > 0 ? <DiffReview files={files} readOnly /> : undefined}
            // The agent's options. It keeps what "always" means, so the card shows no argument patterns.
            ruleScope={false}
            decisions={decisions}
            // ACP's response has no field for a reason.
            allowReason={false}
            onDecide={(choice) => decide(part.toolCallId, choice.decision)}
          />
        );
      }}
    />
  );
}
```

`toAcpPermissionResponse(decision, options)` selects the agent's one option of the same kind: `allow-once` is `allow_once`, `allow-always` is `allow_always`, `deny-once` is `reject_once` and `deny-always` is `reject_always`. With no option of that kind, or several, the request is canceled: options of one kind grant different things, so it never picks one for the person, and `decisionsFromAcpOptions` doesn't offer that kind. Claude Code's ExitPlanMode sends up to three `allow_always` options, so its card offers Approve and Deny. Deny is the exception: with several `reject_once` options it answers the first, since a "no" grants nothing. When `decisionsFromAcpOptions` offers nothing, answer `{ outcome: { outcome: 'cancelled' } }` right away instead of rendering a card.

When the agent sends one `allow_always` option, Always answers it, whatever it grants, such as "Yes, allow all edits during this session". So the card above names it in its description, and the button keeps its short label: card buttons don't wrap, and a long name pushes Approve and Deny off a phone-width card. `decisionsFromAcpOptions` also offers `allow-session`, which answers `allow_once` and leaves the session rule to your `useApprovalPolicy`; the example above leaves it out.

## How a turn maps

| ACP                                                   | Becomes                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `agent_message_chunk`, `agent_thought_chunk` (text)   | `text` and `reasoning` parts, consecutive chunks joined, the last one `streaming` until the turn ends         |
| `tool_call`, `tool_call_update`                       | a `dynamic-tool` part per call, updates merged by id (`null` and missing fields keep their value)             |
| the tool's `name`, else `kind`, else `title`          | the part's `toolName`, which approval rules match; `title` is the part's `title`                              |
| `pending`, `in_progress`                              | `input-available`, shown running                                                                              |
| `completed`                                           | `output-available`, the output being `rawOutput`, else the text of its content                                |
| `failed`                                              | `output-error`, with the text of its content                                                                  |
| `session/request_permission` (`requestAcpPermission`) | `approval-requested`, the tool call id as the approval id                                                     |
| `answerAcpPermission(turn, id, decision)`             | `approval-responded` (then the output, approval kept), or `output-denied`, also when the request was canceled |
| `session/prompt` returns (`endAcpTurn`)               | `status: 'ready'` and its `stopReason`, or `'error'`: a call left running then reads as stopped               |
| `endAcpTurn` with `stopReason: 'cancelled'`           | the text or reasoning it was writing stays `streaming`, cut off, so the run reads as stopped                  |
| `diff` content (`fromAcpDiffs`)                       | `DiffReview` files, paths relative to `root` (the session's `cwd`), a diff with no `oldText` a new file       |

User message chunks, plans, available commands, mode, config and usage updates are left out of the message. `toAcpDiffs` goes the other way, from files to diff content.

## What it does not do yet

ACP's permission request is all or nothing: the agent offers allow and reject, and nothing in between. So the card above approves or rejects a whole edit, with its diff to read. Accepting some hunks of an edit and rejecting others would mean the client applying the edit itself, through `fs/write_text_file`, which this entry does not do.
