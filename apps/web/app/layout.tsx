import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@dizi/ui';

/* The document itself, and nothing that belongs to one audience.
 *
 * This file used to carry the staff shell, which was fine while the platform was only a staff application. P8 adds
 * two more front doors — the patient portal and the public website — and a layout cannot be opted out of in the App
 * Router, only nested into. So the shell moved down to `(staff)/layout.tsx`, the portal and the site got their own,
 * and what is left here is what all three genuinely share: the HTML document, the fonts, the tokens stylesheet and
 * the toast host. The route groups do not appear in any URL: `/patients` is still `/patients`.
 */
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
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
