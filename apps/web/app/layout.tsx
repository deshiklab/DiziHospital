import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { ShellProvider } from '@/lib/shell';

export const metadata: Metadata = {
  title: 'DiziHospital',
  description: 'Hospital management, rebuilt: fast, offline-tolerant, accessible.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The counters and wards use tablets; zoom stays available, which is why we never set maximumScale.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-density="comfortable">
      <body className="bg-surface-canvas text-text-primary antialiased">
        <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-3 focus:py-2">
          Skip to content
        </a>
        <ShellProvider>
          <AppShell>
            <div id="content">{children}</div>
          </AppShell>
        </ShellProvider>
      </body>
    </html>
  );
}
