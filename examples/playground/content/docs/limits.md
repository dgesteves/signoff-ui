What the components cost, where they slow down, and what they don't do yet. The numbers are measured from this repository; the commands that measure them are named next to each.

## Bundle size

What each import adds to an app's JavaScript, minified and gzipped. React and React DOM are left out, since the app has them; the kit's own dependencies are counted (react-markdown and remark-gfm, jsdiff, two Radix primitives, clsx and tailwind-merge). Rows share most of those, so two components together cost less than the sum of their rows.

| Import                                                             |  Gzipped |
| ------------------------------------------------------------------ | -------: |
| `addUsage`, `estimateCost` from `/core` (for a route handler)      |   0.4 kB |
| ACP converters from `/acp`                                         |   1.6 kB |
| `toToolApproval` from `/core` (approval rules in a route handler)  |   2.5 kB |
| `useApprovalPolicy` (the rules without markup)                     |   4.1 kB |
| `useAgUiAgent` from `/ag-ui`                                       |   3.5 kB |
| `applyHunks`, `parseFileChange` from `/core` (with jsdiff)         |   6.7 kB |
| `Sources`                                                          |  10.4 kB |
| `AgentStatus`                                                      |  11.4 kB |
| `RunMeter`                                                         |  12.5 kB |
| `useDiffReview` (the review without markup)                        |  16.3 kB |
| `ApprovalCard`                                                     |  21.6 kB |
| `ToolCallTimeline`                                                 |  22.6 kB |
| `AgentMessage` from `/custom-markdown` (with your own renderer)    |  35.8 kB |
| `DiffReview`                                                       |  43.5 kB |
| `signoffTools` from `/assistant-ui` (with DiffReview, approvals)   |  54.6 kB |
| `AgentMessage` (markdown, reasoning, timeline, approvals, sources) |  90.1 kB |
| Everything in the main entry                                       | 127.1 kB |

Measured with `pnpm size`, which bundles each import from the built package with Rolldown and gzips it. CI runs it on every pull request, with a budget per row about 5% over its size. Most of `AgentMessage` is the markdown parser: `Markdown` alone is 65.2 kB. An app with its own renderer can [import `AgentMessage` without it](/docs/components/agent-message#your-own-markdown-renderer), and CI checks that react-markdown stays out of that bundle. Each component carries the English labels of the sections it reads, not the others.

`DiffReview`'s diff worker is a separate file the bundler emits, loaded only when a file is too large to diff while rendering: 18 kB minified, with jsdiff, in a Vite build.

`styles.css` adds 9.9 kB gzipped, 269 kB uncompressed. Most of that is the selector each rule carries so that it styles the components' own elements and never your content inside them. With Tailwind v4, `tailwind.css` adds the tokens, and your build generates only the utilities the components use.

## Large diffs

`DiffReview` on large files, in Chrome with React's production build, on an Apple M1 Max. Ready is when every file is compared and on screen; the longest task is the longest the page could not respond; the keypress is one decision from the keyboard.

| Case                             | First render |  Ready | Longest task | DOM elements | Keypress |
| -------------------------------- | -----------: | -----: | -----------: | -----------: | -------: |
| Local edits, 1,000 lines         |        56 ms |  56 ms |        69 ms |        4,442 |   3.4 ms |
| Local edits, 5,000 lines         |        77 ms |  78 ms |        93 ms |        5,305 |   6.4 ms |
| Full rewrite, 2,000 lines        |        16 ms | 241 ms |         none |        3,833 |   0.9 ms |
| Full rewrite, 5,000 lines        |        17 ms | 265 ms |        53 ms |        4,073 |   0.9 ms |
| Full rewrite, 5,000 lines, split |        17 ms | 283 ms |        68 ms |        7,322 |   1.2 ms |

Measured with `pnpm perf`, which CI runs on every pull request with a budget per case, several times these numbers so shared runners pass. Before these changes a 5,000-line rewrite blocked the page for 3.3 s, left 260,000 elements and took 77 ms per keypress. Four things keep it fast:

- **A limit on the diff.** Diffing costs about the square of the lines added plus removed. Past `maxEditLength` (2,000 by default, about 0.2 s), the changed region, from its first changed line to its last, becomes one hunk that replaces it, and the review says so. Lines only added or only removed never count against it, nor do unchanged lines before and after the region.
- **A worker.** A file that needs more than 300 edits is diffed in a worker, and shows "Comparing changes…" until it is done; smaller ones are diffed while rendering, on the server too. Webpack 5, Next.js (webpack or Turbopack) and Vite emit the worker without configuration. Where none is available, or `diffWorker={false}`, the file is diffed on the main thread after the first paint: the 5,000-line rewrite then blocks for about 0.17 s.
- **Only what is near the screen.** A review with more than 400 rows renders, of each hunk, the rows within about 800 px of what is visible, also inside a scrolling chat panel. The others keep their height, and their lines as visually hidden text, so a screen reader and find-in-page still have every line. Unchanged lines shown between hunks, with E or the gap's buttons, render the same way past their first 100, in a review of any size. Every hunk renders, so focus, J and K, and their names are the same: past the first 100, they render 100 at a time, a task each, and the one J or K moves to renders at once.
- **Plain text for long lines.** A line over 2,000 characters, such as a minified bundle's, is shown without syntax colors: one piece of text rather than an element per token. Its word-level highlights stay.

Three cases `pnpm perf` does not measure yet, before and after these changes, in Chrome 155 (headless, the GPU off) with React's production build, on an Apple M1 Max with other jobs running (load average 2 to 4). Each figure is the median of three runs.

| Case                                                                      |       Before |         Now |
| ------------------------------------------------------------------------- | -----------: | ----------: |
| A changed line of 1.3 MB, as in a minified bundle: first render           |        3.8 s |      117 ms |
| The same: DOM elements                                                    |      827,688 |         104 |
| "Show all" twice in a 20,000-line file with one change: to the next frame | 1.3 to 1.5 s | 65 to 77 ms |
| The same: DOM elements                                                    |      480,089 |       4,656 |
| 1,000 hunks, every tenth line of 10,000 changed: longest task             |       264 ms |       51 ms |
| The same: every hunk on the page                                          |       503 ms |      586 ms |
| The same: longest task, the CPU four times slower                         |        1.1 s |      212 ms |

## Long runs

`ToolCallTimeline` on a run of 2,000 calls, each with its timing so the waterfall shows, in Chrome with React's production build, on an Apple M1 Max. Appending a call is the main thread's time for the update and for the frame that shows it, without the wait for that frame to start; the frame is the 95th percentile while a call runs and its clock ticks.

| Case             | First render | Append a call | Frame, a call running | DOM elements | Calls rendered |
| ---------------- | -----------: | ------------: | --------------------: | -----------: | -------------: |
| 2,000 tool calls |        41 ms |        2.2 ms |                 18 ms |        1,538 |             81 |

Measured with `pnpm perf`, with a budget per case; the append's is 16 ms, under a frame, and it measures 12 ms with the CPU six times slower. Before these changes the same run took 440 ms to render, 105 ms per appended call and 50 ms frames while a call ran, and left 36,000 elements. Three things keep it fast:

- **Only what is near the screen.** A timeline with more than 150 calls renders, in chunks of 25, the calls within about 800 px of what is visible. A chunk away from it keeps its height as one empty item. A chunk holding an open call, a call still going or focus stays rendered. The calls that render say where they are in the whole list (`aria-posinset`, `aria-setsize`), and the arrow keys, Home and End move between all the calls, bringing one that isn't rendered into view.
- **Only the calls that change render again.** A new call, or a running call's clock, renders that call, not the others. The waterfall's bars are placed from each call's times and the timeline's span, which is set on the bars that are rendered.
- **No animation left running.** A call slides in when it arrives, and the animation ends there.

## Known limitations

<!-- cards -->

- **Large rewrites.** A file changed in more places than `maxEditLength` is reviewed as one hunk that replaces the changed region, without word-level highlights; raise the limit to compare it line by line, at the square of the cost. Long changed lines skip word-level highlights rather than stall, and a line over 2,000 characters has no syntax colors.
- **Lines are commented on, not decided.** A review accepts or rejects whole hunks, or whole files. Lines can be selected to comment on, and the agent gets the comment with its lines, but a hunk cannot be applied in part.
- **Patches without binaries.** `toPatch()` lists an accepted binary file as changed, without its contents, so `git apply` cannot apply that part; the file's own `content` in the result has it, when you passed contents.
- **Edited arguments and signed approvals.** With AI SDK 7's `experimental_toolApprovalSecret`, the server signs the arguments it asked about and refuses any other, so arguments edited before approving fail there by design. ACP's `request_permission` has no way to answer with edited arguments, nor a session option: `allow-session` answers `allow_once` and keeps the session rule on the client.
- **Rules from the client.** Rules made in the browser are a person's grants on top of your server policy. `toToolApproval` can apply them on the server, for that person's runs only; rules that protect other people belong on the server. `parseApprovalRules` checks the rules a request brings, and by default leaves out a pattern with more than three `*` or 500 characters. Each rule gets 20,000 matching steps and 30 more for each character it reads, several times what a common pattern takes, so a pattern that takes more stops early. That bounds each rule, not a call: 100 rules of 500 characters, built to take the most steps for each character, take about 5 seconds on one plain string of 400,000 characters. A deny rule reads a string up to twice and an array up to four times, an item counting as one character at least, so as deny rules they take about 10 seconds on 400,000 characters with a `;` in every 1,000, 20 seconds on an array of two such strings, and 0.1 seconds on 40,000 empty strings (Node 24, Apple M1 Max). On a route that takes rules from the client, cap the length of the arguments in the tool's input schema, its strings and its arrays. A rule that stops before it can tell counts against the call: an allow rule allows nothing, and a deny rule denies, with a reason saying the arguments are too long to check against it. A deny rule it leaves out takes with it the allow rules on the tools it could cover, so the server asks about those calls and the page answers them.
- **Patterns are a convenience, not a sandbox.** An allow pattern matches the whole value from its first character. A deny pattern also reads each command of a chained line, past a path, a variable or a redirect in front of it, so `git push*` denies `git status && git push`, `/usr/bin/git push`, `GIT_TRACE=1 git push` and `2>/dev/null git push`. It reads the common ways to chain or prefix a command, not every way a shell can write one: it still misses `git -C . push` and `git --git-dir=.git push`. To keep a shell tool from running what it shouldn't, keep an allowlist on the server that denies the rest (`toToolApproval(allowed, { otherwise: 'denied' })` for that tool), check each command with a real shell parser, or run its commands in a sandbox.
- **Markdown cost while streaming.** The text is cut into blocks at blank lines, and only the last ones, about its last 1,000 characters, are parsed again on every delta: 1 to 3 ms a delta whether the text is 5k, 20k or 50k characters long, in Chrome on an Apple M1 Max. A block starts only at a line at the margin after a blank line, and not at one that may be a list item, so a long list or a long code block is one block, parsed again on every delta until it ends. The text is parsed whole on every delta, as before, when it has a link reference or footnote definition (`[id]: url`, `[^1]: note`), which any block can use, also in a list or a quote; a code fence opened on the line of a list item or a quote; an indented code fence, as under a list item, that closes at another indent or has a line less indented than it; or a line outside fenced code that starts with `<`. That costs 6 ms a delta at 5k characters, 20 ms at 20k and 46 ms at 50k, so very long answers like that can drop frames. To parse less often, throttle the updates: `useChat({ throttle: 50 })` (`experimental_throttle` in AI SDK 6) updates the messages at most once every 50 ms, not on every delta.
- **Citation numbering.** `[n]` markers are numbered over the message's sources after de-duplication by URL (by source id for documents). If your prompt numbers a list of sources that contains duplicates, markers after the first duplicate point one source early. Number unique sources in the prompt.
- **Run state comes from you.** Parts carry no signal that a run has ended, so tool calls left behind by `stop()` or an interrupted history read "Stopped" only when you pass `active={false}`. `deriveAgentState` reports such a run as `stopped`, which the quickstart's `active` condition covers. An approved call whose result never came, because the run ended in an error, reads "Stopped" only with `failed` as well: the quickstart passes `failed={status === 'error'}`, and a run restored from history that ended in an error needs it too.
- **Long timelines in find-in-page.** Past 150 calls, the calls far from the screen are not on the page: find-in-page and a screen reader's reading cursor reach only those near it, and `renderExtra`'s content for the others unmounts until they come back. The arrow keys, Home and End reach every call.
- **Words for the agent stay English.** Every word a person sees or hears is a [label](/docs/labels), but what goes to the model (`reviewToolOutput`'s summary, `toToolApproval`'s reasons unless you pass its `reason`) is English. Right-to-left layouts have not been tested.
- **Text that reads as something else.** A command, its `cwd`, a file path and a diff line show the characters that do not show (bidi controls such as U+202E, zero-width spaces, Unicode tags, control characters such as an ANSI escape) as a mark with their code points. A command or a path also shows a run of spaces 16 columns wide or more as its count, so spaces cannot push the end of a command out of view, and shows spaces other than U+0020 by their code points. A Markdown link whose text names another host than the one it goes to, or names it in look-alike letters, shows that host beside it. `Sources`, file attachments and Markdown link only to http, https, mailto and relative URLs, and an attached file to `data:` and `blob:` too: anything else is text, not a link. Not covered yet: arguments shown as JSON (a tool without a `command`) and tool output, which show those characters as they are; the argument fields while editing; look-alike letters in a command; and your own `preview` or Markdown renderer, which can call `revealText` and `safeUrl` from `signoff-ui/core`.
- **Nesting in slots.** With `styles.css`, a component rendered in a slot of a component that is itself in a slot is styled up to two levels deep; deeper than that it renders unstyled.

## What's next

The next work, with its issue where it has one:

- Adapters: an AI Elements recipe, `DiffReview` and approvals inside an AI Elements chat ([#40](https://github.com/dgesteves/signoff-ui/issues/40), a good first issue).
- ACP: accepting some hunks of an edit and rejecting others, with the client writing the reviewed file (`fs/write_text_file`).
- Styles: CSS `@scope` for `styles.css`, in place of the selector each rule carries ([#46](https://github.com/dgesteves/signoff-ui/issues/46)).
