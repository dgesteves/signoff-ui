// What each component adds to an app's JavaScript: the built package bundled per import with
// Rolldown, React and React DOM external (the app has them anyway), minified, then gzipped.
// Dependencies count (react-markdown, jsdiff, Radix, tailwind-merge...), and shared ones are
// counted again in every row; CSS is not included.
//
// Each row has a budget, in gzipped kB, about 5% over its size: CI fails when an import outgrows
// it. Raise a budget here, in the same pull request, when the growth is worth it. The docs show the
// sizes too (Performance and limits): CI fails when a row there is missing or more than 0.2 kB off
// what was measured, so update it in the same pull request.
//
// A row can also name packages its bundle must not contain: `AgentMessage` from `/custom-markdown`
// is for apps with their own Markdown renderer, so CI fails if react-markdown gets back into it.
//
//   pnpm build:lib && pnpm size
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'rolldown';

const dist = join(import.meta.dirname, '../packages/signoff-ui/dist');
const index = JSON.stringify(join(dist, 'index.js'));
const core = JSON.stringify(join(dist, 'core.js'));
const customMarkdown = JSON.stringify(join(dist, 'custom-markdown.js'));
const rows = [
  ['`addUsage`, `estimateCost` (`/core`, for a route)', `export { addUsage, estimateCost } from ${core};`, 0.5],
  ['`applyHunks`, `parseFileChange` (`/core`, with jsdiff)', `export { applyHunks, parseFileChange } from ${core};`, 7],
  ['`Sources`', `export { Sources } from ${index};`, 10.9],
  ['`AgentStatus`', `export { AgentStatus, deriveAgentState } from ${index};`, 11.8],
  ['`RunMeter`', `export { RunMeter, useRunTiming } from ${index};`, 13],
  ['`ApprovalCard`', `export { ApprovalCard, ToolApprovalCard } from ${index};`, 22.7],
  ['`useApprovalPolicy` (no markup)', `export { useApprovalPolicy } from ${index};`, 4.2],
  ['`toToolApproval` (`/core`, for a route)', `export { toToolApproval } from ${core};`, 2.7],
  ['`ToolCallTimeline`', `export { ToolCallTimeline } from ${index};`, 24],
  ['`DiffReview`', `export { DiffReview } from ${index};`, 45.8],
  ['`useDiffReview` (no markup)', `export { useDiffReview } from ${index};`, 17],
  [
    '`AgentMessage` (with markdown, reasoning, timeline, approvals, sources)',
    `export { AgentMessage } from ${index};`,
    94.7,
  ],
  [
    '`AgentMessage` (`/custom-markdown`, for your own renderer: no react-markdown)',
    `export { AgentMessage } from ${customMarkdown};`,
    37.7,
    ['react-markdown', 'remark-gfm', 'remend'],
  ],
  ['`useAgUiAgent` (`/ag-ui`)', `export * from ${JSON.stringify(join(dist, 'ag-ui.js'))};`, 3.7],
  ['ACP converters (`/acp`)', `export * from ${JSON.stringify(join(dist, 'acp.js'))};`, 1.8],
  [
    '`signoffTools` (`/assistant-ui`, with DiffReview and the approval card)',
    `export * from ${JSON.stringify(join(dist, 'assistant-ui.js'))};`,
    57.2,
  ],
  ['Everything in the main entry', `export * from ${index};`, 133],
];

// The package a bundled module belongs to: the last node_modules segment of its path.
const packageOf = (id) => /.*node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)?.[1].replace('\\', '/');

const overBudget = [];
const bundledButExcluded = [];
const measured = [];
const dir = mkdtempSync(join(tmpdir(), 'signoff-size-'));
try {
  console.log('| Import | Minified | Gzipped | Budget |\n| --- | --: | --: | --: |');
  for (const [label, source, budget, without = []] of rows) {
    const entry = join(dir, 'entry.js');
    writeFileSync(entry, source);
    const { output } = await build({
      input: entry,
      external: [/^react($|\/)/, /^react-dom($|\/)/],
      platform: 'browser',
      logLevel: 'silent',
      write: false,
      output: { format: 'esm', minify: true },
    });
    const code = output.map((chunk) => (chunk.type === 'chunk' ? chunk.code : '')).join('');
    const packages = new Set(
      output.flatMap((chunk) =>
        chunk.type === 'chunk'
          ? Object.entries(chunk.modules)
              .filter(([, module]) => module.renderedLength > 0)
              .map(([id]) => packageOf(id))
          : [],
      ),
    );
    for (const name of without) if (packages.has(name)) bundledButExcluded.push(`${label}: ${name}`);
    const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
    const gzipped = gzipSync(code).length;
    const over = gzipped > budget * 1024;
    if (over) overBudget.push(`${label}: ${kb(gzipped)}, budget ${budget} kB`);
    measured.push({ label, size: kb(gzipped) });
    console.log(
      `| ${label} | ${kb(Buffer.byteLength(code))} | ${kb(gzipped)} | ${budget} kB${over ? ' (over)' : ''} |`,
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// The docs' table: its rows match these by the names in backticks (or the words, for the last).
const limits = join(import.meta.dirname, '../examples/playground/content/docs/limits.md');
const key = (label) =>
  [...label.matchAll(/`([^`]+)`/g)]
    .map(([, name]) => name)
    .sort()
    .join(' ') || label.trim();
const documented = new Map(
  [...readFileSync(limits, 'utf8').matchAll(/^\| (.+?) +\| +([\d.]+ kB) \|$/gm)].map(([, label, size]) => [
    key(label),
    size,
  ]),
);
// Within 0.2 kB passes, so a dependency's patch release does not fail CI over the docs; in tenths of
// a kB, as both are printed, so the comparison has no float error.
const tenths = (size) => Math.round(Number.parseFloat(size) * 10);
const stale = measured
  .filter(({ label, size }) => {
    const there = documented.get(key(label));
    return there === undefined || Math.abs(tenths(there) - tenths(size)) > 2;
  })
  .map(({ label, size }) => `${label}: ${documented.get(key(label)) ?? 'no row'} there, ${size} measured`);
if (stale.length > 0) {
  console.error(
    `\nlimits.md is missing a size, or is more than 0.2 kB off one (update its Bundle size table):\n  ${stale.join('\n  ')}`,
  );
}

if (bundledButExcluded.length > 0) {
  console.error(`\nBundled, though the row leaves it out:\n  ${bundledButExcluded.join('\n  ')}`);
}

if (overBudget.length > 0) {
  console.error(
    `\nOver budget (raise it in scripts/size.mjs if the growth is worth it):\n  ${overBudget.join('\n  ')}`,
  );
  process.exit(1);
}
if (stale.length > 0 || bundledButExcluded.length > 0) process.exit(1);
