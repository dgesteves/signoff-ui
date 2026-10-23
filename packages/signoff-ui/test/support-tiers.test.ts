// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { headingId, section } from './utils';

/*
 * Support tiers, on the limits page, and the freeze on new integrations in CONTRIBUTING.md. Tier 1
 * names the CI jobs that run on every pull request, so it can't outlive or miss one; both tiers
 * point at the "Works with" matrix in Getting started rather than keep a second one. The freeze
 * has no launch date to go stale: it reads the same before the launch and after it.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const limits = read('examples/playground/content/docs/limits.md');
const guide = read('examples/playground/content/docs/getting-started.md');
const contributing = read('CONTRIBUTING.md');
const ci = read('.github/workflows/ci.yml');

const tiers = section(limits, 'Support tiers');
/** A bulleted item, from its bold lead to the end of its line. */
const item = (markdown: string, lead: string) =>
  markdown.split('\n').find((line) => line.startsWith(`- **${lead}`)) ?? '';
const tier1 = item(tiers, 'Tier 1: tested in CI.');
const tier2 = item(tiers, 'Tier 2: documented, not verified.');

/** The names of ci.yml's jobs that run on every pull request: their own `if` skips only the daily run. */
const pullRequestJobs = ci
  .slice(ci.indexOf('\njobs:\n'))
  .split(/\n {2}(?=[\w-]+:\n)/)
  .slice(1)
  .filter((job) => /^ {4}if: github\.event_name != 'schedule'$/m.test(job))
  .map((job) => /^ {4}name: (.+)$/m.exec(job)?.[1] ?? '');

/** The "Works with" matrix in Getting started: its header and each row's two columns, as text. */
const matrix = section(guide, 'Works with')
  .split('\n')
  .filter((line) => line.startsWith('|'))
  .map((line) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim()),
  );
const [header = []] = matrix;
const tested = matrix
  .slice(2)
  .map((row) => row[1])
  .join(', ');
const untested = matrix
  .slice(2)
  .map((row) => row[2])
  .join(', ');

/** What Tier 2 names from the matrix's untested column. */
const TIER_2 = ['AI Elements', 'Mastra', 'Cloudflare Agents', 'Vercel Eve', 'LangGraph', 'Next.js 14 and 15'];

describe('Support tiers', () => {
  it('is a section of the limits page, with a tier for what CI tests and one for what it does not', () => {
    expect(tiers).not.toBe('');
    expect(tier1).not.toBe('');
    expect(tier2).not.toBe('');
  });

  it('links the Works with matrix, and calls its columns by their headers', () => {
    expect(section(guide, 'Works with')).not.toBe('');
    expect(tiers).toContain(`[Works with](/docs/getting-started#${headingId('Works with')})`);
    expect(header.slice(1)).toEqual(['Tested in CI', 'Should work, not tested in CI']);
    expect(tiers).toContain('its "Tested in CI" column is Tier 1');
    expect(tiers).toContain('its "Should work, not tested in CI" column is Tier 2');
    // One matrix, in Getting started: no table of its own here.
    expect(tiers).not.toMatch(/^\|/m);
  });

  it('names in Tier 1 every CI job that runs on each pull request, and no other', () => {
    expect(pullRequestJobs).toContain('AI SDK 6');
    expect(pullRequestJobs).toContain('CopilotKit example');
    expect(pullRequestJobs).toContain('Firefox');
    expect(pullRequestJobs).toContain("WebKit (Safari's engine)");
    const named = [...tier1.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]).slice(1);
    expect([...named].sort()).toEqual([...pullRequestJobs].sort());
    expect(tier1).toContain('(https://github.com/dgesteves/signoff-ui/blob/main/.github/workflows/ci.yml)');
  });

  it('names in Tier 2 only entries the matrix gives as untested, and what it does not list', () => {
    for (const name of TIER_2) {
      expect(tier2, name).toContain(name);
      expect(untested, name).toContain(name);
      expect(tested, name).not.toContain(name);
    }
    // The docs name Pydantic AI among the AG-UI frameworks; CI runs the ACP adapter on scripted turns.
    expect(read('examples/playground/content/docs/ag-ui.md')).toContain('Pydantic AI');
    expect(untested).not.toContain('Pydantic AI');
    expect(tier2).toContain('Pydantic AI');
    expect(tier2).toContain('scripted turns');
  });
});

describe('CONTRIBUTING: new integrations', () => {
  const freeze = section(contributing, 'New integrations');

  it('holds new integrations until four weeks after the public launch, unless an issue asks for one', () => {
    expect(freeze).not.toBe('');
    expect(freeze).toContain('Until the public launch and for the first four weeks after it');
    for (const kind of ['chat kit', 'protocol adapter', 'agent SDK']) expect(freeze, kind).toContain(kind);
    expect(freeze).toContain('The exception is an integration someone needs and asks for in an issue.');
  });

  it('reads the same before and after the launch: it gives no date', () => {
    expect(freeze).not.toBe('');
    expect(freeze).not.toMatch(/\b20\d\d\b/);
    expect(freeze).not.toMatch(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/,
    );
  });

  it('says how to ask, through the feature request form', () => {
    expect(existsSync(join(root, '.github/ISSUE_TEMPLATE/feature_request.yml'))).toBe(true);
    expect(read('.github/ISSUE_TEMPLATE/feature_request.yml')).toContain('integration');
    expect(freeze).toContain('(https://github.com/dgesteves/signoff-ui/issues/new?template=feature_request.yml)');
  });

  it('links the support tiers on the limits page', () => {
    expect(freeze).toContain(`(https://signoff-ui.vercel.app/docs/limits#${headingId('Support tiers')})`);
  });
});
