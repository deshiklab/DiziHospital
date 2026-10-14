'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  KpiTile,
  Panel,
  Sheet,
  Tabs,
  cx,
  useToast,
} from '@dizi/ui';
import { History, Plus, Settings2, ShieldAlert } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { money } from '@/lib/billing';
import {
  CATALOGUES,
  CHARGE_CATEGORIES,
  catalogueStats,
  checkCode,
  retireImpact,
  usageCount,
  type Catalogue,
  type MasterChange,
  type MasterRow,
} from '@/lib/masters';

/* Setup — every “Setup › …” screen from the legacy module, as one registry with rules.
 *
 * The legacy product had twelve near-identical CRUD pages and no audit trail, so a tariff could change and nobody
 * could say who changed it or when. `lib/masters.ts` holds the twelve catalogues and the four rules they share
 * (a code is an identity, nothing is deleted, every change carries who and when, money rows are dated); this
 * screen is the one place they are edited, with the impact of a retire shown *before* it is pressed.
 *
 * Preview: the catalogues are seeded from the same modules the rest of the platform reads — the tariff the billing
 * screen uses, the drug list the pharmacy uses, the vital ranges the ward chart uses — in memory, so nothing
 * survives a reload. The rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

export default function SetupPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [catalogueId, setCatalogueId] = useState(CATALOGUES[0].id);
  const [tab, setTab] = useState('catalogue');
  const [showRetired, setShowRetired] = useState(false);
  const [query, setQuery] = useState('');
  const [rowId, setRowId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ code: '', label: '', price: '', category: CHARGE_CATEGORIES[0] as string });
  const [labelDraft, setLabelDraft] = useState('');
  const [retireReason, setRetireReason] = useState('');
  const [changes, setChanges] = useState<MasterChange[]>([]);

  /** The catalogues as they are edited on this screen: seeded from the modules, held in memory like the rest of the preview. */
  const [rows, setRows] = useState<Record<string, MasterRow[]>>(() =>
    Object.fromEntries(CATALOGUES.map((c) => [c.id, c.rows.map((r) => ({ ...r }))])),
  );

  const catalogue = CATALOGUES.find((c) => c.id === catalogueId) as Catalogue;
  const live: Catalogue = { ...catalogue, rows: rows[catalogue.id] ?? [] };
  const stats = useMemo(() => catalogueStats(live), [live]);
  const row = (rows[catalogue.id] ?? []).find((r) => r.id === rowId) ?? null;
  const impact = row ? retireImpact(live, row) : null;

  const visible = useMemo(() => {
    const list = (rows[catalogue.id] ?? []).filter((r) => showRetired || r.active);
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter((r) => r.code.toLowerCase().includes(q) || r.label.toLowerCase().includes(q) || Object.values(r.values).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, catalogue.id, showRetired, query]);

  const record = (change: MasterChange) => {
    setChanges((c) => [change, ...c]);
    queueWrite(`${change.kind === 'add' ? 'Added' : change.kind === 'retire' ? 'Retired' : change.kind === 'restore' ? 'Restored' : 'Edited'} ${catalogue.name.toLowerCase()}: ${change.code} ${change.what}`.trim());
  };

  const addRow = () => {
    const check = checkCode(live, draft.code);
    if (!check.ok) {
      push({ title: `Refused — ${check.problem}`, description: check.hint, tone: 'critical' });
      return;
    }
    if (!draft.label.trim()) {
      push({ title: 'A label is what the counter reads; a code is what the system reads. Give it both.', tone: 'critical' });
      return;
    }
    const price = Number(draft.price) || 0;
    const newRow: MasterRow = {
      id: `${catalogue.id}-${Date.now()}`,
      code: draft.code.trim().toUpperCase(),
      label: draft.label.trim(),
      values: price > 0 ? { price, category: draft.category, effective: day, used: 0 } : { used: 0 },
      active: true,
      lastChange: { at: `${day} 15:45`, by: 'Hospital admin', what: 'Created on this screen' },
    };
    setRows((r) => ({ ...r, [catalogue.id]: [newRow, ...(r[catalogue.id] ?? [])] }));
    record({ catalogueId: catalogue.id, code: newRow.code, kind: 'add', at: `${day} 15:45`, by: 'Hospital admin', what: `“${newRow.label}”${price ? ` at ${money(price)}` : ''}` });
    setDraft({ ...draft, code: '', label: '', price: '' });
    push({ title: `${newRow.code} added to ${catalogue.name.toLowerCase()}`, description: 'The change is recorded with who made it and when, because a tariff change shows up in a bill three months later.', tone: 'success' });
  };

  const rename = (target: MasterRow) => {
    if (!labelDraft.trim()) {
      push({ title: 'An empty label is a row nobody can find at the counter.', tone: 'critical' });
      return;
    }
    setRows((r) => ({ ...r, [catalogue.id]: (r[catalogue.id] ?? []).map((x) => (x.id === target.id ? { ...x, label: labelDraft.trim(), lastChange: { at: `${day} 15:45`, by: 'Hospital admin', what: `Renamed from “${target.label}”` } } : x)) }));
    record({ catalogueId: catalogue.id, code: target.code, kind: 'edit', at: `${day} 15:45`, by: 'Hospital admin', what: `Renamed “${target.label}” to “${labelDraft.trim()}”`, detail: 'The code did not change: records that point at it still resolve.' });
    push({ title: `${target.code} renamed`, description: 'The code stayed the same on purpose — the history that points at it still resolves.', tone: 'success' });
    setLabelDraft('');
  };

  const retire = (target: MasterRow) => {
    if (!retireReason.trim()) {
      push({ title: 'A retire needs a reason — the next person to look at this list will ask why.', tone: 'critical' });
      return;
    }
    setRows((r) => ({ ...r, [catalogue.id]: (r[catalogue.id] ?? []).map((x) => (x.id === target.id ? { ...x, active: false, retiredAt: day, retiredBecause: retireReason.trim(), lastChange: { at: `${day} 15:45`, by: 'Hospital admin', what: `Retired — ${retireReason.trim()}` } } : x)) }));
    record({ catalogueId: catalogue.id, code: target.code, kind: 'retire', at: `${day} 15:45`, by: 'Hospital admin', what: `Retired ${usageCount(live, target.code)} record(s) resolve to it`, detail: retireReason.trim() });
    push({
      title: `${target.code} retired`,
      description: `It leaves every picker. ${usageCount(live, target.code)} existing record(s) still resolve to it, so last month’s bill and an old report still read what they said at the time.`,
      tone: 'warning',
    });
    setRowId(null);
    setRetireReason('');
  };

  const restore = (target: MasterRow) => {
    setRows((r) => ({ ...r, [catalogue.id]: (r[catalogue.id] ?? []).map((x) => (x.id === target.id ? { ...x, active: true, retiredAt: undefined, retiredBecause: undefined, lastChange: { at: `${day} 15:45`, by: 'Hospital admin', what: 'Restored to the pickers' } } : x)) }));
    record({ catalogueId: catalogue.id, code: target.code, kind: 'restore', at: `${day} 15:45`, by: 'Hospital admin', what: 'Restored' });
    push({ title: `${target.code} restored`, description: 'Back in the pickers, with the retirement kept in its history rather than erased.', tone: 'success' });
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Settings2 className="size-5 text-brand-600" aria-hidden />
            Setup
          </h1>
          <p className="text-sm text-text-secondary">
            Twelve catalogues, one shape, one audit trail — {day}.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Catalogues" value={String(CATALOGUES.length)} definition="Every legacy Setup screen, kept as one registry so the shape of an entry and its audit trail cannot differ between them." asOf={day} />
        <KpiTile label={`Rows in ${catalogue.name.toLowerCase()}`} value={String(stats.total)} definition="Active rows plus retired ones, which are kept rather than deleted so old records still resolve." asOf={day} footnote={`${stats.retired} retired · ${stats.inUse} in use`} />
        <KpiTile label="Priced rows" value={String(stats.priced)} definition="Rows carrying a price: tariff lines, bed classes and blood products. These are dated, not overwritten." asOf={day} />
        <KpiTile label="Codes in use" value={String(stats.inUse)} definition="Rows that a record somewhere already points at — the population a retire has to be careful about." asOf={day} />
        <KpiTile label="Last change" value={stats.lastChange ?? '—'} definition="The most recent change to this catalogue, whoever made it." asOf={day} />
        <KpiTile label="Changes this session" value={String(changes.length)} definition="Edits made on this screen since it loaded. In production each one is an audited write; here they are held in memory." asOf={day} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'catalogue', label: 'Catalogues' },
          { id: 'changes', label: 'Change log', count: changes.length || undefined },
          { id: 'rules', label: 'The rules' },
        ]}
      />

      {tab === 'catalogue' && (
        <div className="grid gap-3 lg:grid-cols-[18rem_1fr]">
          <Panel title="Catalogues" className="h-fit">
            <ul className="space-y-1">
              {CATALOGUES.map((c) => {
                const s = catalogueStats({ ...c, rows: rows[c.id] ?? [] });
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => { setCatalogueId(c.id); setRowId(null); setQuery(''); }}
                      aria-current={c.id === catalogueId ? 'true' : undefined}
                      className={cx(
                        'w-full rounded-md px-3 py-2 text-left text-sm',
                        c.id === catalogueId ? 'bg-brand-50 text-brand-700' : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
                      )}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="block text-xs text-text-tertiary">{c.legacy} · {s.total} row(s)</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <div className="space-y-3">
            <Panel
              title={`${catalogue.name} — ${catalogue.legacy}`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Code or name"
                    aria-label={`Search ${catalogue.name}`}
                    className="h-9 w-40 rounded-md border border-border-default bg-surface-default px-2 text-sm"
                  />
                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} className="size-4" />
                    Show retired
                  </label>
                </div>
              }
            >
              <p className="mb-2 text-sm text-text-secondary">{catalogue.purpose}</p>
              <ListView
                id={`setup-${catalogue.id}`}
                caption={`${catalogue.name} entries`}
                columns={[
                  { key: 'code', header: 'Code', width: '150px' },
                  { key: 'label', header: 'Name', render: (r) => (
                    <span className={cx(r.active ? 'text-text-primary' : 'text-text-tertiary line-through')}>
                      {r.label}
                      {!r.active && <span className="ml-2 no-underline text-xs">retired {r.retiredAt}</span>}
                    </span>
                  ) },
                  ...catalogue.columns.map((col) => ({
                    key: col.key,
                    header: col.header,
                    ...(col.numeric ? { numeric: true, align: 'right' as const } : {}),
                    ...(col.width ? { width: col.width } : {}),
                    hideBelow: 'lg' as const,
                    render: (r: MasterRow) => {
                      const v = r.values[col.key];
                      if (v === undefined) return '—';
                      if (typeof v === 'number' && (col.key === 'price' || col.key === 'nightly' || col.key === 'charge')) return <span className="tabular-nums">{money(v)}</span>;
                      return String(v);
                    },
                  })),
                  { key: 'lastChange', header: 'Last change', hideBelow: 'xl', width: '220px', render: (r) => `${r.lastChange.at} · ${r.lastChange.what}` },
                ]}
                rows={visible}
                rowId={(r) => r.id}
                onRowClick={(r) => { setRowId(r.id); setLabelDraft(r.label); setRetireReason(''); }}
                height="32rem"
                quickSearch={{ value: query, onChange: setQuery, placeholder: 'Code or name…' }}
                emptyLabel="No rows match — check the retired filter, or add the row."
              />
            </Panel>

            <Panel title="Add a row" actions={<span className="text-xs text-text-secondary">Codes are checked for shape and collisions before the row exists</span>}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs text-text-secondary">
                  Code
                  <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder={catalogue.id === 'charges' ? 'CONS-500' : 'CODE'} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                </label>
                <label className="text-xs text-text-secondary sm:col-span-2">
                  Name
                  <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="What the counter sees" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                </label>
                {(catalogue.id === 'charges' || catalogue.id === 'bedclass' || catalogue.id === 'blood') && (
                  <label className="text-xs text-text-secondary">
                    Price
                    <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} inputMode="decimal" placeholder="0" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm tabular-nums" />
                  </label>
                )}
                {catalogue.id === 'charges' && (
                  <label className="text-xs text-text-secondary">
                    Category
                    <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                      {CHARGE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                )}
                <div className="flex items-end">
                  <Button onClick={addRow}>
                    <Plus className="size-4" aria-hidden /> Add to {catalogue.name.split(' ')[0].toLowerCase()}
                  </Button>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'changes' && (
        <Panel title="Change log for this session" actions={<span className="text-xs text-text-secondary">In production this is the audit trail; here it is this tab</span>}>
          {changes.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Nothing has changed yet. Make an edit on the Catalogues tab — every one lands here with its code, its author
              and the sentence that explains it.
            </p>
          ) : (
            <ul className="space-y-2">
              {changes.map((c, i) => (
                <li key={`${c.code}-${i}`} className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p>
                    <span className={cx('font-medium', c.kind === 'retire' ? TONE_TEXT.warning : c.kind === 'restore' ? TONE_TEXT.success : TONE_TEXT.info)}>{c.kind}</span>
                    <span className="ml-2 font-medium text-text-primary">{c.code}</span>
                    <span className="ml-2 text-text-secondary">{c.what}</span>
                  </p>
                  <p className="text-xs text-text-tertiary">
                    {c.at} · {c.by} · {CATALOGUES.find((x) => x.id === c.catalogueId)?.legacy}
                    {c.detail ? ` · ${c.detail}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="Four rules, twelve catalogues">
            <ul className="space-y-2 text-sm">
              <li><span className="font-medium text-text-primary">A code is an identity.</span> <span className="text-text-secondary">Two rows cannot share one inside a catalogue, and the code is never reused after a retire — that is what lets an old bill still resolve to what it said at the time.</span></li>
              <li><span className="font-medium text-text-primary">Nothing is deleted.</span> <span className="text-text-secondary">A row is retired: it leaves the pickers and stays resolvable. The screen says how many records already point at it before the retire is pressed.</span></li>
              <li><span className="font-medium text-text-primary">Every change carries who and when.</span> <span className="text-text-secondary">A tariff change surfaces in a bill three months later; somebody has to be able to explain it.</span></li>
              <li><span className="font-medium text-text-primary">Money rows are dated, not overwritten.</span> <span className="text-text-secondary">A charge has an effective-from, so re-pricing does not rewrite last month’s revenue.</span></li>
            </ul>
          </Panel>
          <Panel title="What breaks if a catalogue is wrong">
            <ul className="space-y-2 text-sm">
              {CATALOGUES.map((c) => (
                <li key={c.id} className="rounded-md border border-border-subtle px-3 py-2">
                  <p className="font-medium text-text-primary">{c.name} <span className="ml-1 text-xs font-normal text-text-tertiary">{c.legacy}</span></p>
                  <p className="text-text-secondary"><span className={cx('inline-flex items-center gap-1', TONE_TEXT.warning)}><ShieldAlert className="size-3.5" aria-hidden /> Risk:</span> {c.risk}</p>
                  <p className="text-xs text-text-tertiary">Owner: {c.owner}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- row sheet */}
      <Sheet
        open={Boolean(row)}
        onClose={() => setRowId(null)}
        title={row ? `${row.code} — ${row.label}` : 'Entry'}
        description={row ? `${catalogue.name} · ${catalogue.legacy}` : undefined}
        footer={
          row && (
            <div className="flex flex-wrap justify-end gap-2">
              {row.active ? (
                <>
                  <Button variant="ghost" onClick={() => rename(row)} disabled={labelDraft.trim() === row.label}>Save the name</Button>
                  <Button variant="danger" onClick={() => retire(row)}>Retire this entry</Button>
                </>
              ) : (
                <Button onClick={() => restore(row)}>Put it back in the pickers</Button>
              )}
            </div>
          )
        }
      >
        {row && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-text-secondary">Code</dt>
                <dd className="font-medium">{row.code} <span className="ml-1 text-xs text-text-tertiary">codes are immutable</span></dd>
              </div>
              <div>
                <dt className="text-xs text-text-secondary">Records pointing at it</dt>
                <dd className={cx('font-medium tabular-nums', usageCount(live, row.code) > 0 ? TONE_TEXT.warning : TONE_TEXT.neutral)}>{usageCount(live, row.code)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-text-secondary">Name, as it appears everywhere</dt>
                <dd>
                  <input
                    value={labelDraft || row.label}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    disabled={!row.active}
                    aria-label="Name"
                    className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm"
                  />
                </dd>
              </div>
            </dl>

            <div>
              <p className="text-xs text-text-secondary">Values</p>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                {Object.entries(row.values).map(([k, v]) => (
                  <li key={k} className="flex justify-between rounded-md border border-border-subtle px-3 py-1.5">
                    <span className="text-text-secondary">{k}</span>
                    <span className="font-medium tabular-nums">{(k === 'price' || k === 'nightly' || k === 'charge') && typeof v === 'number' ? money(v) : String(v)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {row.active ? (
              <div className={cx('rounded-md border px-3 py-2', impact?.message ? 'border-safety-warning/40 bg-safety-warning/5' : 'border-border-subtle')}>
                <p className="font-medium text-text-primary">If this is retired</p>
                <p className="text-text-secondary">
                  {impact?.message ?? 'Nothing points at this row yet, so retiring it costs nothing except the memory of why it existed.'}
                </p>
                <label className="mt-2 block text-xs text-text-secondary">
                  Reason for retiring
                  <input value={retireReason} onChange={(e) => setRetireReason(e.target.value)} placeholder="Replaced by CONS-500; superseded at the FY review" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                </label>
              </div>
            ) : (
              <div className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2">
                <p className="font-medium text-text-primary">Retired {row.retiredAt}</p>
                <p className="text-text-secondary">{row.retiredBecause}</p>
                <p className="mt-1 text-xs text-text-tertiary">
                  It leaves every picker and stays resolvable, which is why a {day.slice(0, 4)} bill printed from an old record still
                  reads correctly.
                </p>
              </div>
            )}

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs text-text-secondary"><History className="size-3.5" aria-hidden /> Last change</p>
              <p className="text-text-primary">{row.lastChange.at} · {row.lastChange.by}</p>
              <p className="text-text-secondary">{row.lastChange.what}</p>
            </div>

            <p className="text-xs text-text-tertiary">
              Where this catalogue is read: {catalogue.id === 'charges' ? <Link href="/billing" className="underline">billing</Link>
                : catalogue.id === 'drugs' || catalogue.id === 'items' ? <Link href="/inventory" className="underline">inventory</Link>
                  : catalogue.id === 'tests' ? <Link href="/diagnostics" className="underline">diagnostics</Link>
                    : catalogue.id === 'vitals' || catalogue.id === 'wards' || catalogue.id === 'bedclass' ? <Link href="/ward" className="underline">the ward</Link>
                      : catalogue.id === 'theatres' ? <Link href="/ot" className="underline">the theatre suite</Link>
                        : catalogue.id === 'blood' ? <Link href="/bloodbank" className="underline">the blood bank</Link>
                          : <Link href="/clinical" className="underline">the consultation screen</Link>}.
            </p>
          </div>
        )}
      </Sheet>

      <p className="text-xs text-text-tertiary">
        Related screens: every module reads from here — <Link href="/billing" className="underline">billing</Link>,{' '}
        <Link href="/pharmacy" className="underline">pharmacy</Link>, <Link href="/diagnostics" className="underline">diagnostics</Link>,{' '}
        <Link href="/ward" className="underline">the ward</Link>, <Link href="/bloodbank" className="underline">the blood bank</Link> and{' '}
        <Link href="/ot" className="underline">the theatres</Link>. Nothing writes to a catalogue except this screen.
      </p>
    </div>
  );
}
