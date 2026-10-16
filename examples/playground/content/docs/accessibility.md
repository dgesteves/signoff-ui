Review and approval are where a person has to read carefully and decide quickly, so every component is built to work from the keyboard and with a screen reader. Each component's page lists its keys and what it announces; this page is what they share.

## Keyboard first

Every action is a real button. Single-key shortcuts (Y and N on an approval card; J, K, A, R, U, C, E and V in a diff review) only fire while focus is inside the component, which keeps them compliant with WCAG 2.1.4 and out of the way of text fields. They are exposed through `aria-keyshortcuts` and described in visually hidden text. The page-wide ⌘ or Ctrl + Enter approval is opt-in, because it collides with most chat composers.

## Focus is managed

Deciding on an approval card moves focus to the card instead of dropping it on `<body>`. A component that leaves the page takes focus with it: `ToolApprovalBatch` once it has answered its calls, or a card or a review your app removes after a decision. Move focus to what replaces it, such as the next card or the agent's reply. In a review, the hunks share one tab stop, a roving tabindex that J, K and the arrow keys move through, and the file list is one more; each hunk's buttons and each file's controls are in the Tab order too. Writing a comment moves focus to its text area and back to the hunk when it closes. Tool calls follow the disclosure pattern with arrow-key movement. In a run of more than 150 calls, the timeline renders those near the screen; the arrow keys, Home and End still move between all of them, scrolling one that isn't rendered into view, and each call that renders gives its place in the whole list.

## Scrolling content is reachable

Code blocks, tables, diff hunks and the compact run meter scroll sideways when they don't fit (a command preview wraps instead). While they do, they join the tab order as named groups ("Hunk 2 code, app/api/chat/route.ts"), so the arrow keys scroll them; once everything fits, they add no tab stop.

## Announcements

Tool completions and failures (calls that settle together, such as parallel calls, in one announcement), approval decisions, review progress ("Hunk 2 of 4 accepted. 2 remaining.") and agent state changes go through live regions. State announcements are debounced, and only approvals and errors are assertive.

## Not color alone

Every state has an icon and text, diff lines keep their + and − glyphs plus "Added:" and "Removed:" for screen readers, and risk levels are spelled out.

## In the reader's language

Accessible names, announcements and keyboard hints are labels like the visible text, so a [translation](/docs/labels) covers what a screen reader says too. Set `lang` on the page, or on the element that holds the components, so it is pronounced in that language. The keys themselves stay the same.

## Motion

All animation is behind `motion-safe`, and the number tweening in `RunMeter` honors `prefers-reduced-motion`.

## Contrast

A unit test parses the theme and enforces 4.5:1 for text in both themes: every text token on the surfaces it sits on, syntax colors on diff lines and word highlights (composited the way the diff paints its translucent backgrounds), and every text-on-tint class in the components, such as the accepted and rejected badges. UI and chart marks get 3:1. The chart colors were run through a color-vision-deficiency check.

The test covers the kit's own palette. If you map the tokens to your own, as [Theming](/docs/getting-started#theming) shows for shadcn/ui, check text contrast with yours.

## Document outline

Titles take a `headingLevel`; source lists are labeled lists and approval cards are named groups rather than landmarks, so a long conversation does not flood landmark navigation.

## How it's tested

Every component has axe checks in Vitest (jsdom). `pnpm a11y` also runs axe in Chrome against the playground at each stage of a run, the components page, the docs and a phone viewport, in the dark and light themes, which covers color contrast with real layout. CI runs both on every pull request, and a violation in either fails it.
