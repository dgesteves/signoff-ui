---
'signoff-ui': patch
---

`toAcpMessage`: a turn cancelled while the agent was writing reads as stopped, not done. Once `endAcpTurn` set `ready`, the last text or reasoning part was always `done`, whatever the `stopReason`, so after Stop (`session/cancel`, then `stopReason: 'cancelled'`) `deriveAgentState` read `done` unless a tool call happened to be left running. That text now stays `streaming`, cut off, as a cancelled AG-UI run's does, and the run reads `stopped`. A turn that ended on its own (`end_turn`, `max_tokens`, `refusal`) is still done.
