'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Sheet, cx, useToast } from '@dizi/ui';
import { FileText, Printer, ScrollText, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { RegistryForm } from '@/components/RegistryForm';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { birthDeathDay, canReleaseBody, certificateState, checkDeath, type DeathRecord } from '@/lib/birthdeath';
import {
  DEATH_COLUMNS,
  DEATH_FIELDS,
  DEATH_RULES,
  REGISTRY_NOTE,
  checkDeathDraft,
  deathFromDraft,
  emptyDeathDraft,
  nextRegisterNo,
  registryDay,
  type Draft,
} from '@/lib/registry';

/* Birth & Death Record › Death Record (P7) — the register’s writing side.
 *
 * The P6 report refuses five things here, and every one of them is a thing a family hits rather than an auditor:
 * a death with no cause, a certificate issued without a cause on it, an unnatural death with no police station
 * recorded, a body released without the paper, a body released to nobody. The form refuses them as they are typed,
 * and the release panel does not offer the button until `canReleaseBody` agrees — which is a stronger promise than
 * a red label someone can click past.
 *
 * Cause of death is recorded the way a certificate is written: the immediate cause, then what led to it, then the
 * underlying condition. Three lines, because "cardiac arrest" alone is a mechanism and every district’s leading
 * cause of death would be cardiac arrest.
 */

const VIEWS: Array<{ label: string; keep: (d: DeathRecord) => boolean; hint: string }> = [
  { label: 'Everything', keep: () => true, hint: 'The whole day, in-patient deaths and brought-in-dead together — one series, because a death is a death whatever door it came through.' },
  { label: 'Certified', keep: (d) => Boolean(d.certificateNo), hint: 'A medical certificate of cause of death has been issued with a number on it.' },
  { label: 'Registration open', keep: (d) => d.civil.state !== 'Number issued', hint: 'The civil registration is not closed. It is the registrar’s clock, and the family is the one it runs against.' },
  { label: 'Awaiting release', keep: (d) => !d.releasedAt, hint: 'The body is still in the mortuary. The register keeps the clock on this one too.' },
  { label: 'Unnatural', keep: (d) => d.manner.startsWith('Unnatural') || d.manner.startsWith('Unknown'), hint: 'Referred to the police, with the station recorded. The one entry where the hospital is a witness.' },
  { label: 'Uncertified', keep: (d) => !d.certificateNo, hint: 'No certificate number yet. A death without a cause on paper is a death no statistic can use, including the ones that decide where a maternity unit gets built.' },
];

const nameOf = (d: DeathRecord) => d.patient?.name ?? 'Unidentified (never registered)';

export default function DeathRecordPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const register = useMemo(() => birthDeathDay(day), [day]);
  const [written, setWritten] = useState<DeathRecord[]>([]);
  const [view, setView] = useState('Everything');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDeathDraft(day, nextRegisterNo('death', day, register.deaths.map((d) => d.registerNo))));

  const dayRegister = useMemo(() => registryDay(day, undefined, written), [day, written]);
  const rows = useMemo(() => {
    const active = VIEWS.find((v) => v.label === view) ?? VIEWS[0];
    const q = query.trim().toLowerCase();
    return dayRegister.deaths
      .filter(active.keep)
      .filter((d) => !q || nameOf(d).toLowerCase().includes(q) || d.registerNo.toLowerCase().includes(q) || (d.patient?.mrn ?? 'unregistered').toLowerCase().includes(q) || (d.certifiedBy ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [dayRegister.deaths, view, query]);

  const record = selected ? dayRegister.deaths.find((d) => d.id === selected) ?? null : null;
  const check = useMemo(() => checkDeathDraft(draft, day), [draft, day]);
  const stats = useMemo(() => {
    const deaths = dayRegister.deaths;
    return {
      deaths: deaths.length,
      inPatient: deaths.filter((d) => d.kind === 'In-patient').length,
      broughtIn: deaths.filter((d) => d.kind !== 'In-patient').length,
      certified: deaths.filter((d) => Boolean(d.certificateNo)).length,
      unnatural: deaths.filter((d) => d.manner.startsWith('Unnatural') || d.manner.startsWith('Unknown')).length,
      awaitingRelease: deaths.filter((d) => !d.releasedAt).length,
      open: deaths.filter((d) => d.civil.state !== 'Number issued').length,
    };
  }, [dayRegister.deaths]);

  const save = () => {
    const fresh = checkDeathDraft(draft, day);
    if (!fresh.ok) {
      push({ title: `The register refuses this entry — ${fresh.reasons[0].code}`, description: fresh.reasons[0].message, tone: 'critical' });
      return;
    }
    const entry = deathFromDraft(draft, day);
    setWritten((list) => [entry, ...list]);
    setFormOpen(false);
    const outcome = queueWrite(`Death ${entry.registerNo}: ${nameOf(entry)}, ${entry.cause.immediate || 'cause not stated'}`, {
      id: 'recordDeath',
      recordId: entry.registerNo,
      fields: { registerNo: entry.registerNo, at: entry.at, manner: entry.manner, immediateCause: entry.cause.immediate, certifiedBy: entry.certifiedBy ?? '' },
    });
    setDraft(emptyDeathDraft(day, nextRegisterNo('death', day, [entry.registerNo, ...dayRegister.deaths.map((d) => d.registerNo)])));
    push({
      title: outcome.queued ? `${entry.registerNo} recorded on this device` : `${entry.registerNo} recorded, not queued`,
      description: outcome.queued
        ? `It reaches Reports › Birth Death when the server has it — ${syncEngine.summary.pending} write${syncEngine.summary.pending === 1 ? '' : 's'} in the queue. Nothing on the certificate waits for the uplink.`
        : `The contract does not queue this write ${outcome.because}`,
      tone: outcome.queued ? (check.warnings.length ? 'warning' : 'success') : 'warning',
    });
  };

  const release = (death: DeathRecord) => {
    const verdict = canReleaseBody(death);
    if (!verdict.ok) {
      push({ title: `${death.registerNo}: the body stays in the mortuary`, description: verdict.because, tone: 'critical' });
      return;
    }
    const outcome = queueWrite(`Release ${death.registerNo} to ${death.releasedTo}`, {
      id: 'recordDeath',
      recordId: death.registerNo,
      fields: { releasedAt: death.releasedAt, releasedTo: death.releasedTo },
    });
    push({
      title: `${death.registerNo}: release recorded`,
      description: `${verdict.because}${outcome.queued ? ' Queued for the server.' : ` Not queued: ${outcome.because}.`}`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="death-record"
        subtitle={`${day} · ${DEATH_FIELDS.length} fields · the register Reports › Birth Death reads.`}
        actions={
          <>
            <Link href="/admin/birthordeath">
              <Button variant="ghost">Birth record</Button>
            </Link>
            <Link href="/reports/birth_death">
              <Button variant="ghost">Open the report</Button>
            </Link>
            <Button variant="primary" onClick={() => { setDraft(emptyDeathDraft(day, nextRegisterNo('death', day, dayRegister.deaths.map((d) => d.registerNo)))); setFormOpen(true); }}>
              <ScrollText className="size-4" aria-hidden /> Record a death
            </Button>
          </>
        }
        waiting={syncEngine.summary.pending > 0 ? `${syncEngine.summary.pending} record(s) waiting to sync: the release paper is issued from this device either way.` : undefined}
      />

      <AdminSiblings screenId="death-record" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <KpiTile label="Deaths today" value={String(stats.deaths)} definition="In-patient deaths and patients brought in dead, one series, in the order the register meets them." asOf={day} />
        <KpiTile label="In-patient" value={String(stats.inPatient)} definition="Died in a bed here, with a ward, a consultant and a course of treatment behind the cause of death written on the certificate." asOf={day} />
        <KpiTile label="Brought in dead" value={String(stats.broughtIn)} definition="Arrived with no heartbeat and no history. Where the manner is unnatural, the register is a witness rather than a clinician." asOf={day} />
        <KpiTile label="Certified" value={String(stats.certified)} definition="A medical certificate of cause of death has been issued with a number on it, so the cause is a cause and not a mechanism." asOf={day} />
        <KpiTile label="Unnatural" value={String(stats.unnatural)} definition="Referred to the police, with the station recorded and the certificate written by the doctor who saw the body." asOf={day} />
        <KpiTile label="Awaiting release" value={String(stats.awaitingRelease)} definition="The body is still with the hospital, released to a named person against paper. Nobody collects a body by producing a prescription slip." asOf={day} />
        <KpiTile label="Registration open" value={String(stats.open)} definition="Civil registration not closed. Six weeks is the corporation’s own limit; the register shows the age rather than the limit." asOf={day} />
      </div>

      {dayRegister.queuedDeaths > 0 && (
        <SafetyBanner severity="warning" title={`${dayRegister.queuedDeaths} entry written on this device`}>
          Queued with its number already drawn from this node’s block, so the mortuary register is complete while
          offline. It reaches the report when the queue drains.
        </SafetyBanner>
      )}

      <Panel title="The register" actions={<span className="text-xs text-text-secondary">{DEATH_COLUMNS.length} columns · {rows.length} of {dayRegister.deaths.length} rows</span>}>
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
              {v.label} <span className="font-numeric">{dayRegister.deaths.filter(v.keep).length}</span>
            </button>
          ))}
        </div>
        <ListView
          id="death-register"
          caption={`Death register for ${day}`}
          rows={rows}
          rowId={(d) => d.id}
          onRowClick={(d) => setSelected(d.id)}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Name, MRN, register number or certifying doctor' }}
          emptyLabel="No deaths match this view."
          columns={[
            { key: 'registerNo', header: 'Register no.', width: '8rem', render: (d) => <span className="font-numeric">{d.registerNo}</span> },
            { key: 'at', header: 'Time', width: '6.5rem', render: (d) => <span className="font-numeric">{d.at.slice(11)}</span> },
            { key: 'patient', header: 'Name', render: (d) => (<span><span className="font-medium">{nameOf(d)}</span>{d.patient && <span className="font-numeric text-xs text-text-tertiary"> {d.patient.mrn}</span>}</span>) },
            { key: 'age', header: 'Age', width: '4.5rem', align: 'right', numeric: true, render: (d) => (d.patient ? String(d.patient.age) : '—') },
            { key: 'sex', header: 'Sex', width: '4.5rem', hideBelow: 'md', render: (d) => d.patient?.sex ?? '—' },
            { key: 'kind', header: 'Came in', hideBelow: 'lg' },
            { key: 'immediateCause', header: 'Immediate cause', hideBelow: 'md', render: (d) => d.cause.immediate || 'not stated' },
            { key: 'manner', header: 'Manner', hideBelow: 'lg', render: (d) => <span className={cx(d.manner.startsWith('Unnatural') ? 'text-safety-warning' : 'text-text-secondary')}>{d.manner}</span> },
            { key: 'certificate', header: 'Certificate', width: '10rem', render: (d) => <span className={cx(d.certificateNo ? 'font-numeric text-safety-success' : 'text-safety-critical')}>{d.certificateNo ?? 'not issued'}</span> },
            { key: 'releasedTo', header: 'Released to', hideBelow: 'lg', render: (d) => (d.releasedTo ? `${d.releasedTo} · ${d.releasedAt?.slice(11) ?? ''}` : 'still with us') },
          ]}
        />
      </Panel>

      <Panel title="The register’s five rules, enforced as the form is typed" actions={<span className="text-xs text-text-secondary">P6 rules, P7 entry</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {DEATH_RULES.map((rule) => (
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
        title={`Record a death — ${draft.registerNo}`}
        description={`${DEATH_FIELDS.length} fields. Cause of death is written the way the certificate is written: immediate, then what led to it, then the underlying condition.`}
        width="xl"
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
                <>The entry has a cause, a manner, and either a certificate number or a reason it is not issued yet. That is what the report and the family both need.</>
              )
            ) : (
              <>{check.reasons[0].message}</>
            )}
          </SafetyBanner>

          <RegistryForm fields={DEATH_FIELDS} draft={draft} onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))} />

          <Panel title="Before you save">
            <ul className="space-y-1 text-sm text-text-secondary">
              <li>· The certificate is issued by the doctor who saw the body, and the register keeps their name rather than the ward’s.</li>
              <li>· Where the manner is unnatural, the police station goes on the entry before the body moves anywhere.</li>
              <li>· The body is released to a named person against the certificate — not to whoever is holding the file.</li>
            </ul>
          </Panel>
        </div>
      </Sheet>

      {/* ---------------------------------------------------------------------------------------------- one entry */}
      <Sheet
        open={Boolean(record)}
        onClose={() => setSelected(null)}
        title={record ? `${record.registerNo} — ${nameOf(record)}` : 'Entry'}
        description={record ? `${record.kind} · ${record.at} · ${record.manner}` : undefined}
        width="lg"
        footer={
          record && (
            <div className="flex flex-wrap justify-end gap-2">
              <Link href="/print/death-certificate">
                <Button variant="ghost">
                  <Printer className="size-4" aria-hidden /> Print the certificate
                </Button>
              </Link>
              {!record.releasedAt && (
                <Button variant="primary" onClick={() => release(record)}>
                  Release the body
                </Button>
              )}
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
                ['Age / sex', record.patient ? `${record.patient.age} y · ${record.patient.sex}` : 'not registered'],
                ['Came in as', record.kind],
                ['Where', record.wardId ? `${record.kind} · ${record.wardId}` : record.kind],
                ['Died', record.at],
                ['Immediate cause', record.cause.immediate || 'not stated'],
                ['Antecedent cause', record.cause.antecedent || '—'],
                ['Underlying cause', record.cause.underlying || '—'],
                ['Manner', record.manner],
                ['Certified by', record.certifiedBy ? `${record.certifiedBy}${record.certifiedAt ? ` · ${record.certifiedAt}` : ''}` : 'not certified'],
                ['Certificate', certificateState(record)],
                ['Civil registration', record.civil.state + (record.civil.number ? ` · ${record.civil.number}` : '')],
                ['Post-mortem', record.postMortemReferred ? 'referred' : 'not referred'],
                ['Released', record.releasedAt ? `${record.releasedAt} → ${record.releasedTo}` : 'still with the hospital'],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {record.police && (
              <SafetyBanner severity="warning" title="Referred to the police">
                {record.police.station} — recorded with the time the station was informed. The hospital’s part is the record, not the
                finding: the certificate is issued when the doctor has seen the body, and not held until the case closes.
              </SafetyBanner>
            )}

            {record.manner.startsWith('Unnatural') && !record.police && (
              <SafetyBanner severity="critical" title="No police station recorded">
                An unnatural death needs the station that was informed on the entry before the body moves. This is what the report
                refuses.
              </SafetyBanner>
            )}

            {!record.releasedAt && (
              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="font-medium text-text-primary">Release of the body</p>
                <p className={cx('text-text-secondary', !canReleaseBody(record).ok && 'text-safety-critical')}>
                  {canReleaseBody(record).because}
                </p>
              </div>
            )}

            {record.note && <p className="text-text-secondary">{record.note}</p>}

            <Panel title="Checked against the register">
              <ul className="space-y-1 text-sm">
                {checkDeath(record).reasons.length === 0 ? (
                  <li className="text-safety-success">Nothing refused: a cause, a manner and paper where paper is needed.</li>
                ) : (
                  checkDeath(record).reasons.map((r) => (
                    <li key={r.code} className="text-safety-critical">
                      <span className="font-numeric">{r.code}</span> — {r.message}
                    </li>
                  ))
                )}
                {checkDeath(record).warnings.map((w, i) => (
                  <li key={i} className="text-safety-warning">{w}</li>
                ))}
              </ul>
            </Panel>
          </div>
        )}
      </Sheet>
    </div>
  );
}
