---
'signoff-ui': patch
---

`useAgUiAgent`: `stop()` before the server has answered no longer reads as a failed run. `@ag-ui/client` reports that abort through `onRunFailed` and then ends the run without an error, and the hook took it for a failure: `status: 'error'`, `error: { message: 'The operation was aborted.' }`, and `deriveAgentState` read `error`, so pressing Stop while the agent was still "Thinking" showed a red failure. Such a run now ends as a cancelled one does, `ready` with no `error`. A request that fails for another reason before the server answers still reports its error.
