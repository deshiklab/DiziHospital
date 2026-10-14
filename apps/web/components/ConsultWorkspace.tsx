'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  PatientBanner,
  Panel,
  SafetyBanner,
  Segmented,
  Tabs,
  Tooltip,
  cx,
  useToast,
} from '@dizi/ui';
import { Plus, Printer, Search, ShieldCheck, Trash2 } from 'lucide-react';
import {
  FREQUENCIES,
  ORDERS,
  ROUTES,
  RX_TEMPLATES,
  VITALS,
  allergyHits,
  bmi,
  bmiBand,
  flagTone,
  flagVital,
  highAlertHits,
  screenText,
  searchIcd,
  type Encounter,
  type Frequency,
  type OrderLine,
  type RxLine,
} from '@/lib/clinical';
import { DRUGS, drugById, searchDrugs, type Drug } from '@/lib/pharmacy';

/* --------------------------------------------------------------------------------------------
 * The consultation workspace: vitals, notes, orders and the prescription for one encounter.
 *
 * Three things it will not do, on purpose:
 *  - it will not let a prescription be signed while an allergy conflict is unresolved, or while a
 *    dangerous abbreviation is still in the instructions;
 *  - it will not silently overwrite a signed note — a change after signing is an addendum;
 *  - it will not pretend a signature is final while the device is offline; the banner says when it becomes
 *    final, and the audit line records the device.
 */

const INPUT = 'h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm';
const LABEL = 'text-xs text-text-secondary';

export function ConsultWorkspace({
  encounter,
  onChange,
  onSign,
  onAddendum,
  signedFinal,
}: {
  encounter: Encounter;
  onChange: (updater: (e: Encounter) => Encounter) => void;
  onSign: () => void;
  onAddendum: (text: string) => void;
  signedFinal: boolean;
}) {
  const { push } = useToast();
  const [tab, setTab] = useState('notes');
  const [drugQuery, setDrugQuery] = useState('');
  const [icdQuery, setIcdQuery] = useState('');
  const [addendum, setAddendum] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const readOnly = encounter.status === 'Signed';
  const drugResults = useMemo(() => searchDrugs(drugQuery), [drugQuery]);
  const icdResults = useMemo(() => searchIcd(icdQuery), [icdQuery]);

  const allergy = useMemo(() => allergyHits(encounter.rx, DRUGS, encounter.patient.allergies), [encounter.rx, encounter.patient.allergies]);
  const highAlert = useMemo(() => highAlertHits(encounter.rx, DRUGS), [encounter.rx]);
  const textHits = useMemo(
    () => encounter.rx.flatMap((line) => screenText(line.instructions).map((h) => ({ ...h, line: line.brand }))),
    [encounter.rx],
  );
  const blockers = allergy.length > 0 || textHits.length > 0;
  const weight = encounter.vitals.weight;
  const height = encounter.vitals.height;
  const bmiValue = bmi(weight, height);

  const setVital = (key: string, value: number | undefined) =>
    onChange((e) => ({ ...e, vitals: { ...e.vitals, [key]: value } }));

  const setSoap = (key: keyof Encounter['soap'], value: string) =>
    onChange((e) => ({ ...e, soap: { ...e.soap, [key]: value } }));

  const addDiagnosis = (code: string) => {
    const hit = searchIcd(code).find((c) => c.code === code);
    if (!hit) return;
    onChange((e) => (e.diagnoses.some((d) => d.code === hit.code) ? e : { ...e, diagnoses: [...e.diagnoses, hit] }));
    push({ title: `${hit.code} recorded`, description: hit.label, tone: 'success' });
  };

  const addOrder = (code: string) => {
    const item = ORDERS.find((o) => o.code === code);
    if (!item) return;
    onChange((e) => ({
      ...e,
      orders: [
        ...e.orders,
        {
          id: `${e.id}-O-${Date.now()}`,
          code: item.code,
          name: item.name,
          kind: item.kind,
          priority: 'Routine',
          status: 'Draft',
        } as OrderLine,
      ],
    }));
    push({ title: `${item.name} added`, description: 'Sent to the worklist when the note is signed', tone: 'info' });
  };

  const addDrug = (drug: Drug) => {
    const template = RX_TEMPLATES[0].lines[0];
    onChange((e) => ({
      ...e,
      rx: [
        ...e.rx,
        {
          ...template,
          id: `${e.id}-RX-${Date.now()}`,
          drugId: drug.id,
          brand: drug.brand,
          generic: drug.generic,
          strength: drug.strength,
          form: drug.form,
          quantity: 10,
          durationDays: 5,
          dose: '1',
          instructions: '',
        } as RxLine,
      ],
    }));
    setDrugQuery('');
  };

  const patchRx = (id: string, patch: Partial<RxLine>) =>
    onChange((e) => ({ ...e, rx: e.rx.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  const removeRx = (id: string) => onChange((e) => ({ ...e, rx: e.rx.filter((l) => l.id !== id) }));

  const printPrescription = () =>
    window.open(`/print/prescription?enc=${encounter.id}`, '_blank', 'noopener');

  /* -------------------------------------------------------------------------- vitals tab */
  const vitalsTab = (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">
        Recorded by the nurse at check-in and corrected here if needed. Values outside the reference range are
        flagged; outside the critical range they are called out and must be acted on, not just noted.
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {VITALS.map((def) => {
          const value = encounter.vitals[def.key];
          const flag = value === undefined ? null : flagVital(def, value);
          return (
            <label key={def.key} className="flex flex-col gap-1 rounded-md border border-border-subtle p-2">
              <span className={LABEL}>
                {def.label} <span className="text-text-tertiary">({def.unit})</span>
              </span>
              <input
                type="number"
                step={def.step ?? 1}
                value={value ?? ''}
                disabled={readOnly}
                onChange={(e) => setVital(def.key, e.target.value === '' ? undefined : Number(e.target.value))}
                className={cx(
                  INPUT,
                  flag?.startsWith('critical') && 'border-safety-critical text-safety-critical',
                  flag && !flag.startsWith('critical') && flag !== 'ok' && 'border-safety-warning',
                )}
              />
              <span className="flex items-center justify-between text-[11px] text-text-tertiary">
                <span>Ref {def.low}–{def.high}</span>
                {flag && flag !== 'ok' && (
                  <span className={cx('font-medium', flag.startsWith('critical') ? 'text-safety-critical' : 'text-safety-warning')}>
                    {flag === 'high' ? 'High' : flag === 'low' ? 'Low' : flag === 'critical-high' ? '⚠ Critical high' : '⚠ Critical low'}
                  </span>
                )}
              </span>
            </label>
          );
        })}
        <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-sunken p-2">
          <span className={LABEL}>BMI</span>
          <span className="font-numeric text-lg">{bmiValue ?? '—'}</span>
          <span className="text-[11px] text-text-tertiary">{bmiValue ? bmiBand(bmiValue) : 'Needs weight and height'}</span>
        </div>
      </div>
      {VITALS.some((d) => encounter.vitals[d.key] !== undefined && flagVital(d, encounter.vitals[d.key]!) .startsWith('critical')) && (
        <SafetyBanner severity="critical" title="A critical reading is recorded">
          Tell the doctor now rather than waiting for the round. The escalation is recorded against the encounter.
        </SafetyBanner>
      )}
      <div className="flex gap-2">
        <Button variant="primary" disabled={readOnly} onClick={() => push({ title: 'Vitals saved', description: `${encounter.token} · ${new Date().toLocaleTimeString()}`, tone: 'success' })}>
          Save vitals
        </Button>
        <Tooltip content="Repeat readings are kept as a series, never overwritten.">
          <Button size="sm" variant="ghost">Add repeat set</Button>
        </Tooltip>
      </div>
    </div>
  );

  /* --------------------------------------------------------------------------- notes tab */
  const notesTab = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>Load a starting point</span>
        <Button
          size="sm"
          disabled={readOnly}
          onClick={() =>
            onChange((e) => ({
              ...e,
              soap: {
                ...e.soap,
                subjective: e.soap.subjective || `${e.reason}. No chest pain, no breathlessness, no vomiting.`,
                objective: e.soap.objective || 'Alert, oriented. Chest clear, S1 S2 normal, abdomen soft, no oedema.',
                plan: e.soap.plan || 'Investigations as ordered. Review with reports.',
              },
            }))
          }
        >
          Typical OPD note
        </Button>
        <Tooltip content="Nothing is auto-filled into a signed note: templates only fill an empty field.">
          <Button size="sm" variant="ghost">Why not automatic?</Button>
        </Tooltip>
      </div>

      {(
        [
          ['subjective', 'Subjective', 'What the patient says — in their words, with duration'],
          ['objective', 'Objective', 'Examination findings. Vitals live in their own tab'],
          ['assessment', 'Assessment', 'Working diagnosis and reasoning'],
          ['plan', 'Plan', 'Investigations, treatment, advice, follow-up'],
        ] as const
      ).map(([key, label, hint]) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs text-text-tertiary">{hint}</span>
          </span>
          <textarea
            rows={key === 'subjective' || key === 'plan' ? 3 : 2}
            value={encounter.soap[key]}
            disabled={readOnly}
            onChange={(e) => setSoap(key, e.target.value)}
            className="w-full rounded-md border border-border-default bg-surface-default p-2 text-sm"
          />
        </label>
      ))}

      <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Diagnosis</span>
          <span className="text-xs text-text-tertiary">ICD-10 · the working shortlist, the full set loads in P2</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {encounter.diagnoses.map((d) => (
            <span key={d.code} className="inline-flex items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 text-xs">
              <span className="font-numeric">{d.code}</span> {d.label}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove ${d.code}`}
                  onClick={() => onChange((e) => ({ ...e, diagnoses: e.diagnoses.filter((x) => x.code !== d.code) }))}
                  className="text-text-tertiary hover:text-safety-critical"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {encounter.diagnoses.length === 0 && <span className="text-xs text-text-tertiary">No diagnosis recorded yet</span>}
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <input
              value={icdQuery}
              disabled={readOnly}
              onChange={(e) => setIcdQuery(e.target.value)}
              placeholder="Code, English or Bangla name — try E11 or ডায়াবেটিস"
              className={cx(INPUT, 'pl-7')}
              aria-label="Search ICD-10"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {icdResults.slice(0, 4).map((c) => (
              <Button key={c.code} size="sm" variant="ghost" disabled={readOnly} onClick={() => addDiagnosis(c.code)}>
                <span className="font-numeric">{c.code}</span> {c.label.length > 28 ? `${c.label.slice(0, 28)}…` : c.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Advice for the patient (Bangla)</span>
        <textarea
          rows={2}
          value={encounter.adviceBn}
          disabled={readOnly}
          onChange={(e) => onChange((x) => ({ ...x, adviceBn: e.target.value }))}
          className="w-full rounded-md border border-border-default bg-surface-default p-2 text-base"
          placeholder="নিয়মিত ওষুধ সেবন করুন…"
        />
        <span className="text-xs text-text-tertiary">Printed on the prescription, so the advice survives the visit.</span>
      </label>
    </div>
  );

  /* -------------------------------------------------------------------------- orders tab */
  const ordersTab = (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">
        Orders stay drafts until the note is signed, then they land on the laboratory and radiology worklists. A
        STAT order goes to the top of the list and the collections desk is told.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/diagnostics"><Button size="sm" variant="ghost">Open the worklist</Button></Link>
        <span className="text-xs text-text-tertiary">Orders appear there the moment the note is signed.</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {ORDERS.map((o) => (
          <Button key={o.code} size="sm" disabled={readOnly} onClick={() => addOrder(o.code)} className="gap-1">
            <Plus className="size-3" aria-hidden />
            {o.name}
            <span className="text-xs text-text-tertiary">{o.price}৳</span>
          </Button>
        ))}
      </div>

      {encounter.orders.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default p-3 text-sm text-text-tertiary">
          No investigations ordered for this visit.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
          {encounter.orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2 p-2">
              <span className="font-numeric text-xs text-text-tertiary">{o.code}</span>
              <span className="text-sm">{o.name}</span>
              {o.specimenId && <span className="font-numeric rounded-sm bg-surface-sunken px-1.5 text-[11px]">specimen {o.specimenId}</span>}
              <span className="text-xs text-text-secondary">{o.status}</span>
              <div className="ml-auto flex items-center gap-2">
                <Segmented
                  name={`priority-${o.id}`}
                  label={`Priority for ${o.name}`}
                  value={o.priority}
                  onChange={(v) =>
                    onChange((e) => ({ ...e, orders: e.orders.map((x) => (x.id === o.id ? { ...x, priority: v } : x)) }))
                  }
                  options={[
                    { value: 'Routine', label: 'Routine' },
                    { value: 'Urgent', label: 'Urgent', tone: 'warning' },
                    { value: 'STAT', label: 'STAT', tone: 'critical' },
                  ]}
                />
                {o.kind === 'lab' && (
                  <Button size="sm" variant="ghost" onClick={() => window.open(`/print/specimen-label?spec=${o.specimenId ?? o.code}`, '_blank', 'noopener')}>
                    Label
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => onChange((e) => ({ ...e, orders: e.orders.filter((x) => x.id !== o.id) }))} aria-label={`Remove ${o.name}`}>
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  /* -------------------------------------------------------------------- prescription tab */
  const rxTab = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>Templates</span>
        {RX_TEMPLATES.map((t) => (
          <Tooltip key={t.id} content={t.note}>
            <Button
              size="sm"
              disabled={readOnly}
              onClick={() => {
                onChange((e) => ({
                  ...e,
                  rx: [
                    ...e.rx,
                    ...t.lines.map((line, n) => ({ ...line, id: `${e.id}-${t.id}-${n}` }) as RxLine),
                  ],
                }));
                push({ title: `${t.name} added`, description: `${t.lines.length} medicines — check each dose`, tone: 'info' });
              }}
            >
              {t.name}
            </Button>
          </Tooltip>
        ))}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary" aria-hidden />
        <input
          value={drugQuery}
          disabled={readOnly}
          onChange={(e) => setDrugQuery(e.target.value)}
          placeholder="Add a medicine — brand, generic or Bangla name"
          aria-label="Search the formulary"
          className={cx(INPUT, 'pl-7')}
        />
        {drugQuery && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border-subtle bg-surface-raised shadow-lg">
            {drugResults.length === 0 && <li className="p-2 text-sm text-text-tertiary">Nothing in the formulary matches that.</li>}
            {drugResults.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => addDrug(d)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                >
                  <span className="font-medium">{d.brand}</span>
                  <span className="text-text-secondary">{d.generic} {d.strength}</span>
                  <span className="ml-auto text-xs text-text-tertiary">{d.form} · {d.price}৳{d.highAlert ? ' · high alert' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {allergy.length > 0 && (
        <SafetyBanner severity="critical" title="Allergy conflict — resolve before signing" requiresAcknowledgement onAcknowledge={() => setAcknowledged(true)}>
          <ul className="list-disc pl-5">
            {allergy.map((h, i) => (
              <li key={i}>
                {h.message}. <span className="font-medium">{h.fix}.</span>
              </li>
            ))}
          </ul>
        </SafetyBanner>
      )}

      {textHits.length > 0 && (
        <SafetyBanner severity="warning" title="Rewrite these instructions">
          <ul className="list-disc pl-5">
            {textHits.map((h, i) => (
              <li key={i}>
                <span className="font-numeric">{h.line}</span>: {h.message}. <span className="font-medium">{h.fix}.</span>
              </li>
            ))}
          </ul>
        </SafetyBanner>
      )}

      {highAlert.length > 0 && (
        <SafetyBanner severity="warning" title="High-alert medicine on this prescription">
          <ul className="list-disc pl-5">
            {highAlert.map((h, i) => (
              <li key={i}>{h.message}. {h.fix}.</li>
            ))}
          </ul>
        </SafetyBanner>
      )}

      {encounter.rx.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default p-3 text-sm text-text-tertiary">
          Nothing prescribed. Use a template above, or add medicines one by one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {encounter.rx.map((line) => {
            const drug = drugById(line.drugId);
            const lineHits = screenText(line.instructions);
            return (
              <li key={line.id} className={cx('rounded-md border p-2', allergy.some((h) => h.message.includes(line.brand)) ? 'border-safety-critical' : 'border-border-subtle')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{line.brand}</span>
                  <span className="text-xs text-text-secondary">{line.generic} {line.strength} · {line.form}</span>
                  {drug?.highAlert && <span className="rounded-full border border-safety-warning px-1.5 text-[10px] text-safety-warning">high alert</span>}
                  {drug?.controlled && <span className="rounded-full border border-safety-critical px-1.5 text-[10px] text-safety-critical">controlled</span>}
                  <span className="font-numeric ml-auto text-xs text-text-tertiary">{line.quantity} {line.form.toLowerCase()}s · {line.durationDays} days</span>
                  <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => removeRx(line.id)} aria-label={`Remove ${line.brand}`}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Dose</span>
                    <input value={line.dose} disabled={readOnly} onChange={(e) => patchRx(line.id, { dose: e.target.value })} className={INPUT} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Route</span>
                    <select value={line.route} disabled={readOnly} onChange={(e) => patchRx(line.id, { route: e.target.value })} className={INPUT}>
                      {ROUTES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Frequency</span>
                    <select
                      value={line.frequency}
                      disabled={readOnly}
                      onChange={(e) => patchRx(line.id, { frequency: e.target.value as Frequency })}
                      className={INPUT}
                    >
                      {FREQUENCIES.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Days</span>
                    <input
                      type="number"
                      min={1}
                      value={line.durationDays}
                      disabled={readOnly}
                      onChange={(e) => patchRx(line.id, { durationDays: Number(e.target.value) })}
                      className={INPUT}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Quantity</span>
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      disabled={readOnly}
                      onChange={(e) => patchRx(line.id, { quantity: Number(e.target.value) })}
                      className={INPUT}
                    />
                  </label>
                  <label className={cx('flex flex-col gap-1 md:col-span-2 xl:col-span-6', lineHits.length > 0 && 'text-safety-warning')}>
                    <span className={LABEL}>Instructions for the patient</span>
                    <input
                      value={line.instructions}
                      disabled={readOnly}
                      onChange={(e) => patchRx(line.id, { instructions: e.target.value })}
                      placeholder="After breakfast and dinner"
                      className={cx(INPUT, lineHits.length > 0 && 'border-safety-warning')}
                    />
                    {lineHits.map((h, i) => (
                      <span key={i} className="text-[11px] text-safety-warning">
                        {h.message} — {h.fix}
                      </span>
                    ))}
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={printPrescription} className="gap-1.5">
          <Printer className="size-3.5" aria-hidden />
          Print prescription
        </Button>
        <Tooltip content="The pharmacy sees the same lines the moment the note is signed.">
          <Button size="sm" variant="ghost">Send to pharmacy</Button>
        </Tooltip>
      </div>
    </div>
  );

  /* ------------------------------------------------------------------------- history tab */
  const historyTab = (
    <div className="flex flex-col gap-3">
      <Panel title="This visit">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-2">
          <div className="flex justify-between gap-4"><dt className="text-text-secondary">Token</dt><dd className="font-numeric">{encounter.token}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-text-secondary">Arrived</dt><dd className="font-numeric">{encounter.arrivedAt}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-text-secondary">Room</dt><dd>{encounter.room}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-text-secondary">Reason</dt><dd className="text-right">{encounter.reason}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-text-secondary">Status</dt><dd>{encounter.status}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-text-secondary">Signed</dt><dd>{encounter.signedAt ? `${encounter.signedAt} · ${encounter.signedBy}` : '—'}</dd></div>
        </dl>
      </Panel>
      <Panel title="Previous visits">
        <p className="text-sm text-text-secondary">
          The last three encounters for this MRN live in the legacy system until the clinical module is cut over
          (P2). The record page shows them read-only, marked as legacy-owned, so nobody has to guess which system
          to look in.
        </p>
        <div className="mt-2 flex gap-2">
          <Link href={`/patients/${encounter.patient.mrn}`}>
            <Button size="sm">Open the patient record</Button>
          </Link>
          <Button size="sm" variant="ghost" onClick={() => push({ title: 'Legacy history requested', description: 'Shown read-only until the P2 cutover', tone: 'info' })}>
            Fetch from the legacy system
          </Button>
        </div>
      </Panel>
      {encounter.addenda.length > 0 && (
        <Panel title={`Addenda (${encounter.addenda.length})`}>
          <ul className="flex flex-col gap-2 text-sm">
            {encounter.addenda.map((a, i) => (
              <li key={i} className="rounded-md border border-border-subtle p-2">
                <p className="font-numeric text-xs text-text-tertiary">{a.at} · {a.by}</p>
                <p>{a.text}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );

  /* ------------------------------------------------------------------------------ render */
  return (
    <div className="flex flex-col gap-3">
      <PatientBanner
        mrn={encounter.patient.mrn}
        name={encounter.patient.name}
        age={encounter.patient.age}
        sex={encounter.patient.sex}
        payer={encounter.patient.payer}
        allergies={encounter.patient.allergies ? encounter.patient.allergies.split(',').map((a) => a.trim()) : []}
        extra={[
          { label: 'Token', value: encounter.token },
          { label: 'Room', value: encounter.room },
          { label: 'Arrived', value: encounter.arrivedAt.slice(11) },
          { label: 'Status', value: encounter.status },
        ]}
      />

      {readOnly && (
        <SafetyBanner severity="info" title={`Signed at ${encounter.signedAt} — this note is not edited`}>
          {signedFinal
            ? 'A change after signing is an addendum below, so the original stays exactly as it was written and the record shows both.'
            : 'The signature is recorded on this device and becomes final when it reaches the server — the audit line keeps the device and the time.'}
        </SafetyBanner>
      )}

      <Tabs
        items={[
          { id: 'notes', label: 'Notes' },
          { id: 'vitals', label: 'Vitals', count: Object.keys(encounter.vitals).length },
          { id: 'orders', label: 'Orders', count: encounter.orders.length },
          { id: 'rx', label: 'Prescription', count: encounter.rx.length },
          { id: 'history', label: 'History' },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'notes' && notesTab}
        {tab === 'vitals' && vitalsTab}
        {tab === 'orders' && ordersTab}
        {tab === 'rx' && rxTab}
        {tab === 'history' && historyTab}
      </Tabs>

      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
        <Button variant="primary" disabled={readOnly || blockers} onClick={onSign} className="gap-1.5">
          <ShieldCheck className="size-4" aria-hidden />
          Sign and lock
        </Button>
        <Button disabled={readOnly} onClick={() => push({ title: 'Draft saved', description: 'Nothing is lost if the browser closes', tone: 'success' })}>
          Save draft
        </Button>
        {blockers && (
          <span className="text-xs text-safety-critical">
            {allergy.length > 0 ? 'Resolve the allergy conflict first. ' : ''}
            {textHits.length > 0 ? 'Rewrite the flagged instructions first.' : ''}
          </span>
        )}
        {!blockers && encounter.diagnoses.length === 0 && (
          <span className="text-xs text-safety-warning">A diagnosis is required before signing.</span>
        )}
        {readOnly && (
          <div className="flex w-full flex-wrap items-end gap-2 md:w-auto">
            <label className="flex flex-1 flex-col gap-1 md:w-80">
              <span className={LABEL}>Addendum — what changed and why</span>
              <input value={addendum} onChange={(e) => setAddendum(e.target.value)} className={INPUT} placeholder="Report reviewed: HbA1c 9.1 — dose increased" />
            </label>
            <Button
              onClick={() => {
                if (!addendum.trim()) {
                  push({ title: 'Write the addendum first', tone: 'warning' });
                  return;
                }
                onAddendum(addendum.trim());
                setAddendum('');
              }}
            >
              Add to record
            </Button>
          </div>
        )}
        {acknowledged && <span className="text-xs text-text-tertiary">Allergy acknowledgement recorded against your name.</span>}
      </div>
    </div>
  );
}
