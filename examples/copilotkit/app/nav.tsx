'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGES = [
  { href: '/', label: 'In CopilotChat' },
  { href: '/agent-message', label: 'With AgentMessage' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="nav">
      <h1>signoff-ui in CopilotKit</h1>
      <nav aria-label="Examples">
        {PAGES.map((page) => (
          <Link key={page.href} href={page.href} aria-current={page.href === pathname ? 'page' : undefined}>
            {page.label}
          </Link>
        ))}
      </nav>
      <p>Try: run the tests · add rate limiting · deploy</p>
    </header>
  );
}
