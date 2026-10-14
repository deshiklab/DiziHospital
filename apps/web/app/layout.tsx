import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { ShellProvider } from '@/lib/shell';
import { ToastProvider } from '@dizi/ui';

export const metadata: Metadata = {
  title: 'DiziHospital',
  description: 'Hospital management, rebuilt: fast, offline-tolerant, accessible.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available: we never set maximumScale, and the app has its own zoom control besides.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-density="comfortable" data-sidebar="full">
      <body className="bg-surface-canvas text-text-primary antialiased">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-surface-raised focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <ShellProvider>
          <ToastProvider>
            <AppShell>
              <div id="content-root">{children}</div>
            </AppShell>
          </ToastProvider>
        </ShellProvider>
      </body>
    </html>
  );
}
