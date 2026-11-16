/*
 * CopilotKit on /docs/ag-ui: most AG-UI frontends are CopilotKit apps, and the README's AG-UI
 * badge sends them to that page. It tells them to keep CopilotKit's hooks (useAgUiAgent is for apps
 * without it), and its snippet imports only what signoff-ui exports, names the CopilotKit version it
 * ran with, and renders every result CopilotKit can hand it without throwing. Needs the library
 * built (pnpm build:lib).
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as kit from 'signoff-ui';
import ts from 'typescript';
import { z } from 'zod';
import { getGuide, getHeadings, readGuide } from '../lib/docs';

const markdown = readGuide(getGuide('ag-ui')!);
const HEADING = 'Using CopilotKit?';

/** The text under a `##` heading, up to the next one. */
function section(heading: string) {
  return markdown.split(/^## /m).find((part) => part.startsWith(`${heading}\n`)) ?? '';
}

/** What a `from '<module>'` import in the code takes, by name. */
function imported(code: string, module: string) {
  const names = new RegExp(`import \\{([^}]*)\\} from '${module}';`).exec(code)?.[1] ?? '';
  return names
    .split(',')
    .map((name) => name.replace(/^\s*type\s+/, '').trim())
    .filter(Boolean);
}

/** CopilotKit 1.83.0's ToolCallStatus values (@copilotkit/core). */
const ToolCallStatus = { InProgress: 'inProgress', Executing: 'executing', Complete: 'complete' } as const;

type RenderProps = {
  args: { command: string };
  status: string;
  respond?: (result: unknown) => Promise<void>;
  result?: string;
};
type Rendered = { type: unknown; props: Record<string, unknown> } | null;

/**
 * The snippet's `render`, from the page's own code: it runs with CopilotKit's hook capturing the tool,
 * and JSX that returns the element as data, so a test can call it the way CopilotKit does.
 */
function renderOf(code: string) {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  let render: ((props: RenderProps) => Rendered) | undefined;
  const element = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const modules: Record<string, unknown> = {
    '@copilotkit/react-core/v2': {
      ToolCallStatus,
      useHumanInTheLoop: (tool: { render: typeof render }) => (render = tool.render),
    },
    'signoff-ui': kit,
    zod: { z },
    'react/jsx-runtime': { jsx: element, jsxs: element },
  };
  const exports: Record<string, () => unknown> = {};
  new Function('require', 'exports', js)((name: string) => modules[name], exports);
  for (const component of Object.values(exports)) component();
  assert.ok(render, 'the snippet registers no render with useHumanInTheLoop');
  return render;
}

describe('/docs/ag-ui for CopilotKit apps', () => {
  const text = section(HEADING);
  const code = /```tsx[^\n]*\n([\s\S]*?)```/.exec(text)?.[1] ?? '';

  it('has a section for them, linked from the top of the page', () => {
    const id = getHeadings(markdown).find((h) => h.text === HEADING)?.id;
    assert.ok(id, `no "## ${HEADING}" heading`);
    const intro = markdown.slice(0, markdown.indexOf('\n## '));
    assert.ok(intro.includes(`(/docs/ag-ui#${id})`), `the intro doesn't link to #${id}`);
  });

  it('keeps CopilotKit’s hooks, and leaves useAgUiAgent to apps without CopilotKit', () => {
    assert.match(text, /`useAgUiAgent`[^.]*without/);
    assert.ok(imported(code, '@copilotkit/react-core/v2').includes('useHumanInTheLoop'), code);
    assert.doesNotMatch(code, /signoff-ui\/ag-ui/);
  });

  it('imports only what signoff-ui exports', () => {
    const names = imported(code, 'signoff-ui');
    assert.ok(names.length > 0, 'the snippet imports nothing from signoff-ui');
    for (const name of names) assert.ok(name in kit, `signoff-ui exports no ${name}`);
  });

  it('names the CopilotKit version it was tested with', () => {
    assert.match(text, /[Tt]ested with `@copilotkit\/react-core` and `@copilotkit\/runtime` \d+\.\d+\.\d+/);
  });

  it('says the render is registered once, so a value it closes over goes in its deps', () => {
    assert.match(text, /registers the tool and its `render` once/);
    assert.match(text, /`\[policy\.rules, policy\.ready\]`/);
    // CopilotKit compares deps with JSON.stringify, where a function is null.
    assert.match(text, /compares the deps as JSON/);
  });

  it('renders every result CopilotKit can hand it, and a finished card never waits', () => {
    const render = renderOf(code);
    const args = { command: 'npm test' };
    const props = (rendered: Rendered) => {
      assert.equal(rendered?.type, kit.ApprovalCard);
      return rendered!.props;
    };
    // Arguments still streaming: nothing to answer with yet.
    assert.equal(render({ args, status: ToolCallStatus.InProgress }), null);
    // Waiting for the person: a press answers with { approved, reason }.
    const answered: unknown[] = [];
    const waiting = props(
      render({ args, status: ToolCallStatus.Executing, respond: async (r) => void answered.push(r) }),
    );
    assert.equal(waiting.status, 'pending');
    (waiting.onDecide as (choice: { decision: string; reason?: string }) => void)({
      decision: 'deny-once',
      reason: 'use pnpm',
    });
    assert.deepEqual(answered, [{ approved: false, reason: 'use pnpm' }]);
    // Done, with the answer it sent.
    const complete = (result: string) => props(render({ args, status: ToolCallStatus.Complete, result }));
    assert.equal(complete('{"approved":true}').status, 'approved');
    const denied = complete('{"approved":false,"reason":"use pnpm"}');
    assert.deepEqual([denied.status, denied.reason], ['denied', 'use pnpm']);
    // Done without an answer: CopilotKit's results for a run stopped while the card waited and for
    // arguments that didn't parse. A throw here would unmount the app, since CopilotKit has no error boundary.
    for (const result of [
      'Error: Human-in-the-loop interaction aborted',
      `Error: Unexpected token 'p', ..."ommand": npm test}" is not valid JSON`,
    ]) {
      const card = complete(result);
      assert.deepEqual([card.status, card.reason], ['denied', result]);
    }
  });
});
