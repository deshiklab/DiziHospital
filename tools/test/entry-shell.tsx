/* Bundle entry for `npm run test:shell`.
 *
 * It mounts the *real* shell — ShellProvider, ToastProvider and AppShell — the way app/layout.tsx mounts it,
 * so the test exercises the shipping components and not a re-creation of them. Only `next/link` and
 * `next/navigation` are stubbed (see tools/test/mocks), because there is no Next router in jsdom.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { AppShell } from '@/components/AppShell';
import { ShellProvider } from '@/lib/shell';
import { ToastProvider } from '@dizi/ui';

export function mount(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <ShellProvider>
        <ToastProvider>
          <AppShell>
            <div id="content-root">mount check</div>
          </AppShell>
        </ToastProvider>
      </ShellProvider>,
    );
  });
  return root;
}

export { act };
