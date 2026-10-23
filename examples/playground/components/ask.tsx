'use client';

import { useRouter } from 'next/navigation';
import { AskDialog } from 'ondocs/react';
import 'ondocs/react/styles.css';
import { useSyncExternalStore } from 'react';
import { useIsApple } from '@/lib/platform';
import { SparkIcon } from './icons';

const SUGGESTIONS = [
  'How do I install signoff-ui?',
  'How does the agent get the review back?',
  'Can a person approve a tool for the whole session?',
  'Does it work without Tailwind?',
];

/** The site's theme, from the class on <html> (lib/theme.ts), which the dialog follows. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
const theme = () => (document.documentElement.classList.contains('light') ? 'light' : 'dark');

/**
 * The header's Ask button and ondocs's dialog behind it, opened by ⌘K or Ctrl+K too (the button
 * shows the one this keyboard has). Rendered only when the server has a model key (lib/ask.ts).
 * The dialog's code loads the first time it is wanted; citations open through the router.
 */
export function Ask({ className = '' }: { className?: string }) {
  const router = useRouter();
  const current = useSyncExternalStore(subscribe, theme, () => 'dark' as const);
  const apple = useIsApple();
  return (
    <AskDialog
      shortcut="k"
      theme={current}
      title="Ask the signoff-ui docs"
      suggestions={SUGGESTIONS}
      onNavigate={(url, event) => {
        const target = new URL(url, location.href);
        if (target.origin !== location.origin) return;
        event.preventDefault();
        router.push(`${target.pathname}${target.search}${target.hash}`);
      }}
      trigger={
        // Named by its words, "Ask" then "the docs" for screen readers, so the name starts with
        // what it shows (WCAG 2.5.3); the key cap is a hint, named by aria-keyshortcuts.
        <button
          type="button"
          data-ask-trigger
          aria-keyshortcuts={apple ? 'Meta+K' : 'Control+K'}
          className={`tap-target border-line text-fg-muted hover:border-line-strong hover:text-fg focus-visible:outline-cyan-soft relative inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 md:h-8 ${className}`}
        >
          <SparkIcon className="size-4" />
          <span className="max-md:sr-only">Ask</span>
          <span className="sr-only"> the docs</span>
          <kbd
            aria-hidden="true"
            className="border-line-strong text-fg-subtle rounded border px-1 font-mono text-[10.5px] max-md:hidden pointer-coarse:hidden"
          >
            {apple ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
      }
    />
  );
}
