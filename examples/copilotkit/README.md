# CopilotKit

signoff-ui's components inside [CopilotKit](https://docs.copilotkit.ai): its human-in-the-loop and interrupt hooks render the approval card and `DiffReview`, against a scripted AG-UI agent, so it needs no API key. [/docs/copilotkit](https://signoff-ui.vercel.app/docs/copilotkit) walks through the same code.

Start an app of your own from it:

```bash
npx create-next-app@latest my-copilotkit-app --example https://github.com/dgesteves/signoff-ui/tree/main/examples/copilotkit
cd my-copilotkit-app
npm run dev   # http://localhost:3500
```

Or run it from a clone of this repository, against the library's source:

```bash
git clone https://github.com/dgesteves/signoff-ui.git
cd signoff-ui
pnpm install
pnpm build:lib
pnpm --filter copilotkit-example dev   # http://localhost:3500
```

On the first page, ask CopilotChat to "run the tests" (approve with Always, then ask again: the rule answers), to "add rate limiting" (review the edit), or to "deploy" (an AG-UI interrupt). The second page renders the same agent with `AgentMessage` instead of CopilotChat; ask it to "deploy".

| File                                                                                         | What it is                                                                                      |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`app/run-command-approval.tsx`](app/run-command-approval.tsx)                               | `useHumanInTheLoop` with `ToolApprovalCard` and approval rules (`useApprovalPolicy`)            |
| [`app/review-changes.tsx`](app/review-changes.tsx)                                           | `useHumanInTheLoop` with `DiffReview`: the review goes back as the call's result                |
| [`app/deploy-approval.tsx`](app/deploy-approval.tsx)                                         | `useInterrupt` with `ApprovalCard`, for an AG-UI interrupt on a call the agent runs itself      |
| [`app/page.tsx`](app/page.tsx)                                                               | CopilotChat, with the three above                                                               |
| [`app/agent-message/page.tsx`](app/agent-message/page.tsx)                                   | `useAgUiAgent` on CopilotKit's agent, rendered with `AgentMessage`, resuming through CopilotKit |
| [`app/providers.tsx`](app/providers.tsx)                                                     | `CopilotKitProvider`, in the `<Suspense>` boundary `next build` needs under `cacheComponents`   |
| [`app/api/copilotkit/[[...slug]]/route.ts`](app/api/copilotkit/%5B%5B...slug%5D%5D/route.ts) | CopilotKit's runtime with one AG-UI agent and no model adapter                                  |
| [`lib/scripted-agent.ts`](lib/scripted-agent.ts)                                             | The scripted agent: an `AbstractAgent` from `@ag-ui/client`                                     |

For your own agent, set `AGENT_URL` to its AG-UI endpoint (`AGENT_URL=http://localhost:8000/agent npm run dev`): the route then runs an `HttpAgent` pointed at it in place of the scripted one. CopilotKit sends the page's tools (`run_command`, `review_changes`, and `notify` on the second page) with each run, in `RunAgentInput.tools`, for your agent to offer its model. The deploy card needs an agent that ends a run with an interrupt naming the call it guards (`toolCallId`).

It is tested with `@copilotkit/react-core` and `@copilotkit/runtime` 1.79.0 and `@ag-ui/client` 1.0.2, the versions `package.json` pins, on Next.js 16.4. In this repository the example builds against the local library (see `overrides` in `pnpm-workspace.yaml`); CI builds it and runs [`scripts/smoke-copilotkit.mjs`](../../scripts/smoke-copilotkit.mjs), which drives every case above in Chrome.
