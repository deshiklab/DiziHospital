import { AppShell } from '@/components/AppShell';
import { ShellProvider } from '@/lib/shell';

/* The staff application: every screen that runs on a hospital desk, inside the rail/drawer shell.
 *
 * The skip link lives here rather than in the root layout because it targets `#content`, which is this shell's main
 * region. The portal and the site have their own main regions and their own skip links, and a skip link pointing at
 * an id that does not exist on the page is worse than no skip link at all.
 */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-surface-raised focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <AppShell>
        <div id="content-root">{children}</div>
      </AppShell>
    </ShellProvider>
  );
}
