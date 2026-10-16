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
