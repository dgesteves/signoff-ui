---
'signoff-ui': minor
---

`Markdown`, and so `AgentMessage`, names the checkboxes of a task list. GFM renders `- [x] Read the route` as a disabled checkbox with no name, which axe reports as a critical `label` violation and a screen reader reads as an unnamed checkbox; agents write such lists for their plans. Each checkbox is now named "Task", from the new `labels.markdown.task`, and read with its state, checked or not. A translation typed as `SignoffLabels` needs the new key to type-check; one passed as `SignoffLabelsInput` keeps the English for it.
