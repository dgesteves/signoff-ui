// Builds examples/coding-agent against the packed package, as someone gets it who copies it out of
// the repository, and drives the scripted run in Chrome: reads allowed by the default rules, the
// tests approved for the session from the keyboard, a review with a rejected file and a comment on a
// line, the revision it brings, then the tests on the session rule, the commit on a default rule and
// the push blocked by the server's rule. A second run takes the session rule without asking. axe
// checks each step in dark and light, and a 390px phone must not scroll sideways. Then, with live mode
// on the server, the page must still start on the scripted agent and send only scripted requests. Fails
// on any page error or console error, hydration mismatches included.
//
//   pnpm build:lib && pnpm smoke:coding-agent   # or test a running app: BASE_URL=http://localhost:3400
//
// The tarball comes from `npm pack`, unpacked into a copy of the example: all of it, so it must not
// lean on files outside its folder. Every other package is linked from the workspace's install, so
// the build needs no network. The Next.js build uses webpack, as the example's scripts do.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright-core';

const root = join(import.meta.dirname, '..');
const lib = join(root, 'packages/signoff-ui');
const example = join(root, 'examples/coding-agent');
const PORT = 3410;

let base = process.env.BASE_URL;
let work;
let app;
let next;
let server;
let browser;

/** A copy of the example with the packed package, built and started. */
async function startCopy() {
  work = mkdtempSync(join(tmpdir(), 'signoff-coding-agent-'));
  app = join(work, 'app');
  const [{ filename }] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', work], { cwd: lib, encoding: 'utf8' }),
  );
  const installed = join(app, 'node_modules/signoff-ui');
  mkdirSync(installed, { recursive: true });
  execFileSync('tar', ['-xzf', join(work, filename), '-C', installed, '--strip-components=1']);
  cpSync(example, app, {
    recursive: true,
    filter: (source) => !/[\\/](node_modules|\.next|next-env\.d\.ts|tsconfig\.tsbuildinfo)$/.test(source),
  });
  const link = (name, from) => {
    const target = join(app, 'node_modules', name);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(realpathSync(join(from, 'node_modules', name)), target);
  };
  const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const own = manifest(example);
  for (const name of Object.keys({ ...own.dependencies, ...own.devDependencies }))
    if (name !== 'signoff-ui') link(name, example);
  for (const name of Object.keys(manifest(installed).dependencies)) link(name, lib);

  next = join(realpathSync(join(example, 'node_modules/next')), 'dist/bin/next');
  execFileSync(process.execPath, [next, 'build', '--webpack'], { cwd: app, stdio: 'inherit' });
  const tsc = join(realpathSync(join(example, 'node_modules/typescript')), 'bin/tsc');
  execFileSync(process.execPath, [tsc, '--noEmit', '-p', app], { cwd: app, stdio: 'inherit' });
  console.log(`pass  built and typechecked a copy of examples/coding-agent, from ${filename}`);

  // No OPENAI_API_KEY: the page offers the scripted agent only.
  server = await serve(PORT, { OPENAI_API_KEY: '' });
  base = `http://localhost:${PORT}`;
}

/** `next start` on the built copy, with these environment variables, once it answers. */
async function serve(port, env) {
  const child = spawn(process.execPath, [next, 'start', '--port', String(port)], {
    cwd: app,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`http://localhost:${port}`)).ok) return child;
    } catch {
      if (attempt > 60) {
        child.kill();
        throw new Error(`The example did not start on port ${port}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const axeSource = readFileSync(createRequire(join(lib, 'package.json')).resolve('axe-core/axe.min.js'), 'utf8');

async function audit(page, label) {
  // Off any button the last click left the pointer on, and past enter animations: contrast as at rest.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const { violations } = await window.axe.run(document, { resultTypes: ['violations'] });
    return violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
  if (violations.length) throw new Error(`axe, ${label}:\n  ${violations.join('\n  ')}`);
}

async function noSidewaysScroll(page, label) {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  if (scroll > client) throw new Error(`${label}: the page scrolls sideways (${scroll}px wide in ${client}px)`);
}

async function focusWithin(page, locator, label) {
  if (!(await locator.evaluate((el) => el.contains(document.activeElement))))
    throw new Error(`${label} does not have focus`);
}

/** One whole run; `check` runs at each step (axe, the phone's width). */
async function run(page, check) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await check('before the run');
  await page.getByRole('button', { name: 'Start the run' }).click();

  // The listing and both reads: allowed by the default rules on the server, nobody asked.
  const card = page.locator('[data-slot="signoff-approval-card"][data-status="pending"]');
  await card.waitFor({ timeout: 30_000 });
  // The server's toolApproval decided them, so each reads Auto-approved, not "Allowed by your rule": the
  // page's own rules must leave a decision the SDK made alone.
  const auto = await page.locator('[data-slot="signoff-approval-card"]', { hasText: 'Auto-approved' }).count();
  if (auto !== 3) {
    const cards = await page.locator('[data-slot="signoff-approval-card"]').allInnerTexts();
    throw new Error(
      `${auto} calls were approved by a rule before the tests, not 3:\n  ${cards.map((c) => c.replace(/\s+/g, ' ')).join('\n  ')}`,
    );
  }
  if (!(await card.innerText()).includes('npm test')) throw new Error('The card does not ask about npm test');
  await check('the approval card');
  // The card has focus: S approves for this session, which leaves a rule.
  await focusWithin(page, card, 'The approval card');
  await page.keyboard.press('s');
  await page.locator('.rule', { hasText: 'run_command with command npm test*' }).waitFor({ state: 'attached' });

  const review = page.locator('[data-slot="signoff-diff-review"]').first();
  await review.waitFor({ timeout: 30_000 });
  const files = await review.locator('[data-slot="signoff-diff-file"]').count();
  if (files !== 3) throw new Error(`The review shows ${files} files, not 3`);
  await check('the review');
  // The first hunk has focus: Shift+A accepts every hunk. Then leave out the README and comment on line 19.
  await focusWithin(page, review, 'The review');
  await page.keyboard.press('Shift+A');
  const readme = review.locator('[data-slot="signoff-diff-file"]', { hasText: 'README.md' });
  await readme.getByRole('button', { name: /Reject file/ }).click();
  await review.locator('[data-slot="signoff-diff-hunk"]').nth(1).locator('button', { hasText: /^19$/ }).click();
  await page.keyboard.press('c');
  await review.locator('textarea').fill('Spell out ß as ss too.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await review.locator('[data-slot="signoff-diff-comment"]').waitFor();
  await review.locator('[data-slot="signoff-diff-submit"]').click();

  // The comment went back to the agent: it quotes it, and proposes a revision.
  await page.getByText('“Spell out ß as ss too.” on src/slugify.ts, line 19').waitFor({ timeout: 30_000 });
  const revision = page.locator('[data-slot="signoff-diff-review"]', {
    has: page.locator('[data-slot="signoff-diff-submit"]'),
  });
  await revision.waitFor({ timeout: 30_000 });
  await check('the revision');
  await focusWithin(page, revision, 'The revision');
  await page.keyboard.press('Shift+A');
  await page.keyboard.press('ControlOrMeta+Enter');

  // The tests on the session rule, the commit on a default rule, the push blocked on the server.
  await page.locator('[data-slot="signoff-agent-status"][data-state="done"]').first().waitFor({
    state: 'attached',
    timeout: 60_000,
  });
  await page.getByText('A rule on the server blocks git push').waitFor();
  const decisions = await page.locator('.decisions').innerText();
  for (const expected of [
    'Allowed by your rule · run_command with command npm test*',
    'Allowed by your rule · run_command with command git commit*',
    "Denied by the server's rule · run_command with command **git*push**",
    'You approved for this session',
  ])
    if (!decisions.includes(expected)) throw new Error(`The decisions do not list "${expected}":\n${decisions}`);
  await page.locator('#changes-heading').waitFor();
  await check('the end of the run');
}

try {
  if (!base) await startCopy();
  browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  const open = async (options) => {
    const page = await browser.newPage(options);
    page.setDefaultTimeout(15_000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    return page;
  };

  const desktop = await open({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
  await run(desktop, (step) => audit(desktop, `dark, ${step}`));
  console.log('pass  rules, approval from the keyboard, review with a comment, revision, server rule; axe clean');

  // Run again: the session rule answers the tests, so the run goes straight to the review.
  await desktop.getByRole('button', { name: 'Run again' }).click();
  await desktop.locator('[data-slot="signoff-diff-submit"]').waitFor({ timeout: 30_000 });
  if (await desktop.locator('[data-slot="signoff-approval-card"][data-status="pending"]').count())
    throw new Error('The second run asked about a call the session rule covers');
  console.log('pass  the next run took the session rule without asking');

  const phone = await open({ viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true });
  await run(phone, async (step) => {
    await noSidewaysScroll(phone, `390px, ${step}`);
    await audit(phone, `light, 390px, ${step}`);
  });
  console.log('pass  390px phone in light: no sideways scroll at any step; axe clean');

  if (work) {
    // Live mode on (a key and LIVE_MODE=1), and OPENAI_BASE_URL on a closed port, so even a live
    // request leaves nothing.
    const keyed = await serve(PORT + 1, {
      OPENAI_API_KEY: 'smoke-placeholder',
      LIVE_MODE: '1',
      OPENAI_MODEL: '',
      OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
    });
    try {
      const page = await open({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
      const modes = [];
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/agent')
          modes.push(JSON.parse(request.postData() ?? '{}').mode);
      });
      await page.goto(`http://localhost:${PORT + 1}`, { waitUntil: 'networkidle' });
      const agent = page.getByRole('group', { name: 'Agent' });
      for (const [name, pressed] of [
        ['Scripted', 'true'],
        ['gpt-5.4-mini', 'false'],
      ])
        if ((await agent.getByRole('button', { name, exact: true }).getAttribute('aria-pressed')) !== pressed)
          throw new Error(`With a key, the ${name} choice is not aria-pressed="${pressed}"`);
      await audit(page, 'dark, with a key, before the run');
      await page.getByRole('button', { name: 'Start the run' }).click();
      await page.locator('[data-slot="signoff-approval-card"][data-status="pending"]').waitFor({ timeout: 30_000 });
      if (modes.length === 0 || modes.some((mode) => mode !== 'scripted'))
        throw new Error(`With a key, the page sent ${JSON.stringify(modes)}, not only scripted runs`);
      console.log('pass  with a key on the server, the page starts on the scripted agent and sends scripted runs');
      await page.close();
    } finally {
      keyed.kill();
    }
  }

  if (errors.length > 0) throw new Error(`Page errors:\n  ${errors.join('\n  ')}`);
} finally {
  await browser?.close();
  server?.kill();
  if (work) rmSync(work, { recursive: true, force: true });
}
