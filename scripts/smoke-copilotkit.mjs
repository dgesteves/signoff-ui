// Runs examples/copilotkit in Chrome: signoff-ui's components in CopilotKit's render props, against
// the example's scripted AG-UI agent (no model, no key). In CopilotChat, the approval card on a
// human-in-the-loop tool, approved with Always, then the rule answering the next call without
// asking; DiffReview on another, its review sent back as the call's result; and the approval card
// on an AG-UI interrupt, through useInterrupt. With AgentMessage, useAgUiAgent on CopilotKit's
// agent: an approval resumes the run through copilotkit.runAgent, so the resumed run still has the
// page's frontend tool and calls it. Each answer starts one run. Fails on any page or console error.
//
//   pnpm build:lib && pnpm --filter copilotkit-example build
//   pnpm smoke:copilotkit   # starts the built example on a free port (or PORT), or tests BASE_URL if set
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const port =
  Number(process.env.PORT) ||
  (await new Promise((done) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const free = probe.address().port;
      probe.close(() => done(free));
    });
  }));
const BASE = process.env.BASE_URL ?? `http://localhost:${port}`;

let server;
if (!process.env.BASE_URL) {
  server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(port)], {
    cwd: join(import.meta.dirname, '../examples/copilotkit'),
    stdio: 'inherit',
    detached: true,
    // CopilotKit's runtime reports usage unless told not to.
    env: { ...process.env, COPILOTKIT_TELEMETRY_DISABLED: 'true', DO_NOT_TRACK: '1' },
  });
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {
      if (attempt > 60) throw new Error(`The example did not start on ${BASE}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  // Runs started: each POST to the runtime's /agent/<id>/run.
  let runs = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /^\/api\/copilotkit\/agent\/[^/]+\/run$/.test(new URL(request.url()).pathname))
      runs++;
  });
  /** What `action` did, in runs started, once `done` is on the page. */
  const counted = async (action, done) => {
    const before = runs;
    await action();
    await done.waitFor();
    // Room for a stray second run to show up.
    await page.waitForTimeout(500);
    return runs - before;
  };
  const expectRuns = (count, expected, what) => {
    if (count !== expected) throw new Error(`${what} started ${count} runs, not ${expected}`);
  };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  const chat = async (text) => {
    const box = page.getByRole('textbox', { name: 'Type a message...' });
    await box.fill(text);
    await box.press('Enter');
  };
  const cards = page.locator('[data-slot="signoff-approval-card"]');

  // A human-in-the-loop tool, answered on ToolApprovalCard with Always.
  await chat('Please run the tests');
  const card = cards.and(page.locator('[data-status="pending"]'));
  await card.waitFor();
  const shown = await card.innerText();
  if (!shown.includes('npm test')) throw new Error(`The card does not show the command:\n${shown}`);
  expectRuns(
    await counted(
      () => card.getByRole('button', { name: 'Always', exact: true }).click(),
      page.getByText('42 tests passed').first(),
    ),
    1,
    'Always',
  );
  await cards.first().and(page.locator('[data-status="approved"]')).waitFor();
  console.log('pass  human-in-the-loop tool: the card shows the command, Always answers it, the agent runs it');

  // The same call again: the rule answers it, and nobody is asked.
  expectRuns(
    await counted(() => chat('Run the tests again'), page.getByText('42 tests passed').nth(1)),
    2,
    'A call the rule answers (the run, then the answer)',
  );
  if (await cards.and(page.locator('[data-status="pending"]')).count())
    throw new Error('A card asks about a call the Always rule covers');
  const ruled = await cards.nth(1).innerText();
  if (!/rule/i.test(ruled)) throw new Error(`The second card does not say a rule decided it:\n${ruled}`);
  console.log('pass  the Always rule answered the next call without asking');

  // A review: DiffReview, and its result back to the agent.
  await chat('Add rate limiting to the chat route');
  const review = page.locator('[data-slot="signoff-diff-review"]');
  await review.waitFor();
  const files = await review.locator('[data-slot="signoff-diff-file"]').count();
  if (files !== 2) throw new Error(`The review shows ${files} files, not 2`);
  await review.getByRole('button', { name: 'Accept all' }).click();
  expectRuns(
    await counted(
      () => review.locator('[data-slot="signoff-diff-submit"]').click(),
      page.getByText('Your review: Applied 2 of 2 changes in 2 files.'),
    ),
    1,
    'Submitting the review',
  );
  if (await review.locator('[data-slot="signoff-diff-submit"]').count())
    throw new Error('The review still offers to apply once it was submitted');
  console.log('pass  DiffReview: the review went back as the call’s result, and stays read-only');

  // An AG-UI interrupt on a call the agent runs itself, answered through useInterrupt.
  await chat('Deploy to production');
  const interrupt = cards.filter({ hasText: 'Deploy to production?' });
  await interrupt.waitFor();
  if (!(await interrupt.innerText()).includes('production'))
    throw new Error('The interrupt card does not show the call’s arguments');
  expectRuns(
    await counted(
      () => interrupt.getByRole('button', { name: 'Approve', exact: true }).click(),
      page.getByText('Deployed to https://my-app.example.com.'),
    ),
    1,
    'Approving the interrupt',
  );
  console.log('pass  useInterrupt: the card shows the guarded call, and the approval resumes the run');

  // useAgUiAgent on CopilotKit's agent, rendered with AgentMessage.
  await page.goto(`${BASE}/agent-message`, { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: 'Message the agent' }).fill('Deploy to production');
  await page.getByRole('button', { name: 'Send' }).click();
  const pending = cards.and(page.locator('[data-status="pending"]'));
  await pending.waitFor();
  await page.locator('[data-slot="signoff-agent-status"][data-state="awaiting-approval"]').waitFor();
  // The resume goes through copilotkit.runAgent with the page's notify tool, which the agent calls;
  // CopilotKit runs it and starts the follow-up run.
  expectRuns(
    await counted(
      () => pending.getByRole('button', { name: 'Approve', exact: true }).click(),
      page.getByText('Deployed to https://my-app.example.com. Posted in #releases.'),
    ),
    2,
    'Approving on AgentMessage (the resume, then the follow-up after the frontend tool)',
  );
  await page.locator('[data-slot="signoff-agent-status"][data-state="done"]').waitFor();
  console.log('pass  useAgUiAgent with runAgent: the resumed run kept the frontend tool and called it');

  if (errors.length > 0) throw new Error(`Page errors:\n  ${errors.join('\n  ')}`);
} finally {
  await browser.close();
  if (server) {
    process.kill(-server.pid);
    await once(server, 'exit');
  }
}
