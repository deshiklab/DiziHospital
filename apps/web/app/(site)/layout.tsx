import { SiteShell } from '@/components/SiteShell';

/* The public website — the hospital's front door for people who have never been inside it.
 *
 * Mounted beside the staff application and beside the portal rather than inside either, because the three have
 * nothing in common but the document: a visitor is not signed in, has no session, and is not at a desk. The route
 * group keeps the URL at `/site/...` — the group itself never appears in a path.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
