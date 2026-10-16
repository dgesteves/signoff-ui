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
