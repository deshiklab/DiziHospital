import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Panel } from '@dizi/ui';
import { categoryTitle, listArticles, listCategories } from '@/lib/help';

/* Categories are read from the mirrored library on each request rather than frozen at build time: the library
 * is reference material that gets re-mirrored, and a stale category list is a broken help centre. */
export const dynamic = 'force-dynamic';

export default async function HelpCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const articles = listArticles(category);
  if (articles.length === 0) notFound();

  const description = listCategories().find((c) => c.slug === category)?.description;

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Breadcrumb" className="text-sm text-text-secondary">
        <Link href="/help" className="hover:text-brand-600">Help</Link> <span aria-hidden>/</span>{' '}
        <span className="text-text-primary">{categoryTitle(category)}</span>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold">{categoryTitle(category)}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-text-secondary">{description}</p>}
      </header>

      <Panel title={`${articles.length} articles`}>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {articles.map((a) => (
            <li key={`${a.category}-${a.slug}`} className="rounded-md border border-border-subtle p-3">
              <Link href={`/help/${a.category}/${a.slug}`} className="text-base font-medium text-brand-700 hover:underline">
                {a.title}
              </Link>
              {a.date && <p className="font-numeric mt-0.5 text-xs text-text-tertiary">{a.date}</p>}
            </li>
          ))}
        </ul>
      </Panel>

      <p className="text-xs text-text-tertiary">
        Reference material mirrored from the legacy product's published documentation. It describes the legacy
        screens, which may differ from the new interface.
      </p>
    </div>
  );
}
