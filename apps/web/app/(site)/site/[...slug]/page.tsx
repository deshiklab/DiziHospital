'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Button, EmptyState } from '@dizi/ui';
import { FileWarning, Phone } from 'lucide-react';
import { SiteText } from '@/components/SiteBlocks';
import { useSiteLocale } from '@/components/SiteShell';
import { CMS_PAGES, pageBySlug, publishedPages, sectionFor } from '@/lib/cms';

/* One page of the public website.
 *
 * This is the whole of the site's page-serving: look the slug up among the published pages, draw its blocks with the
 * one renderer, and put the author's name and the revision at the bottom. Everything else the site needs — the menu,
 * the footer, the language switch — is the shell around it.
 *
 * Three cases have to be honest rather than tidy:
 *
 *  - **the page is a draft.** The public cannot see it, and the screen says a page is not published yet rather than
 *    showing a 404 that reads as “the hospital removed it”. That distinction matters to somebody holding a printed
 *    leaflet with this address on it;
 *  - **the page never existed.** Same treatment, with the menu offered: on a hospital site the visitor is usually
 *    looking for opening times, and the most useful thing is to get them to the right page;
 *  - **the page is retired.** The address answers with an explanation and a way onwards, which is what a retired
 *    page is for: a blank page is how a stranger decides the hospital has closed.
 */

export default function SitePage() {
  const params = useParams<{ slug: string[] }>();
  const { locale } = useSiteLocale();
  const t = (bn: string, en: string) => (locale === 'bn' ? bn : en);
  const slug = useMemo(() => (params?.slug ?? []).join('/'), [params]);

  const published = useMemo(() => publishedPages(), []);
  const page = pageBySlug(slug, published);
  const unpublished = !page ? CMS_PAGES.find((p) => p.slug === slug) : undefined;
  const section = page ? sectionFor(page.section) : undefined;

  if (!page) {
    return (
      <div className="rounded-lg border border-border-subtle bg-surface-default p-4">
        <EmptyState
          title={
            unpublished
              ? t('এই পাতাটি এখনো প্রকাশ করা হয়নি', 'This page has not been published yet')
              : t('এই ঠিকানায় কোনো পাতা নেই', 'There is no page at this address')
          }
          description={
            unpublished
              ? t(
                  `“${unpublished.titleBn}” লেখা হয়েছে কিন্তু প্রকাশ করা হয়নি, তাই জনসাধারণের জন্য এটি এখনো খোলা নয়। শীঘ্রই এখানে দেখা যাবে।`,
                  `“${unpublished.titleEn}” has been written but not published, so it is not open to the public yet. It will appear here when it is.`,
                )
              : t(
                  'ঠিকানাটি হয়তো বদলেছে, অথবা লিংকটিতে ভুল আছে। নিচের যেকোনো অংশে গিয়ে খুঁজে দেখতে পারেন, অথবা ডেস্কে ফোন করুন ০২ ৯৮৭৬ ৫৪০।',
                  'The address may have changed, or the link may have a typo in it. Use the menu above, or telephone the desk on 02 9876 540 — somebody will find it for you.',
                )
          }
          action={
            <span className="mt-2 flex flex-wrap justify-center gap-2">
              <Link href="/site">
                <Button variant="primary">{t('প্রথম পাতায় যান', 'Go to the front page')}</Button>
              </Link>
              <a href="tel:+88029876540">
                <Button variant="secondary">
                  <Phone className="size-4" aria-hidden /> 02 9876 540
                </Button>
              </a>
            </span>
          }
        />
      </div>
    );
  }

  return (
    <article className="space-y-4">
      <header className="border-b border-border-subtle pb-3">
        <p className="text-xs text-text-tertiary">
          <Link href="/site" className="underline">
            {t('প্রথম পাতা', 'Front page')}
          </Link>{' '}
          · <Link href={`/site/${section?.slug ?? ''}`} className="underline">{locale === 'bn' ? section?.labelBn : section?.label}</Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-text-primary">{locale === 'bn' ? page.titleBn : page.titleEn}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {t('লেখা: ', 'Written by ')}
          {page.author}
          {page.publishedAt ? ` · ${t('প্রকাশিত', 'published')} ${page.publishedAt}` : ''}
        </p>
      </header>

      <div className="rounded-lg border border-border-subtle bg-surface-default p-4">
        <SiteText text={locale === 'bn' ? page.bodyBn : page.bodyEn} locale={locale} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-3 py-2">
        <FileWarning className="size-4 shrink-0 text-text-tertiary" aria-hidden />
        <p className="text-xs text-text-secondary">
          {t(
            `এই পাতাটি শেষ পরিবর্তিত ${page.updatedAt}, সংশোধন r${page.revision}। কোনো কিছু বদলালে নতুন সংশোধন প্রকাশ করা হয় — পুরনোটি নথিতে থেকে যায়।`,
            `Last changed ${page.updatedAt}, revision r${page.revision}. When something changes, a new revision is published and the old one stays on the record.`,
          )}
        </p>
        <Link href="/portal/visits" className="ml-auto">
          <Button variant="secondary">{t('অ্যাপয়েন্টমেন্ট নিন', 'Book an appointment')}</Button>
        </Link>
      </div>

      <nav aria-label={t('এই অংশের পাতাগুলো', 'Pages in this section')} className="flex flex-wrap gap-2">
        {published
          .filter((p) => p.section === page.section && p.slug !== page.slug)
          .map((other) => (
            <Link key={other.slug} href={`/site/${other.slug}`} className="rounded-md border border-border-subtle px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-sunken">
              {locale === 'bn' ? other.titleBn : other.titleEn}
            </Link>
          ))}
      </nav>
    </article>
  );
}
