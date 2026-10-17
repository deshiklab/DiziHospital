'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Sheet, cx, useToast } from '@dizi/ui';
import { Baby, FileText, Printer, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { RegistryForm } from '@/components/RegistryForm';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { birthDeathDay, type BirthRecord } from '@/lib/birthdeath';
import {
  BIRTH_COLUMNS,
  BIRTH_FIELDS,
  BIRTH_RULES,
  REGISTRY_NOTE,
  birthFromDraft,
  checkBirthDraft,
  emptyBirthDraft,
  nextRegisterNo,
  registryDay,
  type Draft,
} from '@/lib/registry';

/* Birth & Death Record › Birth Record (P7) — the register’s writing side.
 *
 * The P6 report reads this register and refuses four things in it; this screen is where those four are refused
 * *as the form is typed*: a stillbirth carrying a live-birth registration number, an Apgar score on a stillbirth,
 * a caesarean with no indication, and a birth with nobody’s name against it. Thirty-four fields, in the order the
 * midwife writes them, with the register’s own verdict below the form rather than after saving.
 *
 * Entries are queued through the contract as `recordBirth`, so the hospital’s series stays gapless per node and a
 * record written at three in the morning is complete before any uplink exists. The report shows them once the
 * server has them, and the screen says which ones it does not have yet.
 */

const VIEWS: Array<{ label: string; keep: (b: BirthRecord) => boolean; hint: string }> = [
  { label: 'Everything', keep: () => true, hint: 'The whole day, live births and stillbirths together — the register is one series, and splitting it is how a stillbirth stops being counted.' },
  { label: 'Live births', keep: (b) => b.outcome === 'Live birth', hint: 'The entries that carry a live-birth registration. These are the ones a birth certificate is issued from.' },
  { label: 'Stillbirths', keep: (b) => b.outcome === 'Stillbirth', hint: 'A birth in the register with its outcome recorded, and no live-birth registration filed. A family that receives a certificate for a child who did not live is asked for it again, at school.' },
  { label: 'Low birth weight', keep: (b) => b.outcome === 'Live birth' && b.weightGrams < 2500, hint: 'Under 2 500 g: a feeding plan and a follow-up date rather than a routine discharge.' },
  { label: 'Registration open', keep: (b) => b.civil.state === 'Not yet filed' || b.civil.state === 'Started online' || b.civil.state === 'Filed, number awaited', hint: 'The civil registration is not closed. Filed before the family leaves the district, not after — applied for from another city it takes months.' },
  { label: 'Vitamins outstanding', keep: (b) => b.outcome === 'Live birth' && (!b.vitaminKGiven || !b.bcgGiven), hint: 'Vitamin K or BCG still to be given before discharge. Both prevent an illness three weeks later, at home, where nobody connects it to the register.' },
];

export default function BirthRecordPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const register = useMemo(() => birthDeathDay(day), [day]);
  const [written, setWritten] = useState<BirthRecord[]>([]);
  const [view, setView] = useState('Everything');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyBirthDraft(day, nextRegisterNo('birth', day, register.births.map((b) => b.registerNo))));

  const dayRegister = useMemo(() => registryDay(day, written), [day, written]);
  const rows = useMemo(() => {
    const active = VIEWS.find((v) => v.label === view) ?? VIEWS[0];
    const q = query.trim().toLowerCase();
    return dayRegister.births
      .filter(active.keep)
      .filter((b) => !q || b.mother.name.toLowerCase().includes(q) || b.mother.mrn.toLowerCase().includes(q) || b.registerNo.toLowerCase().includes(q) || b.attendedBy.toLowerCase().includes(q))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [dayRegister.births, view, query]);

  const record = selected ? dayRegister.births.find((b) => b.id === selected) ?? null : null;
  const check = useMemo(() => checkBirthDraft(draft, day), [draft, day]);
  const stats = useMemo(() => {
    const births = dayRegister.births;
    return {
      births: births.length,
      live: births.filter((b) => b.outcome === 'Live birth').length,
      still: births.filter((b) => b.outcome === 'Stillbirth').length,
      caesarean: births.filter((b) => b.type === 'Caesarean').length,
      lbw: births.filter((b) => b.outcome === 'Live birth' && b.weightGrams < 2500).length,
      open: births.filter((b) => b.civil.state === 'Not yet filed' || b.civil.state === 'Started online' || b.civil.state === 'Filed, number awaited').length,
      vitamins: births.filter((b) => b.outcome === 'Live birth' && (!b.vitaminKGiven || !b.bcgGiven)).length,
    };
  }, [dayRegister.births]);

  const save = () => {
    const fresh = checkBirthDraft(draft, day);
    if (!fresh.ok) {
      push({
        title: `The register refuses this entry — ${fresh.reasons[0].code}`,
        description: fresh.reasons[0].message,
        tone: 'critical',
      });
      return;
    }
    const entry = birthFromDraft(draft, day);
    setWritten((list) => [entry, ...list]);
    setFormOpen(false);
    const outcome = queueWrite(`Birth ${entry.registerNo}: ${entry.mother.name}, ${entry.sex.toLowerCase()}, ${entry.weightGrams} g`, {
      id: 'recordBirth',
      recordId: entry.registerNo,
      fields: { registerNo: entry.registerNo, at: entry.at, outcome: entry.outcome, sex: entry.sex, weightGrams: entry.weightGrams, attendedBy: entry.attendedBy },
    });
    const next = nextRegisterNo('birth', day, [entry.registerNo, ...dayRegister.births.map((b) => b.registerNo)]);
    setDraft(emptyBirthDraft(day, next));
    push({
      title: outcome.queued ? `${entry.registerNo} recorded on this device` : `${entry.registerNo} recorded, not queued`,
      description: outcome.queued
        ? `The number comes from this node’s own block, so the entry is complete now. It reaches Reports › Birth Death when the server has it — ${syncEngine.summary.pending} write${syncEngine.summary.pending === 1 ? '' : 's'} in the queue.`
        : `The contract does not queue this write ${outcome.because}`,
      tone: outcome.queued ? (check.warnings.length ? 'warning' : 'success') : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="birth-record"
        subtitle={`${day} · ${BIRTH_FIELDS.length} fields · the register Reports › Birth Death reads.`}
        actions={
          <>
            <Link href="/admin/birthordeath/death">
              <Button variant="ghost">Death record</Button>
            </Link>
            <Link href="/reports/birth_death">
              <Button variant="ghost">Open the report</Button>
            </Link>
            <Button variant="primary" onClick={() => { setDraft(emptyBirthDraft(day, nextRegisterNo('birth', day, dayRegister.births.map((b) => b.registerNo)))); setFormOpen(true); }}>
              <Baby className="size-4" aria-hidden /> Record a birth
            </Button>
          </>
        }
        waiting={syncEngine.summary.pending > 0 ? `${syncEngine.summary.pending} record(s) waiting to sync: they are in the register below and not yet in the report.` : undefined}
      />

      <AdminSiblings screenId="birth-record" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <KpiTile label="Births today" value={String(stats.births)} definition="Live births and stillbirths together: the register is one series, and a stillbirth that is not counted as a birth is a death nobody counts at all." asOf={day} />
        <KpiTile label="Live births" value={String(stats.live)} definition="Entries a live-birth registration can be issued from, each with vitamin K and BCG recorded or a reason why not." asOf={day} />
        <KpiTile label="Stillbirths" value={String(stats.still)} definition="Recorded as births with the outcome recorded, and with no live-birth registration filed." asOf={day} footnote={stats.still ? 'civil registration not applicable' : undefined} />
        <KpiTile label="Caesareans" value={String(stats.caesarean)} definition="Each one carries an indication. It is the operation the next pregnancy is planned around." asOf={day} />
        <KpiTile label="Low birth weight" value={String(stats.lbw)} definition="Live births under 2 500 g, with a feeding plan and a follow-up date rather than a routine discharge." asOf={day} />
        <KpiTile label="Registration open" value={String(stats.open)} definition="Civil registration not closed. The register carries the clock because the corporation’s queue is not the hospital’s." asOf={day} />
        <KpiTile label="Vitamins outstanding" value={String(stats.vitamins)} definition="Live births where vitamin K or BCG is still to be given. Both prevent an illness three weeks later, at home." asOf={day} />
      </div>

      {dayRegister.queuedBirths > 0 && (
        <SafetyBanner severity="warning" title={`${dayRegister.queuedBirths} entry written on this device`}>
          It is in the register below with its number already drawn, and it reaches the report and the cloud when the
          queue drains. The number is not duplicated while it waits: it comes from this node’s own block.
        </SafetyBanner>
      )}

      <Panel title="The register" actions={<span className="text-xs text-text-secondary">{BIRTH_COLUMNS.length} columns · {rows.length} of {dayRegister.births.length} rows</span>}>
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.label}
              type="button"
              aria-pressed={view === v.label}
              onClick={() => setView(v.label)}
              title={v.hint}
              className={cx('rounded-full border px-2 py-0.5 text-xs', view === v.label ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border-subtle text-text-secondary hover:bg-surface-sunken')}
            >
              {v.label} <span className="font-numeric">{dayRegister.births.filter(v.keep).length}</span>
            </button>
          ))}
        </div>
        <ListView
          id="birth-register"
          caption={`Birth register for ${day}`}
          rows={rows}
          rowId={(b) => b.id}
          onRowClick={(b) => setSelected(b.id)}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Mother, MRN, register number or attendant' }}
          emptyLabel="No births match this view."
          columns={[
            { key: 'registerNo', header: 'Register no.', width: '8rem', render: (b) => <span className="font-numeric">{b.registerNo}</span>, tooltip: 'The hospital’s own series, gapless and never reused — which is what makes a missing entry visible.' },
            { key: 'at', header: 'Born', width: '8.5rem', render: (b) => <span className="font-numeric">{b.at.slice(11)}</span> },
            { key: 'mother', header: 'Mother (MRN)', render: (b) => (<span><span className="font-medium">{b.mother.name}</span> <span className="font-numeric text-xs text-text-tertiary">{b.mother.mrn}</span></span>) },
            { key: 'gravidaPara', header: 'G/P', width: '5rem' },
            { key: 'wardId', header: 'Ward / bed', width: '7rem', hideBelow: 'md', render: (b) => `${b.wardId} ${b.bedId}` },
            { key: 'type', header: 'Delivery', hideBelow: 'lg' },
            { key: 'outcome', header: 'Outcome', render: (b) => <span className={cx('font-medium', b.outcome === 'Stillbirth' ? 'text-safety-critical' : 'text-safety-success')}>{b.outcome}</span> },
            { key: 'sex', header: 'Sex', width: '5rem', hideBelow: 'md' },
            { key: 'weightGrams', header: 'Weight', width: '6rem', align: 'right', numeric: true, render: (b) => `${b.weightGrams} g` },
            { key: 'apgar', header: 'Apgar', width: '5.5rem', hideBelow: 'lg', render: (b) => `${b.apgar.oneMin}/${b.apgar.fiveMin}` },
            { key: 'civil', header: 'Civil registration', hideBelow: 'lg', render: (b) => (<span className={cx(b.civil.state === 'Number issued' ? 'text-safety-success' : 'text-safety-warning')}>{b.civil.state}{b.civil.number ? ` · ${b.civil.number}` : ''}</span>) },
          ]}
        />
      </Panel>

      <Panel title="The register’s four rules, enforced as the form is typed" actions={<span className="text-xs text-text-secondary">P6 rules, P7 entry</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {BIRTH_RULES.map((rule) => (
            <li key={rule.title} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-start gap-1.5 font-medium text-text-primary"><ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {rule.title}</p>
              <p className="text-text-secondary">{rule.because}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-tertiary">{REGISTRY_NOTE}</p>
      </Panel>

      {/* ----------------------------------------------------------------------------------------- the entry form */}
      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={`Record a birth — ${draft.registerNo}`}
        description={`${BIRTH_FIELDS.length} fields in the order the midwife writes them. The register’s verdict is below the form.`}
        width="xl"
        busy={false}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={cx('mr-auto text-xs', check.ok ? 'text-safety-success' : 'text-safety-critical')}>
              {check.ok ? 'The register would accept this entry.' : `${check.reasons.length} refusal(s) — the first is shown below.`}
            </span>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save}>Record and queue</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <SafetyBanner severity={check.ok ? (check.warnings.length ? 'warning' : 'success') : 'critical'} title={check.ok ? (check.warnings.length ? `${check.warnings.length} thing(s) the register records and passes on` : 'Nothing to refuse') : check.reasons[0].code}>
            {check.ok ? (
              check.warnings.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {check.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : (
                <>
                  The birth is complete: an attendant, an outcome, a weight, an Apgar where there is a living newborn, and a
                  registration state. Vitamin K and BCG are recorded either way, because the illness they prevent arrives three
                  weeks later, at home.
                </>
              )
            ) : (
              <>
                {check.reasons[0].message}
                {check.reasons.length > 1 && <span className="mt-1 block">{check.reasons.length - 1} more refusal(s) behind this one — the register lists them all once this is fixed.</span>}
              </>
            )}
          </SafetyBanner>

          <RegistryForm fields={BIRTH_FIELDS} draft={draft} onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))} />

          <Panel title="What this entry becomes">
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-text-secondary">Register number</dt>
                <dd className="font-numeric">{draft.registerNo} <span className="text-xs text-text-tertiary">from this node’s block</span></dd>
              </div>
              <div>
                <dt className="text-xs text-text-secondary">Civil registration</dt>
                <dd>{draft.civilState}{draft.civilNumber ? ` · ${draft.civilNumber}` : ''}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-secondary">Prints</dt>
                <dd>
                  <Link href="/print/birth-certificate" className="underline">
                    Birth record
                  </Link>{' '}
                  <span className="text-xs text-text-tertiary">— the hospital’s own record; the civil certificate is the corporation’s.</span>
                </dd>
              </div>
            </dl>
          </Panel>
        </div>
      </Sheet>

      {/* ---------------------------------------------------------------------------------------------- one entry */}
      <Sheet
        open={Boolean(record)}
        onClose={() => setSelected(null)}
        title={record ? `${record.registerNo} — ${record.mother.name}` : 'Entry'}
        description={record ? `Born ${record.at} · ${record.type} · ${record.outcome}` : undefined}
        width="lg"
        footer={
          record && (
            <div className="flex justify-end gap-2">
              <Link href="/print/birth-certificate">
                <Button variant="ghost">
                  <Printer className="size-4" aria-hidden /> Print the record
                </Button>
              </Link>
              <Link href="/reports/birth_death">
                <Button variant="ghost">
                  <FileText className="size-4" aria-hidden /> Where it is reported
                </Button>
              </Link>
            </div>
          )
        }
      >
        {record && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              {[
                ['Mother', `${record.mother.name} · ${record.mother.mrn}`],
                ['Age / gravida', `${record.mother.age} y · ${record.gravidaPara}`],
                ['Ward and bed', `${record.wardId} ${record.bedId}`],
                ['Delivery', `${record.type} at ${record.at.slice(11)}`],
                ['Attended by', record.attendedBy],
                ['Newborn', `${record.sex} · ${record.weightGrams} g · Apgar ${record.apgar.oneMin}/${record.apgar.fiveMin}`],
                ['Vitamin K / BCG', `${record.vitaminKGiven ? 'given' : 'not given'} / ${record.bcgGiven ? 'given' : 'not given'}`],
                ['First feed', record.firstFeedAt ? record.firstFeedAt.slice(11) : 'not recorded'],
                ['Discharge', record.dischargeAt ?? 'still an in-patient'],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {record.complications.length > 0 && (
              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="font-medium text-text-primary">Labour</p>
                <p className="text-text-secondary">{record.complications.join(' · ')}</p>
              </div>
            )}
            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="font-medium text-text-primary">Civil registration</p>
              <p className={cx(record.civil.state === 'Number issued' ? 'text-safety-success' : 'text-safety-warning')}>
                {record.civil.state}
                {record.civil.number ? ` · ${record.civil.number}` : ''}
              </p>
              {record.civil.state !== 'Number issued' && (
                <p className="text-xs text-text-secondary">
                  Open. It is filed before the family leaves the district: a birth certificate applied for from another city takes
                  months, and the family is the one waiting.
                </p>
              )}
            </div>
            {record.note && <p className="text-text-secondary">{record.note}</p>}
          </div>
        )}
      </Sheet>
    </div>
  );
}
