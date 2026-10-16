'use client';

import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import { Suspense, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  // With cacheComponents (on in new Next.js 16.4 apps), `next build` fails without this boundary:
  // the provider reads the clock (Date.now()) while it renders, which a prerender may not.
  return (
    <Suspense fallback={null}>
      <CopilotKitProvider runtimeUrl="/api/copilotkit">{children}</CopilotKitProvider>
    </Suspense>
  );
}
