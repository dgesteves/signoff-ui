import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getInterface } from './api';
import { componentAbout, componentHref, COMPONENTS } from './components';
import { SITE_URL } from './site';

/*
 * The docs: guides written in Markdown under content/docs, read when the site builds. The same
 * Markdown renders the page, is served at /docs/<slug>.md, and is what "Copy page" copies.
 */

export interface DocPage {
  /** The Markdown file under content/docs, without the extension. */
  slug: string;
  href: string;
  title: string;
  /** The sidebar's shorter name for it, when the title is long. */
  label?: string;
  description: string;
}

export interface NavGroup {
  title: string;
  /** `title` is the sidebar's label; `page` the page's own title, for previous and next. */
  items: Array<{ title: string; page: string; href: string }>;
}

export const GUIDES: DocPage[] = [
  {
    slug: 'introduction',
    href: '/docs',
    title: 'Introduction',
    description:
      'What signoff-ui is: reviewing what an agent changed and approving what it may do, with the result going back to the agent.',
  },
  {
    slug: 'getting-started',
    href: '/docs/getting-started',
    title: 'Getting started',
    description:
      'Install from npm or the shadcn registry, add the styles, and build a Next.js run with a diff review and an approval. AI SDK 6 or 7, React 18 or 19.',
  },
  {
    slug: 'chat-ui',
    href: '/docs/chat-ui',
    title: 'Inside your chat UI',
    label: 'Chat UIs',
    description:
      'Use the review and approval components in assistant-ui, AI Elements or your own chat, with the code for each.',
  },
  {
    slug: 'ag-ui',
    href: '/docs/ag-ui',
    title: 'AG-UI agents',
    label: 'AG-UI',
    description:
      'Render LangGraph, CrewAI, Mastra and other AG-UI agents with the same components, interrupts included, through useAgUiAgent.',
  },
  {
    slug: 'copilotkit',
    href: '/docs/copilotkit',
    title: 'CopilotKit',
    description:
      'The approval card, approval rules and DiffReview inside CopilotKit: its human-in-the-loop and interrupt hooks render them, with a runnable example.',
  },
  {
    slug: 'acp',
    href: '/docs/acp',
    title: 'Agent Client Protocol',
    label: 'ACP',
    description:
      'Render an ACP prompt turn with the same components: session updates as message parts, permission requests as approval cards, edits as diffs.',
  },
  {
    slug: 'accessibility',
    href: '/docs/accessibility',
    title: 'Accessibility',
    description:
      'Keyboard shortcuts scoped to focus, managed focus, announcements, contrast and how they are tested, with axe in jsdom and in Chrome.',
  },
  {
    slug: 'labels',
    href: '/docs/labels',
    title: 'Labels and translations',
    label: 'Labels',
    description:
      'Every word the components show or announce is a label: translate them all with one provider, or change a few, with a complete Portuguese example.',
  },
  {
    slug: 'limits',
    href: '/docs/limits',
    title: 'Performance and limits',
    label: 'Performance',
    description:
      'Bundle size per import, the stylesheet, known limitations with measured numbers, and what comes next.',
  },
  {
    slug: 'comparison',
    href: '/docs/comparison',
    title: 'signoff-ui vs assistant-ui, AI Elements and @pierre/diffs',
    label: 'Comparison',
    description:
      'How signoff-ui is different from assistant-ui, AI Elements and @pierre/diffs, what each does better, and how to use them together.',
  },
  {
    slug: 'migrating-from-agent-ui-kit',
    href: '/docs/migrating-from-agent-ui-kit',
    title: 'Migrating from @dgesteves/agent-ui-kit',
    label: 'Migration',
    description:
      'The package is now signoff-ui: swap it, rename the CSS variables, classes and attributes with one command, and what changed in styles.css.',
  },
];

const guides = (...slugs: string[]) =>
  slugs.map((slug) => {
    const doc = GUIDES.find((d) => d.slug === slug)!;
    return { title: doc.label ?? doc.title, page: doc.title, href: doc.href };
  });

/** The sidebar, in reading order: what to read first, the guides, each component, and the rest. */
export const NAV: NavGroup[] = [
  { title: 'Get started', items: guides('introduction', 'getting-started') },
  { title: 'Guides', items: guides('chat-ui', 'ag-ui', 'copilotkit', 'acp', 'labels', 'accessibility') },
  {
    title: 'Components',
    items: [
      { title: 'All components', page: 'All components', href: '/components' },
      ...COMPONENTS.map((c) => ({ title: c.name, page: c.name, href: componentHref(c.slug) })),
    ],
  },
  { title: 'Resources', items: guides('limits', 'comparison', 'migrating-from-agent-ui-kit') },
];

// Every guide is in the sidebar once.
const listed = NAV.flatMap((group) => group.items.map((item) => item.href));
for (const doc of GUIDES) {
  if (!listed.includes(doc.href)) throw new Error(`lib/docs.ts: ${doc.slug} is in no NAV group`);
}

/**
 * Every docs page in sidebar order, for previous and next. The components page has neither, and
 * neither has the migration guide: it is there for those who need it, not as a next step.
 */
const ORDER = NAV.flatMap((group) => group.items)
  .filter((item) => item.href.startsWith('/docs') && item.href !== '/docs/migrating-from-agent-ui-kit')
  .map((item) => ({ title: item.page, href: item.href }));

export function getGuide(slug: string) {
  return GUIDES.find((doc) => doc.slug === slug);
}

/** The pages before and after this one, in sidebar order. */
export function getPager(href: string) {
  const index = ORDER.findIndex((page) => page.href === href);
  return index === -1 ? {} : { prev: ORDER[index - 1], next: ORDER[index + 1] };
}

// `next build` and `next start` run in examples/playground.
export function readGuide(doc: DocPage) {
  return readFileSync(join(process.cwd(), 'content/docs', `${doc.slug}.md`), 'utf8');
}

export interface Heading {
  id: string;
  text: string;
  depth: 2 | 3;
}

/** Plain text of inline Markdown: code spans, links and emphasis unwrapped. */
export function plainText(markdown: string) {
  return markdown
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_)(.*?)\1/g, '$2')
    .trim();
}

/** The id a heading gets: lowercase words joined by hyphens, as GitHub does it. */
export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** `##` and `###` headings, outside code blocks, for the table of contents and search. */
export function getHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced) continue;
    const match = /^(##|###) (.+)$/.exec(line);
    if (!match) continue;
    const text = plainText(match[2]!);
    headings.push({ id: slugify(text), text, depth: match[1]!.length as 2 | 3 });
  }
  return headings;
}

/** The page as one Markdown document: title, summary and body, with absolute links. */
export function toMarkdown(doc: DocPage, markdown: string) {
  const body = markdown
    // Install blocks are ordinary shell commands outside the site.
    .replace(/^```package-install$/gm, '```bash')
    .replace(/\]\((\/[^)]*)\)/g, `](${SITE_URL}$1)`);
  return `# ${doc.title}\n\n> ${doc.description}\n\nSource: ${SITE_URL}${doc.href}\n\n${body.trim()}\n`;
}

/** Markdown as searchable text: no code blocks, markup, list markers or table rules. */
function textOf(markdown: string) {
  return markdown
    .replace(/^```[^\n]*\n[\s\S]*?^```$/gm, ' ')
    .split('\n')
    .filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line))
    .map((line) =>
      line
        .replace(/^\s*(?:[-*]|\d+\.|>(?: \[!\w+\])?)\s+/, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`|]|\*\*|<!--.*?-->/g, ' '),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SearchSection {
  title: string;
  href: string;
  /** What the section says, as plain text. */
  text: string;
}

/** The text before the first heading, then each `##` and `###` section with its own text. */
function sectionsOf(markdown: string, href: string) {
  const sections: SearchSection[] = [];
  let current: SearchSection & { lines: string[] } = { title: '', href, text: '', lines: [] };
  const close = () =>
    sections.push({ title: current.title, href: current.href, text: textOf(current.lines.join('\n')) });
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const match = fenced ? null : /^(##|###) (.+)$/.exec(line);
    if (!match) {
      current.lines.push(line);
      continue;
    }
    close();
    const title = plainText(match[2]!);
    current = { title, href: `${href}#${slugify(title)}`, text: '', lines: [] };
  }
  close();
  return { intro: sections[0]!.text, sections: sections.slice(1) };
}

/**
 * What the docs search looks through, served as /docs/search-index.json and loaded on first use:
 * each guide and its sections with their text, and each component with its "How it works"
 * sections and every prop, option and returned field, so "storage" finds useApprovalPolicy's option.
 */
export function getSearchIndex() {
  const guides = GUIDES.map((doc) => {
    const { intro, sections } = sectionsOf(readGuide(doc), doc.href);
    return { title: doc.title, description: doc.description, href: doc.href, text: intro, sections };
  });
  const components = COMPONENTS.map((c) => {
    const href = componentHref(c.slug);
    const about = componentAbout(c.slug);
    const how = about ? sectionsOf(about, href) : undefined;
    const api = c.api.flatMap((entry) =>
      [entry.props && { owner: entry.name, name: entry.props }, entry.parameters, entry.returns]
        .map((part) => (typeof part === 'string' ? { owner: part, name: part } : part))
        .filter((part) => !!part)
        .flatMap(({ owner, name }) =>
          getInterface(name).props.map((prop) => ({
            title: prop.name,
            href: `${href}#${`${owner}-${prop.name}`.toLowerCase()}`,
            text: prop.description,
          })),
        ),
    );
    return {
      title: c.name,
      description: c.summary,
      href,
      text: how?.intro ?? '',
      sections: [...(how?.sections ?? []), ...api],
    };
  });
  return [...guides, ...components];
}

export type SearchIndex = ReturnType<typeof getSearchIndex>;
