'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  EmptyState,
  KpiTile,
  Panel,
  Sheet,
  Tabs,
  cx,
  useToast,
} from '@dizi/ui';
import { PackageSearch, TriangleAlert } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { patients } from '@/lib/mock';
import { useShell } from '@/lib/shell';
import { money } from '@/lib/billing';
import { DRUGS, generateBatches, type Drug } from '@/lib/pharmacy';
import { STORES } from '@/lib/inventory';
import {
  EXPIRY_WARNING_DAYS,
  SUBSTITUTION_RULES,
  allergiesOf,
  allergyConflict,
  hit,
  searchCatalogue,
  searchStore,
  substitutionOptions,
  type DrugHit,
  type SearchFilters,
} from '@/lib/drug-search';

/* Medicine search (legacy screen 012 — the pharmacy search — replaced) — the P3 sub-screen.
 *
 * Four questions in the order a counter asks them: is it in the building (which store, which batch, how long
 * until it expires), what may be substituted legally, will it hurt this patient, and what does it cost. The
 * substitution rules and the allergy check live in `lib/drug-search.ts`, so the answer is the same at the counter
 * at 02:00 as it is on this screen at 11:00.
 *
 * Preview: the catalogue and the batches are the pharmacy module's own synthetic data. Nothing survives a reload;
 * the rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

export default function PharmacySearchPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const batches = useMemo(() => generateBatches(day), [day]);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({ inStockOnly: false, avoidAllergens: [], hideControlled: false });
  const [patientMrn, setPatientMrn] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState('medicines');

  const hits = useMemo(() => searchCatalogue(query, day, filters, batches), [query, day, filters, batches]);
  const storeHits = useMemo(() => searchStore(query, day), [query, day]);
  const drug: DrugHit | null = openId ? hits.find((h) => h.drug.id === openId) ?? null : null;
  const options = drug ? substitutionOptions(drug.drug, day, batches) : [];
  const patient = patients.find((p) => p.mrn === patientMrn);
  const patientAllergies = patientMrn ? allergiesOf(patientMrn) : [];

  const worstAllergen = drug && patientAllergies.length ? allergyConflict(drug.drug, patientAllergies) : null;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <PackageSearch className="size-5 text-brand-600" aria-hidden />
            Medicine search
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — what is in the building, what may be given instead, and what this patient must not have.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-text-secondary">
            Search
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Brand, generic, class, strength…"
              className="mt-1 h-9 w-72 rounded-md border border-border-default bg-surface-default px-2 text-sm"
            />
          </label>
          <label className="text-xs text-text-secondary">
            Patient (for the allergy check)
            <select value={patientMrn} onChange={(e) => setPatientMrn(e.target.value)} className="mt-1 h-9 w-56 rounded-md border border-border-default bg-surface-default px-2 text-sm">
              <option value="">No patient selected</option>
              {patients.slice(0, 20).map((p) => <option key={p.mrn} value={p.mrn}>{p.name} · {p.mrn}{p.allergies ? ' · allergies' : ''}</option>)}
            </select>
          </label>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Formulary" value={String(DRUGS.length)} definition="Medicines in the formulary; consumables and reagents are searched from the store tab." asOf={day} />
        <KpiTile label="Results" value={String(hits.length)} definition="Matches for the current search, filters applied." asOf={day} />
        <KpiTile label="Out of stock" value={String(hits.filter((h) => h.onHand === 0).length)} definition="Matching medicines with nothing usable in any store." asOf={day} />
        <KpiTile label="Expiring soon" value={String(hits.filter((h) => (h.daysToNearest ?? 9999) <= EXPIRY_WARNING_DAYS).length)} definition={`Nearest usable batch expires within ${EXPIRY_WARNING_DAYS} days — offered first, and flagged here.`} asOf={day} />
        <KpiTile label="Controlled" value={String(hits.filter((h) => h.drug.controlled).length)} definition="Matches that are controlled: counter register, a witness, and never substituted." asOf={day} />
        <KpiTile label="Stores searched" value={String(STORES.length)} definition="Every store in the building is searched, because the counter shelf running out is not the same as the hospital running out." asOf={day} />
      </div>

      <Panel title="Filters" actions={<span className="text-xs text-text-secondary">The patient-specific filter is the one that matters clinically</span>}>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-text-secondary">
            <input type="checkbox" checked={filters.inStockOnly} onChange={(e) => setFilters({ ...filters, inStockOnly: e.target.checked })} className="size-4" />
            In stock anywhere
          </label>
          <label className="flex items-center gap-2 text-text-secondary">
            <input type="checkbox" checked={filters.hideControlled} onChange={(e) => setFilters({ ...filters, hideControlled: e.target.checked })} className="size-4" />
            Hide controlled medicines
          </label>
          <label className="flex items-center gap-2 text-text-secondary">
            <input
              type="checkbox"
              checked={filters.avoidAllergens.length > 0}
              disabled={!patientMrn || patientAllergies.length === 0}
              onChange={(e) => setFilters({ ...filters, avoidAllergens: e.target.checked ? patientAllergies : [] })}
              className="size-4"
            />
            Exclude this patient’s allergens{patientMrn && patientAllergies.length > 0 ? ` (${patientAllergies.join(', ')})` : ''}
          </label>
        </div>
        {patientMrn && patientAllergies.length === 0 && (
          <p className="mt-2 text-xs text-text-tertiary">This patient has no allergies recorded — the check runs either way, it simply has nothing to match.</p>
        )}
      </Panel>

      {tab === 'medicines' && (
        <Panel title={`${hits.length} match(es)`} actions={<span className="text-xs text-text-secondary">Open a medicine for its batches, substitutes and cost</span>}>
          {hits.length === 0 ? (
            <EmptyState title="Nothing matches" description="Try the generic name, or clear the filters — an out-of-stock match is still an answer worth having." />
          ) : (
            <ListView
              id="drug-search"
              caption="Medicines matching the search"
              height="30rem"
              rows={hits}
              rowId={(h) => h.drug.id}
              onRowClick={(h) => setOpenId(h.drug.id)}
              columns={[
                { key: 'brand', header: 'Medicine', render: (h) => (
                  <span>
                    <span className="font-medium text-text-primary">{h.drug.brand}</span>
                    <span className="ml-2 text-xs text-text-tertiary">{h.drug.generic} {h.drug.strength} · {h.drug.form}</span>
                  </span>
                ) },
                { key: 'klass', header: 'Class', hideBelow: 'lg', render: (h) => h.drug.klass },
                { key: 'onHand', header: 'On hand', numeric: true, align: 'right', width: '110px', render: (h) => (
                  <span className={cx(h.onHand === 0 ? TONE_TEXT.critical : h.onHand < 50 ? TONE_TEXT.warning : TONE_TEXT.success)}>{h.onHand}</span>
                ) },
                { key: 'store', header: 'Nearest store', hideBelow: 'md', width: '150px', render: (h) => h.byStore[0]?.store ?? '—' },
                { key: 'expiry', header: 'Use before', width: '140px', render: (h) => (
                  h.nearestExpiry
                    ? <span className={cx((h.daysToNearest ?? 0) <= EXPIRY_WARNING_DAYS ? TONE_TEXT.warning : TONE_TEXT.neutral)}>{h.nearestExpiry} · {h.daysToNearest} d</span>
                    : <span className="text-text-tertiary">—</span>
                ) },
                { key: 'flags', header: 'Flags', width: '200px', render: (h) => (
                  <span className="flex flex-wrap gap-1">
                    {h.drug.controlled && <span className="rounded-full bg-safety-critical/10 px-2 py-0.5 text-[10px] text-safety-critical">controlled</span>}
                    {h.drug.highAlert && <span className="rounded-full bg-safety-warning/10 px-2 py-0.5 text-[10px] text-safety-warning">high alert</span>}
                    {h.drug.allergenTags.length > 0 && <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] text-text-secondary">{h.drug.allergenTags.join('/')}</span>}
                    {h.expiredQty > 0 && <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] text-text-tertiary">{h.expiredQty} expired</span>}
                  </span>
                ) },
                { key: 'price', header: 'Unit price', numeric: true, align: 'right', width: '110px', render: (h) => money(h.drug.price) },
              ]}
            />
          )}
        </Panel>
      )}

      {tab === 'store' && (
        <Panel title="Consumables and reagents" actions={<span className="text-xs text-text-secondary">From the store module: a cannula is searched the same way a tablet is</span>}>
          {storeHits.length === 0 ? (
            <EmptyState title="Nothing in the stores matches" description="Try “cannula”, “saline”, “gauze” or “strip”, or clear the search to list what is on hand." />
          ) : (
            <ul className="space-y-2">
              {storeHits.map((r) => (
                <li key={r.item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-text-primary">{r.item.name}</span>
                    <span className="ml-2 text-xs text-text-tertiary">{r.item.category} · {r.item.unit} · {r.item.packUnit}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-xs">
                    <span className={cx(r.onHand < 50 ? TONE_TEXT.warning : TONE_TEXT.success)}>{r.onHand} on hand</span>
                    <span className="text-text-tertiary">{r.stores.join(' · ') || 'no store'}</span>
                    {r.nearestExpiry && <span className="text-text-tertiary">use before {r.nearestExpiry}</span>}
                    {r.coldChain && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">cold chain</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'medicines', label: 'Medicines', count: hits.length },
          { id: 'store', label: 'Store items', count: storeHits.length },
          { id: 'rules', label: 'Substitution and allergy rules' },
        ]}
      />

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="What may be substituted, and what may not">
            <ul className="space-y-2 text-sm">
              {SUBSTITUTION_RULES.map((r) => (
                <li key={r.rule}>
                  <span className="font-medium text-text-primary">{r.rule}.</span> <span className="text-text-secondary">{r.because}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="The allergy check">
            <p className="text-sm text-text-secondary">
              Every formulary entry carries the allergen group it belongs to — penicillin, sulfa drugs, NSAIDs and so on. The check runs against the
              patient’s recorded allergies from the register, in the same words the record uses, and it is shown on this screen and at the counter
              before a box is handed over. This is the reason <Link href="/patients" className="underline">the patient record</Link> keeps allergies
              as a field and not as a note.
            </p>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- medicine sheet */}
      <Sheet
        open={Boolean(drug)}
        onClose={() => setOpenId(null)}
        title={drug ? `${drug.drug.brand} ${drug.drug.strength}` : 'Medicine'}
        description={drug ? `${drug.drug.generic} · ${drug.drug.form} · ${drug.drug.klass}` : undefined}
        width="xl"
        footer={
          drug && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  queueWrite(`Substitution recorded: ${drug.drug.brand} ${drug.drug.strength} for ${query || 'the prescribed brand'} at the counter`);
                  push({
                    title: 'Substitution recorded on the line',
                    description: '“Dispensed as” is a fact about the patient’s medication history. A silent swap makes the next prescriber’s decision wrong.',
                    tone: 'success',
                  });
                }}
              >
                Record a substitution
              </Button>
              <Link href="/pharmacy" className="inline-flex">
                <Button variant="ghost">Open the dispensing queue</Button>
              </Link>
            </div>
          )
        }
      >
        {drug && (
          <div className="space-y-3 text-sm">
            {worstAllergen && (
              <div className={cx('rounded-md border px-3 py-2', worstAllergen.conflict ? 'border-safety-critical/40 bg-safety-critical/5' : 'border-border-subtle')}>
                <p className="flex items-center gap-1.5 font-medium text-text-primary">
                  <TriangleAlert className={cx('size-4', worstAllergen.conflict ? TONE_TEXT.critical : TONE_TEXT.neutral)} aria-hidden /> Allergy check
                </p>
                <p className={cx('text-text-secondary')}>{worstAllergen.message}</p>
                {worstAllergen.conflict && (
                  <p className="mt-1 text-xs text-text-tertiary">
                    The counter may not dispense it and may not substitute within the same group. The prescriber changes the prescription, and the
                    change is on the record.
                  </p>
                )}
              </div>
            )}

            <dl className="grid gap-3 sm:grid-cols-4">
              <div><dt className="text-xs text-text-secondary">On hand</dt><dd className="font-medium tabular-nums">{drug.onHand}</dd></div>
              <div><dt className="text-xs text-text-secondary">Nearest expiry</dt><dd className="font-medium">{drug.nearestExpiry ?? '—'}{drug.daysToNearest !== undefined ? ` (${drug.daysToNearest} d)` : ''}</dd></div>
              <div><dt className="text-xs text-text-secondary">Unit price</dt><dd className="font-medium tabular-nums">{money(drug.drug.price)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Allergen groups</dt><dd className="font-medium">{drug.drug.allergenTags.join(' · ') || 'none recorded'}</dd></div>
            </dl>

            <div>
              <p className="font-medium text-text-primary">Batches by store — first expiry first</p>
              {drug.byStore.length === 0 ? (
                <p className="text-text-secondary">Nothing usable in any store. The main store is the one to ask; a counter that says “no stock” when the store room has it wastes a patient’s afternoon.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {drug.byStore.map((s) => (
                    <li key={s.store} className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-1.5">
                      <span>{s.store} · {s.batches} batch(es)</span>
                      <span className="tabular-nums text-text-secondary">{s.qty} units · use before {s.nearestExpiry}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="font-medium text-text-primary">Substitutes on the shelf</p>
              {options.length === 0 ? (
                <p className="text-text-secondary">No other brand of this molecule in the formulary — a shortage here is a conversation with the prescriber.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {options.map((o) => (
                    <li key={o.drug.id} className={cx('flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2', o.legal ? 'border-border-subtle' : 'border-safety-warning/30 bg-safety-warning/5')}>
                      <span>
                        <span className="font-medium text-text-primary">{o.drug.brand} {o.drug.strength}</span>
                        <span className="ml-2 text-xs text-text-tertiary">{o.onHand} on hand · {money(o.pricePerUnit)} per unit{o.priceDifference !== 0 ? ` (${o.priceDifference > 0 ? '+' : ''}${money(o.priceDifference)} against this one)` : ''}</span>
                      </span>
                      <span className={cx('max-w-[24rem] text-xs', o.legal ? TONE_TEXT.success : TONE_TEXT.warning)}>{o.because}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="text-xs text-text-tertiary">
              Related screens: <Link href="/pharmacy" className="underline">the dispensing queue</Link> uses this catalogue,{' '}
              <Link href="/inventory" className="underline">inventory</Link> holds the batches and the suppliers, and{' '}
              <Link href="/setup" className="underline">Setup › Medicine master</Link> is where the controls and allergen groups are maintained.
            </p>
          </div>
        )}
      </Sheet>

      <p className="text-xs text-text-tertiary">
        Related screens: <Link href="/pharmacy/returns" className="underline">sale returns</Link> is where medicines come back, and{' '}
        <Link href="/setup" className="underline">Setup</Link> holds the formulary this search reads.
      </p>
    </div>
  );
}
