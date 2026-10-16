[CopilotKit](https://docs.copilotkit.ai) is an AG-UI client with a chat of its own, and its human-in-the-loop and interrupt hooks hand you render props. Keep those hooks, and render signoff-ui's components in their render props: the approval card, approval rules and `DiffReview` then work inside `CopilotChat`, with the answer going back to the agent through CopilotKit. [examples/copilotkit](https://github.com/dgesteves/signoff-ui/tree/main/examples/copilotkit) runs every file on this page against a scripted AG-UI agent, with no API key, and CI builds it and drives each case in Chrome. Tested with `@copilotkit/react-core` and `@copilotkit/runtime` 1.79.0 (the v2 hooks), `@ag-ui/client` 1.0.2 and Next.js 16.4.

## Install

```package-install
npm i signoff-ui ai @copilotkit/react-core @copilotkit/runtime @ag-ui/client zod
```

Add signoff-ui's styles as in [Getting started](/docs/getting-started#add-the-styles), next to CopilotKit's own (`@copilotkit/react-core/v2/styles.css`).

## The runtime and the provider

CopilotKit's runtime runs the agent beside your app. With an AG-UI agent it needs no model adapter: it passes the agent's events through to the page.

```ts title="app/api/copilotkit/[[...slug]]/route.ts"
import { HttpAgent } from '@ag-ui/client';
import { CopilotRuntime, createCopilotRuntimeHandler, InMemoryAgentRunner } from '@copilotkit/runtime/v2';
import { ScriptedAgent } from '@/lib/scripted-agent';

// CopilotKit's runtime with one AG-UI agent and no model adapter: it passes the agent's events to the
// page. AGENT_URL points it at your AG-UI server (LangGraph, Mastra, CrewAI, Pydantic AI and others).
const runtime = new CopilotRuntime({
  agents: { default: process.env.AGENT_URL ? new HttpAgent({ url: process.env.AGENT_URL }) : new ScriptedAgent() },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({ runtime, basePath: '/api/copilotkit' });

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
```

`ScriptedAgent` is the example's agent, which plays a scripted run for each message ([`lib/scripted-agent.ts`](https://github.com/dgesteves/signoff-ui/blob/main/examples/copilotkit/lib/scripted-agent.ts)). With `AGENT_URL` set, the route runs your AG-UI server instead: LangGraph, Mastra, CrewAI, Pydantic AI or any other.

```tsx title="app/providers.tsx"
'use client';

import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import { Suspense, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  // With cacheComponents (on in new Next.js 16.4 apps), `next build` fails without this boundary:
  // the provider reads the clock (Date.now()) while it renders, which a prerender may not.
  return (
    <Suspense fallback={null}>
      <CopilotKitProvider runtimeUrl="/api/copilotkit">{children}</CopilotKitProvider>
    </Suspense>
  );
}
```

Render `<Providers>` around the app in `app/layout.tsx`. The `Suspense` boundary matters in apps made with Next.js 16.4, where `cacheComponents` is on: without it, `next build` fails on every page, because the provider reads the clock (`Date.now()`) while it renders.

## Approve a call

`useHumanInTheLoop` gives the agent a tool that waits for a person. Its `render` sees the call at three points: arguments streaming in (`inProgress`, with no `respond` yet), waiting for an answer (`executing`), and answered (`complete`, with the result as a string). This one renders nothing while the arguments stream: a press then has nothing to answer with, and would leave the card stuck. At the other two points it hands `ToolApprovalCard` the call as an AI SDK tool part, so the card offers For this session and Always, lets the rules they add answer later calls, and shows how each call was decided.

```tsx title="app/run-command-approval.tsx"
'use client';

import { ToolCallStatus, useHumanInTheLoop } from '@copilotkit/react-core/v2';
import { ToolApprovalCard, type ApprovalPolicy, type ToolPart } from 'signoff-ui';
import { z } from 'zod';

/** The answer respond sent, or undefined when the result is something else, such as an error. */
function readAnswer(result: string) {
  try {
    return JSON.parse(result) as { approved: boolean; reason?: string };
  } catch {
    return undefined;
  }
}

/** The call as the AI SDK tool part ToolApprovalCard reads: waiting for a person, or answered. */
function toToolPart(toolCallId: string, input: unknown, result: string | undefined): ToolPart {
  const part = { type: 'dynamic-tool', toolName: 'run_command', toolCallId, input } as const;
  if (result === undefined) return { ...part, state: 'approval-requested', approval: { id: toolCallId } };
  // Complete: the answer respond sent, or an error (a stopped run, arguments that didn't parse).
  const answer = readAnswer(result);
  const reason = answer ? answer.reason : result;
  return answer?.approved
    ? { ...part, state: 'approval-responded', approval: { id: toolCallId, approved: true, reason } }
    : { ...part, state: 'output-denied', approval: { id: toolCallId, approved: false, reason } };
}

export function RunCommandApproval({ policy }: { policy: ApprovalPolicy }) {
  useHumanInTheLoop(
    {
      name: 'run_command',
      description: 'Run a shell command, once the user approves it',
      parameters: z.object({ command: z.string() }),
      render: ({ toolCallId, args, status, respond, result }) => {
        // The arguments are still streaming in, and there is no respond to answer with yet.
        if (status === ToolCallStatus.InProgress) return null;
        return (
          <ToolApprovalCard
            part={toToolPart(toolCallId, args, result)}
            policy={policy}
            onRespond={({ approved, reason }) => respond?.({ approved, reason })}
          />
        );
      },
    },
    // CopilotKit registers render once: these deps register it again when the rules change, so a
    // rule added with Always answers the next call. It compares them as JSON, so list data.
    [policy.rules, policy.ready],
  );
  return null;
}
```

The agent gets what `respond` sent, `{ approved, reason }`, as the call's result, so have it run the command only when `approved` is true. A call can also end without an answer: when the run is stopped while the card waits, or the arguments don't parse, CopilotKit sets the result to an `Error: ...` string. `readAnswer` returns nothing for that, and the card reads Denied with the error, where `JSON.parse` in `render` would throw and take the page down.

CopilotKit registers the tool and its `render` once, so a value `render` closes over keeps its first value. The policy is such a value: its deps register the tool again when the rules change, so a rule added with Always answers the next call, and the card reads "Allowed by your rule". CopilotKit compares the deps as JSON, so list data there, not functions.

## Review proposed edits

A tool whose arguments carry `files` (`path`, `oldContent`, `newContent`) gets a `DiffReview`. The person accepts or rejects each hunk and comments on lines, and `reviewToolOutput` sends the review back as the call's result: a one-line summary, each file as applied, the rejected hunks and the comments.

```tsx title="app/review-changes.tsx"
'use client';

import { ToolCallStatus, useHumanInTheLoop } from '@copilotkit/react-core/v2';
import { DiffReview, decisionsFromToolOutput, reviewToolOutput } from 'signoff-ui';
import { z } from 'zod';

const file = z.object({ path: z.string(), oldContent: z.string().optional(), newContent: z.string().optional() });

/** The review respond sent, or undefined when the result is something else, such as an error. */
function readReview(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

export function ReviewChanges() {
  useHumanInTheLoop({
    name: 'review_changes',
    description: 'Propose edits to files, which apply once the user reviews them',
    parameters: z.object({ files: z.array(file) }),
    render: ({ args, status, respond, result }) => {
      // The files are still streaming in, and may be cut short.
      if (status === ToolCallStatus.InProgress) return null;
      return (
        <DiffReview
          files={args.files}
          // Answered: the review stays on the page, read-only, with the decisions it sent.
          readOnly={status === ToolCallStatus.Complete}
          decisions={status === ToolCallStatus.Complete ? decisionsFromToolOutput(readReview(result)) : undefined}
          onSubmit={(review) => respond?.(reviewToolOutput(review))}
        />
      );
    },
  });
  return null;
}
```

Once answered, the review stays on the page, read-only, with the decisions `decisionsFromToolOutput` reads back from the result. [DiffReview](/docs/components/diff-review) covers the rest of its props.

## Interrupts

An agent that runs a tool itself can pause before it with an AG-UI interrupt: the run ends with `RUN_FINISHED` and an `interrupt` outcome that names the call (`toolCallId`). `useInterrupt` renders a card for it in `CopilotChat`:

```tsx title="app/deploy-approval.tsx"
'use client';

import type { Message } from '@ag-ui/client';
import { useAgent, useInterrupt } from '@copilotkit/react-core/v2';
import { ApprovalCard } from 'signoff-ui';

/** The name and arguments of the call an interrupt guards, from the agent's messages. */
function callOf(messages: readonly Message[], toolCallId: string | undefined) {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const call = message.toolCalls?.find((c) => c.id === toolCallId);
    if (!call) continue;
    try {
      return { name: call.function.name, input: JSON.parse(call.function.arguments) as unknown };
    } catch {
      return { name: call.function.name, input: call.function.arguments };
    }
  }
  return undefined;
}

export function DeployApproval() {
  const { agent } = useAgent();
  useInterrupt({
    // The interrupts that guard a tool call; give the others a UI of their own.
    enabled: ({ value }) => !!(value as { toolCallId?: string } | undefined)?.toolCallId,
    render: ({ interrupt, resolve }) => {
      const call = callOf(agent.messages, interrupt?.toolCallId);
      return (
        <ApprovalCard
          toolName={call?.name ?? 'tool'}
          input={call?.input}
          description={interrupt?.message}
          onDecide={async ({ decision, reason }) => {
            await resolve({ approved: decision.startsWith('allow'), reason });
          }}
        />
      );
    },
  });
  return null;
}
```

An interrupt carries no arguments, so `callOf` finds the call in the agent's messages. `resolve` sends `{ approved, reason }`: CopilotKit adds it as the call's tool message and resumes the run with it as the interrupt's `resume` entry. `onDecide` awaits it in a function of its own, because `ApprovalCard` types `onDecide` to return nothing. Once answered, the card leaves the chat, and the agent's reply follows. Interrupts that guard no call, such as `input_required`, are left for a `useInterrupt` of their own.

## Put them on the page

The three components render nothing themselves: they register their tools and renderers with CopilotKit, which shows the cards in `CopilotChat`. The approval rules live in the page, in `useApprovalPolicy`, so they last while the page is open (pass it `storage` to keep Always rules).

```tsx title="app/page.tsx"
'use client';

import { CopilotChat } from '@copilotkit/react-core/v2';
import { useApprovalPolicy } from 'signoff-ui';
import { DeployApproval } from './deploy-approval';
import { ReviewChanges } from './review-changes';
import { RunCommandApproval } from './run-command-approval';

export default function Page() {
  // The rules For this session and Always add: the next call they cover is answered without asking.
  const policy = useApprovalPolicy();
  return (
    <>
      <RunCommandApproval policy={policy} />
      <ReviewChanges />
      <DeployApproval />
      <CopilotChat className="chat" />
    </>
  );
}
```

## Render the run with AgentMessage

To render the run with signoff-ui's own components instead of `CopilotChat` (the tool call timeline, approval cards, sub-agents and the agent's status), read CopilotKit's agent with `useAgUiAgent`, and keep CopilotKit for the runtime and the tools. Start each run with `agent.addMessage(...)`, then `copilotkit.runAgent({ agent })`, and pass `runAgent`, so the run that resumes an interrupt goes through CopilotKit too:

```tsx title="app/agent-message/page.tsx"
const { copilotkit } = useCopilotKit();
const { agent } = useAgent();
// A frontend tool: CopilotKit sends it with each run it starts, and runs it when the agent calls it.
useFrontendTool({
  name: 'notify',
  description: 'Post a message in a team channel',
  parameters: z.object({ channel: z.string(), text: z.string() }),
  handler: async ({ channel }) => `Posted in ${channel}`,
});
const { messages, status, respond } = useAgUiAgent(agent, {
  // Resume through CopilotKit, so the run that resumes has the frontend tools too.
  runAgent: (parameters) => copilotkit.runAgent({ agent, ...parameters }),
});
```

Without `runAgent`, the hook resumes with `agent.runAgent({ resume })`, which sends no tools: the resumed run couldn't call `notify`, or any other tool the page registered. The same goes outside CopilotKit, for any app that passes `tools`, `context` or `forwardedProps` to `runAgent`: pass `runAgent: (parameters) => agent.runAgent({ ...parameters, tools, context })`.

## How it is tested

CI builds the example with `next build`, then [`scripts/smoke-copilotkit.mjs`](https://github.com/dgesteves/signoff-ui/blob/main/scripts/smoke-copilotkit.mjs) drives it in Chrome and fails on any page or console error:

- `run_command`: the card shows the command, Always answers it with one run, and the next call is answered by the rule (two runs: the call, then the answer), with no card waiting.
- `review_changes`: two files, Accept all, and the agent's reply quotes the review's summary; the review is read-only afterwards.
- The deploy interrupt: the card shows the call's arguments, and Approve resumes the run, with one run.
- With `AgentMessage`: Approve resumes through `copilotkit.runAgent` with the page's `notify` tool, the agent calls it, and CopilotKit runs it and starts the follow-up run. With `runAgent` left out, the resumed run gets no tools and this step fails.

The same test passes against `next dev`, where React's Strict Mode is on (`BASE_URL=http://localhost:3500 pnpm smoke:copilotkit`).
