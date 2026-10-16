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
