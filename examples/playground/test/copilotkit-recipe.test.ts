/*
 * /docs/copilotkit, the CopilotKit recipe: every file it shows is examples/copilotkit's own code,
 * which CI builds and drives in Chrome (scripts/smoke-copilotkit.mjs), so the page can't drift from
 * code that runs. It names the CopilotKit versions the example pins, and the sidebar lists it with
 * the other guides.
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { getGuide, NAV, readGuide } from '../lib/docs';

const ROOT = join(import.meta.dirname, '../../..');
const EXAMPLE = join(ROOT, 'examples/copilotkit');

/** The code blocks with a file name for a title: ```tsx title="app/page.tsx". */
function files(markdown: string) {
  return [...markdown.matchAll(/^```\w+ title="([^"]+)"\n([\s\S]*?)^```$/gm)].map(([, title, code]) => ({
    title: title!,
    code: code!,
  }));
}

/** Lines without their indentation, so an excerpt can come from inside a function. */
const lines = (text: string) =>
  text
    .trimEnd()
    .split('\n')
    .map((line) => line.trim());

describe('/docs/copilotkit', () => {
  const doc = getGuide('copilotkit');
  const markdown = doc ? readGuide(doc) : '';
  const pkg = JSON.parse(readFileSync(join(EXAMPLE, 'package.json'), 'utf8')) as {
    name: string;
    dependencies: Record<string, string>;
  };

  it('is a guide, in the sidebar with the others', () => {
    assert.ok(doc, 'lib/docs.ts has no copilotkit guide');
    const guides = NAV.find((group) => group.title === 'Guides')?.items.map((item) => item.href) ?? [];
    assert.ok(guides.includes('/docs/copilotkit'), `the Guides group lists ${guides.join(', ')}`);
  });

  it('shows examples/copilotkit’s own files, whole or as a run of their lines', () => {
    const shown = files(markdown);
    assert.ok(shown.length >= 5, `the page shows ${shown.length} files`);
    for (const { title, code } of shown) {
      const source = readFileSync(join(EXAMPLE, title), 'utf8');
      if (code === source) continue;
      const file = lines(source);
      const excerpt = lines(code);
      const at = file.findIndex((_, start) => excerpt.every((line, i) => file[start + i] === line));
      assert.ok(at !== -1, `${title}: the page's code is not in examples/copilotkit/${title}`);
    }
  });

  it('names the CopilotKit versions the example pins and CI runs', () => {
    const react = pkg.dependencies['@copilotkit/react-core'];
    for (const name of ['@copilotkit/react-core', '@copilotkit/runtime', '@ag-ui/client'])
      assert.match(pkg.dependencies[name] ?? '', /^\d+\.\d+\.\d+$/, `examples/copilotkit doesn't pin ${name}`);
    assert.equal(pkg.dependencies['@copilotkit/runtime'], react);
    const tested = /[Tt]ested with `@copilotkit\/react-core` and `@copilotkit\/runtime` (\d+\.\d+\.\d+)/.exec(markdown);
    assert.equal(tested?.[1], react, 'the page names another CopilotKit version than the example runs');
  });

  it('links to the example, and CI builds it and drives it in Chrome', () => {
    assert.match(markdown, /\(https:\/\/github\.com\/dgesteves\/signoff-ui\/tree\/main\/examples\/copilotkit\)/);
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    assert.ok(ci.includes(`pnpm --filter ${pkg.name} build`), 'CI does not build examples/copilotkit');
    assert.match(ci, /run: pnpm smoke:copilotkit$/m);
  });
});
