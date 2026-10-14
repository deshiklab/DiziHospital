import { notFound } from 'next/navigation';
import { ReportScreen } from '@/components/ReportScreen';
import { REPORT_TOPICS } from '@/lib/report-suite';

/* `/reports/<topic>` — one route, sixteen reports and the seventeenth to come.
 *
 * A server component on purpose: it lists the topics for prerendering, so every report is in the build output and
 * hydrates like any other screen, and it refuses anything invented. It refuses it *here* rather than with
 * `dynamicParams = false`, because that setting answers an unknown segment with the not-found page and an HTTP 200 —
 * a body that says 404 and a status that says fine, which a crawler or an uptime check reads as a working page. With
 * the params rendered on demand and `notFound()` called, the status and the body agree.
 *
 * The report itself is a client component, because the scope, the period and the grid's paging are the reader's.
 */

export function generateStaticParams() {
  return REPORT_TOPICS.map((topic) => ({ topic }));
}

export default async function ReportTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  /* An invented topic is a 404 with a 404 status, not a page that says “not found” politely. */
  if (!REPORT_TOPICS.includes(topic)) notFound();
  return <ReportScreen topic={topic} />;
}
