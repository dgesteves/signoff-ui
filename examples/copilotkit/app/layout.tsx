import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@copilotkit/react-core/v2/styles.css';
import 'signoff-ui/styles.css';
import './globals.css';
import { Nav } from './nav';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'signoff-ui · CopilotKit',
  description: 'signoff-ui’s approval card and diff review inside CopilotKit, against a scripted AG-UI agent.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="page">
            <Nav />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
