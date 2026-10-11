# signoff-ui

Review what your agent changed and approve what it may do: React components for multi-file diff review and tool approvals, for AI SDK and AG-UI agents, inside the chat UI you already have.

[![CI](https://img.shields.io/github/actions/workflow/status/dgesteves/signoff-ui/ci.yml?branch=main&label=CI&labelColor=0d0f12&color=22d3ee)](https://github.com/dgesteves/signoff-ui/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/signoff-ui?labelColor=0d0f12&color=22d3ee)](https://www.npmjs.com/package/signoff-ui)
[![License: MIT](https://img.shields.io/badge/license-MIT-22d3ee?labelColor=0d0f12)](./LICENSE)

**Website and docs:** [signoff-ui.vercel.app](https://signoff-ui.vercel.app), with a playground where a scripted coding agent asks for a review and an approval, driven from the keyboard, with no API key.

<!-- npm-readme:video -->

https://github.com/user-attachments/assets/7db9d783-37ed-43dc-b532-a11d27fe46fd

<sub>The <a href="https://signoff-ui.vercel.app">playground</a>, driven from the keyboard: tool calls stream into the timeline, <kbd>Y</kbd> approves the install, <kbd>A</kbd>/<kbd>R</kbd> review hunks, <kbd>Ctrl</kbd>+<kbd>↵</kbd> applies. Then the <a href="https://signoff-ui.vercel.app/gallery#ag-ui">AG-UI demo</a>, a real <code>@ag-ui/client</code> agent that resumes once you approve.</sub>

<!-- npm-readme:image
<p align="center">
  <a href="https://signoff-ui.vercel.app"><img src="docs/media/demo.webp" width="100%" alt="The playground driven from the keyboard: tool calls stream into a timeline, Y approves a package install, A and R accept and reject diff hunks, Ctrl+Enter applies them and the run meter shows the cost. Then the AG-UI demo: a LangGraph-style run that resumes once the install is approved."></a>
</p>

<sub>The <a href="https://signoff-ui.vercel.app">playground</a>, driven from the keyboard: tool calls stream into the timeline, <kbd>Y</kbd> approves the install, <kbd>A</kbd>/<kbd>R</kbd> review hunks, <kbd>Ctrl</kbd>+<kbd>↵</kbd> applies. Then the <a href="https://signoff-ui.vercel.app/gallery#ag-ui">AG-UI demo</a>, a real <code>@ag-ui/client</code> agent that resumes once you approve.</sub>
-->

## Why it exists

Coding and editing agents propose changes across several files and ask to run commands that can break things, and someone has to sign off on both. The chat kits most teams use stop short there: assistant-ui's reviewable diff takes one file's hunks, already split, and its apply returns nothing, while AI Elements has no diff at all and a confirm/deny you wire up yourself. `DiffReview` computes the hunks from each file's old and new contents, lets a person accept or reject them (or whole files) and comment on lines from the keyboard, and gives the agent back each file with only the accepted hunks applied, the hunks it rejected and every comment with its lines. `ApprovalCard` shows exactly what will run and how risky it is, takes a reason with a denial, lets a person approve once, for the session or always (by tool and argument pattern) and edit the arguments first, and tells automatic decisions apart from a person's.

## Quickstart

```bash
npm i signoff-ui ai @ai-sdk/react @ai-sdk/openai zod
```

Add the styles once: `@import 'signoff-ui/tailwind.css';` after Tailwind v4 in your CSS, or `import 'signoff-ui/styles.css';` with Tailwind v3 or none.

**The route.** The agent proposes edits through `review_changes`, a tool with no `execute`, so the page answers it. `toolApproval` makes AI SDK 7 stop and ask before `run_command`:

```ts
// app/api/chat/route.ts (excerpt)
import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from 'ai';
import { z } from 'zod';
// …
const tools = {
  // …
  // No execute: the page answers it with a DiffReview, and the result holds each file as applied.
  review_changes: tool({
    description: 'Propose edits to files. The user reviews them hunk by hunk before anything is written.',
    inputSchema: z.object({
      files: z.array(z.object({ path: z.string(), oldContent: z.string().optional(), newContent: z.string() })),
    }),
  }),
  run_command: tool({
    description: 'Run a shell command in the repository.',
    inputSchema: z.object({ command: z.string() }),
    execute: async ({ command }) => ({ exitCode: 0, stdout: `(simulated) ${command}` }),
  }),
};
// …
const result = streamText({
  model: openai('gpt-5.4-mini'),
  messages: await convertToModelMessages(messages, { tools }),
  tools,
  // Ask before running commands. The reason shows on the approval card.
  toolApproval: { run_command: { type: 'user-approval', reason: 'Runs a shell command in the repository.' } },
  // Keep going after tool calls: the AI SDK stops after the first step by default.
  stopWhen: stepCountIs(10),
});
```

**The page.** `AgentMessage` lays out the run with the approval card inline, and `renderTool` puts a `DiffReview` where the proposed edit is. Its `onSubmit` result goes back to the agent as the tool's output, through `reviewToolOutput`: a summary, each file as applied, the hunks rejected and the reviewer's comments. The run continues once every answer is in:

```tsx
// app/agent-run.tsx (excerpt)
'use client';

import { useChat } from '@ai-sdk/react';
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type LanguageModelUsage,
  type UIMessage,
} from 'ai';
import { useState } from 'react';
import {
  AgentMessage,
  AgentStatus,
  DiffReview,
  RunMeter,
  deriveAgentState,
  getToolPartName,
  reviewToolOutput,
  useRunTiming,
  type FileChange,
} from 'signoff-ui';
// …
export function AgentRun() {
  const { messages, status, sendMessage, addToolOutput, addToolApprovalResponse } = useChat<Message>({
    // Continue the run once the review is in and every approval has an answer.
    sendAutomaticallyWhen: (chat) =>
      lastAssistantMessageIsCompleteWithToolCalls(chat) || lastAssistantMessageIsCompleteWithApprovalResponses(chat),
  });
  // …
        <AgentMessage
          message={last}
          streaming={status === 'streaming'}
          // Once the run has finished, been stopped or failed, calls that never settled read "Stopped".
          active={state !== 'done' && state !== 'stopped' && state !== 'error'}
          onToolApproval={addToolApprovalResponse}
          // The proposed edit, reviewed hunk by hunk: the agent gets the files as applied, and your comments.
          renderTool={(part) =>
            getToolPartName(part) === 'review_changes' && part.state === 'input-available' ? (
              <DiffReview
                files={(part.input as { files: FileChange[] }).files}
                onSubmit={(review) =>
                  addToolOutput({
                    tool: 'review_changes',
                    toolCallId: part.toolCallId,
                    output: reviewToolOutput(review),
                  })
                }
              />
            ) : undefined
          }
        />
  // …
}
```

**Render it from a page.** New Next.js 16 apps turn on `cacheComponents`, and `useChat` creates ids with `Math.random()`, which a prerendered page may not contain, so the component that calls it goes inside `<Suspense>`:

```tsx
// app/page.tsx
import { Suspense } from 'react';
import { AgentRun } from './agent-run';

export default function Page() {
  // With cacheComponents (on in new Next.js 16 apps), useChat needs a Suspense boundary:
  // it creates ids with Math.random(), which Next.js does not allow in prerendered output.
  return (
    <Suspense>
      <AgentRun />
    </Suspense>
  );
}
```

The whole app, with a status pill and a cost meter, is [examples/nextjs-minimal](examples/nextjs-minimal): it runs against a scripted model with no API key, and CI drives it in Chrome through the review, the approval and the final answer. [Getting started](https://signoff-ui.vercel.app/docs/getting-started) walks through it, including AI SDK 6, other models and the shadcn registry (`npx shadcn@latest add https://signoff-ui.vercel.app/r/diff-review.json`).

## Works inside assistant-ui, AI Elements or your own chat

The components take AI SDK message parts and plain props, not a runtime, and `styles.css` styles only their own elements, never the rest of your page or the content you render inside them.

- **Your own chat:** render `AgentMessage` for the assistant's message, as above, or only `DiffReview` and `ToolApprovalCard` for the tool parts you want to gate.
- **AI Elements:** keep its conversation, messages and prompt input, and render `ToolApprovalCard` or `DiffReview` for those tool parts in place of `Tool` and `Confirmation`.
- **assistant-ui:** `signoffTools()` from `signoff-ui/assistant-ui` goes in `MessagePrimitive.Parts`' `components.tools`: a `DiffReview` for the calls that propose files, its review sent back as the call's result, and the approval card, with your approval rules, for calls at an approval gate. [examples/assistant-ui](examples/assistant-ui) runs it with no API key.
- **AG-UI agents** (LangGraph, CrewAI, Mastra and others): `useAgUiAgent` from `signoff-ui/ag-ui` turns the run into the same message parts, with interrupts as approval cards.
- **Agent Client Protocol:** `signoff-ui/acp` folds a prompt turn's session updates and permission requests into the same message parts, with the agent's options on the approval card and each edit's diff as `DiffReview` files.

[Inside your chat UI](https://signoff-ui.vercel.app/docs/chat-ui) has the code for each.

## Components

| Role       | Component                                               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review     | `DiffReview`, `useDiffReview`                           | Unified or split review of edits across files, computed from their contents or a patch, with word-level highlights. Accept or reject hunks or whole files and comment on lines from the keyboard; `onSubmit` returns each file with only the accepted hunks applied, the rejected hunks and the comments, and `toPatch()` a unified diff. Large files are diffed in a worker and render only what is near the screen. `useDiffReview` is the same without the markup. |
| Approve    | `ApprovalCard`, `ToolApprovalCard`, `useApprovalPolicy` | What will run, its risk when you rate it, approve or deny with a reason, a second press for `critical` actions, and "Auto-approved" or "Blocked by policy" for automatic decisions. Approve once, for the session or always, by tool and argument pattern; edit the arguments first; approve all pending; an audit trail; the same rules as AI SDK 7's `toolApproval`.                                                                                                |
| Supporting | `AgentMessage`                                          | A whole assistant message: streaming markdown, reasoning, tool calls as one timeline with approvals inline, files and sources.                                                                                                                                                                                                                                                                                                                                        |
|            | `ToolCallTimeline`                                      | Every tool call's state, measured duration and a waterfall, errors inline.                                                                                                                                                                                                                                                                                                                                                                                            |
|            | `RunMeter`, `AgentStatus`                               | Tokens, estimated cost and time to first token; the run's state in one announced pill.                                                                                                                                                                                                                                                                                                                                                                                |
|            | `Sources`, `Markdown`, `Reasoning`                      | Citations, streaming-safe markdown and collapsible reasoning.                                                                                                                                                                                                                                                                                                                                                                                                         |
|            | `useAgUiAgent`                                          | An AG-UI agent's run as AI SDK messages, status, usage and approvals.                                                                                                                                                                                                                                                                                                                                                                                                 |

Typed against AI SDK 6 and 7 (`ai@^6.0.0 || ^7.0.102`), on React 18 and 19 (`react@^18.2.0 || ^19.0.0`), with Tailwind v4, v3 or no Tailwind, each tested in CI. Keyboard-first and announced to screen readers, with axe checks in jsdom and in Chrome. Every word the components show or announce is a label you can translate, from one provider. The kit calls no model and makes no requests of its own, so any model your backend uses works.

## Docs

- [Live playground](https://signoff-ui.vercel.app): a scripted coding-agent run with a review and an approval, driven from the keyboard. No API key.
- [Docs](https://signoff-ui.vercel.app/docs): [Getting started](https://signoff-ui.vercel.app/docs/getting-started), [Inside your chat UI](https://signoff-ui.vercel.app/docs/chat-ui), [AG-UI agents](https://signoff-ui.vercel.app/docs/ag-ui), [theming](https://signoff-ui.vercel.app/docs/getting-started#theming), [accessibility](https://signoff-ui.vercel.app/docs/accessibility), [labels and translations](https://signoff-ui.vercel.app/docs/labels), [performance and limits](https://signoff-ui.vercel.app/docs/limits), and a page per component with its props, keyboard and styling hooks. Also as [`/llms.txt`](https://signoff-ui.vercel.app/llms.txt) and [`/llms-full.txt`](https://signoff-ui.vercel.app/llms-full.txt) for coding agents.
- Formerly `@dgesteves/agent-ui-kit`: [Migrating](https://signoff-ui.vercel.app/docs/migrating-from-agent-ui-kit) is a package swap and one command.
- [Changelog](packages/signoff-ui/CHANGELOG.md), [contributing](CONTRIBUTING.md) and [security](SECURITY.md).

## How it compares

signoff-ui does one part of an agent product in depth: the review and approval step. [assistant-ui](https://github.com/assistant-ui/assistant-ui) and [AI Elements](https://github.com/vercel/ai-elements) cover the whole chat, and they do several things better:

- **assistant-ui** has a chat runtime and thread, adapters for the AI SDK, LangGraph, AG-UI and more, and an Elements collection far wider than this kit. Its task card shows nested sub-agents, which this kit renders flat.
- **AI Elements** covers the most of the message surface in shadcn style (conversation, prompt input, artifacts, a `Context` usage indicator and more), maintained by Vercel. Its components are written against AI SDK 6.

Where signoff-ui goes further: review from file contents across several files, with the patched files, the rejected hunks and line comments as the result; approvals once, for the session or always, by tool and argument pattern, with the arguments editable first and the same rules for AI SDK 7's `toolApproval`; approvals that tell a person's decision from a policy's; tool durations that leave out time spent waiting for a person; and a stylesheet for Tailwind v3 or no Tailwind. Use either library for the chat, and these components for the sign-off. [The full comparison](https://signoff-ui.vercel.app/docs/comparison).

## License

[MIT](./LICENSE) © Diogo Esteves
