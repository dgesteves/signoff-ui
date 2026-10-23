---
'signoff-ui': minor
---

Approvals and reviews work better with a screen reader, in forced colours, in a right-to-left page and on a touch screen.

- `ToolApprovalBatch`: once Approve all or Deny all has answered and the parts say so, the bar leaves the page as before, but its announcement ("2 approvals approved.") is still spoken, and focus moves from its button to the first card it answered instead of falling to `<body>`. `ToolApprovalCard`'s card carries `data-approval-id` for that.
- A focused `ApprovalCard` is described by its reason, then the risk, what will run and the calls a lasting decision would remember ("High risk. Runs pnpm add zod in ~/app. A lasting decision covers run_command with command pnpm add\*."), then its keys. A decision for the session or always is announced with the rule it saved, and a critical press that is let go, by Escape, focus leaving or a newer card taking ⌘/Ctrl+Enter, says "Confirmation cancelled.". The card's focus ring shows again when focus lands on it after a decision.
- Applying a `DiffReview` is announced: "Review sent: 3 of 4 accepted, 1 comment.".
- In a right-to-left page, commands and their directory, JSON, rule patterns, diff lines, hunk ranges and file paths stay left to right (`dir="ltr"`), so bidi no longer shows `~/app` as `app/~` or `pnpm add*` as `*pnpm add`. Comments and argument fields take the direction of their text.
- In forced colours, Approve, Approve all, Apply and the comment's save button keep a border, a pressed Accept or Reject gets a thicker one, and the layout picked is underlined.
- On a touch screen (`pointer: coarse`), text fields are 16px or more, so iOS no longer zooms into them, and key caps and key hints are hidden.
- In a narrow review, a hunk's buttons wrap to a line of their own rather than cut its range short (`@@ -11,6 …`), and the unchanged-lines buttons say "1 unchanged line".

The labels gain `approvalCard.summary`, `approvalCard.resolvedFor`, `approvalCard.confirmCancelled` and `diffReview.submitted`: a translation typed as `SignoffLabels` needs those four to type-check, and one passed as `SignoffLabelsInput` keeps the English for them. `ApprovalCard` grows by 0.5 kB gzipped (to 22.3 kB), `AgentMessage` by 0.8 kB (to 91.5 kB) and `DiffReview` by 0.2 kB (to 44.3 kB).
