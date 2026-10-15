'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  CheckboxField,
  DataGrid,
  FieldSection,
  KpiTile,
  Panel,
  SafetyBanner,
  SelectField,
  Sheet,
  Tabs,
  TextAreaField,
  TextField,
  cx,
  useToast,
  type Column,
  type GridView,
} from '@dizi/ui';
import { Coins, History, Link2, Pencil, Plus, ShieldAlert, TriangleAlert } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { money } from '@/lib/billing';
import { useShell } from '@/lib/shell';
import { EXPENSE_HEADS, expenseHeadByCode } from '@/lib/finance-tables';
import {
  AIT_RATES,
  HEAD_GROUP_BY_KIND,
  NEVER_COMMISSIONABLE,
  SEED_HEADS,
  SETUP_NOTE,
  UNMAPPED_CATEGORIES,
  VAT_RATES,
  categoryCoverage,
  checkHead,
  withholdingHeads,
  type CategoryCoverage,
  type HeadDraft,
  type HeadKind,
} from '@/lib/finance-setup';
import { CAPITAL_FLOOR } from '@/lib/finance';

/* Setup › Finance — the income and expense heads, and the two fields that carry money.
 *
 * The legacy screen was two grids of names: a head was a row somebody typed, with no idea what read it. Two things
 * read a head and both go wrong quietly:
 *
 *  - The **billing category** an income head collects is the mapping the day-end reconciliation uses to decide
 *    whether a counter’s takings reached the ledger. A category with no head at all does not look like a gap: the
 *    money lands in “other operating income”, the head that should carry it shows nothing, and the reconciliation
 *    reports the difference as missing documents — which is the one thing an accountant will chase for a month.
 *  - The **withholding and VAT** on an expense head are applied per voucher from the rate the head says *on the day
 *    the voucher is paid*. A rate is therefore dated, not overwritten: last month’s vouchers keep the rate they
 *    were paid under, and the tax return still matches them.
 *
 * So this screen is the head list plus the two questions the list has to answer: where does each kind of billed
 * money land, and what has to be held back on what we pay.
 *
 * Preview: heads are seeded from the same tables the ledger files against, held in memory, so nothing survives a
 * reload. The rules and the coverage reading do — coverage is recomputed from the drafts on this screen, so fixing
 * the gap here shows as fixed here.
 */

const STATE_LABEL: Record<CategoryCoverage['state'], string> = {
  single: 'One head collects it',
  shared: 'Two heads claim it',
  unmapped: 'No head collects it',
};

const STATE_TONE: Record<CategoryCoverage['state'], string> = {
  single: 'text-safety-success',
  shared: 'text-safety-warning',
  unmapped: 'text-safety-critical',
};

interface HeadChange {
  code: string;
  at: string;
  by: string;
  kind: 'add' | 'edit';
  what: string;
  because: string;
}

const blankHead = (day: string, kind: HeadKind, category?: CategoryCoverage['category']): HeadDraft => ({
  code: kind === 'Income' ? 'INC-' : 'EXP-',
  label: '',
  kind,
  group: HEAD_GROUP_BY_KIND[kind][0],
  categories: category ? [category] : [],
  aitPct: null,
  vatPct: null,
  quotable: false,
  effectiveFrom: day,
});

/**
 * The first day of the month after `day` — the earliest date a change may carry when the head has money in the
 * period that is closing. Nothing matched is re-labelled; the change applies to what comes next.
 */
const afterPeriod = (day: string): string => {
  const [y, m] = day.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

/** The head a new category was reaching for, when the branch already has a laboratory head and wants imaging too. */
const suggested = (category: CategoryCoverage['category']): HeadDraft => {
  const day = todayIso();
  return { ...blankHead(day, 'Income', category), code: 'INC-IMAG', label: 'Diagnostics — imaging', group: 'Operating' };
};

/**
 * The head register's views, as queries.
 *
 * The six filters used to be an `if` chain keyed on the label shown in the chip, which is the shape that breaks the
 * moment a label is edited. Each one is now a `GridView`: the name the desk reads, the query behind it and the id the
 * filter reads — one record, so they cannot disagree.
 */
const HEAD_VIEWS: GridView[] = [
  { id: 'all', name: 'Every head', query: { page: 1, pageSize: 25 } },
  { id: 'income', name: 'Income heads', query: { page: 1, pageSize: 25, filters: { view: 'income' } } },
  { id: 'expense', name: 'Expense heads', query: { page: 1, pageSize: 25, filters: { view: 'expense' } } },
  { id: 'categorised', name: 'Billed to a category', query: { page: 1, pageSize: 25, filters: { view: 'categorised' } } },
  { id: 'withheld', name: 'What we withhold on', query: { page: 1, pageSize: 25, filters: { view: 'withheld' } } },
  { id: 'capital', name: 'Capital', query: { page: 1, pageSize: 25, filters: { view: 'capital' } } },
  { id: 'quotable', name: 'Quoted purchases', query: { page: 1, pageSize: 25, filters: { view: 'quotable' } } },
];

export default function SetupFinancePage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [heads, setHeads] = useState<HeadDraft[]>(() => SEED_HEADS.map((h) => ({ ...h, categories: [...h.categories] })));
  const [tab, setTab] = useState('heads');
  /* The views are named queries, so the label and the filter behind it cannot drift apart: the id in the query is the
     one `registered` below reads. */
  const [view, setView] = useState(HEAD_VIEWS[0].id);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<HeadDraft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [because, setBecause] = useState('');
  /** The refusals and warnings for the draft being written, recomputed on every keystroke. */
  const [live, setLive] = useState<ReturnType<typeof checkHead>>({ ok: true, refusals: [], warnings: [] });
  /** Which category is being handed to an existing head, when the gap is closed that way rather than with a new head. */
  const [handoff, setHandoff] = useState<CategoryCoverage | null>(null);
  const [changes, setChanges] = useState<HeadChange[]>([]);

  const income = useMemo(() => heads.filter((h) => h.kind === 'Income'), [heads]);
  const expense = useMemo(() => heads.filter((h) => h.kind === 'Expense'), [heads]);
  /** Coverage, read from the drafts on this screen — the same function the reconciliation will read the ledger with. */
  const coverage = useMemo(() => categoryCoverage(income), [income]);
  const gaps = useMemo(() => UNMAPPED_CATEGORIES(income), [income]);
  const withheld = useMemo(() => withholdingHeads(expense), [expense]);
  const blocked = useMemo(() => NEVER_COMMISSIONABLE(), []);

  const check = (draft: HeadDraft, editing: boolean) =>
    checkHead(draft, heads, {
      editing,
      hasMoneyInPeriod: editing,
      periodEnds: day,
      hasCapitalisedAssets: editing && draft.kind === 'Expense',
    });

  const openDraft = (h: HeadDraft, fresh = false) => {
    const draft = { ...h, categories: [...h.categories] };
    setEditing(draft);
    setIsNew(fresh);
    setBecause('');
    setLive(check(draft, !fresh));
  };

  const edit = (patch: Partial<HeadDraft>) => {
    if (!editing) return;
    const next = { ...editing, ...patch };
    setEditing(next);
    setLive(check(next, !isNew));
  };

  const fieldError = (field: string): string | undefined => live.refusals.find((r) => r.field === field)?.message;

  const save = () => {
    if (!editing) return;
    const verdict = check(editing, !isNew);
    if (!verdict.ok) {
      push({
        title: `Refused — ${verdict.refusals[0].message}`,
        description: verdict.refusals.length > 1 ? `${verdict.refusals.length - 1} more thing(s) on the form are not right yet.` : undefined,
        tone: 'critical',
      });
      return;
    }
    if (!isNew && !because.trim()) {
      push({
        title: 'Say why the head is changing.',
        description: 'A rate or a category on this list changes what the ledger does. The reason is what the next person to read the change has, because the code cannot explain itself.',
        tone: 'critical',
      });
      return;
    }
    const before = heads.find((h) => h.code === editing.code);
    const what = !before
      ? `Created: ${editing.label}, ${editing.kind.toLowerCase()}, ${editing.group}`
      : [
          before.label !== editing.label ? `renamed from “${before.label}”` : '',
          before.group !== editing.group ? `${before.group} → ${editing.group}` : '',
          JSON.stringify(before.categories) !== JSON.stringify(editing.categories)
            ? `collects ${editing.categories.length > 0 ? editing.categories.join(' · ') : 'no billing category'} (was ${before.categories.length > 0 ? before.categories.join(' · ') : 'none'})`
            : '',
          before.aitPct !== editing.aitPct ? `withholding ${before.aitPct ?? 'none'} % → ${editing.aitPct ?? 'none'} %` : '',
          before.vatPct !== editing.vatPct ? `VAT ${before.vatPct ?? 'none'} % → ${editing.vatPct ?? 'none'} %` : '',
          before.quotable !== editing.quotable ? `quotation ${editing.quotable ? 'now required' : 'no longer required'}` : '',
        ]
          .filter(Boolean)
          .join('; ') || 'terms re-saved unchanged';

    setHeads((rows) => (before ? rows.map((h) => (h.code === editing.code && h.kind === editing.kind ? editing : h)) : [editing, ...rows]));
    setChanges((c) => [
      {
        code: editing.code,
        at: `${day} ${new Date().getHours()}:${String(new Date().getMinutes()).padStart(2, '0')}`,
        by: 'Finance manager — S. Chowdhury',
        kind: before ? 'edit' : 'add',
        what,
        because: because.trim() || 'Created on this screen',
      },
      ...c,
    ]);
    const outcome = queueWrite(
      `${before ? 'Changed' : 'Added'} ${editing.kind.toLowerCase()} head ${editing.code}: ${what}`,
      {
        id: 'appendAuditEntry',
        recordId: editing.code,
        fields: {
          code: editing.code,
          kind: editing.kind,
          group: editing.group,
          categories: editing.categories.join(','),
          aitPct: editing.aitPct,
          vatPct: editing.vatPct,
          effectiveFrom: editing.effectiveFrom,
          because: because.trim() || null,
        },
      },
    );
    const fixes = gaps.length > 0 && editing.kind === 'Income' && editing.categories.length > 0;
    push({
      title: `${editing.code} saved`,
      description:
        `${editing.kind === 'Income' && editing.categories.length > 0 ? `Billed ${editing.categories.join(' and ')} lines now credit this head at the reconciliation. ` : ''}` +
        `${editing.kind === 'Expense' && (editing.aitPct != null || editing.vatPct != null) ? `Applies from ${editing.effectiveFrom}: vouchers paid before that day keep the rate they were paid under. ` : ''}` +
        `${fixes ? 'The coverage panel below was read from this draft, so the gap is shown as closed. ' : ''}` +
        `${outcome.queued ? '' : `Recorded locally only: ${outcome.because}`}`,
      tone: 'success',
    });
    setEditing(null);
    setBecause('');
  };

  /* ------------------------------------------------------------------ the head register, as the grid queries it */

  const registered = useMemo(() => {
    const byView = heads.filter((h) => {
      if (view === 'income') return h.kind === 'Income';
      if (view === 'expense') return h.kind === 'Expense';
      if (view === 'capital') return h.kind === 'Expense' && h.group === 'Capital';
      if (view === 'withheld') return h.aitPct != null || h.vatPct != null;
      if (view === 'quotable') return h.kind === 'Expense' && h.quotable;
      if (view === 'categorised') return h.kind === 'Income' && h.categories.length > 0;
      return true;
    });
    if (!query.trim()) return byView;
    const q = query.trim().toLowerCase();
    return byView.filter(
      (h) =>
        h.code.toLowerCase().includes(q) ||
        h.label.toLowerCase().includes(q) ||
        h.group.toLowerCase().includes(q) ||
        h.categories.some((c) => c.toLowerCase().includes(q)),
    );
  }, [heads, view, query]);

  const pageRows = registered.slice((page - 1) * pageSize, page * pageSize);

  const columns: Array<Column<HeadDraft>> = [
    {
      key: 'code',
      header: 'Head',
      render: (h) => (
        <span>
          <span className="font-medium text-text-primary">{h.label}</span>
          <span className="block text-xs text-text-tertiary">{h.code} · {h.kind.toLowerCase()} · {h.group}</span>
        </span>
      ),
    },
    {
      key: 'categories',
      header: 'Billed as',
      hideBelow: 'lg',
      render: (h) =>
        h.kind === 'Expense' ? (
          <span className="text-xs text-text-tertiary">filed by what was bought</span>
        ) : h.categories.length === 0 ? (
          <span className="text-xs text-text-tertiary">counter income no bill knows about</span>
        ) : (
          <span className="text-xs">{h.categories.join(' · ')}</span>
        ),
    },
    {
      key: 'aitPct',
      header: 'Withholding',
      align: 'right',
      width: '7rem',
      render: (h) => <span className="tabular-nums">{h.aitPct == null ? '—' : `${h.aitPct} %`}</span>,
    },
    {
      key: 'vatPct',
      header: 'VAT',
      align: 'right',
      width: '5rem',
      hideBelow: 'md',
      render: (h) => <span className="tabular-nums">{h.vatPct == null ? '—' : `${h.vatPct} %`}</span>,
    },
    {
      key: 'effectiveFrom',
      header: 'From',
      width: '7rem',
      hideBelow: 'lg',
      render: (h) => <span className="text-xs tabular-nums">{h.effectiveFrom}</span>,
    },
  ];

  const covered = coverage.filter((c) => c.state === 'single').length;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Coins className="size-5 text-brand-600" aria-hidden />
            Setup › Finance
          </h1>
          <p className="text-sm text-text-secondary">
            {heads.length} heads, and the two fields that carry money — what each income head collects, and what is held back on what we pay. {day}.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/setup">
            <Button variant="secondary" size="sm">Every catalogue</Button>
          </Link>
          <Link href="/setup/referral-commission">
            <Button variant="secondary" size="sm">Referral agreements</Button>
          </Link>
          <Button size="sm" onClick={() => openDraft(blankHead(day, 'Income'), true)}>
            <Plus className="size-4" aria-hidden /> New income head
          </Button>
        </div>
      </header>

      {gaps.length > 0 && (
        <SafetyBanner severity="warning" title={`${gaps.length} billing categor${gaps.length === 1 ? 'y has' : 'ies have'} no income head — ${gaps.join(', ')}`}>
          <p>
            Every billed line under {gaps.length === 1 ? 'it' : 'them'} is credited to “Other operating income” instead, so the head that should carry the
            branch’s revenue shows nothing and the day-end reconciliation reads the difference as missing documents. That is a gap nobody sees on a bill,
            which is why it is on this screen rather than in a report.
          </p>
          <p className="mt-1">
            <Button variant="secondary" size="sm" onClick={() => setTab('coverage')}>
              <Link2 className="size-4" aria-hidden /> Decide where {gaps.length === 1 ? 'it' : 'they'} land{gaps.length === 1 ? 's' : ''}
            </Button>
          </p>
        </SafetyBanner>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KpiTile label="Income heads" value={String(income.length)} definition="Every head a receipt may post to. One that is missing becomes “miscellaneous”, and a ledger whose largest line is miscellaneous cannot be reconciled." asOf={day} />
        <KpiTile label="Expense heads" value={String(expense.length)} definition="What money may be spent on, whether it is capital, and what tax has to be held back before it leaves." asOf={day} footnote={`${withheld.length} withhold something`} />
        <KpiTile label="Categories covered" value={`${covered} of ${coverage.length}`} definition="Billing categories a bill can file a line under, and whether an income head collects it. This is the mapping the reconciliation matches counter takings against." asOf={day} />
        <KpiTile label="Categories with no head" value={String(gaps.length)} definition="Revenue that lands in other operating income and looks like a missing document at day end." asOf={day} footnote={gaps.length > 0 ? gaps.join(' · ') : 'none — every category lands somewhere'} />
        <KpiTile label="Never commissionable" value={String(blocked.length)} definition="Heads no referral agreement may ever name, refused on every accrual rather than on save." asOf={day} footnote={blocked.map((b) => b.head.code).join(' · ')} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'heads', label: 'The heads', count: heads.length },
          { id: 'coverage', label: 'Category coverage', count: gaps.length || undefined },
          { id: 'tax', label: 'Tax on what we pay', count: withheld.length },
          { id: 'rules', label: 'What is refused' },
          { id: 'changes', label: 'Change log', count: changes.length || undefined },
        ]}
      />

      {tab === 'heads' && (
        <Panel>
          <DataGrid<HeadDraft>
            id="setup-heads"
            caption={`Income and expense heads — ${(HEAD_VIEWS.find((v) => v.id === view)?.name ?? 'Every head').toLowerCase()}, ${registered.length} of ${heads.length}`}
            columns={columns}
            rows={pageRows}
            total={registered.length}
            page={Math.min(page, Math.max(1, Math.ceil(registered.length / pageSize)))}
            pageSize={pageSize}
            onQuery={(q) => { setPage(q.page); setPageSize(q.pageSize); }}
            quickSearch={{ value: query, onChange: (v) => { setQuery(v); setPage(1); }, placeholder: 'Head, code, group or billing category…' }}
            views={HEAD_VIEWS}
            activeViewId={view}
            onViewApply={(id) => { setView(id); setPage(1); }}
            printMeta={`Branch: Main Campus · ${HEAD_VIEWS.find((v) => v.id === view)?.name ?? 'Every head'} · ${day}`}
            exportFileName={`heads-${day}`}
            rowId={(h) => `${h.kind}-${h.code}`}
            height="26rem"
            onRowClick={(h) => openDraft(h)}
            rowActions={(h) => [
              { label: 'Edit the head', icon: <Pencil className="size-4" aria-hidden />, onSelect: () => openDraft(h) },
              ...(h.kind === 'Income' && h.categories.length < coverage.length
                ? [{ label: 'Teach it a billing category', icon: <Link2 className="size-4" aria-hidden />, onSelect: () => openDraft(h) }]
                : []),
            ]}
          />
          <p className="mt-2 text-xs text-text-secondary">
            {SETUP_NOTE} Retiring a head is done on the catalogue screen, where the impact on records that already point at it is computed before
            it is pressed — nothing on this list is ever deleted, because an old bill still has to print what it said at the time.
          </p>
        </Panel>
      )}

      {tab === 'coverage' && (
        <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
          <Panel title="Where each kind of billed money lands">
            <ListView<CategoryCoverage>
              id="category-coverage"
              caption={`Billing categories and the income head that collects each — ${coverage.length} categories`}
              columns={[
                {
                  key: 'category',
                  header: 'Billed as',
                  render: (c) => (
                    <span>
                      <span className="font-medium text-text-primary">{c.category}</span>
                      <span className={cx('block text-xs font-medium', STATE_TONE[c.state])}>{STATE_LABEL[c.state]}</span>
                    </span>
                  ),
                },
                {
                  key: 'winner',
                  header: 'Credited to',
                  render: (c) =>
                    c.winner ? (
                      <span className="text-xs">
                        {income.find((h) => h.code === c.winner)?.label ?? c.winner}
                        <span className="block text-text-tertiary">
                          {c.winner}
                          {(() => {
                            const from = income.find((h) => h.code === c.winner)?.effectiveFrom;
                            return from && from > day ? ` · from ${from}` : '';
                          })()}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-safety-critical">Other operating income</span>
                    ),
                },
                {
                  key: 'because',
                  header: 'What that means',
                  hideBelow: 'lg',
                  render: (c) => <span className="text-xs text-text-secondary">{c.because}</span>,
                },
              ]}
              rows={coverage}
              rowId={(c) => c.category}
              height="24rem"
              rowActions={(c) => [
                ...(c.state === 'unmapped'
                  ? [
                      { label: 'Give it its own head', icon: <Plus className="size-4" aria-hidden />, onSelect: () => openDraft(suggested(c.category), true) },
                      { label: 'Hand it to a head we have', icon: <Link2 className="size-4" aria-hidden />, onSelect: () => setHandoff(c) },
                    ]
                  : []),
                ...(c.state === 'shared' && c.heads.length > 1
                  ? [
                      {
                        label: `Open ${c.heads[1]} — the one not credited`,
                        icon: <Pencil className="size-4" aria-hidden />,
                        onSelect: () => {
                          const second = income.find((h) => h.code === c.heads[1]);
                          if (second) openDraft(second);
                        },
                      },
                    ]
                  : []),
                ...(c.state === 'single'
                  ? [
                      {
                        label: 'Open the head that collects it',
                        icon: <Pencil className="size-4" aria-hidden />,
                        onSelect: () => {
                          const first = income.find((h) => h.code === c.heads[0]);
                          if (first) openDraft(first);
                        },
                      },
                    ]
                  : []),
              ]}
            />
          </Panel>

          <Panel title="Why this mapping is money">
            <ul className="space-y-2 text-sm text-text-secondary">
              <li>
                <span className="font-medium text-text-primary">The reconciliation reads the first head that collects a category.</span> Not the
                only one — the first. So a category with two heads means one of them never sees a bill, and a category with none means the money is
                credited to a head nobody budgeted for.
              </li>
              <li>
                <span className="font-medium text-text-primary">A category is a promise to the patient.</span> The tariff files each line under one of
                {' '}{coverage.length} categories, and that is what decides which head the money lands in. Two heads for one category is a decision
                nobody has made; here it is visible.
              </li>
              <li>
                <span className="font-medium text-text-primary">Capital work is billed the same way.</span> A theatre day-procedure is a procedure, not
                attendance — which is why the procedure head is the one the theatre income is credited to, and why it can only collect one thing at a
                time.
              </li>
            </ul>
            <p className="mt-3 text-xs text-text-tertiary">
              This panel is read from the drafts on this screen, so a category given a head here stops being a gap here. In production the same table
              is what the day-end reconciliation reads, which is the point of changing it in one place.
            </p>
          </Panel>
        </div>
      )}

      {tab === 'tax' && (
        <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
          <Panel title="What is held back before money leaves">
            <ListView<HeadDraft>
              id="withholding-heads"
              caption={`Expense heads that withhold tax — ${withheld.length} of ${expense.length}`}
              columns={[
                {
                  key: 'code',
                  header: 'Head',
                  render: (h) => (
                    <span>
                      <span className="font-medium text-text-primary">{h.label}</span>
                      <span className="block text-xs text-text-tertiary">{h.code} · {h.group}</span>
                    </span>
                  ),
                },
                { key: 'aitPct', header: 'Withholding', align: 'right', width: '7rem', render: (h) => <span className="tabular-nums">{h.aitPct == null ? '—' : `${h.aitPct} %`}</span> },
                { key: 'vatPct', header: 'VAT', align: 'right', width: '5rem', render: (h) => <span className="tabular-nums">{h.vatPct == null ? '—' : `${h.vatPct} %`}</span> },
                {
                  key: 'note',
                  header: 'What it means',
                  hideBelow: 'lg',
                  render: (h) => <span className="text-xs text-text-secondary">{expenseHeadByCode(h.code)?.note ?? 'Added on this screen — no note on the ledger head yet.'}</span>,
                },
              ]}
              rows={withheld}
              rowId={(h) => h.code}
              height="22rem"
              onRowClick={(h) => openDraft(h)}
              rowActions={(h) => [{ label: 'Change the rate', icon: <Pencil className="size-4" aria-hidden />, onSelect: () => openDraft(h) }]}
            />
          </Panel>

          <Panel title="The rates the law has">
            <ul className="space-y-2 text-sm text-text-secondary">
              <li>
                <span className="font-medium text-text-primary">Withholding is one of {AIT_RATES.filter((r) => r != null).join(', ')} % or none.</span> A rate
                the law does not have is a rate somebody will have to explain to a tax officer, so the field is a list and not a number.
              </li>
              <li>
                <span className="font-medium text-text-primary">VAT is 5 % or 15 % or none.</span> The input tax on what this branch buys is a cost rather
                than a credit — its clinical services sit outside the net — so a VAT rate here changes what a purchase costs, not what can be reclaimed.
              </li>
              <li>
                <span className="font-medium text-text-primary">A rate applies from a date.</span> The ledger holds the rate on each voucher, so changing
                the rate here re-taxes nothing that was already paid. Without the date, the vouchers and the return stop matching.
              </li>
              <li>
                <span className="font-medium text-text-primary">A capital head is not a big one.</span> Above {money(CAPITAL_FLOOR)} a purchase on a capital
                head is an asset on the register and depreciates; on a revenue head it is this month’s cost. Changing a head that already has assets on
                the register from capital to revenue would put their whole value into one month.
              </li>
            </ul>
            <p className="mt-3 text-xs text-text-tertiary">
              {EXPENSE_HEADS.length} expense heads on the ledger; {withheld.length} of them withhold on the voucher. One with a rate of “none” is a
              decision, not an omission — salaries and utilities are the two that are deliberately at none.
            </p>
          </Panel>
        </div>
      )}

      {tab === 'rules' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="What this screen refuses, and why">
            <ul className="space-y-2 text-sm">
              {[
                ['A withholding or VAT rate on an income head', 'Tax belongs to what the hospital pays, not to what it takes. An income head filing it double-counts tax in the day book.'],
                ['A billing category this branch does not bill under', 'A line could never be filed to the head through the tariff, so the mapping would be a promise the billing screen cannot keep.'],
                ['Changing what a head collects while it has money in the period', 'The reconciliation has already matched that money. Re-labelling it turns last week’s “missing documents” into this week’s “complete” without a single receipt changing.'],
                ['Moving a donation head into operating income', 'A grant is not the month’s revenue. Filed as operating, it gets spent on salaries without anybody deciding to.'],
                ['A withholding or VAT rate the law does not have', `Withholding is one of ${AIT_RATES.filter((r) => r != null).join(', ')} %; VAT is ${VAT_RATES.filter((r) => r != null).join(' or ')} %. Anything else is a return that will not reconcile.`],
                ['A rate change with no effective date', 'The rate is what the vouchers were paid under, dated. Without a date, the change rewrites what was already paid — on paper only, which is worse.'],
                ['Capital to revenue while assets are on the register', 'Their whole value would leave the register and land in one month’s cost.'],
                ['The same code on both sides of the book', 'The day book keeps two lists and every reconciliation reads them separately; one code on both makes both readings ambiguous.'],
                ['An expense head claiming a billing category', 'An expense is filed by what was bought, not by what was billed to a patient.'],
                ['A change with no reason recorded', 'A rate or a category here changes what the ledger does. The reason is the only part of the change the code cannot explain.'],
              ].map(([what, why]) => (
                <li key={what} className="flex gap-2">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-safety-warning" aria-hidden />
                  <span>
                    <span className="font-medium text-text-primary">{what}</span>
                    <span className="block text-xs text-text-secondary">{why}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="space-y-3">
            <Panel title="Heads no agreement may ever name">
              <ul className="space-y-2 text-sm">
                {blocked.map(({ head, because }) => (
                  <li key={head.code} className="border-b border-border-subtle pb-2">
                    <span className="font-medium text-text-primary">{head.label}</span>
                    <span className="block text-xs text-text-tertiary">
                      {head.code} · {head.group} · {head.categories.length > 0 ? `billed as ${head.categories.join(' and ')}` : 'no billing category'}
                    </span>
                    <span className="block text-xs text-text-secondary">{because}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-text-secondary">
                The refusal is computed on every commission accrual as it is built, not on the agreement, so an agreement written before this rule
                existed cannot pay on one of these either. <Link href="/setup/referral-commission" className="text-brand-600 underline">Referral agreements</Link> shows
                the whole rule set.
              </p>
            </Panel>

            <Panel title="Warned, not refused">
              <ul className="space-y-2 text-xs text-text-secondary">
                <li className="flex gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-safety-warning" aria-hidden />
                  <span>
                    <span className="font-medium text-text-primary">Two heads on one category.</span> Allowed, because the tariff files two different
                    services under one category — blood and procedures both land under “Procedure”. The second head is then only reachable by a manual
                    counter receipt, and the coverage panel says which one the reconciliation credits.
                  </span>
                </li>
                <li className="flex gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-safety-warning" aria-hidden />
                  <span>
                    <span className="font-medium text-text-primary">A group change while money is in the period.</span> Allowed, dated from today: the
                    period it already covers keeps the group it was booked under, because a report that has been signed does not change meaning.
                  </span>
                </li>
                <li className="flex gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-safety-warning" aria-hidden />
                  <span>
                    <span className="font-medium text-text-primary">A rate change on a head with vouchers already paid.</span> Allowed, because rates
                    change; the vouchers keep the rate they were paid under, and the warning says so at the moment of the change rather than after a
                    return has been filed.
                  </span>
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'changes' && (
        <Panel title="Changes made on this screen">
          {changes.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Nothing has been changed yet. Every change here is dated and carries who made it and why, because a rate or a category on this list shows
              up in a voucher or a report months later and somebody has to be able to explain it.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {changes.map((c, i) => (
                <li key={`${c.code}-${i}`} className="border-b border-border-subtle pb-2">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <History className="size-4 text-brand-600" aria-hidden />
                    <span className="font-medium text-text-primary">{c.code}</span>
                    <span className="text-xs text-text-tertiary">
                      {c.kind === 'add' ? 'created' : 'changed'} · {c.at} · {c.by}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-text-secondary">{c.what}</span>
                  <span className="mt-0.5 block text-xs text-text-tertiary">Because: {c.because}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-text-secondary">
            In production each of these is an audited write in the same transaction as the change, queued through the outbox with the rest of the desk’s
            work. Here they are held in memory: the rules and the coverage reading are real, the persistence is not.
          </p>
        </Panel>
      )}

      {/* ------------------------------------------------------------------ handing a category to a head that exists */}

      <Sheet
        open={Boolean(handoff)}
        onClose={() => setHandoff(null)}
        title={handoff ? `Where should ${handoff.category} money land?` : 'Hand a category over'}
        description="A head that already collects something is usually the right home for a category that has none — the reconciliation credits the first head that claims it, so the order in the list matters."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setHandoff(null)}>Close</Button>
            {handoff && (
              <Button size="sm" onClick={() => { openDraft(suggested(handoff.category), true); setHandoff(null); }}>
                <Plus className="size-4" aria-hidden /> Give it its own head instead
              </Button>
            )}
          </div>
        }
      >
        {handoff && (
          <div className="space-y-3 text-sm">
            <p className="text-text-secondary">{handoff.because}</p>
            <ul className="space-y-2">
              {income.map((h) => (
                <li key={h.code} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle p-2">
                  <span>
                    <span className="font-medium text-text-primary">{h.label}</span>
                    <span className="block text-xs text-text-tertiary">
                      {h.code} · {h.categories.length > 0 ? `collects ${h.categories.join(' · ')}` : 'collects nothing billed'}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      openDraft({ ...h, categories: [...h.categories, handoff.category], effectiveFrom: afterPeriod(day) });
                      setHandoff(null);
                    }}
                  >
                    <Link2 className="size-4" aria-hidden /> Collect {handoff.category} here
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-text-tertiary">
              Nothing is saved from this list: it opens the head’s own form with the category added, where the refusals and the reason apply. The date
              is set to {afterPeriod(day)} on purpose — a head that already has money in this period cannot be re-labelled today, and dating the change
              after it means the lines already matched keep the head they were matched to.
            </p>
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------------ the head form: the nine legacy fields */}

      <Sheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? (isNew ? 'A new head' : editing.label || editing.code) : 'Head'}
        description={editing ? `${editing.kind} head · ${editing.code} · effective from ${editing.effectiveFrom}` : undefined}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="sm" onClick={save}>
              <Coins className="size-4" aria-hidden /> {isNew ? 'Create the head' : 'Save the change'}
            </Button>
          </div>
        }
      >
        {editing && (
          <div className="space-y-4 text-sm">
            {live.refusals.length > 0 && (
              <div role="status" className="rounded-md bg-safety-critical/10 px-3 py-2 text-xs text-safety-critical">
                <p className="font-medium">{live.refusals.length} thing{live.refusals.length === 1 ? '' : 's'} to fix before this may be saved:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {live.refusals.map((r) => <li key={r.code}>{r.message}</li>)}
                </ul>
              </div>
            )}
            {live.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md bg-safety-warning/10 px-3 py-2 text-xs text-safety-warning">
                {live.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}

            <FieldSection title="The head" description="A code is an identity, a label is what the counter reads, and the kind decides which side of the day book it lands on.">
              <TextField label="Code" name="code" required value={editing.code} onChange={(e) => edit({ code: e.target.value.toUpperCase() })} error={fieldError('code')} hint={`INC- for income, EXP- for expense. ${isNew ? '' : 'The code does not change on an edit: history points at it.'}`} />
              <TextField label="Label" name="label" required value={editing.label} onChange={(e) => edit({ label: e.target.value })} error={fieldError('label')} className="md:col-span-2" />
              <SelectField
                label="Kind"
                name="kind"
                value={editing.kind}
                onChange={(e) => {
                  const kind = e.target.value as HeadKind;
                  edit({ kind, group: HEAD_GROUP_BY_KIND[kind][0], categories: kind === 'Income' ? editing.categories : [], aitPct: null, vatPct: null });
                }}
                options={[{ value: 'Income', label: 'Income — money in' }, { value: 'Expense', label: 'Expense — money out' }]}
                hint="One side of the book per code, so the day book’s two lists stay unambiguous."
              />
              <SelectField
                label="Group"
                name="group"
                value={editing.group}
                onChange={(e) => edit({ group: e.target.value })}
                options={HEAD_GROUP_BY_KIND[editing.kind].map((g) => ({ value: g, label: g }))}
                error={fieldError('group')}
                hint={editing.kind === 'Income' ? 'A donation is never operating income.' : 'Capital above the floor is an asset, not a month’s cost.'}
              />
            </FieldSection>

            {editing.kind === 'Income' ? (
              <FieldSection title="What it collects" description="The mapping the reconciliation reads. Empty means counter income no bill knows about.">
                <div className="md:col-span-2 xl:col-span-3">
                  <p className="mb-1 text-sm font-medium text-text-secondary">Billing categories this head collects</p>
                  <ul className="flex flex-wrap gap-1">
                    {coverage.map((c) => {
                      const on = editing.categories.includes(c.category);
                      const rival = income.find((h) => h.code !== editing.code && h.categories.includes(c.category));
                      return (
                        <li key={c.category}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => edit({ categories: on ? editing.categories.filter((x) => x !== c.category) : [...editing.categories, c.category] })}
                            className={cx(
                              'rounded-full border px-2 py-0.5 text-xs',
                              on ? 'border-brand-500 bg-brand-50 text-brand-700' : rival ? 'border-safety-warning/50 text-safety-warning' : 'border-border-subtle text-text-secondary hover:border-brand-300',
                            )}
                          >
                            {c.category}
                            {rival && !on ? ` — ${rival.code} has it` : ''}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {fieldError('categories') && <p role="alert" className="mt-1 text-xs font-medium text-safety-critical">{fieldError('categories')}</p>}
                  <p className="mt-1 text-xs text-text-tertiary">
                    A category another head already claims is shown with that head’s code: adding it here is allowed, but the reconciliation credits the
                    first head in the list, so the other one stops seeing bills.
                  </p>
                </div>
              </FieldSection>
            ) : null}

            {editing.kind === 'Expense' ? (
              <FieldSection title="Tax held back, and whether it is a purchase" description="The rates the law has, applied from the date on the voucher rather than from today’s list.">
                <SelectField
                  label="Withholding"
                  name="aitPct"
                  value={editing.aitPct == null ? '' : String(editing.aitPct)}
                  onChange={(e) => edit({ aitPct: e.target.value === '' ? null : Number(e.target.value) })}
                  options={AIT_RATES.map((r) => ({ value: r == null ? '' : String(r), label: r == null ? 'None' : `${r} %` }))}
                  error={fieldError('aitPct')}
                  hint="Held back from the supplier and paid to the tax office."
                />
                <SelectField
                  label="VAT"
                  name="vatPct"
                  value={editing.vatPct == null ? '' : String(editing.vatPct)}
                  onChange={(e) => edit({ vatPct: e.target.value === '' ? null : Number(e.target.value) })}
                  options={VAT_RATES.map((r) => ({ value: r == null ? '' : String(r), label: r == null ? 'None' : `${r} %` }))}
                  error={fieldError('vatPct')}
                  hint="Recorded on the bill. Input tax is a cost at this branch, not a credit."
                />
                <CheckboxField
                  name="quotable"
                  label="A purchase, so it is quoted and compared"
                  checked={editing.quotable}
                  onChange={(e) => edit({ quotable: e.target.checked })}
                  hint="A meter, a rent agreement and a licence are not quotations — asking for one turns an approval into a formality."
                />
              </FieldSection>
            ) : null}

            <FieldSection title="From when, and why" description="A dated change is what lets an old report still read what this list said at the time.">
              <TextField label="Effective from" name="effectiveFrom" type="date" required value={editing.effectiveFrom} onChange={(e) => edit({ effectiveFrom: e.target.value })} error={fieldError('effectiveFrom')} hint="Rates and categories apply from this day, never backwards. A category change on a head that has money in the period has to be dated after it." />
              <TextAreaField
                label={isNew ? 'Why it is being added (optional on a new head)' : 'Why it is changing'}
                name="because"
                rows={2}
                value={because}
                onChange={(e) => setBecause(e.target.value)}
                className="md:col-span-2"
                hint="Read by whoever asks in three months why a voucher withheld what it did."
              />
            </FieldSection>
          </div>
        )}
      </Sheet>
    </div>
  );
}
