## Try it without an API key

The reference app is a coding agent on a scripted model: it asks before it runs a command, and nothing it writes lands until you apply it in a review. It needs no API key and no code to copy:

```bash
npx create-next-app@latest my-agent --example https://github.com/dgesteves/signoff-ui/tree/main/examples/coding-agent
cd my-agent
npm run dev   # http://localhost:3400
```

The walkthrough on this page, [Render a run](/docs/getting-started#render-a-run), starts the same way, against a scripted model too:

```bash
npx create-next-app@latest my-quickstart --example https://github.com/dgesteves/signoff-ui/tree/main/examples/nextjs-minimal
cd my-quickstart
npm run dev   # http://localhost:3200
```

To add the components to an app of your own, read on: install them, add the styles, then render [your first sign-off](/docs/getting-started#your-first-sign-off), with no AI SDK and no key.

## Requirements

- **React** 18.2 or later, or 19 (`react@^18.2.0 || ^19.0.0`). CI runs the test suite on both.
- **AI SDK** 6 or 7 (`ai@^6.0.0 || ^7.0.102`), an optional peer. The kit imports its types only, so it adds no SDK code to your bundle, and an AG-UI or ACP app can [leave it out](/docs/getting-started#from-npm).
- **A React app.** Nothing in the kit is tied to a framework. The walkthrough below is a Next.js 16 App Router app, which CI builds and runs in Chrome. In a Vite app, [three things change](/docs/getting-started#vite-and-other-bundlers).
- **ES modules.** The package is ESM only, with no CommonJS build: load it with `import`, as bundlers and Next.js do. CI builds and tests it on Node 24.
- **Browsers.** Chrome 111, Safari 16.4 and Firefox 128 or later, the minimums of [Tailwind CSS v4](https://tailwindcss.com/docs/compatibility), which builds the kit's stylesheet, and Edge 111, which runs Chrome's engine. CI runs the current Chrome, Firefox and WebKit (Safari's engine), not the minimums.

[Works with](/docs/getting-started#works-with) has what CI tests, and what should work but isn't tested yet.

For an AG-UI agent (LangGraph, CrewAI, Mastra and the rest) instead of the AI SDK, read this page for the install and the styles, then go to [AG-UI agents](/docs/ag-ui).

## Install

The same components come two ways: as an npm package, or as source files the shadcn CLI copies into your app.

### From npm

```package-install
npm i signoff-ui ai
```

`ai` is an optional peer dependency: the components' props use its message part types, and the kit imports none of its code. An AG-UI or ACP app can install `signoff-ui` without it, since `signoff-ui/ag-ui` and `signoff-ui/acp` declare their own types. Without `ai`, TypeScript reads the AI SDK types in the components' props as `any`, and with `skipLibCheck: false` it reports them missing, so add `ai` as a dev dependency to have them checked. `@assistant-ui/react` is optional too, for `signoff-ui/assistant-ui` ([assistant-ui](/docs/chat-ui#assistant-ui)). The package ships ES modules with `'use client'` kept per file, a precompiled stylesheet, and `signoff-ui/core` for server code.

### With the shadcn CLI

```package-install
npx shadcn@latest add https://signoff-ui.vercel.app/r/agent-message.json
```

Each item brings the component, the helpers it imports, its npm dependencies and the theme tokens, which `shadcn add` writes into your CSS. Files land in `components/signoff-ui/`.

The items are `agent-message`, `tool-call-timeline`, `approval-card`, `use-approval-policy`, `diff-review`, `use-diff-review`, `run-meter`, `agent-status`, `sources`, `markdown`, `reasoning`, `ag-ui` and `assistant-ui`, each at `https://signoff-ui.vercel.app/r/<item>.json`. Installing a second item skips the shared files it already added. They also install straight from the repository (`npx shadcn@latest add dgesteves/signoff-ui/agent-message`).

To add them by name instead (`npx shadcn@latest add @signoff-ui/agent-message`), add the namespace to your `components.json` once. The namespace needs this `registries` entry: the shadcn directory doesn't list it yet.

```json title="components.json"
{
  "registries": {
    "@signoff-ui": "https://signoff-ui.vercel.app/r/{name}.json"
  }
}
```

Component and hook files start with `'use client'`, so they work when rendered from Server Components; the helpers in `lib/` (`diff.ts`, `usage.ts`, `ai.ts`, `format.ts`) do not, so the server can call them.

**From a coding agent.** The [shadcn MCP server](https://ui.shadcn.com/docs/mcp) lets Claude Code, Cursor, VS Code or Codex browse and install registry items. Set it up with `npx shadcn@latest mcp init --client claude` (or `cursor`, `vscode`), make sure `components.json` lists the registry as above, and ask for it by name, for example "add the signoff-ui diff review to the chat page". Agents can also read these docs from [`/llms.txt`](https://signoff-ui.vercel.app/llms.txt).

### Linting the copied files

The files `shadcn add` copies are code in your app, so your linters read them. They pass a new Next.js app's ESLint config (`core-web-vitals` and `typescript`) with no warnings, which CI checks on every change.

A design-system check is stricter: it holds code to your own components and tokens, and the kit's files use theirs, with native buttons, the `signoff-*` tokens and a few arbitrary values such as `text-[13px]`. Set `components/signoff-ui` apart, so the check reports your code and not files you'd update with `shadcn add` rather than rewrite. With [onsystem](https://onsystem.vercel.app), list the folder in `components` or turn its rules off in `overrides`, as [Code from shadcn registries](https://onsystem.vercel.app/docs/configuration#code-from-shadcn-registries) shows; `exclude` alone isn't enough there. The same goes for other registries' folders, such as AI Elements' `components/ai-elements`.

### Which one

| Difference           | npm                                     | shadcn                                      |
| -------------------- | --------------------------------------- | ------------------------------------------- |
| Updates              | `npm update`                            | Run `shadcn add` again and merge your edits |
| Styles               | Tailwind v4, Tailwind v3 or no Tailwind | Tailwind v4, like any current shadcn/ui app |
| Changing a component | `className`, tokens and `data-*` hooks  | Edit the source                             |
| Imports              | `signoff-ui`                            | `@/components/signoff-ui/...`               |

Start with npm if you want updates and don't plan to fork the components. Use the registry if you'd rather own the code, or your app already follows the shadcn/ui conventions.

## Add the styles

> [!NOTE]
> Once per app. Skip this if you installed with the shadcn CLI: it already wrote the tokens into your CSS.

```css title="app/globals.css" tab="Tailwind v4"
@import 'tailwindcss';
@import 'signoff-ui/tailwind.css';
```

```ts title="app/layout.tsx" tab="Tailwind v3 or no Tailwind"
import 'signoff-ui/styles.css';
```

**Tailwind v4.** Import the kit's entry after Tailwind. It adds the tokens, maps them into your theme and points `@source` at the components, so your build generates only the utilities they use.

**Tailwind v3, or no Tailwind.** Import the precompiled stylesheet after your global CSS. It has only the utilities the kit uses, and no global reset.

### What styles.css leaves alone

<!-- cards -->

- **Your app.** Every rule is scoped to the components' own elements.
- **Your reset.** It has no cascade layers, so Tailwind v3 builds accept it, and a reset such as `* { padding: 0 }` can't strip the components' spacing. If your app orders its CSS with layers, use `styles.layered.css`: the same rules in `@layer theme, base, utilities`.
- **Your theme's variables.** It sets no `--spacing`, `--text-*` or `--font-*`. Its utilities have the kit's values written in and read only the `--signoff-*` tokens.
- **Your content inside the components.** What `renderTool`, `renderData` and `renderOutput` return, a custom approval `preview` and `DiffReview`'s `actions` sit in a `data-signoff-slot` element the kit's rules don't reach. Your CSS styles it, and it inherits the component's text color and font.

### Dark mode

Light is the default. Add `class="dark"` (or `data-theme="dark"`) to `<html>` or any ancestor for the dark palette. To follow the OS setting instead, also import `signoff-ui/theme.auto.css`; `class="light"` on `<html>` still forces light.

## Your first sign-off

An approval card and a review, with no AI SDK, model or key: `useState` holds the decision, and the review logs what you applied. Render it from any page.

```tsx title="app/first-sign-off.tsx"
'use client';

import { useState } from 'react';
import { ApprovalCard, DiffReview, type ApprovalChoice } from 'signoff-ui';

export function FirstSignOff() {
  const [choice, setChoice] = useState<ApprovalChoice>();
  return (
    <>
      <ApprovalCard
        toolName="run_command"
        input={{ command: 'npm test' }}
        risk="medium"
        // The card shows the outcome you pass back. An agent gets the choice itself:
        // { decision, reason, input, args }.
        status={!choice ? 'pending' : choice.decision.startsWith('allow') ? 'approved' : 'denied'}
        decision={choice?.decision}
        reason={choice?.reason}
        onDecide={setChoice}
      />
      <DiffReview
        files={[
          { path: 'config.ts', oldContent: 'export const retries = 1;\n', newContent: 'export const retries = 3;\n' },
        ]}
        // Each file as applied, the rejected hunks and your comments: what an agent would get back.
        onSubmit={(review) => console.log(review)}
      />
    </>
  );
}
```

With an AI SDK agent, `AgentMessage` sends the decision with `addToolApprovalResponse`, and the review goes back as the tool's output with `addToolOutput`: the walkthrough below wires both.

## Render a run

A Next.js App Router app with AI SDK 7: a client component, a page and a route. The agent reads a file, proposes an edit across two files for you to review, and asks before it runs a command. [The quickstart, running](https://github.com/dgesteves/signoff-ui/tree/main/examples/nextjs-minimal) is this section as an app against a scripted model, so it needs no API key, and CI runs it in Chrome. [One command](/docs/getting-started#try-it-without-an-api-key) starts it.

```package-install
npm i signoff-ui ai @ai-sdk/react @ai-sdk/openai zod
```

The client renders the last assistant message, its status and its cost, with a minimal composer. `renderTool` puts a `DiffReview` where the agent proposes its edit, and the review's result goes back as the tool's output, shaped for the model by `reviewToolOutput`. The wrapper paints the kit's own background and text colors (`bg-signoff-bg text-signoff-fg`), so the run reads well whatever your page's colors are. In a shadcn/ui app, also [point the kit at your tokens](/docs/getting-started#theming): otherwise the wrapper paints a box in the kit's background color on your page. Without Tailwind, use the CSS [after the walkthrough](/docs/getting-started#without-tailwind) instead, which covers the layout and the composer too.

```tsx title="app/agent-run.tsx"
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
  humanizeToolName,
  reviewToolOutput,
  useRunTiming,
  type FileChange,
} from 'signoff-ui';

type Message = UIMessage<{ usage?: LanguageModelUsage }>;

// review_changes waits on a person, like an approval: the page answers it with a DiffReview.
const CLIENT_TOOLS = ['review_changes'];

export function AgentRun() {
  const { messages, status, error, sendMessage, addToolOutput, addToolApprovalResponse } = useChat<Message>({
    // Continue the run once the review is in and every approval has an answer.
    sendAutomaticallyWhen: (chat) =>
      lastAssistantMessageIsCompleteWithToolCalls(chat) || lastAssistantMessageIsCompleteWithApprovalResponses(chat),
  });
  const [input, setInput] = useState('');
  const last = messages.findLast((m) => m.role === 'assistant');
  // The reply to the message you sent last, once it starts: the meter shows this run, not the one before.
  const reply = last === messages.at(-1) ? last : undefined;
  const { state, detail } = deriveAgentState({ status, message: last, pendingClientTools: CLIENT_TOOLS });
  // A run starts with each message you send and spans its review and approval round trips.
  const timing = useRunTiming(status, messages);

  return (
    // The kit's own background and text colors, so it reads well on any page. Add `dark` for the dark theme.
    <div className="bg-signoff-bg text-signoff-fg mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <AgentStatus state={state} detail={detail && humanizeToolName(detail)} elapsedMs={timing.activeMs} />
      {/* Why the run failed, such as a missing API key: the route's onError sends the message. */}
      {error && <p role="alert">{error.message}</p>}
      {last && (
        <AgentMessage
          message={last}
          streaming={status === 'streaming'}
          // Once the run has finished, been stopped or failed, calls that never settled read "Stopped".
          active={state !== 'done' && state !== 'stopped' && state !== 'error'}
          failed={status === 'error'}
          // The time a review takes is yours, not the tool's: its call shows no duration.
          pendingClientTools={CLIENT_TOOLS}
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
      )}
      <RunMeter
        usage={reply?.metadata?.usage}
        pricing={{ input: 2.5, cachedInput: 0.25, output: 10 }}
        ttftMs={timing.ttftMs}
        durationMs={timing.activeMs}
      />
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim()) return;
          void sendMessage({ text: input });
          setInput('');
        }}
      >
        <input
          aria-label="Message the agent"
          placeholder="Ask the agent to change something"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="border-signoff-border bg-signoff-surface flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status !== 'ready' && status !== 'error'}
          className="bg-signoff-accent text-signoff-on-accent rounded-lg px-4 text-sm font-medium disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
```

Render it from a page. With `cacheComponents`, on by default in new Next.js 16 apps, `useChat` needs a `<Suspense>` boundary: it creates ids with `Math.random()`, which Next.js doesn't allow in prerendered output. So the run renders in the browser, after hydration, and the page's server HTML has only an empty placeholder for it.

```tsx title="app/page.tsx"
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

On the server, give the model its tools: `review_changes` has no `execute`, so the page answers it; `run_command` needs approval first. Send usage as message metadata:

```ts title="app/api/chat/route.ts"
import { openai } from '@ai-sdk/openai';
import { addUsage, type DiffReviewToolOutput } from 'signoff-ui/core';
import { convertToModelMessages, stepCountIs, streamText, tool, type LanguageModelUsage, type UIMessage } from 'ai';
import { z } from 'zod';

type Message = UIMessage<{ usage?: LanguageModelUsage }>;

// A pretend repository, so nothing touches your disk or shell.
const FILES: Record<string, string> = {
  'app/api/chat/route.ts': 'export async function POST(req: Request) {\n  // ...\n}\n',
};

const tools = {
  read_file: tool({
    description: 'Read a file from the repository.',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      const content = FILES[path];
      if (content === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return { path, content };
    },
  }),
  // No execute: the page answers it with a DiffReview, and the result holds each file as applied.
  review_changes: tool({
    description: 'Propose edits to files. The user reviews them hunk by hunk before anything is written.',
    inputSchema: z.object({
      files: z.array(z.object({ path: z.string(), oldContent: z.string().optional(), newContent: z.string() })),
    }),
    // What the page sends back: reviewToolOutput(review). Messages typed with InferUITools take it from here.
    outputSchema: z.custom<DiffReviewToolOutput>(),
  }),
  run_command: tool({
    description: 'Run a shell command in the repository.',
    inputSchema: z.object({ command: z.string() }),
    execute: async ({ command }) => ({ exitCode: 0, stdout: `(simulated) ${command}` }),
  }),
};

export async function POST(req: Request) {
  // The messages come from the client as they are: a caller can send an approval for a call the model never
  // proposed. Before a tool has real effects, read "What an approval is":
  // https://signoff-ui.vercel.app/docs/getting-started#what-an-approval-is
  const { messages }: { messages: Message[] } = await req.json();
  const result = streamText({
    model: openai('gpt-5.4-mini'),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    // Ask before running commands. The reason shows on the approval card.
    toolApproval: { run_command: { type: 'user-approval', reason: 'Runs a shell command in the repository.' } },
    // Keep going after tool calls: the AI SDK stops after the first step by default.
    stopWhen: stepCountIs(10),
  });

  // After the review and the approval, the run continues the same message in a new request whose
  // totalUsage starts from zero, and useChat replaces metadata.usage. Add the usage the message already has
  // (it comes back from the client, so it is fine for display but not for billing).
  const last = messages.at(-1);
  const previous = last?.role === 'assistant' ? last.metadata?.usage : undefined;

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    sendSources: true,
    messageMetadata: ({ part }) =>
      part.type === 'finish' ? { usage: addUsage(previous, part.totalUsage) } : undefined,
    // Failed tool calls show this text. The default hides every error as "An error occurred.".
    onError: (error) => (error instanceof Error ? error.message : 'An error occurred.'),
  });
}
```

What each part is for:

- **`review_changes` without `execute`.** The AI SDK ends the step at the call and leaves it to the client. `DiffReview`'s `onSubmit` gets each file with only the accepted hunks applied (`content`) and its decision, the rejected hunks with their lines, and the comments with theirs. `reviewToolOutput` turns that into one summary sentence and those lists, and `addToolOutput` sends it to the model as the tool's result.
- **`sendAutomaticallyWhen`.** Continues the run once the review is in (`lastAssistantMessageIsCompleteWithToolCalls`) and once every approval has an answer (`lastAssistantMessageIsCompleteWithApprovalResponses`).
- **`pendingClientTools`.** `useChat` is `ready` while the review waits on you; naming the tool makes `deriveAgentState` read it as waiting, not done. Given to `AgentMessage` too, it keeps the review's call from showing a duration: the time it took was yours.
- **`stopWhen`.** The AI SDK stops after one step by default, so without it the run ends at the first tool call and never reaches the review.
- **`toolApproval`.** The `reason` shows on the approval card, as `approval.requestReason`.
- **`addUsage`.** Without it, the meter would show only the last request of a run that paused for the review and the approval.
- **`reply`.** When you send a new message, the last assistant message is still the previous run's until the reply starts. The meter takes the usage of the reply only, so a new run starts from "–", not from the last run's tokens and cost.
- **`onError`.** A tool that throws becomes an `output-error` part, and its `errorText` goes through `onError`. By default that hides every message behind "An error occurred.", so the timeline would show that instead of `ENOENT`. In production, pass through the errors you're happy for users to read and keep the rest generic.

For an agent that writes long answers, pass `throttle: 50` to `useChat` (`experimental_throttle` in AI SDK 6). `AgentMessage` parses only about the last 1,000 characters of the streaming text again on each delta, but a long list or code block is parsed again until it ends, and text with a link reference or footnote definition, some code fences in list items, or a line outside fenced code that starts with `<`, is parsed whole on every delta, which takes longer the longer the text ([Known limitations](/docs/limits#known-limitations)); throttled, the messages update at most once every 50 ms.

### When a run fails

A request that fails leaves the status reading "Error", and the client says why under it: it takes `error` from `useChat` and renders `{error && <p role="alert">{error.message}</p>}` after `<AgentStatus>`. On a first run, the most likely cause is a missing API key. The route then fails before it calls the model, and the server's log has `AI_LoadAPIKeyError`: "OpenAI API key is missing. Pass it using the 'apiKey' parameter or the OPENAI_API_KEY environment variable." The route's `onError` sends that message to the client, where every failure would otherwise read "An error occurred.", and `useChat` returns it as `error`. The client renders only the last assistant message, so the text you sent isn't on screen.

For a chat that keeps every turn on screen, render each message, as [Inside your chat UI](/docs/chat-ui#your-own-chat) does.

### What an approval is

An approval is the person's answer to the agent: it keeps the agent from running what the person didn't agree to. It doesn't protect your server from whoever calls it. The route takes `messages` from the request as they come, so a caller can send an approved `run_command` the model never proposed, and the AI SDK runs it. Here the command is simulated. Before a tool has real effects:

- Run it in a sandbox, with only the access a run needs.
- Check the messages' shape with `validateUIMessages` from `ai`. It checks their shape, not where they came from.
- Keep the rules that must hold on the server, in `toolApproval`. It decides again on every approved call, so a forged approval doesn't get past them.
- Set `experimental_toolApprovalSecret` in `streamText` if you don't need edited arguments. The server then signs each call it asks about and refuses an approval for any other call, an edited one included ([Known limitations](/docs/limits#known-limitations)).

The [coding agent](https://github.com/dgesteves/signoff-ui/tree/main/examples/coding-agent#what-an-approval-is) validates its messages and keeps a rule on the server.

### Approval rules in the route

With [`useApprovalPolicy`](/docs/components/use-approval-policy#sending-a-persons-rules-with-each-request), the page sends a person's "For this session" and "Always" rules with each request, and the route decides with them. Keep them on `run_command`, the one tool this route asks about: `read_file` runs as before, and `review_changes` stays with the page. Rules over every tool would put a card on `review_changes` too. It has no `execute`, so once approved the call never gets a result: the review never shows, and recent AI SDK 7 releases end the run with `AI_MissingToolResultsError`. In the route above:

```ts
import { addUsage, parseApprovalRules, toToolApproval, type DiffReviewToolOutput } from 'signoff-ui/core';

export async function POST(req: Request) {
  const { messages, rules }: { messages: Message[]; rules?: unknown } = await req.json();
  // This person's rules, for this person's run. A call they don't cover asks, as before.
  const yours = toToolApproval(parseApprovalRules(rules), {
    otherwise: { type: 'user-approval', reason: 'Runs a shell command in the repository.' },
  });
  const result = streamText({
    // model, messages, tools and stopWhen as above
    toolApproval: (options) => (options.toolCall.toolName === 'run_command' ? yours(options) : 'not-applicable'),
  });
  // …the rest as above
}
```

Rules from the page are that person's grants: keep the ones that protect other people on the server ([The server's rules win](/docs/components/use-approval-policy#the-servers-rules-win)).

### Typed messages

The AI SDK can type `useChat`'s messages from your tools, with `InferUITools`. Each tool's output type then comes from its `outputSchema`, which is why `review_changes` above has one: without it, the client's `addToolOutput` fails to typecheck, with "Type 'DiffReviewToolOutput' is not assignable to type 'undefined'." Keep the tools in a module of their own, so the client can import their types without importing the route:

```ts title="lib/tools.ts"
import { tool, type InferUITools, type LanguageModelUsage, type UIDataTypes, type UIMessage } from 'ai';
import type { DiffReviewToolOutput } from 'signoff-ui/core';
import { z } from 'zod';

export const tools = {
  // read_file and run_command, as in the route above
  review_changes: tool({
    description: 'Propose edits to files. The user reviews them hunk by hunk before anything is written.',
    inputSchema: z.object({
      files: z.array(z.object({ path: z.string(), oldContent: z.string().optional(), newContent: z.string() })),
    }),
    // What the page sends back: reviewToolOutput(review).
    outputSchema: z.custom<DiffReviewToolOutput>(),
  }),
};

// The route's messages, and the client's useChat<Message>().
export type Message = UIMessage<{ usage?: LanguageModelUsage }, UIDataTypes, InferUITools<typeof tools>>;
```

The route imports `tools` and `Message` from it in place of its own, and the client imports the type in place of its `Message`:

```tsx
import type { Message } from '@/lib/tools';
```

### Without Tailwind

The classes on the wrapper, the form, the input and the button are Tailwind utilities. `styles.css` styles only the kit's own components, so without Tailwind these elements get the browser's defaults. Give the wrapper `className="agent-run"` and the form `className="composer"` instead, and add this CSS:

```css title="app/globals.css"
.agent-run {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 42rem;
  margin: 0 auto;
  padding: 1.5rem;
  background: var(--signoff-bg);
  color: var(--signoff-fg);
}
.composer {
  display: flex;
  gap: 0.5rem;
}
.composer input,
.composer button {
  border-radius: 0.5rem;
  font: inherit;
  font-size: 0.875rem;
}
.composer input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--signoff-border);
  background: var(--signoff-surface);
  color: inherit;
}
.composer button {
  padding: 0 1rem;
  border: 0;
  background: var(--signoff-accent);
  color: var(--signoff-on-accent);
  font-weight: 500;
}
.composer button:disabled {
  opacity: 0.5;
}
```

### Imports with shadcn

With the shadcn CLI, add the `agent-message`, `agent-status`, `diff-review` and `run-meter` items. The walkthrough's imports from `signoff-ui` then come from the files they add:

```tsx
import { AgentMessage } from '@/components/signoff-ui/agent-message';
import { AgentStatus } from '@/components/signoff-ui/agent-status';
import { DiffReview } from '@/components/signoff-ui/diff-review';
import { RunMeter } from '@/components/signoff-ui/run-meter';
import { deriveAgentState, getToolPartName } from '@/components/signoff-ui/lib/ai';
import type { FileChange } from '@/components/signoff-ui/lib/diff';
import { useRunTiming } from '@/components/signoff-ui/lib/hooks';
import { reviewToolOutput } from '@/components/signoff-ui/lib/review';
```

In the route, `addUsage` comes from `@/components/signoff-ui/lib/usage`, where npm has `signoff-ui/core`.

## Choosing a model

The kit renders what the AI SDK streams, whichever model produced it, so the model is one line in the route. Install the provider's package, put its API key in your environment, and change `model`:

```ts title="app/api/chat/route.ts"
import { anthropic } from '@ai-sdk/anthropic';

const result = streamText({
  model: anthropic('claude-sonnet-5-5'), // was openai('gpt-5.4-mini')
  messages: await convertToModelMessages(messages, { tools }),
  tools,
  toolApproval: { run_command: { type: 'user-approval', reason: 'Runs a shell command in the repository.' } },
  stopWhen: stepCountIs(10),
});
```

- **OpenAI**: `openai('gpt-5.4-mini')` from `@ai-sdk/openai`, with `OPENAI_API_KEY`
- **Anthropic**: `anthropic('claude-sonnet-5-5')` from `@ai-sdk/anthropic`, with `ANTHROPIC_API_KEY`
- **Google**: `google('gemini-3.5-flash')` from `@ai-sdk/google`, with `GOOGLE_GENERATIVE_AI_API_KEY`
- **xAI**: `xai('grok-4.7')` from `@ai-sdk/xai`, with `XAI_API_KEY`
- **Mistral**: `mistral('mistral-medium-latest')` from `@ai-sdk/mistral`, with `MISTRAL_API_KEY`
- **A local model** (Ollama, LM Studio): `ollama('qwen3')` from `@ai-sdk/openai-compatible`, with no key

A local model runs on your machine, with no key and nothing to pay per token. Point the OpenAI-compatible provider at the local server (LM Studio's is `http://localhost:1234/v1`) and pick a model you've pulled that can call tools:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const ollama = createOpenAICompatible({ name: 'ollama', baseURL: 'http://localhost:11434/v1' });
```

The model ids are from each package's own model-id types, for the AI SDK 7 versions; any id the provider accepts works. Other providers are on the [AI SDK providers page](https://ai-sdk.dev/providers/ai-sdk-providers), including Amazon Bedrock, Azure OpenAI, Groq, DeepSeek and the Vercel AI Gateway. For tool approvals, pick a model that's good at tool calling.

Agents on LangGraph, CrewAI, Mastra or another AG-UI framework pick their model in the framework, and the components render them the same way: see [AG-UI agents](/docs/ag-ui).

## API keys and costs

**Do I need an API key, and does it work with my ChatGPT or Claude subscription?** The kit itself needs no key: it's React components, and it makes no requests of its own. The agent you build calls your provider with your API key, from your server, like any AI SDK app. Chat subscriptions such as ChatGPT Plus or Claude Pro don't include API access; API usage is billed separately by each provider, or runs free on a local model.

**Does the kit cost anything?** No. It's MIT-licensed, with no service, account or usage fees. What a run costs is what your provider charges for it, which [`RunMeter`](/docs/components/run-meter) estimates from the rates you give it.

**Does the playground use a key?** The public playground runs a scripted agent, with no model and no key. Its optional live mode runs the same tools against OpenAI, with the `OPENAI_API_KEY` (and `OPENAI_MODEL`) of whoever runs the playground; it's off on the public demo.

## Works with

What CI tests on every pull request, and what should work, through the same message parts or as plain React, but isn't tested yet. An entry moves to the tested column once a CI job runs it.

| Stack           | Tested in CI                              | Should work, not tested in CI                                     |
| --------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| AI SDK          | 6, 7                                      |                                                                   |
| React           | 18, 19                                    |                                                                   |
| Node            | 24                                        | 20 from 20.19, 22 from 22.12                                      |
| Framework       | Next.js 16 App Router, Vite               | Next.js 14 and 15, the Pages Router, React Router, other bundlers |
| Chat UI         | Your own, assistant-ui                    | AI Elements                                                       |
| Agent           | AI SDK, AG-UI, ACP                        | Mastra through `@mastra/ai-sdk`, Cloudflare Agents, Vercel Eve    |
| AG-UI framework | CopilotKit                                | LangGraph, CrewAI, Mastra                                         |
| Styles          | Tailwind v4, Tailwind v3, no Tailwind     |                                                                   |
| Browser         | Chrome, Firefox, WebKit (Safari's engine) | Safari, Edge, older versions                                      |

The tested entries come from these jobs in [`ci.yml`](https://github.com/dgesteves/signoff-ui/blob/main/.github/workflows/ci.yml), which run on Node 24, under the names a pull request's checks show:

- **Lint, typecheck, test, build**: the library's typecheck and test suite, the AG-UI and ACP adapters included; `styles.css` in Chrome next to a global reset, in a Tailwind v3 build and in a Tailwind v4 app; and the playground, a Next.js 16 app on Tailwind v4, AI SDK 7 and React 19, in Chrome, with axe.
- **AI SDK 6** and **React 18**: the library's typecheck and test suite again, on AI SDK 6.0.0 and the latest 6, and on the latest React 18.
- **Next.js quickstart**: [examples/nextjs-minimal](https://github.com/dgesteves/signoff-ui/tree/main/examples/nextjs-minimal), [Render a run](/docs/getting-started#render-a-run) as an app on AI SDK 7, built and run in Chrome through a review, an approval and the final answer.
- **Coding agent reference app**: [examples/coding-agent](https://github.com/dgesteves/signoff-ui/tree/main/examples/coding-agent), with no Tailwind, built with webpack from the packed package and run in Chrome on a desktop and a phone-sized screen.
- **assistant-ui binding**: [examples/assistant-ui](https://github.com/dgesteves/signoff-ui/tree/main/examples/assistant-ui), a Vite app, built from the packed package with `vite build` and run in Chrome through a review and an approval, then started with `vite dev` and run through the review to the approval card.
- **CopilotKit example**: [examples/copilotkit](https://github.com/dgesteves/signoff-ui/tree/main/examples/copilotkit), a Next.js 16 app on CopilotKit 1.83.0 with a scripted AG-UI agent, built with `next build` and run in Chrome: the approval card, an approval rule and a review inside `CopilotChat`, an AG-UI interrupt through `useInterrupt`, and `useAgUiAgent` resuming a run through CopilotKit.
- **Firefox** and **WebKit (Safari's engine)**: the playground and the quickstart in each, and axe in WebKit too. WebKit runs on macOS, where it behaves as Safari does.

**Examples installed fresh from npm** runs daily and on each release's pull request, not on every pull request: the `nextjs-minimal`, `coding-agent` and `assistant-ui` examples, each copied out, installed from npm with no lockfile, and run with `dev` in Chrome.

How the untested agents connect:

- **Mastra through `@mastra/ai-sdk`**: its `chatRoute()` serves an agent as AI SDK UI messages, tool approvals included, so `useChat` and `AgentMessage` render it as in [Render a run](/docs/getting-started#render-a-run).
- **Cloudflare Agents**: `useAgentChat` from `@cloudflare/ai-chat/react` returns what `useChat` does, `messages` and `addToolApprovalResponse` included, and the agent's tools ask with the AI SDK's `needsApproval`. Pass them to `AgentMessage` as the walkthrough does.
- **Vercel Eve**: `useEveAgent` from `eve/react`, with `reducer: defaultMessageReducer()`, gives messages whose parts follow the AI SDK's, in Eve's own types. It answers approvals with `respond()`, not `addToolApprovalResponse`, so `onToolApproval` needs a function of yours that calls `respond()`.
- **AG-UI frameworks**: [AG-UI agents](/docs/ag-ui) has LangGraph and the others. [CopilotKit](/docs/copilotkit), which CI tests, has a page of its own.
- **AI Elements**: [Inside your chat UI](/docs/chat-ui#ai-elements) has where the components go in its message parts.

## AI SDK 6 or 7

The components take the same message parts from both. The differences are on the server:

- Install `ai@^6 @ai-sdk/react@^3 @ai-sdk/openai@^3` for AI SDK 6, and the AI SDK 6 versions of any other providers (`@ai-sdk/anthropic@^3`, `@ai-sdk/google@^3`, `@ai-sdk/xai@^3`, `@ai-sdk/openai-compatible@^2` and so on).
- `toolApproval` is an AI SDK 7 option. On 6, drop it and mark the tool with `needsApproval: true`:

```ts
run_command: tool({
  description: 'Run a shell command in the repository.',
  inputSchema: z.object({ command: z.string() }),
  needsApproval: true,
  execute: async ({ command }) => ({ exitCode: 0, stdout: `(simulated) ${command}` }),
}),
```

The approval card then shows no reason: the reason is `toolApproval`'s, which the card reads as `approval.requestReason`, and AI SDK 6 has neither. The rest of the walkthrough is the same. CI typechecks the library and runs its tests against the latest AI SDK 6 and the oldest supported 6.0.0, as well as 7.

## Next.js

**Server Components.** Components and hooks are client modules with their own `'use client'` directive, so a Server Component can render any of them. The pure helpers aren't, so Server Components and Route Handlers can call them. Import those from `signoff-ui/core`, which has no React:

```ts title="app/api/review/route.ts"
import { applyHunks, parseFileChange } from 'signoff-ui/core';
```

**`cacheComponents`.** Nothing in the kit reads the clock or a random number while rendering on the server, so pages that render it prerender with `cacheComponents` on. Live durations render after hydration, so server and client markup match. `useChat` is the exception, as above: wrap the component that calls it in `<Suspense>`.

**Versions.** CI builds and runs the walkthrough on Next.js 16. Next.js 14 and 15 run React 18.2 and 19, which the kit supports, and the Pages Router works too, since the components are ordinary React; those aren't built in CI.

## Vite and other bundlers

The components are React and ES modules with nothing from Next.js, so they render in a Vite app as they do in Next.js, and Vite ignores their `'use client'` lines. [examples/assistant-ui](https://github.com/dgesteves/signoff-ui/tree/main/examples/assistant-ui) is a Vite app, which CI builds from the packed package and runs with `vite build` and `vite dev`. Three things differ from the walkthrough.

**The styles** go in your entry file, or in your CSS after Tailwind when you run Tailwind v4 through `@tailwindcss/vite`:

```css title="src/index.css" tab="Tailwind v4"
@import 'tailwindcss';
@import 'signoff-ui/tailwind.css';
```

```ts title="src/main.tsx" tab="Tailwind v3 or no Tailwind"
import 'signoff-ui/styles.css';
```

**The route** runs on your server, since a Vite app has no API routes of its own. Point `useChat` at it with a transport:

```tsx
import { DefaultChatTransport } from 'ai';

// In AgentRun, the walkthrough's useChat with a transport added.
const { messages, status, error, sendMessage, addToolOutput, addToolApprovalResponse } = useChat<Message>({
  // Your server's chat route. Without a transport, useChat posts to /api/chat on the page's own origin.
  transport: new DefaultChatTransport({ api: 'https://api.example.com/chat' }),
  sendAutomaticallyWhen: (chat) =>
    lastAssistantMessageIsCompleteWithToolCalls(chat) || lastAssistantMessageIsCompleteWithApprovalResponses(chat),
});
```

A server on another origin than the page has to allow it with CORS. In development, Vite's `server.proxy` can forward `/api` to your server instead, when its route is at `/api/chat`, and `useChat` then needs no transport.

**The page** needs no `<Suspense>`: the walkthrough wraps `AgentRun` in one for Next.js' prerendering (`cacheComponents`), and a Vite app renders on the client. Render `<AgentRun />` from your entry as it is.

Other bundlers that read ES modules and the package's `exports` work the same way. `DiffReview` starts its diff worker for large files without configuration in Vite and webpack 5 ([Large diffs](/docs/limits#large-diffs)).

## React 18 or 19

Both work with the same code. CI installs React 18 and runs the library's test suite, typecheck included, on it. On React 18 there's nothing to change.

## Theming

Every color, radius and font is a CSS variable. Override them on `:root`, on `.dark`, or on any subtree; `.light` and `.dark` switch a subtree's palette too:

```css title="app/globals.css"
:root {
  --signoff-accent: #7c3aed; /* fills: buttons, running state, focus */
  --signoff-accent-fg: #6d28d9; /* accent text */
  --signoff-hot: #c2410c; /* attention: approvals, errors, deletions */
  --signoff-radius: 6px;
  --signoff-font-sans: var(--font-inter);
}
```

| Tokens                                                                                  | Purpose                          |
| --------------------------------------------------------------------------------------- | -------------------------------- |
| `--signoff-bg`, `--signoff-surface`, `--signoff-surface-2`, `--signoff-border(-strong)` | Surfaces and lines               |
| `--signoff-fg`, `--signoff-fg-muted`, `--signoff-fg-subtle`                             | Text, all AA on every surface    |
| `--signoff-accent`, `--signoff-accent-fg`, `--signoff-on-accent`, `--signoff-ring`      | Activity, primary actions, focus |
| `--signoff-hot`, `--signoff-hot-fg`, `--signoff-on-hot`, `--signoff-warn(-fg)`          | Attention, risk, errors          |
| `--signoff-add-bg`, `--signoff-add-strong`, `--signoff-del-bg`, `--signoff-del-strong`  | Diff lines and word highlights   |
| `--signoff-chart-input`, `--signoff-chart-output`                                       | The token bar                    |
| `--signoff-code-*`                                                                      | Syntax tinting                   |
| `--signoff-radius`, `--signoff-font-sans`, `--signoff-font-mono`                        | Shape and type                   |

The fonts are your app's `--font-sans` and `--font-mono` when it defines them, as shadcn/ui and Tailwind v4 apps do, then Geist when `geist` is loaded, then the system's.

Messages, timelines and sources have no background of their own: they sit on your page and take their text color from the kit's palette. If the page's background doesn't match the kit's theme (a dark page with the light palette, say), give their container `bg-signoff-bg text-signoff-fg`, as the walkthrough does. Cards, the status pill and the meter paint their own surfaces.

**In a shadcn/ui app**, point the kit at your tokens so it looks native. Add this after the kit's tokens; one block covers both themes, since your tokens switch with `.dark`:

```css title="app/globals.css"
:root,
.dark {
  --signoff-bg: var(--background);
  --signoff-surface: var(--card);
  --signoff-surface-2: var(--muted);
  --signoff-border: var(--border);
  --signoff-border-strong: var(--input);
  --signoff-fg: var(--foreground);
  --signoff-fg-muted: var(--muted-foreground);
  --signoff-fg-subtle: var(--muted-foreground);
  --signoff-accent: var(--primary);
  --signoff-accent-fg: var(--primary);
  --signoff-on-accent: var(--primary-foreground);
  --signoff-ring: var(--ring);
  --signoff-hot: var(--destructive);
  --signoff-hot-fg: var(--destructive);
  --signoff-radius: var(--radius);
}
```

Diff and chart colors keep the kit's cyan and magenta, which your palette may not tell apart as well. The kit's contrast test covers its own palette, so check text contrast with yours.

**Styling hooks.** Components accept `className`, merged with `tailwind-merge`, and expose `data-signoff` on their root, `data-slot` (such as `data-slot="signoff-approval-card"`) and state attributes (`data-phase`, `data-state`, `data-decision`, `data-risk`) to target from your CSS:

```css
[data-slot='signoff-approval-card'][data-risk='critical'] {
  outline: 2px solid var(--signoff-hot);
}
```

## Next steps

- [AG-UI agents](/docs/ag-ui): render LangGraph, CrewAI or Mastra agents with the same components.
- [Components](/components): each component in isolation, with its install command and usage.
- [The playground](/): a full run with approvals and diff review, driven from the keyboard.
