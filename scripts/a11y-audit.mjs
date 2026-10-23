// Runs axe-core in real Chrome against the playground: the home page's first screen as it loads and
// with its panel filled, the run's states (approval pending, diff review, done), the components page,
// the docs and a phone viewport, in the dark theme and then the light one.
// Unlike the jsdom tests, this checks color contrast with real layout. It also turns on axe's
// target-size rule (WCAG 2.5.8, 24px targets), which axe leaves off by default.
// Then what axe cannot see: in forced colours, focus rings, risk badges, the primary buttons, the
// diff's + and − and what is pressed still show; in a right-to-left page, code, commands, paths and
// rule patterns stay left to right; on a touch screen, text fields are 16px (iOS zooms into smaller
// ones) and no key caps show.
//
//   pnpm build:lib && pnpm registry:build && pnpm build:playground
//   pnpm a11y   # starts the built playground on :3230, or audits BASE_URL if set
//   BASE_URL=http://localhost:3100 pnpm a11y   # the one `pnpm dev` serves
//   BROWSER=webkit pnpm a11y   # or firefox (`pnpm exec playwright-core install webkit firefox`)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';

const BROWSER = process.env.BROWSER ?? 'chrome';
const launch = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
}[BROWSER];
if (!launch) throw new Error(`BROWSER is chrome, firefox or webkit, not ${BROWSER}`);

const PORT = 3230;
const BASE = process.env.BASE_URL ?? `http://localhost:${PORT}`;

let server;
if (!process.env.BASE_URL) {
  server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
    cwd: join(import.meta.dirname, '../examples/playground'),
    stdio: 'inherit',
    detached: true,
  });
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {
      if (attempt > 60) throw new Error(`The playground did not start on ${BASE}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
const require = createRequire(join(import.meta.dirname, '../packages/signoff-ui/package.json'));
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const browser = await launch();
let failures = 0;

async function audit(page, label) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      resultTypes: ['violations'],
      rules: { 'target-size': { enabled: true } },
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    }));
  });
  failures += violations.length;
  console.log(`${violations.length === 0 ? 'pass' : 'FAIL'}  ${label}`);
  for (const v of violations) console.log(`      ${v.id} (${v.impact}): ${v.nodes.slice(0, 3).join(', ')}`);
}

// The scripted run, which #run starts; the first screen has a pending card of its own.
const pending = '#run [data-slot="signoff-approval-card"][data-status="pending"]';
// Let enter animations settle so contrast is measured at full opacity.
const settle = (page) => page.waitForTimeout(800);

/** The first screen as it loads, then after a decision in the review and one on the card. */
async function firstScreen(page, label) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await settle(page);
  await audit(page, `${label} · first screen`);
  const frame = page.locator('[data-frame="signoff"]');
  await frame.locator('[data-slot="signoff-diff-hunk"]').last().focus();
  await page.keyboard.press('r');
  await frame.locator('[data-slot="signoff-approval-card"]').focus();
  await page.keyboard.press('n');
  await settle(page);
  await audit(page, `${label} · first screen, a hunk rejected and the command denied`);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
await firstScreen(page, 'home');
await page.goto(`${BASE}/?speed=4#run`, { waitUntil: 'networkidle' });
await page.waitForSelector(pending, { timeout: 60_000 });
await settle(page);
await audit(page, 'playground · approval pending');
// Go to the card, then approve.
await page.focus(pending);
await page.keyboard.press('y');
await page.waitForSelector('#run [data-slot="signoff-diff-submit"]', { timeout: 60_000 });
await settle(page);
await page.keyboard.press('a');
await page.keyboard.press('r');
await audit(page, 'playground · diff review');
await page.keyboard.press('Control+Enter');
await page.getByText('Run complete').waitFor({ timeout: 60_000 });
await settle(page);
await audit(page, 'playground · done');
await page.goto(`${BASE}/components`, { waitUntil: 'networkidle' });
await settle(page);
await audit(page, 'components page (dark, light and custom themes)');
for (const path of [
  '/docs',
  '/docs/getting-started',
  '/docs/chat-ui',
  '/docs/ag-ui',
  '/docs/acp',
  '/docs/accessibility',
  '/docs/labels',
  '/docs/limits',
  '/docs/comparison',
  '/docs/migrating-from-agent-ui-kit',
  '/docs/components/approval-card',
  '/docs/components/use-approval-policy',
  '/docs/components/diff-review',
  '/docs/components/use-diff-review',
  '/docs/components/run-meter',
  '/docs/components/use-ag-ui-agent',
  // No such page: the 404.
  '/docs/theming',
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await settle(page);
  await audit(page, `docs ${path}`);
}
// A review mid-way: lines selected in a hunk, a comment being written, a file marked viewed.
await page.goto(`${BASE}/docs/components/diff-review`, { waitUntil: 'networkidle' });
await page.locator('[data-slot="signoff-diff-hunk"]').nth(1).focus();
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('c');
await page.keyboard.type('Keep the existing error format.');
await page.locator('[data-slot="signoff-diff-file"] input[type="checkbox"]').last().check();
await settle(page);
await audit(page, 'docs /docs/components/diff-review · lines selected, a comment being written');
// Approval rules at work: a rule made, a call it answers, two at once, and arguments being edited.
await page.goto(`${BASE}/docs/components/use-approval-policy`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'two at once' }).click();
await page.locator('[data-slot="signoff-approval-batch"]').first().waitFor();
await settle(page);
await audit(page, 'docs /docs/components/use-approval-policy · two approvals waiting, with Approve all');
await page.getByRole('button', { name: 'Approve all' }).click();
await page.getByRole('button', { name: 'npm test', exact: true }).click();
await page.getByRole('button', { name: 'For this session', exact: true }).click();
await page.getByRole('button', { name: 'npm test -- --watch', exact: true }).click();
await page.locator('main [data-slot="signoff-approval-card"]', { hasText: 'Allowed by your rule' }).waitFor();
await settle(page);
await audit(page, 'docs /docs/components/use-approval-policy · a session rule, and a call it answered');
await page.goto(`${BASE}/docs/components/approval-card`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Edit arguments' }).first().click();
await settle(page);
await audit(page, 'docs /docs/components/approval-card · editing arguments');
await page.setViewportSize({ width: 390, height: 844 });
await firstScreen(page, '390px viewport');
await page.goto(`${BASE}/?speed=4#run`, { waitUntil: 'networkidle' });
await page.waitForSelector(pending, { timeout: 60_000 });
await settle(page);
await audit(page, 'playground · 390px viewport');
await page.goto(`${BASE}/docs/getting-started`, { waitUntil: 'networkidle' });
await settle(page);
await audit(page, 'docs /docs/getting-started · 390px viewport');
await page.goto(`${BASE}/docs/components/tool-call-timeline`, { waitUntil: 'networkidle' });
await settle(page);
await audit(page, 'docs /docs/components/tool-call-timeline · 390px viewport');
// A sub-agent open under the call that started it, its calls nested.
await page
  .locator('main')
  .getByRole('button', { name: /^Researcher/ })
  .first()
  .click();
await settle(page);
await audit(page, 'docs /docs/components/tool-call-timeline · a sub-agent open, 390px viewport');
// Under 30rem a review wraps its lines, so axe measures each one, the rejected hunk's too.
for (const path of ['/docs/components/diff-review', '/components']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await settle(page);
  await audit(page, `${path} · a rejected hunk, 390px viewport`);
}
// The limits page's tables, on a phone too.
await page.goto(`${BASE}/docs/limits`, { waitUntil: 'networkidle' });
await settle(page);
await audit(page, 'docs /docs/limits · 390px viewport');

// The light theme, with a light OS: the site follows it until the reader picks.
const light = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
await firstScreen(light, 'light · home');
await light.goto(`${BASE}/?speed=4#run`, { waitUntil: 'networkidle' });
await light.waitForSelector(pending, { timeout: 60_000 });
await settle(light);
await audit(light, 'light · playground · approval pending');
for (const path of ['/components', '/docs/getting-started', '/docs/components/diff-review']) {
  await light.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await settle(light);
  await audit(light, `light · ${path}`);
}
await light.setViewportSize({ width: 390, height: 844 });
await light.goto(`${BASE}/docs/components/approval-card`, { waitUntil: 'networkidle' });
await settle(light);
await audit(light, 'light · /docs/components/approval-card · 390px viewport');
for (const path of ['/docs/components/diff-review', '/components']) {
  await light.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await settle(light);
  await audit(light, `light · ${path} · a rejected hunk, 390px viewport`);
}

/** A check axe does not make: `problems` lists what is wrong, and an empty list passes. */
function check(label, problems) {
  failures += problems.length;
  console.log(`${problems.length === 0 ? 'pass' : 'FAIL'}  ${label}`);
  for (const problem of problems.slice(0, 5)) console.log(`      ${problem}`);
}

// Forced colours (Windows contrast themes) drop backgrounds and shadows: what showed through them
// must show through a border, an outline or the text instead.
const forced = await browser.newPage({ viewport: { width: 1440, height: 900 }, forcedColors: 'active' });
if (await forced.evaluate(() => matchMedia('(forced-colors: active)').matches)) {
  await forced.goto(`${BASE}/docs/components/approval-card`, { waitUntil: 'networkidle' });
  await settle(forced);
  check(
    'forced colours · risk badges and the primary buttons keep a border',
    await forced.evaluate(() =>
      [
        ...document.querySelectorAll('[data-slot="signoff-approval-risk"], [data-slot="signoff-approval-approve"]'),
      ].flatMap((el) => {
        const style = getComputedStyle(el);
        return style.borderTopStyle !== 'none' && Number.parseFloat(style.borderTopWidth) >= 1
          ? []
          : [`${el.dataset.slot} "${el.textContent}": border ${style.borderTopStyle} ${style.borderTopWidth}`];
      }),
    ),
  );
  // The first card, as focus lands on it after a decision, then from the keyboard through its
  // controls: each shows its focus ring.
  const ring = () =>
    forced.evaluate(() => {
      const el = document.activeElement;
      const style = getComputedStyle(el);
      return el.closest('[data-slot="signoff-approval-card"]') &&
        (style.outlineStyle === 'none' || Number.parseFloat(style.outlineWidth) < 1)
        ? `${el.dataset.slot ?? el.tagName} "${el.textContent.slice(0, 30)}": outline ${style.outlineStyle} ${style.outlineWidth}`
        : '';
    });
  await forced.locator('main [data-slot="signoff-approval-card"]').first().focus();
  const rings = [await ring()];
  for (let i = 0; i < 6; i++) {
    await forced.keyboard.press('Tab');
    rings.push(await ring());
  }
  check('forced colours · focus rings on an approval card', rings.filter(Boolean));
  await forced.goto(`${BASE}/docs/components/diff-review`, { waitUntil: 'networkidle' });
  await settle(forced);
  const hunk = forced.locator('main [data-slot="signoff-diff-hunk"]').first();
  await hunk.focus();
  await forced.keyboard.press('a');
  check(
    'forced colours · a review: the hunk focus ring, + and − on its lines, and what is pressed or on',
    await forced.evaluate(() => {
      const problems = [];
      const focused = document.activeElement;
      const ring = getComputedStyle(focused);
      if (ring.outlineStyle === 'none' || Number.parseFloat(ring.outlineWidth) < 1)
        problems.push(`focused hunk: outline ${ring.outlineStyle} ${ring.outlineWidth}`);
      const rows = [...document.querySelectorAll('main [data-line="add"], main [data-line="del"]')];
      if (rows.length === 0) problems.push('no added or removed lines');
      for (const row of rows) {
        const glyph = row.dataset.line === 'add' ? '+' : '−';
        const sign = [...row.children].find((el) => el.textContent === glyph);
        const style = sign && getComputedStyle(sign);
        if (!style || style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0')
          problems.push(`${row.dataset.line} line "${row.textContent.slice(0, 30)}": no ${glyph} that shows`);
      }
      // A pressed Accept has a thicker border than the Reject beside it; the layout picked is underlined.
      // A moves focus on to the next hunk: the accepted one is the one before.
      const accepted = document.querySelector('main [data-slot="signoff-diff-hunk"][data-decision="accepted"]');
      const accept = accepted?.querySelector('button[aria-pressed="true"]');
      const reject = accepted?.querySelector('button[aria-pressed="false"]');
      if (!accept || !reject) problems.push('no pressed Accept beside an unpressed Reject');
      else if (
        Number.parseFloat(getComputedStyle(accept).borderTopWidth) <=
        Number.parseFloat(getComputedStyle(reject).borderTopWidth)
      )
        problems.push('a pressed Accept looks like an unpressed one');
      const on = focused.closest('[data-slot="signoff-diff-review"]').querySelector('[role="radio"][data-state="on"]');
      if (!getComputedStyle(on).textDecorationLine.includes('underline'))
        problems.push(`layout "${on.textContent}": not underlined`);
      const submit = document.querySelector('main [data-slot="signoff-diff-submit"]');
      if (submit && getComputedStyle(submit).borderTopStyle === 'none') problems.push('Apply: no border');
      return problems;
    }),
  );
} else {
  console.log(`skip  forced colours: ${BROWSER} does not emulate them`);
}
await forced.close();

// A right-to-left page (an Arabic translation): code, commands, paths and patterns stay left to
// right, so bidi cannot reorder what runs or what is reviewed.
const rtl = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const path of [
  '/docs/components/approval-card',
  '/docs/components/diff-review',
  '/docs/components/use-approval-policy',
]) {
  await rtl.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await rtl.evaluate(() => {
    document.documentElement.dir = 'rtl';
  });
  if (path.endsWith('use-approval-policy')) {
    await rtl.getByRole('button', { name: 'npm test', exact: true }).click();
    await rtl.locator('main [data-slot="signoff-approval-card"] input[type="text"]').first().waitFor();
  }
  check(
    `dir=rtl · ${path}: code, commands, paths and rule patterns read left to right`,
    await rtl.evaluate(() => {
      const code = [
        '[data-slot="signoff-diff-hunk"] [data-line]',
        '[data-slot="signoff-approval-command"]',
        '[data-slot="signoff-approval-card"] [data-slot="signoff-json-view"] pre',
        '[data-slot="signoff-approval-card"] fieldset input[type="text"]',
      ].join(', ');
      const found = [...document.querySelectorAll(`main :is(${code})`)];
      const page = getComputedStyle(document.querySelector('main [data-signoff]')).direction;
      return [
        ...(found.length === 0 ? ['none found'] : []),
        ...(page === 'rtl' ? [] : [`the components are ${page}, not rtl`]),
        ...found.flatMap((el) => {
          const direction = getComputedStyle(el).direction;
          return direction === 'ltr'
            ? []
            : [`${el.dataset.slot ?? el.tagName} "${el.textContent.slice(0, 40)}": ${direction}`];
        }),
      ];
    }),
  );
}
await rtl.close();

// A touch screen: text fields are 16px or more, so iOS does not zoom into them, and there are no
// key caps (the docs search and Ask's included).
const touch = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: BROWSER !== 'firefox',
});
if (await touch.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
  const small = () =>
    touch.evaluate(() =>
      [...document.querySelectorAll('textarea, input:not([type="checkbox"]):not([type="radio"]), select')].flatMap(
        (el) => {
          const size = Number.parseFloat(getComputedStyle(el).fontSize);
          return size >= 16 ? [] : [`${el.tagName} ${el.id || el.getAttribute('aria-label') || ''}: ${size}px`];
        },
      ),
    );
  await touch.goto(`${BASE}/docs/components/approval-card`, { waitUntil: 'networkidle' });
  await touch.getByRole('button', { name: 'Edit arguments' }).first().click();
  await touch.getByRole('button', { name: 'Deny with feedback' }).first().click();
  const fields = await small();
  const caps = await touch.evaluate(() =>
    [...document.querySelectorAll('main [data-signoff] kbd')].flatMap((kbd) =>
      kbd.checkVisibility() ? [`kbd "${kbd.textContent}" shows`] : [],
    ),
  );
  check('touch · /docs/components/approval-card: fields at 16px, no key caps', [...fields, ...caps]);
  await touch.goto(`${BASE}/docs/components/diff-review`, { waitUntil: 'networkidle' });
  await touch.locator('main [data-slot="signoff-diff-hunk"] button[aria-keyshortcuts="C"]').first().click();
  await touch.locator('main [data-slot="signoff-diff-comment-editor"] textarea').waitFor();
  check('touch · /docs/components/diff-review: the comment and the docs search at 16px', await small());
} else {
  console.log(`skip  touch: ${BROWSER} does not emulate a coarse pointer`);
}
await touch.close();
await browser.close();
if (server) process.kill(-server.pid);

if (failures > 0) {
  console.error(`\n${failures} violation type(s) found.`);
  process.exit(1);
}
console.log('\nNo axe violations.');
