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
