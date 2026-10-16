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
