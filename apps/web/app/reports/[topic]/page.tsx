import { notFound } from 'next/navigation';
import { ReportScreen } from '@/components/ReportScreen';
import { REPORT_TOPICS } from '@/lib/report-suite';

/* `/reports/<topic>` — one route, sixteen reports and the seventeenth to come.
 *
 * A server component on purpose: it decides whether the topic exists at all (`notFound` for anything invented, and
 * `dynamicParams = false` so an unknown segment is a 404 rather than a half-rendered report), and it lists the
 * topics for prerendering so every report is present in the build output and hydrates like any other screen. The
 * report itself is a client component, because the scope, the period and the grid's paging are the reader's.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return REPORT_TOPICS.map((topic) => ({ topic }));
}

export default async function ReportTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  if (!REPORT_TOPICS.includes(topic)) notFound();
  return <ReportScreen topic={topic} />;
}
