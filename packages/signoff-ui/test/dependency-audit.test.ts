// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';

/* pnpm 12 writes pnpm-lock.yaml as two YAML documents, and GitHub's dependency graph reads only the
   first, which holds pnpm's own packages: Dependabot can't alert on anything this repository or its
   site installs. `pnpm audit` takes its place, on every pull request for the production
   dependencies, and daily for the whole tree. The advisories it skips are in pnpm-workspace.yaml,
   each with the reason. */

interface Step {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  'continue-on-error'?: boolean | string;
}

interface Job {
  if?: string;
  'continue-on-error'?: boolean | string;
  steps: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job | undefined>;
}

type Dependencies = Record<string, { specifier: string; version: string }>;

/** The part of pnpm-lock.yaml these tests read: what each workspace package asks for, and what each package installs. */
interface Lockfile {
  importers: Record<
    string,
    { dependencies?: Dependencies; optionalDependencies?: Dependencies; devDependencies?: Dependencies } | undefined
  >;
  packages: Record<string, unknown>;
  snapshots: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>;
}

const root = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
/** A workflow, or one with no triggers and no jobs when the file is missing. */
const workflow = (path: string): Workflow =>
  existsSync(join(root, path)) ? (parse(read(path)) as Workflow) : { on: {}, jobs: {} };
/** The steps of a job that run `pnpm audit`. */
const auditSteps = (job: Job | undefined) => (job?.steps ?? []).filter((step) => /\bpnpm audit\b/.test(step.run ?? ''));
/** The commands of a job's steps that run `pnpm audit`. */
const audits = (job: Job | undefined) => auditSteps(job).map((step) => step.run);

/** The document of pnpm-lock.yaml with the workspace's packages, after the one with pnpm's own. */
const lock = Array.from(parseAllDocuments(read('pnpm-lock.yaml')), (document) => document.toJS() as Lockfile).find(
  (document) => document.importers?.['packages/signoff-ui'],
);
const library = lock?.importers['packages/signoff-ui'];

/**
 * The snapshot a dependency resolves to: `name@version`, with its peers in parentheses; an alias
 * (`tailwindcss-v3: tailwindcss@3.4.19`) names its own. A workspace link has none.
 */
const snapshot = (name: string, version: string) =>
  version.startsWith('link:') ? undefined : /^\d/.test(version) ? `${name}@${version}` : version;

/**
 * Every package the snapshots install, each as `name@version`, following dependencies, optional
 * dependencies and the peers pnpm resolved for them; and the snapshots pnpm-lock.yaml doesn't have.
 */
function installs(snapshots: string[]) {
  const seen = new Set<string>();
  const missing: string[] = [];
  const queue = [...snapshots];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    if (seen.has(key)) continue;
    seen.add(key);
    const found = lock?.snapshots[key];
    if (!found) missing.push(key);
    for (const [name, version] of Object.entries({ ...found?.dependencies, ...found?.optionalDependencies })) {
      const next = snapshot(name, version);
      if (next) queue.push(next);
    }
  }
  return { packages: [...new Set([...seen].map((key) => key.replace(/\(.*$/, '')))], missing };
}

/** A dependency of packages/signoff-ui, a peer (a dev dependency here) included, as its snapshot. */
const resolve = (name: string) => {
  const dependency = library?.dependencies?.[name] ?? library?.devDependencies?.[name];
  return dependency && snapshot(name, dependency.version);
};

const isZod3 = (pkg: string) => /^zod@3\./.test(pkg);

describe('pnpm audit on every pull request', () => {
  const main = workflow('.github/workflows/ci.yml').jobs.ci;

  it('fails the main CI job on a moderate or worse advisory in a production dependency', () => {
    expect(main?.if).toBe("github.event_name != 'schedule'");
    expect(audits(main)).toEqual(['pnpm audit --prod --audit-level=moderate']);
  });

  it('fails it, not only warns', () => {
    expect(main).not.toHaveProperty('continue-on-error');
    for (const step of auditSteps(main)) expect(step).not.toHaveProperty('continue-on-error');
  });

  it('runs last, after a failed step too: a new advisory skips no other check and hides no result', () => {
    expect(main?.steps.at(-1)).toMatchObject({
      if: '${{ !cancelled() }}',
      run: 'pnpm audit --prod --audit-level=moderate',
    });
  });
});

describe('pnpm audit daily, over the whole tree', () => {
  const audit = workflow('.github/workflows/audit.yml');

  it('is a workflow of its own', () => {
    expect(existsSync(join(root, '.github/workflows/audit.yml'))).toBe(true);
  });

  it('runs daily, by hand, and on a pull request that changes the lockfile or the audit settings', () => {
    expect(audit.on.schedule).toEqual([{ cron: expect.stringMatching(/^\d+ \d+ \* \* \*$/) }]);
    expect(audit.on).toHaveProperty('workflow_dispatch');
    expect(audit.on.pull_request).toEqual({
      paths: ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.github/workflows/audit.yml'],
    });
  });

  it('can only read the repository', () => {
    expect(audit.permissions).toEqual({ contents: 'read' });
  });

  it('audits the dev and the production dependencies, at every severity', () => {
    expect(Object.values(audit.jobs).flatMap(audits)).toEqual(['pnpm audit']);
    for (const job of Object.values(audit.jobs)) {
      expect(job).not.toHaveProperty('continue-on-error');
      for (const step of auditSteps(job)) expect(step).not.toHaveProperty('continue-on-error');
    }
  });
});

describe('zod 3, whose advisory pnpm audit skips', () => {
  /* The ignore in pnpm-workspace.yaml holds for the whole repository: zod 3 coming into the
     published package's dependencies, or the registry items', would pass the audit unreported. */

  it("is not among what the published package's dependencies install", () => {
    const { packages, missing } = installs(
      Object.entries({ ...library?.dependencies, ...library?.optionalDependencies }).flatMap(
        ([name, { version }]) => snapshot(name, version) ?? [],
      ),
    );
    expect(missing).toEqual([]);
    // The walk reaches past the direct dependencies: micromark comes in through react-markdown.
    expect(packages).toEqual(expect.arrayContaining([expect.stringMatching(/^react-markdown@/)]));
    expect(packages).toEqual(expect.arrayContaining([expect.stringMatching(/^micromark@/)]));
    expect(packages.filter(isZod3)).toEqual([]);
  });

  it("nor among what the registry items' dependencies install", () => {
    const registry = JSON.parse(read('registry.json')) as { items: { dependencies?: string[] }[] };
    // A dependency can carry a range: `name@^1.2.0`.
    const names = [...new Set(registry.items.flatMap((item) => item.dependencies ?? []))].map((dependency) =>
      dependency.replace(/(?<=.)@.*$/, ''),
    );
    expect(names).toContain('ai');
    const snapshots = names.map(resolve);
    expect(names.filter((_, index) => !snapshots[index])).toEqual([]);
    const { packages, missing } = installs(snapshots.filter((key) => key !== undefined));
    expect(missing).toEqual([]);
    expect(packages.filter(isZod3)).toEqual([]);
  });
});

describe('the advisories pnpm audit skips', () => {
  const source = read('pnpm-workspace.yaml');
  const lines = source.split('\n');
  const { auditConfig } = parse(source) as { auditConfig?: { ignoreGhsas?: string[] } };
  const locked = new Set(Object.keys(lock?.packages ?? {}).map((key) => key.slice(0, key.lastIndexOf('@'))));
  // The package each advisory skipped today is about.
  const about: Record<string, string> = {
    'GHSA-mrhx-c7xc-m3w5': 'zod',
    'GHSA-238p-pmpm-9mq7': 'katex',
  };

  /** The comment right above an advisory's line, as one line. */
  const comment = (id: string) => {
    const above: string[] = [];
    for (let at = lines.findIndex((text) => text.trim() === `- ${id}`) - 1; at >= 0; at--) {
      const text = lines[at]?.trim() ?? '';
      if (!text.startsWith('#')) break;
      above.unshift(text.replace(/^#\s*/, ''));
    }
    return above.join(' ');
  };

  it("each come with a comment that opens with the advisory's package and severity, then says why", () => {
    expect(locked.has('react-markdown')).toBe(true);
    for (const id of auditConfig?.ignoreGhsas ?? []) {
      expect(id).toMatch(/^GHSA(?:-[2-9cfghjmpqrvwx]{4}){3}$/);
      const [, name = '', why = ''] = /^(\S+) \((?:low|moderate|high|critical)\): (.*)$/.exec(comment(id)) ?? [];
      expect(why, `${id}: "<package> (<severity>): <why>" above it`).not.toBe('');
      expect(locked.has(name), `${id}: ${name} is a package in pnpm-lock.yaml`).toBe(true);
      if (id in about) expect(name, id).toBe(about[id]);
    }
  });
});

describe('examples/copilotkit', () => {
  /* CopilotKit pins @ag-ui/client and @ag-ui/core exactly. Should the example ask for another
     version, it installs two copies, and its scripted agent, an AbstractAgent from the example's
     copy, no longer type-checks as an agent of CopilotKit's runtime (Dependabot's @ag-ui/client
     1.0.3, in #220). And one version of each @copilotkit package: one copy of CopilotKit. */
  const example = lock?.importers['examples/copilotkit'];
  const { packages, missing } = installs(
    Object.entries({ ...example?.dependencies, ...example?.devDependencies }).flatMap(
      ([name, { version }]) => snapshot(name, version) ?? [],
    ),
  );

  it('installs one version of each @ag-ui and @copilotkit package, the @ag-ui/client it asks for', () => {
    expect(missing).toEqual([]);
    const versions = new Map<string, string[]>();
    for (const pkg of packages.filter((id) => /^@(?:ag-ui|copilotkit)\//.test(id))) {
      const name = pkg.slice(0, pkg.lastIndexOf('@'));
      versions.set(name, [...(versions.get(name) ?? []), pkg]);
    }
    expect([...versions.keys()]).toEqual(
      expect.arrayContaining(['@ag-ui/client', '@ag-ui/core', '@copilotkit/runtime', '@copilotkit/shared']),
    );
    expect([...versions.values()].filter((ids) => ids.length > 1)).toEqual([]);
    expect(versions.get('@ag-ui/client')).toEqual([
      `@ag-ui/client@${example?.dependencies?.['@ag-ui/client']?.version}`,
    ]);
  });
});
