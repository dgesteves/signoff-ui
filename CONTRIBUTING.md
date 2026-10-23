# Contributing

Issues and pull requests are welcome. For a larger change, open an issue first, so we can agree on the shape before you write it.

## Setup

Node 24 (see `.nvmrc`) and pnpm (the version in `package.json`'s `packageManager`; `corepack enable` picks it up).

```bash
pnpm install
pnpm dev   # the library in watch mode, and the playground on http://localhost:3100
```

The playground runs a scripted agent and needs no key. For live mode, copy `examples/playground/.env.example` to `.env.local` and set `OPENAI_API_KEY` and `LIVE_MODE=1`, and `OPENAI_MODEL` for a model other than `gpt-5.4-mini`. It runs on your key; the public site leaves `LIVE_MODE` off, so it shows only the scripted run. `examples/nextjs-minimal` is the README quickstart as an app: build the library, then `pnpm --filter nextjs-minimal dev` (port 3200). `examples/coding-agent`, the reference app, runs the same way: `pnpm --filter coding-agent dev` (port 3400).

```
packages/signoff-ui/   the library: src/ (components, lib/, styles/), test/, build scripts
examples/playground/     the site: the playground, the components page and the docs (Next.js)
examples/nextjs-minimal/ the README quickstart, against a scripted model
examples/coding-agent/   the reference app: approval rules and reviews, against a scripted model
registry.json            the shadcn registry, generated from src/
scripts/                 registry generator, smoke tests, media capture, accessibility audit
```

The Next.js examples don't run on StackBlitz: its WebContainers render no App Router page on Next.js 15 or later.

## Checks

CI runs all of these; run the ones your change touches before you push.

```bash
pnpm format:check && pnpm lint && pnpm lint:registry
pnpm build:lib        # also checks 'use client' directives and the shipped CSS
pnpm size             # each import's gzipped size, against its budget in scripts/size.mjs
pnpm typecheck
pnpm test             # Vitest, Testing Library and axe in jsdom
pnpm test:coverage    # the same, with coverage and its thresholds (vitest.config.ts)
pnpm --filter signoff-ui lint:package   # publint and attw
pnpm registry:check   # registry.json matches src/
pnpm smoke:styles     # styles.css in Chrome: a global reset, a Tailwind v3 build, your content in slots
pnpm build:playground && pnpm smoke:playground
pnpm a11y             # axe in Chrome, across the built playground, components page and docs
pnpm --filter nextjs-minimal build && pnpm smoke:nextjs
pnpm examples:check   # examples/coding-agent asks for the version of signoff-ui this repository publishes
pnpm --filter coding-agent test && pnpm smoke:coding-agent
```

`pnpm media` regenerates `docs/media` from a running playground (Chrome and ffmpeg required).

The smoke tests and `pnpm a11y` drive Google Chrome through Playwright, so they need Chrome installed. Each starts the built app on a port of its own; set `BASE_URL` to test one that is already running, such as `pnpm dev`'s playground on http://localhost:3100.

The suite also runs against AI SDK 6 and React 18. To do the same, in `packages/signoff-ui` (then restore `package.json` and `pnpm-lock.yaml`):

```bash
pnpm add --save-dev ai@^6 && pnpm exec tsc --noEmit -p tsconfig.src.json && pnpm test
pnpm add --save-dev react@^18.2.0 react-dom@^18.2.0 @types/react@^18 @types/react-dom@^18 && pnpm test
```

## Adding a component

1. Add it under `packages/signoff-ui/src/`. Start the file with `'use client'` if it uses hooks, state or event handlers; keep pure helpers in `src/lib/` without it, so Server Components can call them. Style it with Tailwind utilities and the `signoff-*` color tokens (no fixed colors, so themes apply), and give its root `data-signoff` and a `data-slot` starting with `signoff-`. Put content the app passes in to render as its own (a render prop, a custom preview) in an element with `data-signoff-slot`: `styles.css` styles the kit's elements only, and stops at those (`scripts/kit-scope.mjs`).
2. Export it from `src/index.ts`, and helpers with no React from `src/core.ts` too.
3. Add tests in `packages/signoff-ui/test/`, including an axe check. Every render must be safe on the server: no clock or random reads while rendering (`test/server-render.test.tsx`).
4. Add it to `ITEMS` in `scripts/registry.mjs` and run `pnpm registry:generate`, which works out the files and dependencies from its imports.
5. Show it on the components page (`examples/playground/app/components/page.tsx`, with a demo in `examples/playground/components/demos/`), and document it on the docs site: an entry in `examples/playground/lib/components.ts` and how it behaves in `examples/playground/content/components/<slug>.md`. The README lists components in one table; add it there if it is one people should know about.

## New integrations

Until the public launch and for the first four weeks after it, the kit adds no new integration: no new chat kit, protocol adapter or agent SDK, whether as a package entry, a registry item, an example or a docs page. Fixes, docs and tests for the integrations it has go on as usual.

The exception is an integration someone needs and asks for in an issue. Open a [feature request](https://github.com/dgesteves/signoff-ui/issues/new?template=feature_request.yml) that says what you are building and what it runs on (the chat kit, protocol or agent SDK, and its version), or add your case to an open one. After those four weeks, propose a new integration in an issue first, as any larger change.

Each integration is in a [support tier](https://signoff-ui.vercel.app/docs/limits#support-tiers): Tier 1 when a CI job runs it on every pull request, Tier 2 when it is documented but not verified. A new one is Tier 2 until a CI job runs it.

## Changesets

A change to the published package needs a changeset: run `pnpm changeset`, pick `signoff-ui`, choose patch for a fix or minor for a feature, and write a line or two for the changelog from a user's point of view. Docs, the examples and CI need none. Merging to `main` opens a "Version packages" pull request, and merging that publishes to npm. Its version step, `pnpm version-packages`, also moves `examples/coding-agent` to `signoff-ui@^<new version>`, so a copy of the example installs the release its code is written for. [RELEASING.md](./RELEASING.md) covers the release workflow, its dry run, and what to do when a release step fails.

By contributing, you agree that your work is released under the [MIT license](./LICENSE) and that you follow the [code of conduct](./CODE_OF_CONDUCT.md).
