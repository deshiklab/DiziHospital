'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { Eye, FileText, Globe2, Languages, ShieldCheck } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { SiteBlocks } from '@/components/SiteBlocks';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  CMS_PAGES,
  CMS_WAITING,
  MARKERS,
  PAGE_EVENTS,
  PUBLISH_RULES,
  SECTIONS,
  checkPage,
  cmsStats,
  parseBody,
  sectionFor,
  serialiseBody,
  siteFacts,
  type CmsPage,
  type PageState,
  type SiteSection,
} from '@/lib/cms';

/* Front CMS (P8) — the public website as records rather than a folder of files somewhere.
 *
 * The screen exists to make three things true at once:
 *
 *  - **Writing is not publishing.** An editor can spend a week on a page, in either language, on this node, and
 *    nothing the public sees changes. Publication is a separate, deliberate act, and the contract makes it
 *    online-only because the website is one site served from the cloud.
 *  - **Bangla is not a translation bolted on afterwards.** Both languages are on the same sheet, side by side, with
 *    the Bangla written first. The check refuses a page that has one and not the other: the menu on the public site
 *    has a switch, and a page that falls back to English makes the switch a lie.
 *  - **The page is content, not markup.** Four markers — `## `, `- `, `key: value`, `> ` — and a paragraph. The
 *    preview below the box uses the same parser the public site uses, which is the only way a preview can be
 *    trusted: if it were drawn by different code it would be a drawing of the page rather than the page.
 *
 * The facts that people actually telephone for — opening hours, the emergency number, the address — are not typed
 * into a page at all. They come from the branch facts, and the site renders them from there, so the website and the
 * front desk cannot disagree about when the door opens.
 */

const STATE_TONE: Record<PageState, string> = {
  published: 'text-safety-success',
  draft: 'text-safety-warning',
  retired: 'text-text-tertiary',
};

const editors = ['R. Howlader', 'M. Hoque', 'S. Nahar', 'J. Alam'];

export default function FrontCmsPage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [pages, setPages] = useState<CmsPage[]>(CMS_PAGES);
  const [view, setView] = useState('Everything');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<CmsPage | null>(null);
  // Which page of the register this is, so the slug check can tell an edit from a second page at one address.
  const [filedAs, setFiledAs] = useState<string | null>(null);
  const [showBn, setShowBn] = useState(true);
  const [events, setEvents] = useState(PAGE_EVENTS);

  const stats = useMemo(() => cmsStats(pages, day), [pages, day]);
  const verdict = useMemo(() => (draft ? checkPage(draft, { today: day, pages, editing: filedAs }) : null), [draft, day, pages]);
  const facts = siteFacts();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pages
      .filter((p) => (view === 'Published' ? p.state === 'published' : view === 'Drafts' ? p.state === 'draft' : view === 'Needs a Bangla version' ? !p.bodyBn.trim() : view === 'Not touched this year' ? p.state === 'published' && p.updatedAt < '2025-10-16' : true))
      .filter((p) => !q || p.titleEn.toLowerCase().includes(q) || p.titleBn.includes(q) || p.slug.includes(q) || p.author.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [pages, view, query]);

  const save = (publish: boolean) => {
    if (!draft) return;
    if (publish && !verdict?.ok) {
      push({ title: `The page was not published — ${verdict?.reasons[0].code}`, description: verdict?.reasons[0].message ?? 'The checks refused it.', tone: 'critical' });
      return;
    }
    const next: CmsPage = {
      ...draft,
      state: publish ? 'published' : draft.state === 'published' ? 'published' : 'draft',
      author: 'R. Howlader',
      updatedAt: day,
      revision: publish ? draft.revision + 1 : draft.revision,
      ...(publish ? { publishedAt: `${day} 09:40` } : {}),
    };
    setPages((list) => (list.some((p) => p.slug === draft.slug && p.section === draft.section) ? list.map((p) => (p.slug === draft.slug && p.section === draft.section ? next : p)) : [...list, next]));
    setEvents((list) => [{ at: `${day} 09:40`, what: publish ? 'published' : 'edited', by: 'R. Howlader', note: publish ? `Published revision ${next.revision}.` : 'Saved as a draft revision; nothing the public sees has changed.' }, ...list]);
    const wrote = queueWrite(`${publish ? 'Publish' : 'Save'} “${next.titleEn}”`, {
      id: publish ? 'publishCmsPage' : 'updateCmsPage',
      recordId: next.slug || 'home',
      fields: { slug: next.slug || 'home', state: next.state, revision: next.revision, languages: next.bodyBn.trim() ? 'bn+en' : 'en' },
    });
    push({
      title: publish ? `“${next.titleEn}” published` : `“${next.titleEn}” saved as a draft`,
      description: publish
        ? `Revision ${next.revision} is what the public will see, and the page keeps the one before it, so unpublishing puts back exactly what was there. ${
            wrote.queued ? 'The cache turns over within a couple of minutes.' : `Refused here: ${wrote.because}`
          }`
        : `Only this node and the content team see it. ${verdict?.warnings.length ? `Noted: ${verdict.warnings.map((w) => w.message).join(' ')} ` : ''}${wrote.queued ? '' : `Not queued: ${wrote.because}`}`,
      tone: wrote.queued ? (publish ? 'success' : 'info') : 'warning',
    });
    setDraft(null);
  };

  const retire = (page: CmsPage) => {
    const wrote = queueWrite(`Retire “${page.titleEn}”`, { id: 'publishCmsPage', recordId: page.slug || 'home', fields: { slug: page.slug || 'home', state: 'retired', revision: page.revision } });
    setPages((list) => list.map((p) => (p.slug === page.slug && p.section === page.section ? { ...p, state: 'retired' as PageState } : p)));
    push({
      title: `“${page.titleEn}” retired`,
      description: `The address answers with a short explanation and a way to the right page rather than going blank — a blank page is how a stranger decides the hospital closed. ${
        wrote.queued ? 'The revision that was live stays on the record with the time it was live.' : `Refused here: ${wrote.because}`
      }`,
      tone: wrote.queued ? 'warning' : 'critical',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="front-cms"
        subtitle={`${day} · ${stats.pages} pages · ${stats.published} published · ${stats.drafts} draft${stats.drafts === 1 ? '' : 's'} · ${stats.words.toLocaleString()} words in two languages · last edit ${stats.lastEdit} by one of ${stats.editors} editors.`}
        actions={
          <>
            <Link href="/site">
              <Button variant="ghost">
                <Eye className="size-4" aria-hidden /> See the site
              </Button>
            </Link>
            <Button
              variant="primary"
              onClick={() =>
                (setFiledAs(null),
                setDraft({
                  slug: 'news/',
                  section: 'news',
                  titleEn: '',
                  titleBn: '',
                  bodyEn: '',
                  bodyBn: '',
                  state: 'draft',
                  author: 'R. Howlader',
                  updatedAt: day,
                  revision: 0,
                }))
              }
            >
              <FileText className="size-4" aria-hidden /> New page
            </Button>
          </>
        }
        waiting={
          stats.missingBangla
            ? `${stats.missingBangla} page(s) have no Bangla text. The public site is Bangla-first, and a page that falls back to English makes the language switch a lie — the checks refuse it at publication, and this list is where it is caught while the editor is still around.`
            : undefined
        }
      />

      <AdminSiblings screenId="front-cms" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Pages" value={String(stats.pages)} definition="Everything the CMS holds, in both languages. A page is a record with a revision, not a file: the version the public is reading is known by name and time." asOf={day} />
        <KpiTile label="Published" value={String(stats.published)} definition="What the public can reach. Publication is online-only in the contract: the site is served from the cloud, so a page published on this node only is a page the public cannot see." asOf={day} />
        <KpiTile label="Drafts" value={String(stats.drafts)} definition="Written and not published. Writing is deliberately not publishing — an editor can spend a week on a page and nothing changes for anybody until somebody decides it is ready." asOf={day} footnote={stats.drafts ? 'visible only to the content team' : undefined} />
        <KpiTile label="No Bangla version" value={String(stats.missingBangla)} definition="Pages with English and no Bangla. The site is Bangla-first: somebody looking for the outdoor clinic times in Dhaka reads Bangla, and the check refuses a one-language page at publication." asOf={day} footnote={stats.missingBangla ? 'refused at publication' : undefined} />
        <KpiTile label="Older than a year" value={String(stats.stale)} definition="Published pages nobody has touched in twelve months. On a hospital site the stale page is usually the one with an old telephone number or an old price, and it is the page strangers arrive on." asOf={day} footnote={stats.stale ? 'read them once' : undefined} />
        <KpiTile label="Words, both languages" value={stats.words.toLocaleString()} definition="Everything written, both languages counted. A hospital site that gets shorter usually gets better: the paragraph somebody deleted is the one that was never true." asOf={day} />
      </div>

      <Panel
        title="The page list"
        actions={
          <Segmented
            label="Which pages"
            name="cms-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'Everything', label: `Everything (${stats.pages})` },
              { value: 'Published', label: `Published (${stats.published})` },
              { value: 'Drafts', label: `Drafts (${stats.drafts})` },
              { value: 'Needs a Bangla version', label: `No Bangla (${stats.missingBangla})` },
              { value: 'Not touched this year', label: `Older (${stats.stale})` },
            ]}
          />
        }
      >
        <ListView
          id="cms-pages"
          caption="Website pages"
          rows={rows}
          rowId={(row) => `${row.section}:${row.slug}`}
          onRowClick={(row) => (setDraft({ ...row }), setFiledAs(row.slug))}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Title, path or author' }}
          rowActions={(row) => [
            { label: 'Edit the page', onSelect: () => (setDraft({ ...row }), setFiledAs(row.slug)) },
            ...(row.state === 'published' ? [{ label: 'Retire the page', onSelect: () => retire(row) }] : []),
            { label: 'See it on the site', onSelect: () => push({ title: row.slug === '' ? 'The front page — /site' : `/${row.slug}`, description: `The site renders these records, so what you are reading on the screen is what a visitor reads. Revision ${row.revision}, live since ${row.publishedAt ?? 'never'}.`, tone: 'info' }) },
          ]}
          columns={[
            {
              key: 'title',
              header: 'Page',
              render: (row) => (
                <span className="block">
                  <span className="block font-medium">{row.titleEn}</span>
                  <span lang="bn" className="block text-sm text-text-secondary">{row.titleBn}</span>
                  <span className="font-numeric block text-xs text-text-tertiary">{row.slug === '' ? '/site (front page)' : `/${row.slug}`}</span>
                </span>
              ),
            },
            { key: 'section', header: 'Section', width: '11rem', render: (row) => <span className="block"><span className="block">{sectionFor(row.section).label}</span><span className="block text-xs text-text-tertiary">{sectionFor(row.section).audience === 'patients' ? 'patients read it' : sectionFor(row.section).audience === 'both' ? 'patients and staff' : 'staff'}</span></span> },
            { key: 'state', header: 'State', width: '8rem', render: (row) => <span className={cx('font-medium', STATE_TONE[row.state])}>{row.state}</span> },
            { key: 'revision', header: 'Live revision', width: '8rem', hideBelow: 'lg', render: (row) => <span className="font-numeric">{row.revision === 0 ? '—' : `r${row.revision}`}</span> },
            { key: 'author', header: 'Written by', width: '11rem', hideBelow: 'lg', render: (row) => <span className="block"><span className="block">{row.author}</span><span className="font-numeric block text-xs text-text-tertiary">{row.updatedAt}</span></span> },
            { key: 'live', header: 'Live since', width: '13rem', hideBelow: 'xl', render: (row) => (row.publishedAt ? <span className="font-numeric">{row.publishedAt}</span> : <span className="text-text-tertiary">never</span>) },
            { key: 'languages', header: 'Languages', width: '9rem', hideBelow: 'xl', render: (row) => <span className={cx('text-xs', row.bodyBn.trim() ? 'text-text-secondary' : 'text-safety-warning')}>{row.bodyBn.trim() ? (row.bodyEn.trim() ? 'Bangla + English' : 'Bangla only') : 'English only'}</span> },
          ]}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="What publishing does, and in what order" actions={<span className="flex items-center gap-1 text-xs text-text-secondary"><Globe2 className="size-3.5" aria-hidden /> one site, one place</span>}>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-text-secondary">
            {PUBLISH_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ol>
        </Panel>

        <Panel title="The facts a page never types by hand" actions={<span className="text-xs text-text-secondary">rendered from the branch record</span>}>
          <p className="text-xs text-text-secondary">
            Opening hours, telephone numbers and the address are the three things a hospital website is actually asked for. They are rendered from the same record the
            front desk works from, so a page cannot advertise an opening time the door does not keep.
          </p>
          <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.key} className="rounded-md border border-border-subtle px-2 py-1">
                <dt className="text-text-tertiary">
                  {fact.key} · <span lang="bn">{fact.keyBn}</span>
                </dt>
                <dd className="text-text-primary">
                  {fact.value} · <span lang="bn">{fact.valueBn}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <Panel title="The four markers, and why a page is not a word processor" actions={<span className="flex items-center gap-1 text-xs text-text-secondary"><Languages className="size-3.5" aria-hidden /> both languages, one grammar</span>}>
        <ul className="space-y-1 text-xs text-text-secondary">
          {MARKERS.map((marker) => (
            <li key={marker.marker}>
              <span className="font-numeric rounded bg-surface-sunken px-1 text-text-primary">{marker.marker}</span> — {marker.because}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-tertiary">
          Nothing is pasted in from a word processor. That is how a hospital site ends up with six fonts, a table that only lines up on the machine it was written
          on, and a telephone number inside an image that nobody can read aloud.
        </p>
      </Panel>

      <Panel title="What this screen is waiting for">
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
          {CMS_WAITING.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Panel>

      {/* ------------------------------------------------------------------------ the editor */}
      <Sheet
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft ? draft.titleEn || 'New page' : 'Page'}
        description={draft ? `${sectionFor(draft.section).label} · ${draft.slug === '' ? 'the front page' : `/${draft.slug}`} · ${draft.state}${draft.revision ? ` · live revision r${draft.revision}` : ''}` : undefined}
        width="xl"
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {verdict?.ok ? 'The checks pass: both languages, a usable address, no placeholder text, and nothing to fix before it goes out.' : `${verdict?.reasons.length ?? 0} thing(s) to fix before this can be published.`}
            </span>
            <Button variant="ghost" onClick={() => save(false)} disabled={!draft}>
              Save as a draft
            </Button>
            <Button variant="primary" onClick={() => save(true)} disabled={!verdict?.ok}>
              <ShieldCheck className="size-4" aria-hidden /> Publish revision {(draft?.revision ?? 0) + 1}
            </Button>
          </>
        }
      >
        {draft && verdict && (
          <div className="space-y-3">
            {!verdict.ok && (
              <SafetyBanner severity="critical" title={`This page cannot be published as it stands — ${verdict.reasons[0].code}`}>
                <ul className="list-disc space-y-1 pl-5">
                  {verdict.reasons.map((r) => (
                    <li key={r.code}>{r.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}
            {verdict.warnings.length > 0 && (
              <SafetyBanner severity="info" title="Worth knowing">
                <ul className="list-disc space-y-1 pl-5">
                  {verdict.warnings.map((w) => (
                    <li key={w.code}>{w.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}

            <FieldSection title="The page" description="Title, address and where it sits in the menu.">
              <TextField label="Title — English" name="titleEn" value={draft.titleEn} onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })} required />
              <TextField label="Title — Bangla" name="titleBn" value={draft.titleBn} onChange={(e) => setDraft({ ...draft, titleBn: e.target.value })} lang="bn" required />
              <TextField label="Address" name="slug" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} hint={`Lower-case words with dashes. A page under “${sectionFor(draft.section).label}” belongs under /${sectionFor(draft.section).slug}/…`} />
              <SelectField
                label="Section"
                name="section"
                value={draft.section}
                onChange={(e) => setDraft({ ...draft, section: e.target.value as SiteSection })}
                options={SECTIONS.map((s) => ({ value: s.section, label: `${s.label} · ${s.labelBn}` }))}
                hint={sectionFor(draft.section).purpose}
              />
              <SelectField
                label="Written by"
                name="author"
                value={draft.author}
                onChange={(e) => setDraft({ ...draft, author: e.target.value })}
                options={editors.map((name) => ({ value: name, label: name }))}
                hint="The name goes on the published page: it is the answer to “who do I ask about this?”"
              />
              <SelectField
                label="State"
                name="state"
                value={draft.state}
                onChange={(e) => setDraft({ ...draft, state: e.target.value as PageState })}
                options={[
                  { value: 'draft', label: 'Draft — the content team only' },
                  { value: 'published', label: 'Published — the public' },
                  { value: 'retired', label: 'Retired — address answers with an explanation' },
                ]}
              />
            </FieldSection>

            <div className="flex items-center gap-2">
              <Segmented
                label="Which language to write"
                name="cms-lang"
                value={showBn ? 'Bangla' : 'English'}
                onChange={(v) => setShowBn(v === 'Bangla')}
                options={[
                  { value: 'Bangla', label: 'Bangla first' },
                  { value: 'English', label: 'English' },
                ]}
              />
              <span className="text-xs text-text-tertiary">Both are edited on this sheet. The Bangla is written first, because it is what a patient in Dhaka actually reads.</span>
            </div>

            <FieldSection title={showBn ? 'The page — Bangla' : 'The page — English'} description="One marker per line: ## heading, - list item, “key: value” facts, > dated notice, and a blank line between paragraphs.">
              {showBn ? (
                <div className="md:col-span-2 xl:col-span-3">
                  <TextAreaField label="Bangla text" name="bodyBn" value={draft.bodyBn} onChange={(e) => setDraft({ ...draft, bodyBn: e.target.value })} rows={14} lang="bn" />
                </div>
              ) : (
                <div className="md:col-span-2 xl:col-span-3">
                  <TextAreaField label="English text" name="bodyEn" value={draft.bodyEn} onChange={(e) => setDraft({ ...draft, bodyEn: e.target.value })} rows={14} />
                </div>
              )}
            </FieldSection>

            <Panel title="Preview" actions={<span className="text-xs text-text-secondary">drawn by the parser the site uses</span>}>
              <div className="space-y-2">
                <SiteBlocks blocks={parseBody(showBn ? draft.bodyBn : draft.bodyEn, showBn ? 'bn' : 'en')} locale={showBn ? 'bn' : 'en'} />
                {parseBody(showBn ? draft.bodyBn : draft.bodyEn, showBn ? 'bn' : 'en').length === 0 && (
                  <p className="text-sm text-text-tertiary">
                    Nothing to preview yet. The first line you write appears here exactly as the site will draw it — which is the point of the box: a preview drawn by
                    different code is a drawing of the page, not the page.
                  </p>
                )}
              </div>
              <p className="mt-2 text-xs text-text-tertiary">
                Round-trip check: the editor’s text is parsed into {parseBody(draft.bodyEn, 'en').length} English and {parseBody(draft.bodyBn, 'bn').length} Bangla block(s),
                and writes back as {serialiseBody(parseBody(draft.bodyEn, 'en'), 'en').split('\n').length} English line(s). A page that does not survive that round trip is a
                page with a marker the renderer does not know, and the check refuses it rather than dropping the line.
              </p>
            </Panel>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-md border border-border-subtle p-3">
                <p className="text-xs font-medium text-text-primary">Revisions of this page</p>
                <ul className="mt-1 space-y-1 text-xs text-text-secondary">
                  <li className="font-numeric">
                    r{draft.revision || 1} — {draft.state === 'published' ? `live since ${draft.publishedAt ?? 'not published'}` : 'not published'}, written by {draft.author} on {draft.updatedAt}
                  </li>
                  <li className="text-text-tertiary">
                    Publishing writes the next revision and keeps this one. Unpublishing puts back exactly what was there, which is the reason a hospital keeps a revision
                    list rather than an undo button.
                  </li>
                </ul>
              </div>
              <div className="rounded-md border border-border-subtle p-3">
                <p className="text-xs font-medium text-text-primary">Recent activity on the site</p>
                <ul className="mt-1 space-y-1 text-xs text-text-secondary">
                  {events.slice(0, 4).map((event) => (
                    <li key={`${event.at}-${event.what}`}>
                      <span className="font-numeric">{event.at}</span> — {event.by} {event.what} the page. {event.note}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

