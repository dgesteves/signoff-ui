---
'signoff-ui': patch
---

`useAgUiAgent` takes a `runAgent` option for the run that resumes an interrupt. By default the hook resumes with `agent.runAgent({ resume })`, which sends no tools, context or forwarded props, so a run started with them lost them once someone answered an approval. Pass `runAgent: (parameters) => agent.runAgent({ ...parameters, tools, context })`, or in CopilotKit `runAgent: (parameters) => copilotkit.runAgent({ agent, ...parameters })`, which sends the frontend tools you registered.
