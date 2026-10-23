'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { NavGroup, SearchIndex } from '@/lib/docs';
import { useIsApple } from '@/lib/platform';
import { Sheet } from '../controls';
import { MenuIcon } from '../icons';

/*
 * The docs navigation: a sticky sidebar on wide screens, a bar with a menu button on phones and
 * tablets. Both have the search box, over every page's title, sections and text, and every prop.
 * ⌘K or Ctrl+K focuses it; on a site with Ask, which takes ⌘K, / does instead. The index loads
 * the first time the search is used.
 */

let index: SearchIndex | undefined;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function loadIndex() {
  loading ??= fetch('/docs/search-index.json')
    .then((response) => (response.ok ? (response.json() as Promise<SearchIndex>) : []))
    .catch(() => [])
    .then((loaded) => {
      index = loaded;
      for (const listener of listeners) listener();
    });
}

function useSearchIndex() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => index,
    () => undefined,
  );
}

/** Lowercase words, with common endings dropped, so "theme" finds "Theming" and "approvals" "approval". */
function terms(text: string) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => (word.length > 4 ? word.replace(/(ing|es|s|e)$/, '') : word));
}

/** Every query term starts a word in the text. */
function hit(query: string[], text: string) {
  const words = terms(text);
  return query.every((q) => words.some((word) => word.startsWith(q)));
}

/** A line of the text around the first term, for a match in a section's body. */
function snippet(query: string[], text: string) {
  const escaped = query[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}`, 'iu').exec(text)?.index ?? 0;
  const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 40)));
  const end = text.indexOf(' ', Math.min(text.length, at + 90));
  return `${start > 0 ? '…' : ''}${text.slice(start, end === -1 ? undefined : end).trim()}${end === -1 ? '' : '…'}`;
}

interface Result {
  title: string;
  page?: string;
  href: string;
  snippet?: string;
}

/** Title matches first (pages, then sections), then sections whose text matches. */
function matches(query: string, index: SearchIndex) {
  const q = terms(query);
  if (q.length === 0) return [];
  const ranked: Array<Result & { rank: number }> = [];
  for (const page of index) {
    if (hit(q, `${page.title} ${page.description}`)) ranked.push({ title: page.title, href: page.href, rank: 0 });
    else if (hit(q, page.text))
      ranked.push({ title: page.title, href: page.href, snippet: snippet(q, page.text), rank: 2 });
    for (const section of page.sections) {
      if (hit(q, section.title)) ranked.push({ title: section.title, page: page.title, href: section.href, rank: 1 });
      else if (hit(q, `${section.title} ${section.text}`)) {
        ranked.push({
          title: section.title,
          page: page.title,
          href: section.href,
          snippet: snippet(q, section.text),
          rank: 2,
        });
      }
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, 40);
}

function NavLinks({
  nav,
  shortcut,
  onNavigate,
  autoFocusSearch = false,
}: {
  nav: NavGroup[];
  shortcut: string;
  onNavigate?: () => void;
  autoFocusSearch?: boolean;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const index = useSearchIndex();
  const results = index ? matches(query, index) : [];

  useEffect(() => {
    if (autoFocusSearch) inputRef.current?.focus();
  }, [autoFocusSearch]);

  const link = (active: boolean) =>
    `focus-visible:outline-cyan-soft relative flex items-center rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 ${
      active
        ? 'bg-raised font-medium text-fg-strong before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-cyan'
        : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
    }`;

  return (
    <div className="flex flex-col gap-6">
      <div role="search" className="relative">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search the docs
        </label>
        <input
          ref={inputRef}
          id={`${id}-search`}
          data-docs-search
          type="search"
          value={query}
          onFocus={loadIndex}
          onChange={(event) => {
            loadIndex();
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder="Search docs"
          autoComplete="off"
          className="border-line focus-visible:outline-cyan-soft bg-code text-fg placeholder:text-fg-subtle h-9 w-full rounded-lg border pr-16 pl-3 text-[13.5px] focus-visible:border-transparent focus-visible:outline-2 pointer-coarse:text-base [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd
          aria-hidden="true"
          className="border-line-strong text-fg-subtle pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border px-1.5 font-mono text-[10.5px] lg:block pointer-coarse:hidden"
        >
          {shortcut}
        </kbd>
      </div>

      {query.trim() ? (
        <div>
          <p className="sr-only" aria-live="polite">
            {index ? (results.length === 1 ? '1 result' : `${results.length} results`) : ''}
          </p>
          {!index ? (
            <p className="text-fg-subtle px-2.5 text-[13px]">Searching…</p>
          ) : results.length ? (
            <ul className="flex flex-col gap-0.5" aria-label="Search results">
              {results.map((result) => (
                <li key={result.href}>
                  <Link href={result.href} onClick={onNavigate} className={`${link(false)} flex-col items-start`}>
                    {result.page && <span className="text-fg-subtle font-mono text-[10.5px]">{result.page}</span>}
                    <span>{result.title}</span>
                    {result.snippet && (
                      <span className="text-fg-subtle mt-0.5 line-clamp-2 text-[12.5px] leading-snug">
                        {result.snippet}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fg-subtle px-2.5 text-[13px]">Nothing matches “{query.trim()}”.</p>
          )}
        </div>
      ) : (
        nav.map((group, g) => (
          <div key={group.title}>
            <p
              id={`${id}-group-${g}`}
              className="text-fg-subtle mb-1.5 px-2.5 font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase"
            >
              {group.title}
            </p>
            <ul className="flex flex-col gap-0.5" aria-labelledby={`${id}-group-${g}`}>
              {group.items.map((item) => {
                const active = item.href === pathname;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={link(active)}
                    >
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

/** Where a docs page puts its "On this page" menu in the bar below 1024px (components/docs/toc.tsx). */
export const TOC_SLOT_ID = 'docs-toc-slot';

export function DocsSidebar({
  nav,
  ask = false,
}: {
  nav: NavGroup[];
  /** The site has Ask, which takes ⌘K (components/ask.tsx); the search takes `/` instead. */
  ask?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = nav.flatMap((group) => group.items).find((item) => item.href === pathname);
  const apple = useIsApple();
  const shortcut = ask ? '/' : apple ? '⌘K' : 'Ctrl K';

  // ⌘K / Ctrl+K, or with Ask / outside a text field: the search box, in the sidebar or, on phones and
  // tablets, in the menu. Without Ask, no single key is bound (WCAG 2.1.4).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !ask;
      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      const slash = ask && event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !typing;
      if (!command && !slash) return;
      event.preventDefault();
      loadIndex();
      const input = [...document.querySelectorAll<HTMLInputElement>('[data-docs-search]')].find(
        (el) => el.offsetParent !== null,
      );
      if (input) input.focus();
      else setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ask]);

  return (
    <>
      {/* Phones and tablets: the current page and a menu button, then the page's sections, under the site header. */}
      <div className="border-line/80 bg-ink/95 sticky top-14 z-30 -mx-4 flex h-12 items-center gap-3 border-b px-4 backdrop-blur-md sm:-mx-6 sm:px-6 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-controls="docs-menu"
          className="focus-visible:outline-cyan-soft text-fg-muted hover:text-fg -ml-1.5 inline-flex h-9 min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-[13.5px] focus-visible:outline-2"
        >
          <MenuIcon className="size-4 shrink-0" />
          <span className="text-fg-subtle">Docs</span>
          {current && (
            <>
              <span aria-hidden="true" className="text-line-strong">
                /
              </span>
              <span className="text-fg truncate font-medium">{current.title}</span>
            </>
          )}
        </button>
        <div id={TOC_SLOT_ID} className="ml-auto shrink-0" />
      </div>
      <Sheet id="docs-menu" open={open} onClose={() => setOpen(false)} title="Docs">
        {open && <NavLinks nav={nav} shortcut={shortcut} onNavigate={() => setOpen(false)} />}
      </Sheet>

      {/* Wide screens: a sticky sidebar. */}
      <nav
        aria-label="Docs"
        className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] [scrollbar-width:thin] overflow-y-auto overscroll-contain py-8 pr-2 lg:block"
      >
        <NavLinks nav={nav} shortcut={shortcut} />
      </nav>
    </>
  );
}
