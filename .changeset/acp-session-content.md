---
'signoff-ui': patch
---

`signoff-ui/acp` takes the `session` tool call content that ACP's unstable schema added in `@agentclientprotocol/sdk` 2.6: a reference to another session the call works on, such as a subagent it started. `AcpToolCallContent` includes `{ type: 'session', sessionId }`, so a tool call or update typed with the SDK's `/unstable` types fits `AcpToolCall` again, and its content type-checks as `fromAcpDiffs`' argument. With SDK 2.6 and later, both failed to type-check. The reference is left out of the message, as terminal content is: a call's output is still its `rawOutput`, else the text of its content. Objects from older SDK versions fit as before.
