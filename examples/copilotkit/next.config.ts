import type { NextConfig } from 'next';

const config: NextConfig = {
  // The create-next-app defaults since Next.js 16.4. With cacheComponents, CopilotKitProvider needs a
  // Suspense boundary (app/providers.tsx): it reads the clock while it renders.
  cacheComponents: true,
  partialPrefetching: true,
};

export default config;
