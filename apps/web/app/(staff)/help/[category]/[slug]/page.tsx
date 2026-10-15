import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, EmptyState, Panel, SafetyBanner, Tooltip } from '@dizi/ui';
import { categoryTitle, listArticles, readArticle } from '@/lib/help';

export const dynamic = 'force-dynamic';

export default async function HelpArticlePage({ params }: { params: Promise<{ category: string; slug: string }> }) {
  const { category, slug } = await params;
  const article = readArticle(category, slug);
  if (!article) notFound();

  const siblings = listArticles(category).filter((a) => a.slug !== slug).slice(0, 6);

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Breadcrumb" className="text-sm text-text-secondary">
        <Link href="/help" className="hover:text-brand-600">Help</Link> <span aria-hidden>/</span>{' '}
        <Link href={`/help/${category}`} className="hover:text-brand-600">{categoryTitle(category)}</Link>{' '}
        <span aria-hidden>/</span> <span className="text-text-primary">{article.title}</span>
      </nav>

      <SafetyBanner severity="info" title="This page documents the legacy product">
        It is mirrored reference material, kept because the module it describes may still be in use in your branch.
        Check the ownership matrix to see whether this module has moved to the new platform yet.
      </SafetyBanner>

      <article className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel>
          <header className="mb-3 border-b border-border-subtle pb-2">
            <h1 className="text-2xl font-semibold">{article.title}</h1>
            <p className="font-numeric mt-1 text-xs text-text-tertiary">
              {categoryTitle(category)}
              {article.date ? ` · ${article.date}` : ''}
              {article.sourceUrl ? ' · mirrored from the published documentation of the legacy product' : ''}
            </p>
          </header>

          {article.body.trim() ? (
          <div className="prose-dizi max-w-none text-base leading-relaxed text-text-primary">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                /* `node` is react-markdown's own AST handle — it must never reach the DOM. */
                h1: ({ node: _n, ...p }) => <h2 className="mt-5 mb-2 text-lg font-semibold" {...p} />,
                h2: ({ node: _n, ...p }) => <h2 className="mt-5 mb-2 text-lg font-semibold" {...p} />,
                h3: ({ node: _n, ...p }) => <h3 className="mt-4 mb-1.5 text-base font-semibold" {...p} />,
                p: ({ node: _n, ...p }) => <p className="my-2 text-base text-text-primary" {...p} />,
                ul: ({ node: _n, ...p }) => <ul className="my-2 list-disc pl-6 text-base" {...p} />,
                ol: ({ node: _n, ...p }) => <ol className="my-2 list-decimal pl-6 text-base" {...p} />,
                li: ({ node: _n, ...p }) => <li className="my-0.5" {...p} />,
                a: ({ node: _n, href, ...p }) => (
                  <a
                    {...p}
                    href={href}
                    className="text-brand-600 underline decoration-brand-300 hover:decoration-brand-600"
                    {...(href?.startsWith('http') ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                  />
                ),
                img: ({ node: _n, src, alt }) => (
                  // Images are served from the mirrored library by the asset route, so a screenshot can never
                  // 404 silently: the frame keeps its space while the file loads.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={typeof src === 'string' ? src : undefined}
                    alt={alt ?? ''}
                    loading="lazy"
                    className="my-3 w-full rounded-md border border-border-subtle bg-surface-sunken"
                  />
                ),
                table: ({ node: _n, ...p }) => (
                  <div className="my-3 overflow-x-auto">
                    <table className="w-full border-collapse text-sm" {...p} />
                  </div>
                ),
                th: ({ node: _n, ...p }) => <th className="border border-border-subtle bg-surface-sunken px-2 py-1 text-left" {...p} />,
                td: ({ node: _n, ...p }) => <td className="border border-border-subtle px-2 py-1 align-top" {...p} />,
                code: ({ node: _n, ...p }) => <code className="rounded-sm bg-surface-sunken px-1 font-numeric text-sm" {...p} />,
                blockquote: ({ node: _n, ...p }) => (
                  <blockquote className="my-2 border-l-4 border-border-default pl-3 text-text-secondary" {...p} />
                ),
              }}
            >
              {article.body}
            </ReactMarkdown>
          </div>
          ) : (
            /* 14 of the mirrored articles are title-only stubs in the library itself. Saying so is better than
               showing a blank panel that looks like a rendering fault. */
            <EmptyState
              title="This article has no text in the library"
              description={`The library holds the title “${article.title}” with an empty body — the page carried nothing but its own banner when it was mirrored. Nothing was lost on the way in: the mirrored file is ${categoryTitle(category)}/${slug}.md. If the answer to this question is still needed, it belongs on the help home page instead.`}
            />
          )}

          <footer className="mt-5 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3 no-print">
            <span className="text-sm text-text-secondary">Was this helpful?</span>
            <Button size="sm">Yes</Button>
            <Button size="sm">No</Button>
            <Tooltip content="Report an outdated or wrong article — it goes to the clinical lead, who owns the help library.">
              <Button size="sm" variant="ghost">Report a problem</Button>
            </Tooltip>
            {article.sourceUrl && (
              /* Attribution: the mirrored text, screenshots and title belong to whoever published the article.
                 The URL is read from the mirror at runtime, never hard-coded here. */
              <span className="text-xs text-text-tertiary">
                Source:{' '}
                <a href={article.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline hover:text-brand-600">
                  original article
                </a>{' '}
                · mirrored {article.date ?? 'earlier'} · content © the original publisher
              </span>
            )}
          </footer>
        </Panel>

        <aside className="flex flex-col gap-3 no-print">
          <Panel title="In this category">
            <ul className="flex flex-col gap-1 text-sm">
              {siblings.map((s) => (
                <li key={s.slug}>
                  <Link href={`/help/${s.category}/${s.slug}`} className="text-brand-600 hover:underline">{s.title}</Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Using the new platform">
            <ul className="flex flex-col gap-1 text-sm">
              <li><Link href="/help#offline" className="text-brand-600 hover:underline">Working when the internet is down</Link></li>
              <li><Link href="/help#ownership" className="text-brand-600 hover:underline">Which system owns which module</Link></li>
              <li><Link href="/help#print" className="text-brand-600 hover:underline">Printing slips, labels and receipts</Link></li>
            </ul>
          </Panel>
        </aside>
      </article>
    </div>
  );
}
