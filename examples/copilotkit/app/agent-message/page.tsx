'use client';

import { useAgent, useCopilotKit, useFrontendTool } from '@copilotkit/react-core/v2';
import { useState } from 'react';
import { AgentMessage, AgentStatus, deriveAgentState } from 'signoff-ui';
import { useAgUiAgent } from 'signoff-ui/ag-ui';
import { z } from 'zod';

export default function Page() {
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
  const last = messages.findLast((m) => m.role === 'assistant');
  const { state, detail } = deriveAgentState({ status, message: last });
  const [input, setInput] = useState('');

  return (
    <>
      <div className="thread">
        {messages.map((message) =>
          message.role === 'assistant' ? (
            <AgentMessage
              key={message.id}
              message={message}
              streaming={message === last && status === 'streaming'}
              onToolApproval={respond}
            />
          ) : (
            <p key={message.id} className="user">
              {message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')}
            </p>
          ),
        )}
        <AgentStatus state={state} detail={detail} />
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim()) return;
          agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: input });
          setInput('');
          void copilotkit.runAgent({ agent });
        }}
      >
        <input
          aria-label="Message the agent"
          placeholder="Ask the agent to deploy"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={status === 'submitted' || status === 'streaming'}>
          Send
        </button>
      </form>
    </>
  );
}
