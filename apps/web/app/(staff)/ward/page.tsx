'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  DataGrid,
  EmptyState,
  KpiTile,
  Panel,
  PatientBanner,
  SafetyBanner,
  Segmented,
  Sheet,
  Tabs,
  cx,
  useToast,
  type Column,
  type RowAction,
} from '@dizi/ui';
import { ArrowLeftRight, BedDouble, ClipboardList, LogOut, Printer, Syringe, TriangleAlert } from 'lucide-react';
import { DOCTORS, todayIso } from '@/lib/appointments';
import { patients } from '@/lib/mock';
import { useShell } from '@/lib/shell';
import { money } from '@/lib/billing';
import { generateDiagnosticOrders, hasResults, worstFlag } from '@/lib/diagnostics';
import {
  BED_CHARGE,
  BED_FLOW,
  CLEANING_TARGET_MIN,
  DOSE_TONE,
  EWS_RESPONSE,
  NOTE_KINDS,
  STAFF,
  WARDS,
  clock,
  dischargeChecklist,
  dischargeDues,
  doseBlockers,
  generateInpatient,
  isLate,
  latestVitals,
  marStats,
  occupancy,
  overdueCleaning,
  wardAlerts,
  wardQualityGaps,
  wardName,
  type Admission,
  type Bed,
  type DischargeType,
  type DoseStatus,
  type EwsBand,
  type InpatientDay,
  type MarDose,
  type NoteKind,
  type VitalSet,
} from '@/lib/ward';

/* Ward (legacy screens 006/058/061/021 replaced) — the P5 module.
 *
 * The bed board is the picture; everything behind it is a rule from `lib/ward.ts` made visible:
 *  - a bed changes state with a reason and a name, never silently;
 *  - observations produce an early-warning score, and the score carries the response it demands;
 *  - a dose is signed at the bedside, and the signature is refused until the five rights are accounted for;
 *  - a discharge is a document with a checklist, and dues are counted rather than forgotten.
 *
 * It is a preview: the board and the patients are synthetic and nothing survives a reload. The rules do — that is
 * the part worth reviewing at this stage.
 */

const INPUT = 'h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm';
const LABEL = 'text-xs text-text-secondary';

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};
const TONE_DOT: Record<string, string> = {
  critical: 'bg-safety-critical',
  warning: 'bg-safety-warning',
  info: 'bg-brand-500',
  success: 'bg-safety-success',
  neutral: 'bg-border-strong',
};

const BED_BG: Record<Bed['status'], string> = {
  Free: 'border-safety-success/40 bg-safety-success/5',
  Occupied: 'border-border-default bg-surface-default',
  Cleaning: 'border-safety-warning/50 bg-safety-warning/5',
  Reserved: 'border-safety-warning/40 bg-surface-sunken',
  Blocked: 'border-safety-critical/40 bg-safety-critical/5',
};

const EWS_CHIP: Record<EwsBand, string> = {
  Routine: 'bg-surface-sunken text-text-secondary',
  Watch: 'bg-brand-50 text-brand-700',
  Escalate: 'bg-safety-warning/10 text-safety-warning',
  Emergency: 'bg-safety-critical/10 text-safety-critical',
};

export default function WardPage() {
  const { sync } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [board, setBoard] = useState<InpatientDay>(() => generateInpatient(day));
  const [wardFilter, setWardFilter] = useState<string>('all');
  const [tab, setTab] = useState('board');
  const [bedSheet, setBedSheet] = useState<string | null>(null);
  const [chartId, setChartId] = useState<string | null>(null);
  const [doseId, setDoseId] = useState<string | null>(null);
  const [admitBedId, setAdmitBedId] = useState<string | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [marFilter, setMarFilter] = useState<'due' | 'late' | 'given' | 'all'>('due');
  const [quickSearch, setQuickSearch] = useState('');
  const [chartTab, setChartTab] = useState('obs');
  const [dischargeId, setDischargeId] = useState<string | null>(null);
  const [admitMrn, setAdmitMrn] = useState('');
  const [admitForm, setAdmitForm] = useState({ consultantId: DOCTORS[0].id, reason: '', severity: 'Stable' as Admission['severity'], expectedStayDays: 3 });
  const [transferForm, setTransferForm] = useState({ toBedId: '', reason: '', toBranch: '' });
  const [dischargeForm, setDischargeForm] = useState({ type: 'Recovered' as DischargeType, course: '', condition: 'Improved and stable', followUpDays: 7, settled: true });
  const [noteForm, setNoteForm] = useState<{ kind: NoteKind; text: string }>({ kind: 'Note', text: '' });
  const [doseForm, setDoseForm] = useState<{ status: DoseStatus; checked: boolean; witness: string; reason: string; indication: string }>({ status: 'Given', checked: false, witness: '', reason: '', indication: '' });
  const [escalateForm, setEscalateForm] = useState({ to: STAFF.find((s) => s.role === 'Registrar')?.name ?? 'Registrar', response: '' });

  /* ---------------------------------------------------------------- derived */
  const occ = useMemo(() => occupancy(board.beds), [board.beds]);
  const alerts = useMemo(() => wardAlerts(board), [board]);
  const gaps = useMemo(() => wardQualityGaps(board), [board]);
  const mar = useMemo(() => marStats(board.mar, board.nowMinutes), [board]);
  const dues = useMemo(() => dischargeDues(board.discharges), [board.discharges]);
  const visibleWards = wardFilter === 'all' ? WARDS : WARDS.filter((w) => w.id === wardFilter);
  const bedSheetBed = board.beds.find((b) => b.id === bedSheet) ?? null;
  const dischargeAdmission = board.admissions.find((a) => a.id === dischargeId) ?? null;
  const chart = board.admissions.find((a) => a.id === chartId) ?? null;
  const dose = board.mar.find((d) => d.id === doseId) ?? null;
  /** The dose as it is being written, so the footer can refuse a signature before it is pressed. */
  const pendingBlockers = dose
    ? doseBlockers({
        ...dose,
        status: doseForm.status,
        checked: doseForm.status === 'Given' ? doseForm.checked : true,
        witness: doseForm.witness || undefined,
        reason: doseForm.reason || undefined,
        indication: doseForm.indication || undefined,
      })
    : [];


  const results = useMemo(() => generateDiagnosticOrders(day), [day]);

  const patientOf = (admissionId: string) => board.admissions.find((a) => a.id === admissionId)?.patient;
  const bedOf = (admissionId: string) => {
    const bedId = board.admissions.find((a) => a.id === admissionId)?.bedId;
    return board.beds.find((b) => b.id === bedId)?.label ?? '—';
  };
  const admissionOfDose = (d: MarDose) => board.admissions.find((a) => a.id === d.admissionId);
  const dosesFor = (admissionId: string) => board.mar.filter((d) => d.admissionId === admissionId);
  const vitalsFor = (admissionId: string) => board.vitals.filter((v) => v.admissionId === admissionId);
  const notesFor = (admissionId: string) => board.notes.filter((n) => n.admissionId === admissionId);

  const setBed = (bedId: string, patch: Partial<Bed>) =>
    setBoard((b) => ({ ...b, beds: b.beds.map((x) => (x.id === bedId ? { ...x, ...patch } : x)) }));

  /* ---------------------------------------------------------------- bed actions */
  const admitInto = (bedId: string, form: { mrn: string; consultantId: string; reason: string; severity: Admission['severity']; expectedStayDays: number }) => {
    const bed = board.beds.find((b) => b.id === bedId);
    if (!bed) return;
    const patient = patientsForAdmit.find((p) => p.mrn === form.mrn);
    if (!patient) return;
    const consultant = DOCTORS.find((d) => d.id === form.consultantId);
    const id = `ADM-${day.replace(/-/g, '')}-${String(board.admissions.length + 900)}`;
    const admission: Admission = {
      id,
      mrn: patient.mrn,
      patient: {
        mrn: patient.mrn,
        name: patient.name,
        nameBn: patient.nameBn,
        age: patient.age,
        sex: patient.sex,
        phone: patient.phone,
        allergies: patient.allergies,
        payer: patient.payer,
      },
      wardId: bed.wardId,
      bedId: bed.id,
      admittedAt: `${day} ${board.now}`,
      admittedBy: 'Reception — ward admission',
      consultantId: form.consultantId,
      consultantName: consultant?.name ?? 'Unassigned',
      reason: form.reason,
      class: bed.class,
      severity: form.severity,
      expectedStayDays: form.expectedStayDays,
      plannedDischargeToday: false,
      instructions: patient.allergies ? [`Allergy: ${patient.allergies} — check every new order`] : [],
    };
    setBoard((b) => ({
      ...b,
      admissions: [...b.admissions, admission],
      beds: b.beds.map((x) => (x.id === bed.id ? { ...x, status: 'Occupied', admissionId: id, reservedFor: undefined, note: undefined, cleaningSince: undefined } : x)),
    }));
    setAdmitBedId(null);
    push({ title: `Admitted ${patient.name} to ${bed.label}`, description: `Consultant ${admission.consultantName} · expected stay ${form.expectedStayDays} day(s). The ward bill starts at ${money(BED_CHARGE[bed.class])} a day.`, tone: 'success' });
  };

  const dischargePatient = (admissionId: string, form: { type: DischargeType; course: string; condition: string; followUpDays: number; settled: boolean }) => {
    const admission = board.admissions.find((a) => a.id === admissionId);
    const bed = board.beds.find((b) => b.id === admission?.bedId);
    if (!admission || !bed) return;
    const record = {
      id: `DSC-${admission.id}`,
      admissionId: admission.id,
      mrn: admission.mrn,
      name: admission.patient.name,
      nameBn: admission.patient.nameBn,
      age: admission.patient.age,
      sex: admission.patient.sex,
      wardId: admission.wardId,
      bedId: bed.id,
      admittedAt: admission.admittedAt,
      dischargedAt: `${day} ${board.now}`,
      stayedDays: losDays(admission, day),
      type: form.type,
      diagnosis: admission.diagnosis ?? { code: 'R69', label: 'Illness, unspecified' },
      consultantName: admission.consultantName,
      summary: { course: form.course, findings: 'Examined before discharge; stable enough to go home.', treatment: admission.reason, condition: form.condition, adviceBn: 'নিয়মিত ওষুধ সেবন করুন, জ্বর বা শ্বাসকষ্ট হলে দ্রুত হাসপাতালে আসুন।' },
      medications: [],
      followUpDays: form.followUpDays,
      followUpWith: admission.consultantName,
      bill: { settled: form.settled, due: form.settled ? 0 : BED_CHARGE[bed.class] * 2 },
      preparedBy: admission.admittedBy,
    };
    setBoard((b) => ({
      ...b,
      admissions: b.admissions.filter((a) => a.id !== admissionId),
      discharges: [record, ...b.discharges],
      beds: b.beds.map((x) => (x.id === bed.id ? { ...x, status: 'Cleaning', admissionId: undefined, cleaningSince: board.now, note: `Discharged at ${board.now} — terminal clean in progress` } : x)),
    }));
    push({
      title: `${admission.patient.name} discharged`,
      description: form.settled ? 'Summary written, bill settled, bed sent for cleaning.' : `Leaving with ${money(BED_CHARGE[bed.class] * 2)} outstanding — the discharge register records it.`,
      tone: form.settled ? 'success' : 'warning',
    });
  };

  const transferPatient = (admissionId: string, form: { toBedId: string; reason: string; toBranch?: string }) => {
    const admission = board.admissions.find((a) => a.id === admissionId);
    if (!admission) return;
    const fromBed = board.beds.find((b) => b.id === admission.bedId);
    const toBed = board.beds.find((b) => b.id === form.toBedId);
    if (!toBed && !form.toBranch) return;
    const transfer = {
      id: `TR-${admission.id}-${board.transfers.length + 1}`,
      admissionId,
      mrn: admission.mrn,
      at: clock(board.nowMinutes),
      by: 'Ward',
      fromBed: fromBed?.label ?? admission.bedId,
      fromWardId: admission.wardId,
      toBed: toBed?.label,
      toWardId: toBed?.wardId,
      toBranch: form.toBranch,
      reason: form.reason,
      acceptedBy: 'Charge nurse',
    };
    setBoard((b) => ({
      ...b,
      admissions: form.toBranch
        ? b.admissions.filter((a) => a.id !== admissionId)
        : b.admissions.map((a) => (a.id === admissionId ? { ...a, bedId: form.toBedId, wardId: toBed!.wardId, class: toBed!.class } : a)),
      transfers: [transfer, ...b.transfers],
      beds: b.beds.map((x) => {
        if (fromBed && x.id === fromBed.id) return { ...x, status: 'Cleaning', admissionId: undefined, cleaningSince: clock(board.nowMinutes), note: 'Patient moved — bed to be cleaned' };
        if (toBed && x.id === toBed.id) return { ...x, status: 'Occupied', admissionId, reservedFor: undefined };
        return x;
      }),
    }));
    setTransferId(null);
    push({ title: form.toBranch ? `Transferred to ${form.toBranch}` : `Moved to ${toBed?.label}`, description: 'The transfer is recorded with the reason, the accepting name and both locations.', tone: 'success' });
  };

  /* ---------------------------------------------------------------- medication */
  const signDose = (dose: MarDose, form: { status: DoseStatus; checked: boolean; witness?: string; reason?: string; indication?: string }) => {
    setBoard((b) => ({
      ...b,
      mar: b.mar.map((d) =>
        d.id === dose.id
          ? {
              ...d,
              status: form.status,
              checked: form.status === 'Given' ? form.checked : d.checked || form.checked,
              givenAt: form.status === 'Given' ? clock(b.nowMinutes) : undefined,
              givenBy: form.status === 'Given' ? 'Signed on this screen' : undefined,
              witness: form.witness,
              reason: form.reason,
              indication: form.indication,
            }
          : d,
      ),
    }));
    setDoseId(null);
    push({
      title: `${dose.brand} ${dose.strength} — ${form.status.toLowerCase()}`,
      description:
        form.status === 'Given'
          ? `Checked against the pack${form.witness ? `, witnessed by ${form.witness}` : ''}.${dose.prn ? ` Given for: ${form.indication}.` : ''}`
          : `Recorded with the reason: ${form.reason}`,
      tone: form.status === 'Given' ? 'success' : 'warning',
    });
  };

  const addNote = (admissionId: string, form: { kind: NoteKind; text: string }) => {
    setBoard((b) => ({
      ...b,
      notes: [
        { id: `NN-${admissionId}-${b.notes.length + 900}`, admissionId, at: clock(b.nowMinutes), by: 'Signed on this screen', shift: b.shift, kind: form.kind, text: form.text },
        ...b.notes,
      ],
    }));
    push({ title: 'Note added to the chart', description: 'Nursing notes are append-only: a correction is another note, never an edit.', tone: 'success' });
  };

  const escalate = (set: VitalSet, form: { response: string; to: string }) => {
    setBoard((b) => ({
      ...b,
      vitals: b.vitals.map((v) => (v.id === set.id ? { ...v, escalated: { at: clock(b.nowMinutes), to: form.to, response: form.response } } : v)),
    }));
    push({ title: `Escalation recorded for score ${set.score}`, description: `${form.to} — ${form.response}`, tone: 'success' });
  };

  /* ---------------------------------------------------------------- grids */
  const admissionColumns: Array<Column<Admission>> = [
    { key: 'bed', header: 'Bed', width: '5rem', render: (a) => <span className="font-numeric">{bedOf(a.id)}</span> },
    { key: 'mrn', header: 'MRN', width: '7rem', render: (a) => <span className="font-numeric text-text-secondary">{a.mrn}</span> },
    { key: 'name', header: 'Patient', render: (a) => (
      <span className="flex flex-col">
        <span className="font-medium">{a.patient.name}</span>
        <span className="text-xs text-text-tertiary">{a.patient.age} · {a.patient.sex}{a.patient.allergies ? ` · allergy: ${a.patient.allergies}` : ''}</span>
      </span>
    ) },
    { key: 'wardId', header: 'Ward', hideBelow: 'lg', render: (a) => wardName(a.wardId) },
    { key: 'consultantName', header: 'Under', hideBelow: 'xl' },
    { key: 'reason', header: 'Admitted for', hideBelow: 'lg', render: (a) => <span className="text-xs text-text-secondary">{a.reason}</span> },
    { key: 'diagnosis', header: 'Working diagnosis', hideBelow: 'xl', render: (a) => (a.diagnosis ? `${a.diagnosis.code} · ${a.diagnosis.label}` : '—') },
    { key: 'admittedAt', header: 'Admitted', hideBelow: 'md', render: (a) => <span className="font-numeric text-xs">{a.admittedAt}</span> },
    { key: 'severity', header: 'State', render: (a) => (
      <span className={cx('rounded-full px-2 py-0.5 text-xs', a.severity === 'Critical' ? 'bg-safety-critical/10 text-safety-critical' : a.severity === 'Guarded' ? 'bg-safety-warning/10 text-safety-warning' : 'bg-surface-sunken text-text-secondary')}>{a.severity}</span>
    ) },
    { key: 'ews', header: 'Early warning', render: (a) => {
      const latest = latestVitals(board, a.id);
      if (!latest) return <span className="text-text-tertiary">—</span>;
      return (
        <span className={cx('rounded-full px-2 py-0.5 text-xs', EWS_CHIP[latest.band])} title={EWS_RESPONSE[latest.band].response}>
          {latest.score} · {latest.band}
        </span>
      );
    } },
    { key: 'los', header: 'Day', render: (a) => <span className="font-numeric">{losDays(a, day)}</span> },
  ];

  const marColumns: Array<Column<MarDose>> = [
    { key: 'scheduledAt', header: 'Due', width: '5rem', render: (d) => <span className={cx('font-numeric', isLate(d, board.nowMinutes) && 'text-safety-critical')}>{d.scheduledAt}</span> },
    { key: 'bed', header: 'Bed', width: '5rem', render: (d) => <span className="font-numeric">{bedOf(d.admissionId)}</span> },
    { key: 'patient', header: 'Patient', render: (d) => patientOf(d.admissionId)?.name ?? d.admissionId },
    { key: 'drug', header: 'Medicine', render: (d) => (
      <span className="flex flex-col">
        <span className="font-medium">
          {d.brand} {d.strength}
          {d.controlled && <span className="ml-1 rounded-full bg-safety-critical/10 px-1.5 text-[10px] text-safety-critical">controlled</span>}
          {d.highAlert && <span className="ml-1 rounded-full bg-safety-warning/10 px-1.5 text-[10px] text-safety-warning">high alert</span>}
        </span>
        <span className="text-xs text-text-tertiary">{d.generic} · {d.dose} · {d.route} · {d.frequency}</span>
      </span>
    ) },
    { key: 'status', header: 'State', render: (d) => (
      <span className="flex items-center gap-2">
        <span className={cx('rounded-full px-2 py-0.5 text-xs', d.status === 'Given' ? 'bg-safety-success/10 text-safety-success' : isLate(d, board.nowMinutes) ? 'bg-safety-critical/10 text-safety-critical' : 'bg-safety-warning/10 text-safety-warning')}>
          {d.status}{isLate(d, board.nowMinutes) ? ' · late' : ''}
        </span>
        {doseBlockers(d).length > 0 && <TriangleAlert className="size-3.5 text-safety-critical" aria-hidden />}
      </span>
    ) },
    { key: 'who', header: 'Recorded', hideBelow: 'lg', render: (d) => (
      <span className="text-xs text-text-secondary">
        {d.givenBy ?? '—'}
        {d.controlled && <span className="block text-[11px] text-text-tertiary">witness: {d.witness ?? 'missing'}</span>}
        {d.reason && <span className="block text-[11px] text-text-tertiary">reason: {d.reason}</span>}
        {d.indication && <span className="block text-[11px] text-text-tertiary">for: {d.indication}</span>}
      </span>
    ) },
  ];

  const doseActions = (d: MarDose): RowAction<MarDose>[] => [
    { label: d.status === 'Given' ? 'Review the entry' : 'Sign for this dose', onSelect: () => setDoseId(d.id), icon: <Syringe className="size-3.5" aria-hidden /> },
    { label: 'Open the patient’s chart', onSelect: () => setChartId(d.admissionId), icon: <ClipboardList className="size-3.5" aria-hidden /> },
    { label: 'Open the bed', onSelect: () => setBedSheet(board.admissions.find((a) => a.id === d.admissionId)?.bedId ?? null), icon: <BedDouble className="size-3.5" aria-hidden /> },
  ];

  const admissionActions = (a: Admission): RowAction<Admission>[] => [
    { label: 'Open the chart', onSelect: () => setChartId(a.id), icon: <ClipboardList className="size-3.5" aria-hidden /> },
    { label: 'Transfer to another bed or branch', onSelect: () => setTransferId(a.id), icon: <ArrowLeftRight className="size-3.5" aria-hidden /> },
    { label: 'Discharge', onSelect: () => setDischargeId(a.id), icon: <LogOut className="size-3.5" aria-hidden />, separated: true },
  ];

  const marRows = useMemo(() => {
    const rows =
      marFilter === 'due' ? board.mar.filter((d) => d.status === 'Due')
      : marFilter === 'late' ? board.mar.filter((d) => isLate(d, board.nowMinutes))
      : marFilter === 'given' ? board.mar.filter((d) => d.status === 'Given')
      : board.mar;
    const q = quickSearch.trim().toLowerCase();
    return q ? rows.filter((d) => `${d.brand} ${d.generic} ${patientOf(d.admissionId)?.name ?? ''} ${bedOf(d.admissionId)}`.toLowerCase().includes(q)) : rows;
  }, [board, marFilter, quickSearch]);

  const patientsForAdmit = useMemo(() => patients.filter((p) => p.status === 'Active' || p.status === 'Follow-up').slice(0, 40), []);
  const transferBed = transferId ? board.admissions.find((a) => a.id === transferId) : null;
  const freeBeds = board.beds.filter((b) => b.status === 'Free' || (b.status === 'Reserved' && b.id === transferBed?.bedId));

  /* ---------------------------------------------------------------- render */
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Ward</h1>
          <p className="text-sm text-text-secondary">
            {day} · {board.now} · <span className="font-medium">{board.shift} shift</span> · {occ.occupied} of {occ.total} beds in use · handover due at{' '}
            {board.shift === 'Morning' ? '14:00' : board.shift === 'Evening' ? '21:00' : '07:00'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            name="ward-filter"
            label="Ward"
            value={wardFilter}
            onChange={setWardFilter}
            options={[{ value: 'all', label: 'All wards' }, ...WARDS.map((w) => ({ value: w.id, label: w.prefix }))]}
          />
          <Link href="/reports">
            <Button variant="ghost">Occupancy report</Button>
          </Link>
        </div>
      </div>

      <SafetyBanner severity="info" title="P5 module — preview ward with synthetic patients">
        The bed board, the observations, the drug round and the discharge register are real workflows rendered from
        deterministic synthetic data, and nothing here survives a reload. The three rules that matter are enforced on
        the screen: a bed changes state with a reason and a name, an early-warning score carries the response it
        requires, and a dose cannot be signed until the five rights are accounted for.
      </SafetyBanner>

      {sync !== 'live' && (
        <SafetyBanner severity="warning" title="The ward keeps working while the uplink is down">
          Bed states, observations, notes and doses are written to this device and queued: a ward that loses Wi-Fi
          still charts. The queue and the conflict rules are the P0-210 prototype — until it lands, a reload loses
          what was added here, and the screen says so rather than pretending otherwise.
        </SafetyBanner>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-6">
        <KpiTile label="Occupancy" value={`${occ.percent} %`} definition="Beds in use against usable beds — a blocked bed is not one the desk can admit into." asOf={`${day} ${board.now}`} footnote={`${occ.occupied} of ${occ.total} · ${occ.blocked} blocked`} />
        <KpiTile label="Beds free now" value={String(occ.free)} definition="Clean, empty and ready for the next patient." asOf={`${day} ${board.now}`} footnote={`${occ.cleaning} being cleaned · ${occ.reserved} reserved`} />
        <KpiTile label="Doses due" value={String(mar.due)} definition="Scheduled doses not yet signed for, including anything overdue." asOf={`${day} ${board.now}`} footnote={mar.late ? `${mar.late} more than two hours late` : 'nothing overdue'} />
        <KpiTile label="Round compliance" value={`${mar.compliancePct} %`} definition="Doses given inside the two-hour window around their slot." asOf={`${day} ${board.now}`} footnote={`${mar.held} held or refused, each with a reason`} />
        <KpiTile label="Controlled doses" value={`${mar.controlledGiven - mar.controlledUnwitnessed}/${mar.controlledGiven}`} definition="Controlled administrations with a named witness on the record." asOf={`${day} ${board.now}`} footnote={mar.controlledUnwitnessed ? `${mar.controlledUnwitnessed} without a witness — a hard error` : 'all witnessed'} />
        <KpiTile label="Discharges today" value={String(board.discharges.length)} definition="Patients who left a bed today, each with a summary written." asOf={`${day} ${board.now}`} footnote={dues.count ? `${dues.count} left with ${money(dues.amount)} outstanding` : 'all settled'} />
      </div>

      <Panel
        title={`Needs attention now — ${alerts.length} item(s)`}
        actions={<span className="text-xs text-text-tertiary">Early-warning escalations, drug-round errors and beds stuck in cleaning</span>}
      >
        {alerts.length === 0 ? (
          <EmptyState title="Nothing is asking for attention" description="No patient is trending on the early-warning chart, the drug round has no errors recorded and no bed is past the cleaning target." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-2">
                <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', TONE_DOT[a.tone])} />
                <span className="flex-1 text-sm">{a.text}</span>
                {a.admissionId && (
                  <Button variant="ghost" size="sm" onClick={() => setChartId(a.admissionId!)}>
                    Open chart
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Tabs
        items={[
          { id: 'board', label: 'Bed board' },
          { id: 'patients', label: 'Patients', count: board.admissions.length },
          { id: 'medication', label: 'Drug round', count: mar.due + mar.late },
          { id: 'handover', label: 'Handover' },
          { id: 'discharge', label: 'Discharge desk', count: board.discharges.length },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'board' && (
          <div className="flex flex-col gap-3">
            {visibleWards.map((w) => {
              const beds = board.beds.filter((b) => b.wardId === w.id);
              const wardOcc = occupancy(beds);
              return (
                <Panel
                  key={w.id}
                  title={`${w.name} · ${w.floor}`}
                  actions={
                    <span className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
                      <span>{w.inCharge}</span>
                      <span>{w.nurseRatio}</span>
                      <span className="font-numeric">{wardOcc.occupied}/{beds.length} · {wardOcc.percent} %</span>
                    </span>
                  }
                >
                  <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
                    {beds.map((bed) => {
                      const admission = board.admissions.find((a) => a.id === bed.admissionId);
                      const latest = admission ? latestVitals(board, admission.id) : undefined;
                      return (
                        <li key={bed.id}>
                          <button
                            type="button"
                            onClick={() => setBedSheet(bed.id)}
                            className={cx('flex w-full flex-col gap-0.5 rounded-md border p-2 text-left hover:shadow-sm', BED_BG[bed.status])}
                          >
                            <span className="flex items-center justify-between gap-1">
                              <span className="font-numeric text-xs font-semibold">{bed.label}</span>
                              <span className={cx('size-2 rounded-full', TONE_DOT[admission ? (latest ? EWS_RESPONSE[latest.band].tone : 'neutral') : bed.status === 'Free' ? 'success' : bed.status === 'Blocked' ? 'critical' : 'warning'])} aria-hidden />
                            </span>
                            {admission ? (
                              <>
                                <span className="truncate text-xs font-medium">{admission.patient.name}</span>
                                <span className="truncate text-[11px] text-text-tertiary">{bed.class} · day {losDays(admission, day)}</span>
                                {latest && (
                                  <span className={cx('mt-0.5 inline-flex w-fit rounded-full px-1.5 text-[10px]', EWS_CHIP[latest.band])}>
                                    EWS {latest.score} · {latest.band}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="truncate text-[11px] text-text-tertiary">{bed.status}{bed.note ? ` · ${bed.note}` : ''}</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              );
            })}
          </div>
        )}

        {tab === 'patients' && (
          <DataGrid<Admission>
            id="ward-patients"
            caption="Patients in beds"
            columns={admissionColumns}
            rows={board.admissions}
            total={board.admissions.length}
            page={1}
            pageSize={50}
            rowId={(a) => a.id}
            height="32rem"
            rowActions={admissionActions}
            onRowClick={(a) => setChartId(a.id)}
            quickSearch={{ value: '', onChange: () => undefined, placeholder: 'Name, MRN, bed or consultant…' }}
            printMeta={`Ward census ${day} ${board.now} · ${occ.occupied}/${occ.total} beds`}
          />
        )}

        {tab === 'medication' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                name="mar-filter"
                label="Show"
                value={marFilter}
                onChange={setMarFilter}
                options={[
                  { value: 'due', label: `Due (${mar.due})` },
                  { value: 'late', label: `Late (${mar.late})` },
                  { value: 'given', label: `Given (${mar.given})` },
                  { value: 'all', label: `All (${board.mar.length})` },
                ]}
              />
              <span className="text-xs text-text-tertiary">
                A dose is signed at the bedside: the check is recorded, a controlled drug needs a witness by name, and
                a dose that was not given needs a reason.
              </span>
            </div>
            {gaps.unaccounted.length > 0 && (
              <SafetyBanner severity="critical" title={`${gaps.unaccounted.length} administration(s) on the record are not accounted for`}>
                <ul className="ml-1 list-disc pl-4 text-sm">
                  {gaps.unaccounted.map((u) => (
                    <li key={u.id}>{u.text}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}
            <DataGrid<MarDose>
              id="ward-mar"
              caption="Medication round"
              columns={marColumns}
              rows={marRows}
              total={marRows.length}
              page={1}
              pageSize={50}
              rowId={(d) => d.id}
              height="30rem"
              sort={{ key: 'scheduledAt', dir: 'asc' }}
              rowActions={doseActions}
              quickSearch={{ value: quickSearch, onChange: setQuickSearch, placeholder: 'Medicine, patient or bed…' }}
              printMeta={`Drug round ${day} ${board.now} · ${board.shift} shift`}
            />
          </div>
        )}

        {tab === 'handover' && (
          <div className="flex flex-col gap-3">
            {board.handovers.map((h) => (
              <Panel
                key={h.id}
                title={`${wardName(h.wardId)} · ${h.shift} handover at ${h.at}`}
                actions={<span className="text-xs text-text-tertiary">{h.by} → {h.to}</span>}
              >
                <dl className="flex flex-col gap-2 text-sm">
                  {(['situation', 'background', 'assessment', 'recommendation'] as const).map((key) => (
                    <div key={key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                      <dt className="w-32 shrink-0 text-xs uppercase tracking-wide text-text-tertiary">{key}</dt>
                      <dd className="flex-1">{h.sbar[key]}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="mt-3 flex flex-col gap-1.5 border-t border-border-subtle pt-3">
                  {h.tasks.map((t) => (
                    <li key={t.text} className="flex items-center gap-2 text-sm">
                      <span className={cx('inline-grid size-4 shrink-0 place-items-center rounded-sm border text-[10px]', t.done ? 'border-safety-success bg-safety-success/10 text-safety-success' : 'border-border-default text-transparent')} aria-hidden>
                        ✓
                      </span>
                      <span className={cx('flex-1', t.done && 'text-text-tertiary line-through')}>{t.text}</span>
                      <span className="text-xs text-text-tertiary">{t.owner}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-text-tertiary">
                  Handover is written, not spoken: the next shift reads the tasks it inherited, and an unfinished task
                  is somebody’s name, not a rumour.
                </p>
              </Panel>
            ))}
          </div>
        )}

        {tab === 'discharge' && (
          <div className="flex flex-col gap-3">
            <SafetyBanner severity={dues.count ? 'warning' : 'success'} title={dues.count ? `${dues.count} patient(s) left with ${money(dues.amount)} outstanding` : 'Every discharge today was settled before the patient left'}>
              Discharging with an unsettled bill happens in every hospital. What matters is that it is counted, named
              and visible to the billing counter — not discovered at month end.
            </SafetyBanner>
            <Panel title={`Transfers today — ${board.transfers.length}`}>
              <ul className="flex flex-col gap-2 text-sm">
                {board.transfers.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-numeric text-xs text-text-tertiary">{t.at}</span>
                    <span className="font-medium">{t.mrn}</span>
                    <span>
                      {t.fromWardId === 'referral' ? t.fromBed : `${wardName(t.fromWardId)} ${t.fromBed}`}
                      <span aria-hidden> → </span>
                      {t.toBranch ? `${t.toBranch} (another branch)` : `${wardName(t.toWardId ?? '')} ${t.toBed}`}
                    </span>
                    <span className="flex-1 text-xs text-text-secondary">{t.reason}</span>
                    <span className="text-xs text-text-tertiary">accepted by {t.acceptedBy}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-text-tertiary">
                Every move is a record with two locations and a name that accepted it — including the one that left
                the building, which is how a patient ends up with one record at two branches instead of two records.
              </p>
            </Panel>

            <div className="flex flex-wrap gap-2">
              {board.discharges.map((d) => (
                <Panel key={d.id} title={`${d.name} · ${d.mrn}`} className="min-w-[22rem] flex-1">
                  <p className="text-xs text-text-secondary">
                    {wardName(d.wardId)} · {d.bedId.replace(/^\w+-/, '')} · admitted {d.admittedAt} · discharged {d.dischargedAt} · {d.stayedDays} day(s)
                  </p>
                  <p className="mt-1 text-sm">{d.type} — {d.diagnosis.code} · {d.diagnosis.label}</p>
                  <p className="mt-1 text-xs text-text-secondary">Under {d.consultantName} · summary prepared by {d.preparedBy}</p>
                  <ul className="mt-2 flex flex-col gap-0.5">
                    {dischargeChecklist(d).map((c) => (
                      <li key={c.label} className="flex items-center gap-2 text-xs">
                        <span aria-hidden className={cx('inline-grid size-3.5 place-items-center rounded-sm border text-[9px]', c.done ? 'border-safety-success bg-safety-success/10 text-safety-success' : 'border-safety-critical/60 text-safety-critical')}>
                          {c.done ? '✓' : '!'}
                        </span>
                        <span className={c.done ? 'text-text-secondary' : 'text-safety-critical'}>{c.label}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link href={`/print/discharge-summary?dsc=${d.id}`}>
                      <Button size="sm" variant="ghost" className="gap-1.5">
                        <Printer className="size-3.5" aria-hidden />
                        Print discharge summary
                      </Button>
                    </Link>
                    <Link href="/billing">
                      <Button size="sm" variant="ghost">Billing counter</Button>
                    </Link>
                  </div>
                </Panel>
              ))}
            </div>
          </div>
        )}
      </Tabs>

      {/* ------------------------------------------------------------ sheets */}
      <Sheet
        open={Boolean(bedSheetBed)}
        onClose={() => setBedSheet(null)}
        title={bedSheetBed ? `Bed ${bedSheetBed.label} · ${bedSheetBed.class}` : 'Bed'}
        description={bedSheetBed ? `${wardName(bedSheetBed.wardId)} · ${bedSheetBed.status}${bedSheetBed.note ? ` · ${bedSheetBed.note}` : ''}` : undefined}
        width="md"
        footer={
          bedSheetBed && (
            <div className="flex flex-wrap items-center gap-2">
              {bedSheetBed.status === 'Occupied' && (
                <>
                  <Button size="sm" onClick={() => { setChartId(bedSheetBed.admissionId ?? null); setBedSheet(null); }}>Open chart</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setTransferId(bedSheetBed.admissionId ?? null); setBedSheet(null); }}>Transfer</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setDischargeId(bedSheetBed.admissionId ?? null); setBedSheet(null); }}>Discharge</Button>
                </>
              )}
              {bedSheetBed.status === 'Free' && (
                <>
                  <Button size="sm" onClick={() => { setAdmitBedId(bedSheetBed.id); setBedSheet(null); }}>Admit a patient here</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setBed(bedSheetBed.id, { status: 'Reserved', note: 'Reserved by the ward desk', reservedFor: 'Expected admission' }); push({ title: `Bed ${bedSheetBed.label} reserved`, description: 'A reservation carries who it is held for; a bed is never quietly taken out of the pool.', tone: 'info' }); }}>Reserve</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setBed(bedSheetBed.id, { status: 'Blocked', note: 'Blocked by the ward desk — reason to be recorded in maintenance' }); push({ title: `Bed ${bedSheetBed.label} blocked`, description: 'Blocked beds are counted out of occupancy, not hidden inside it.', tone: 'warning' }); }}>Block</Button>
                </>
              )}
              {bedSheetBed.status === 'Cleaning' && (
                <>
                  <Button size="sm" onClick={() => { setBed(bedSheetBed.id, { status: 'Free', note: `Cleaned and checked at ${board.now}`, cleaningSince: undefined }); push({ title: `Bed ${bedSheetBed.label} is free`, description: 'Cleaning finished, checked by the nurse in charge: the bed is available again.', tone: 'success' }); }}>Cleaning finished — free the bed</Button>
                  <Button size="sm" variant="ghost" onClick={() => setBed(bedSheetBed.id, { status: 'Blocked', note: 'Out of service — awaiting maintenance' })}>Take out of service</Button>
                </>
              )}
              {bedSheetBed.status === 'Reserved' && (
                <>
                  <Button size="sm" onClick={() => { setAdmitBedId(bedSheetBed.id); setBedSheet(null); }}>Admit into the reserved bed</Button>
                  <Button size="sm" variant="ghost" onClick={() => setBed(bedSheetBed.id, { status: 'Free', note: undefined, reservedFor: undefined })}>Release the reservation</Button>
                </>
              )}
              {bedSheetBed.status === 'Blocked' && (
                <Button size="sm" onClick={() => setBed(bedSheetBed.id, { status: 'Cleaning', note: 'Reopened for cleaning and checking', cleaningSince: board.now })}>Reopen: clean and check</Button>
              )}
            </div>
          )
        }
      >
        {bedSheetBed && (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt className={LABEL}>Ward</dt><dd>{wardName(bedSheetBed.wardId)}</dd></div>
              <div><dt className={LABEL}>Class and daily charge</dt><dd>{bedSheetBed.class} · {money(BED_CHARGE[bedSheetBed.class])}</dd></div>
              <div><dt className={LABEL}>State</dt><dd>{bedSheetBed.status}</dd></div>
              <div><dt className={LABEL}>Note</dt><dd>{bedSheetBed.note ?? '—'}</dd></div>
              {bedSheetBed.cleaningSince && (
                <div className="col-span-2">
                  <dt className={LABEL}>Out of service since</dt>
                  <dd className={board.nowMinutes - clockToMinutes(bedSheetBed.cleaningSince) > CLEANING_TARGET_MIN ? 'text-safety-warning' : ''}>
                    {bedSheetBed.cleaningSince} ({board.nowMinutes - clockToMinutes(bedSheetBed.cleaningSince)} minutes — target {CLEANING_TARGET_MIN})
                  </dd>
                </div>
              )}
            </dl>
            <div>
              <p className={LABEL}>What this bed can become, and what the move has to carry</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {BED_FLOW[bedSheetBed.status].map((move) => (
                  <li key={move.to} className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{move.to}</span>
                    <span className="flex-1">{move.label}</span>
                    <span className="text-xs text-text-tertiary">needs: {move.needs.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet
        open={Boolean(admitBedId)}
        onClose={() => setAdmitBedId(null)}
        title="Admit into this bed"
        description="A bed becomes occupied only with a patient, a consultant, a reason and an expected stay."
        width="lg"
        footer={
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!admitMrn || admitForm.reason.trim().length < 8} onClick={() => admitBedId && admitInto(admitBedId, { ...admitForm, mrn: admitMrn })}>
              Admit patient
            </Button>
            <span className="text-xs text-text-tertiary">A reason under eight characters is not a reason.</span>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Patient</span>
            <select className={INPUT} value={admitMrn} onChange={(e) => setAdmitMrn(e.target.value)}>
              <option value="">Choose a registered patient…</option>
              {patientsForAdmit.map((p) => (
                <option key={p.mrn} value={p.mrn}>{p.mrn} · {p.name} · {p.age}{p.sex === 'Male' ? 'M' : p.sex === 'Female' ? 'F' : ''}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Consultant</span>
            <select className={INPUT} value={admitForm.consultantId} onChange={(e) => setAdmitForm((f) => ({ ...f, consultantId: e.target.value }))}>
              {DOCTORS.map((d) => (
                <option key={d.id} value={d.id}>{d.name} · {d.department}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Why this patient is in a bed</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-border-default bg-surface-default p-2 text-sm"
              value={admitForm.reason}
              onChange={(e) => setAdmitForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Shortness of breath, not settling in the emergency room…"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>State on admission</span>
              <select className={INPUT} value={admitForm.severity} onChange={(e) => setAdmitForm((f) => ({ ...f, severity: e.target.value as Admission['severity'] }))}>
                <option>Stable</option>
                <option>Guarded</option>
                <option>Critical</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Expected stay (days)</span>
              <input type="number" min={1} max={30} className={INPUT} value={admitForm.expectedStayDays} onChange={(e) => setAdmitForm((f) => ({ ...f, expectedStayDays: Number(e.target.value) }))} />
            </label>
          </div>
          <p className="text-xs text-text-tertiary">
            The bed state, the admission and the ward bill all start here. Nothing is admitted without a consultant:
            a bed with a patient and nobody responsible for them is how a ward loses track.
          </p>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(transferId)}
        onClose={() => setTransferId(null)}
        title="Transfer"
        description={transferBed ? `${transferBed.patient.name} · currently ${bedOf(transferBed.id)}` : undefined}
        width="lg"
        footer={
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={(!transferForm.toBedId && !transferForm.toBranch) || transferForm.reason.trim().length < 8} onClick={() => transferId && transferPatient(transferId, transferForm)}>
              Record the transfer
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>To bed</span>
            <select className={INPUT} value={transferForm.toBedId} onChange={(e) => setTransferForm((f) => ({ ...f, toBedId: e.target.value, toBranch: '' }))}>
              <option value="">Choose a free bed…</option>
              {freeBeds.map((b) => (
                <option key={b.id} value={b.id}>{b.label} · {wardName(b.wardId)} · {b.class}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>…or transfer to another branch</span>
            <select className={INPUT} value={transferForm.toBranch} onChange={(e) => setTransferForm((f) => ({ ...f, toBranch: e.target.value, toBedId: '' }))}>
              <option value="">Stay in this hospital</option>
              <option>Uttara Branch</option>
              <option>Mirpur Branch</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Reason</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-border-default bg-surface-default p-2 text-sm"
              value={transferForm.reason}
              onChange={(e) => setTransferForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Stepped up to the high dependency unit for closer observation…"
            />
          </label>
          <p className="text-xs text-text-tertiary">
            A branch transfer keeps one record with two locations: the receiving branch accepts it by name, and the
            patient does not get a second MRN for having been moved.
          </p>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(dischargeId)}
        onClose={() => setDischargeId(null)}
        title="Discharge"
        description={dischargeAdmission ? `${dischargeAdmission.patient.name} · ${bedOf(dischargeAdmission.id)} · admitted ${dischargeAdmission.admittedAt} — the summary, the medicines and the bill, or it is not a discharge.` : undefined}
        width="lg"
        footer={
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={dischargeForm.course.trim().length < 12} onClick={() => dischargeId && dischargePatient(dischargeId, dischargeForm)}>
              Discharge the patient
            </Button>
            <span className="text-xs text-text-tertiary">The bed goes to Cleaning, not straight to Free.</span>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Type of discharge</span>
            <select className={INPUT} value={dischargeForm.type} onChange={(e) => setDischargeForm((f) => ({ ...f, type: e.target.value as DischargeType }))}>
              {['Recovered', 'Improved, follow-up in OPD', 'Referred to a higher centre', 'Discharged on request', 'Left against medical advice', 'Transferred to another branch', 'Died'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Course in hospital</span>
            <textarea
              className="min-h-24 w-full rounded-md border border-border-default bg-surface-default p-2 text-sm"
              value={dischargeForm.course}
              onChange={(e) => setDischargeForm((f) => ({ ...f, course: e.target.value }))}
              placeholder="Admitted with fever and hypotension, given intravenous fluids and antibiotics…"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Condition on discharge</span>
              <select className={INPUT} value={dischargeForm.condition} onChange={(e) => setDischargeForm((f) => ({ ...f, condition: e.target.value }))}>
                <option>Improved and stable</option>
                <option>Recovered, no complaints</option>
                <option>Stable, discharged on request</option>
                <option>Improved, referred onward for a specialist opinion</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Follow-up in (days)</span>
              <input type="number" min={0} max={90} className={INPUT} value={dischargeForm.followUpDays} onChange={(e) => setDischargeForm((f) => ({ ...f, followUpDays: Number(e.target.value) }))} />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={dischargeForm.settled} onChange={(e) => setDischargeForm((f) => ({ ...f, settled: e.target.checked }))} />
            <span>
              The bill is settled at the counter.
              <span className="block text-xs text-text-tertiary">Unchecked discharges the patient anyway and records the amount outstanding against the branch.</span>
            </span>
          </label>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(chart)}
        onClose={() => setChartId(null)}
        title={chart ? `${chart.patient.name} · ${bedOf(chart.id)}` : 'Chart'}
        description={chart ? `${wardName(chart.wardId)} · under ${chart.consultantName} · admitted ${chart.admittedAt}` : undefined}
        width="xl"
        footer={
          chart && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setTransferId(chart.id); setChartId(null); }}>Transfer</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDischargeId(chart.id); setChartId(null); }}>Discharge</Button>
              <Link href={`/print/discharge-summary?mrn=${chart.mrn}`}>
                <Button size="sm" variant="ghost" className="gap-1.5">
                  <Printer className="size-3.5" aria-hidden />
                  Summary
                </Button>
              </Link>
            </div>
          )
        }
      >
        {chart && (
          <div className="flex flex-col gap-3">
            <PatientBanner
              mrn={chart.mrn}
              name={chart.patient.name}
              age={chart.patient.age}
              sex={chart.patient.sex}
              bed={bedOf(chart.id)}
              payer={chart.patient.payer}
              allergies={chart.patient.allergies ? [chart.patient.allergies] : []}
              alerts={[
                ...(chart.severity !== 'Stable' ? [`${chart.severity} — reviewed by ${chart.consultantName}`] : []),
                ...(chart.isolation ? [chart.isolation] : []),
                ...(chart.codeStatus ? [chart.codeStatus] : ['No ceiling-of-care decision documented']),
              ]}
              extra={[
                { label: 'Admitted for', value: chart.reason },
                { label: 'Working diagnosis', value: chart.diagnosis ? `${chart.diagnosis.code} · ${chart.diagnosis.label}` : 'Not yet coded' },
                { label: 'Expected stay', value: `${chart.expectedStayDays} day(s)` },
              ]}
            />

            <Tabs
              items={[
                { id: 'obs', label: 'Observations', count: vitalsFor(chart.id).length },
                { id: 'notes', label: 'Nursing notes', count: notesFor(chart.id).length },
                { id: 'med', label: 'Medication', count: dosesFor(chart.id).length },
                { id: 'results', label: 'Results' },
              ]}
              value={chartTab}
              onChange={setChartTab}
            >
              {chartTab === 'obs' && (
                <div className="flex flex-col gap-3">
                  {vitalsFor(chart.id)
                    .slice()
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((v) => (
                      <Panel
                        key={v.id}
                        title={`${v.at} · score ${v.score} · ${v.band}`}
                        actions={<span className="text-xs text-text-tertiary">recorded by {v.by}</span>}
                      >
                        <ul className="flex flex-wrap gap-2 text-sm">
                          {v.params.map((p) => (
                            <li key={p.key} className={cx('rounded-md border px-2 py-1', p.points >= 3 ? 'border-safety-critical/40 bg-safety-critical/5' : p.points > 0 ? 'border-safety-warning/40 bg-safety-warning/5' : 'border-border-subtle')}>
                              <span className="text-xs text-text-tertiary">{p.label}</span>{' '}
                              <span className="font-numeric font-medium">{p.value}{p.unit ? ` ${p.unit}` : ''}</span>{' '}
                              <span className="text-xs text-text-tertiary">+{p.points} · {p.reason}</span>
                            </li>
                          ))}
                        </ul>
                        <p className={cx('mt-2 text-sm', TONE_TEXT[EWS_RESPONSE[v.band].tone])}>
                          <strong>{v.band}:</strong> {EWS_RESPONSE[v.band].obs}. {EWS_RESPONSE[v.band].response}
                        </p>
                        {v.escalated ? (
                          <p className="mt-1 text-xs text-text-secondary">
                            Escalated at {v.escalated.at} to {v.escalated.to} — {v.escalated.response}
                          </p>
                        ) : (v.band === 'Escalate' || v.band === 'Emergency') && (
                          <div className="mt-2 flex flex-col gap-2 border-t border-border-subtle pt-2">
                            <p className="text-xs text-safety-critical">This score requires a documented review. Record it here.</p>
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="flex flex-col gap-1">
                                <span className={LABEL}>Who attended</span>
                                <select className={INPUT} value={escalateForm.to} onChange={(e) => setEscalateForm((f) => ({ ...f, to: e.target.value }))}>
                                  {STAFF.filter((s) => s.role === 'Registrar' || s.role === 'Consultant' || s.role === 'Intern').map((s) => (
                                    <option key={s.id}>{s.name}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex min-w-64 flex-1 flex-col gap-1">
                                <span className={LABEL}>What was done</span>
                                <input className={INPUT} value={escalateForm.response} onChange={(e) => setEscalateForm((f) => ({ ...f, response: e.target.value }))} placeholder="Reviewed at the bedside, oxygen started, plan documented…" />
                              </label>
                              <Button size="sm" disabled={escalateForm.response.trim().length < 10} onClick={() => escalate(v, escalateForm)}>
                                Record the review
                              </Button>
                            </div>
                          </div>
                        )}
                      </Panel>
                    ))}
                </div>
              )}

              {chartTab === 'notes' && (
                <div className="flex flex-col gap-3">
                  <Panel title="Add a note">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-col gap-1">
                          <span className={LABEL}>Kind</span>
                          <select className={INPUT} value={noteForm.kind} onChange={(e) => setNoteForm((f) => ({ ...f, kind: e.target.value as NoteKind }))}>
                            {NOTE_KINDS.map((k) => (
                              <option key={k}>{k}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex min-w-72 flex-1 flex-col gap-1">
                          <span className={LABEL}>What happened</span>
                          <input className={INPUT} value={noteForm.text} onChange={(e) => setNoteForm((f) => ({ ...f, text: e.target.value }))} placeholder="Wound edge inspected: no discharge, no redness…" />
                        </label>
                        <Button size="sm" disabled={noteForm.text.trim().length < 8} onClick={() => { addNote(chart.id, noteForm); setNoteForm({ kind: 'Note', text: '' }); }}>
                          Add to the chart
                        </Button>
                      </div>
                      <p className="text-xs text-text-tertiary">
                        Notes are appended and signed with the time and the shift. A correction is another note — the
                        record is never rewritten, which is what makes it usable in a review.
                      </p>
                    </div>
                  </Panel>
                  <ul className="flex flex-col gap-2">
                    {notesFor(chart.id)
                      .slice()
                      .sort((a, b) => b.at.localeCompare(a.at))
                      .map((n) => (
                        <li key={n.id} className="rounded-md border border-border-subtle bg-surface-default p-2">
                          <p className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
                            <span className="font-numeric">{n.at}</span>
                            <span className="rounded-full bg-surface-sunken px-2 py-0.5">{n.kind}</span>
                            <span>{n.shift} shift</span>
                            <span>{n.by}</span>
                          </p>
                          <p className="mt-1 text-sm">{n.text}</p>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {chartTab === 'med' && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-text-tertiary">
                    Today’s round for this patient. Signing is a bedside action: the check is recorded, a controlled
                    dose needs a witness, and a dose that was not given needs a reason.
                  </p>
                  <ul className="flex flex-col gap-2">
                    {dosesFor(chart.id)
                      .slice()
                      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
                      .map((d) => {
                        const blockers = doseBlockers(d);
                        return (
                          <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface-default p-2">
                            <span className="font-numeric w-12 text-sm">{d.scheduledAt}</span>
                            <span className="flex-1">
                              <span className="text-sm font-medium">{d.brand} {d.strength}</span>
                              {d.controlled && <span className="ml-1 rounded-full bg-safety-critical/10 px-1.5 text-[10px] text-safety-critical">controlled</span>}
                              {d.highAlert && <span className="ml-1 rounded-full bg-safety-warning/10 px-1.5 text-[10px] text-safety-warning">high alert</span>}
                              <span className="block text-xs text-text-tertiary">{d.generic} · {d.dose} · {d.route} · {d.frequency}</span>
                              {d.reason && <span className="block text-xs text-text-secondary">Reason: {d.reason}</span>}
                              {d.givenBy && <span className="block text-xs text-text-secondary">Given by {d.givenBy}{d.witness ? `, witnessed by ${d.witness}` : ''}</span>}
                              {blockers.length > 0 && <span className="mt-0.5 block text-xs text-safety-critical">{blockers.join('; ')}</span>}
                            </span>
                            <span className={cx('rounded-full px-2 py-0.5 text-xs', `bg-surface-sunken ${TONE_TEXT[DOSE_TONE[d.status]]}`)}>{d.status}</span>
                            <Button size="sm" variant="ghost" onClick={() => setDoseId(d.id)}>
                              {d.status === 'Given' ? 'Review' : 'Sign'}
                            </Button>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              )}

              {chartTab === 'results' && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-text-tertiary">
                    Results for this patient from today’s laboratory and imaging worklist — the same records the
                    diagnostics screen holds, read here because a ward round should not need a second tab.
                  </p>
                  {results.filter((o) => o.patient.mrn === chart.mrn).length === 0 ? (
                    <EmptyState title="No orders for this patient today" description="Anything ordered on the ward appears here as soon as the laboratory receives it." />
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {results
                        .filter((o) => o.patient.mrn === chart.mrn)
                        .map((o) => (
                          <li key={o.id} className="rounded-md border border-border-subtle bg-surface-default p-2">
                            <p className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-medium">{o.testName}</span>
                              <span className="font-numeric text-xs text-text-tertiary">{o.specimenId ?? o.id}</span>
                              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{o.status}</span>
                              {needsFlag(o) && <span className="rounded-full bg-safety-critical/10 px-2 py-0.5 text-xs text-safety-critical">critical value</span>}
                            </p>
                            {hasResults(o.status) && (
                              <p className="mt-1 text-xs text-text-secondary">
                                {Object.entries(o.results).map(([k, v]) => `${k} ${v}`).join(' · ')}
                              </p>
                            )}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
            </Tabs>
          </div>
        )}
      </Sheet>

      <Sheet
        open={Boolean(dose)}
        onClose={() => setDoseId(null)}
        title={dose ? `${dose.brand} ${dose.strength}` : 'Dose'}
        description={dose ? `${patientOf(dose.admissionId)?.name ?? ''} · ${bedOf(dose.admissionId)} · due ${dose.scheduledAt} · ${dose.frequency}` : undefined}
        width="md"
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pendingBlockers.length > 0} onClick={() => dose && signDose(dose, doseForm)}>
              {doseForm.status === 'Given' ? 'Sign the administration' : 'Record it'}
            </Button>
            <span className="text-xs text-text-tertiary">{pendingBlockers.length ? pendingBlockers[0] : 'Nothing is missing from this entry.'}</span>
          </div>
        }
      >
        {dose && (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt className={LABEL}>Generic and form</dt><dd>{dose.generic} · {dose.strength}</dd></div>
              <div><dt className={LABEL}>Dose and route</dt><dd>{dose.dose} · {dose.route}</dd></div>
              <div><dt className={LABEL}>Prescribed as</dt><dd>{dose.frequency}{dose.prn ? ' (as needed)' : ''}</dd></div>
              <div><dt className={LABEL}>Flags</dt><dd>{[dose.controlled ? 'Controlled — witness required' : null, dose.highAlert ? 'High alert — double-check' : null].filter(Boolean).join(' · ') || 'Routine'}</dd></div>
            </dl>

            <label className="flex flex-col gap-1">
              <span className={LABEL}>Outcome</span>
              <select className={INPUT} value={doseForm.status} onChange={(e) => setDoseForm((f) => ({ ...f, status: e.target.value as DoseStatus }))}>
                <option>Given</option>
                <option>Held</option>
                <option>Refused</option>
                <option>Not given</option>
              </select>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={doseForm.checked} onChange={(e) => setDoseForm((f) => ({ ...f, checked: e.target.checked }))} />
              <span>
                Right patient, right drug, right dose, right route, right time — checked against the pack.
                <span className="block text-xs text-text-tertiary">The check is recorded before the dose, at the bedside. This is the field that fails an audit when it is skipped.</span>
              </span>
            </label>

            {dose.controlled && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Witness (controlled drug — a second person by name)</span>
                <select className={INPUT} value={doseForm.witness} onChange={(e) => setDoseForm((f) => ({ ...f, witness: e.target.value }))}>
                  <option value="">Choose the witness…</option>
                  {STAFF.map((s) => (
                    <option key={s.id} value={s.name}>{s.name} · {s.role}</option>
                  ))}
                </select>
                <span className="text-xs text-text-tertiary">An opioid without a witness is not an administration record — it is a gap with a signature.</span>
              </label>
            )}

            {dose.prn && doseForm.status === 'Given' && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Indication (why it was given)</span>
                <input className={INPUT} value={doseForm.indication} onChange={(e) => setDoseForm((f) => ({ ...f, indication: e.target.value }))} placeholder="Pain score 7/10, no relief from paracetamol…" />
              </label>
            )}

            {doseForm.status !== 'Given' && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Reason</span>
                <textarea className="min-h-20 w-full rounded-md border border-border-default bg-surface-default p-2 text-sm" value={doseForm.reason} onChange={(e) => setDoseForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Vomiting — held and the registrar informed…" />
              </label>
            )}

            {pendingBlockers.length > 0 && (
              <SafetyBanner severity="warning" title="This entry cannot be signed yet">
                <ul className="ml-1 list-disc pl-4 text-sm">
                  {pendingBlockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}
          </div>
        )}
      </Sheet>

      {gaps.noCeiling.length > 0 && (
        <Panel title={`Ceiling of care not documented — ${gaps.noCeiling.length} patient(s)`}>
          <p className="text-sm text-text-secondary">
            No decision is recorded about what should be done if these patients deteriorate. The round asks for one:
            a resuscitation status written when nobody is in a hurry is worth more than one written at 3 a.m.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {gaps.noCeiling.map((g) => (
              <li key={g.mrn} className="rounded-full bg-surface-sunken px-2 py-0.5">
                {g.bed} · {g.name}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

/** Days a patient has been in the bed, counting the admission day, from the generated day. */
function losDays(admission: Admission, day: string): number {
  const [ay, am, ad] = admission.admittedAt.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = day.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const t = Date.UTC(ty, tm - 1, td);
  return Math.max(1, Math.round((t - a) / 86_400_000) + 1);
}

function clockToMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function needsFlag(order: ReturnType<typeof generateDiagnosticOrders>[number]): boolean {
  return hasResults(order.status) && (worstFlag(order) === 'critical-high' || worstFlag(order) === 'critical-low');
}
