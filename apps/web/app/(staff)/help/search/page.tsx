import Link from 'next/link';
import { Panel } from '@dizi/ui';
import { searchHelp } from '@/lib/help';

/* Help search. Server-rendered so a result is a URL you can send to a colleague. */
export const dynamic = 'force-dynamic';

export default async function HelpSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const hits = q.trim().length >= 2 ? searchHelp(q) : [];

  const highlight = (text: string, needle: string) => {
    const i = text.toLowerCase().indexOf(needle.toLowerCase());
    if (i === -1) return text;
    return (
      <>
        {text.slice(0, i)}
        <mark className="rounded-sm bg-brand-100 px-0.5">{text.slice(i, i + needle.length)}</mark>
        {text.slice(i + needle.length)}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Breadcrumb" className="text-sm text-text-secondary">
        <Link href="/help" className="hover:text-brand-600">Help</Link> <span aria-hidden>/</span> <span className="text-text-primary">Search</span>
      </nav>

      <form action="/help/search" className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="q" className="text-sm text-text-secondary">Search the help library</label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            autoFocus
            className="h-10 w-full max-w-2xl rounded-md border border-border-default bg-surface-default px-3 text-base"
          />
        </div>
        <button type="submit" className="h-10 w-full rounded-md bg-brand-500 px-4 text-sm font-medium text-text-inverse hover:bg-brand-600 sm:w-auto">
          Search
        </button>
      </form>

      {q.trim().length < 2 ? (
        <Panel>
          <p className="text-sm text-text-secondary">Type at least two characters. Try “dispense”, “invoice”, “backup” or “appointment”.</p>
        </Panel>
      ) : (
        <Panel title={`${hits.length} result${hits.length === 1 ? '' : 's'} for “${q}”`}>
          {hits.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Nothing found in the reference library. The new interface is documented on the{' '}
              <Link href="/help" className="text-brand-600 hover:underline">help home page</Link>; for anything else, raise it
              with the clinical lead so it becomes a documented answer rather than tribal knowledge.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {hits.map((h) => (
                <li key={`${h.category}-${h.slug}`} className="rounded-md border border-border-subtle p-3">
                  <Link href={`/help/${h.category}/${h.slug}`} className="text-base font-medium text-brand-700 hover:underline">
                    {highlight(h.title, q)}
                  </Link>
                  <p className="font-numeric text-xs text-text-tertiary">{h.categoryTitle} · {h.slug}</p>
                  <p className="mt-1 text-sm text-text-secondary">…{highlight(h.snippet, q)}…</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
