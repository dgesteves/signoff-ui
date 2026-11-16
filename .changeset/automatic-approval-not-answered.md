---
'signoff-ui': patch
---

`ToolApprovalCard`, and so `AgentMessage` with an `approvalPolicy`, no longer answers a call that the AI SDK's `toolApproval` decided. The SDK streams that decision as a request marked `isAutomatic`, then its response. When a render fell between the two and a rule of the page's policy covered the call, the card answered it from the policy too. It sent a second answer through `onToolApproval`, `approved: true` even for a call the SDK had denied, and the card read "Allowed by your rule" instead of "Auto-approved". Next.js 16.4.6 compresses route handler responses, and the two chunks arrive apart more often there. The card now leaves those calls to the SDK, as `ToolApprovalBatch` already did.
