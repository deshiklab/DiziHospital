import { PortalProviders, PortalShell } from '@/components/PortalShell';

/* The patient portal — the patient's own front door.
 *
 * No staff shell and no sidebar: it is mounted beside the staff application rather than inside it, because a layout
 * cannot be opted out of in the App Router. The document, the tokens and the toast host are shared; everything the
 * staff shell does — the rail, the sync pill, the command palette, the density controls — belongs to a desk, and a
 * patient on a phone is not at a desk.
 *
 * The portal keeps its own outbox rather than the desk's: a booking made on a bus is held on the phone with the
 * patient's own words around it, and the outbox checks every write against the same contract metadata the desk uses.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalProviders>
      <PortalShell>{children}</PortalShell>
    </PortalProviders>
  );
}
