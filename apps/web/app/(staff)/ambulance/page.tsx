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
  type Column,
} from '@dizi/ui';
import { Ambulance, Crosshair, Printer, Siren, TriangleAlert } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { patients } from '@/lib/mock';
import { useShell } from '@/lib/shell';
import { money } from '@/lib/billing';
import {
  DECONTAMINATION_MIN,
  FARE_TABLE,
  MAX_DRIVE_HOURS,
  OXYGEN_FLOOR_PCT,
  RESPONSE_TARGET_MIN,
  TURNAROUND_MIN,
  ambulanceDay,
  bestVehicle,
  dispatchCheck,
  minutesBetween,
  responseVerdict,
  type AmbulanceCall,
  type CallKind,
  type CallPriority,
  type Driver,
  type Vehicle,
} from '@/lib/ambulance';

/* Ambulance (legacy screen 043 — `admin/vehicle/getcallambulance` — replaced) — the P4 sub-screen.
 *
 * The legacy screen was a log of calls. This one keeps the log and answers the two questions a log cannot:
 * which vehicle can actually go now, and why the last response took the time it did. `lib/ambulance.ts` holds
 * the rules — one state per vehicle, four measured timestamps, oxygen floor, driver hours, decontamination —
 * and every refusal on this screen says which rule refused it.
 *
 * Preview: the log is synthetic and nothing survives a reload. The rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const CALL_TONE: Record<AmbulanceCall['state'], string> = {
  Waiting: 'bg-safety-warning/10 text-safety-warning',
  Dispatched: 'bg-brand-50 text-brand-700',
  'On scene': 'bg-brand-50 text-brand-700',
  Conveying: 'bg-brand-50 text-brand-700',
  Completed: 'bg-surface-sunken text-text-secondary',
  Cancelled: 'bg-surface-sunken text-text-tertiary',
};

const VEHICLE_CHIP: Record<Vehicle['state'], string> = {
  Free: 'bg-safety-success/10 text-safety-success',
  'On a call': 'bg-brand-50 text-brand-700',
  Returning: 'bg-brand-50 text-brand-700',
  'Under maintenance': 'bg-safety-critical/10 text-safety-critical',
  Decontamination: 'bg-safety-warning/10 text-safety-warning',
};

export default function AmbulancePage() {
  const { sync, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [fleet, setFleet] = useState(() => ambulanceDay(day));
  const [tab, setTab] = useState('dispatch');
  const [callId, setCallId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [newCall, setNewCall] = useState({
    kind: 'Emergency' as CallKind,
    priority: 'P1 — immediate' as CallPriority,
    from: '',
    to: 'Emergency department',
    mrn: '',
    complaint: '',
    infectious: false,
  });

  const call = fleet.calls.find((c) => c.id === callId) ?? null;
  const vehicle = fleet.vehicles.find((v) => v.id === vehicleId) ?? null;
  const driver = fleet.drivers.find((d) => d.id === driverId) ?? null;
  const waiting = fleet.calls.filter((c) => c.state === 'Waiting');
  const suggestions = useMemo(() => (call ? bestVehicle(call, fleet.vehicles) : []), [call, fleet.vehicles]);

  const patchCall = (id: string, patch: Partial<AmbulanceCall>) =>
    setFleet((f) => ({ ...f, calls: f.calls.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const patchVehicle = (id: string, patch: Partial<Vehicle>) =>
    setFleet((f) => ({ ...f, vehicles: f.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));

  const driverOf = (id: string) => fleet.drivers.find((d) => d.id === id);

  /* ---------------------------------------------------------------- dispatch */

  const dispatch = (target: AmbulanceCall, chosen: Vehicle) => {
    const crewDriver = driverOf(target.crew.driverId);
    const check = dispatchCheck(target, chosen, crewDriver, day);
    if (!check.ok) {
      setRefusal(`Refused — ${check.blockers.join(' ')}`);
      push({ title: 'Dispatch refused: a rule in the checklist blocks it.', tone: 'critical' });
      return;
    }
    const dispatchedAt = `${day}T11:${String(10 + fleet.stats.running * 3).padStart(2, '0')}`;
    patchCall(target.id, {
      state: 'Dispatched',
      vehicleId: chosen.id,
      dispatchedAt,
      checks: { oxygenPct: chosen.oxygenPct, stretcher: chosen.stretcher === 'ok', suction: chosen.suction === 'ok', bagSealedTo: '2027-02-28', at: dispatchedAt },
    });
    patchVehicle(chosen.id, { state: 'On a call', note: `On ${target.id} since ${dispatchedAt.slice(11)}` });
    setRefusal(check.warnings.length ? `Dispatched with a note — ${check.warnings.join(' ')}` : null);
    push({ title: `${target.id} dispatched: ${chosen.plate} to ${target.from}. The clock on the response started when the call was received.`, tone: 'success' });
  };

  const arriveOnScene = (target: AmbulanceCall) => {
    const at = `${day}T11:${String(24 + fleet.stats.running).padStart(2, '0')}`;
    patchCall(target.id, { state: 'On scene', onSceneAt: at });
    const verdict = responseVerdict({ ...target, onSceneAt: at });
    push({ title: `On scene at ${at.slice(11)} — ${verdict.text}`, tone: verdict.verdict === 'missed' ? 'critical' : 'success' });
  };

  const complete = (target: AmbulanceCall, handover: boolean, decontaminate: boolean) => {
    const at = `${day}T11:${String(45 + fleet.stats.running * 2).padStart(2, '0')}`;
    const vehicleOnCall = fleet.vehicles.find((v) => v.id === target.vehicleId);
    patchCall(target.id, {
      state: 'Completed',
      handoverAt: handover ? at : target.handoverAt,
      returnedAt: at,
      fare: target.fare ?? (() => {
        const row = FARE_TABLE.find((f) => f.kind === vehicleOnCall?.kind) ?? FARE_TABLE[1];
        const km = 5;
        return { base: row.base, perKm: row.perKm, km, waiting: 0, total: row.base + row.perKm * km };
      })(),
    });
    if (vehicleOnCall) {
      patchVehicle(vehicleOnCall.id, {
        state: decontaminate ? 'Decontamination' : 'Free',
        note: decontaminate
          ? `Decontaminating after ${target.id} — ${DECONTAMINATION_MIN} minutes out of the pool`
          : `Back at ${vehicleOnCall.base} after ${target.id}`,
      });
    }
    setCallId(null);
    push({
      title: decontaminate
        ? `${target.id} complete. The vehicle is out of the pool for ${DECONTAMINATION_MIN} minutes of decontamination — an infectious patient changes the state of the vehicle, not just the log.`
        : `${target.id} complete; the vehicle is back in the pool.`,
      tone: 'success',
    });
  };

  const raiseCall = () => {
    if (!newCall.from.trim()) {
      push({ title: 'A call needs the place it is coming from — that is what the response time is measured from.', tone: 'critical' });
      return;
    }
    const id = `AMB-${4422 + fleet.calls.length}`;
    const patient = patients.find((p) => p.mrn === newCall.mrn);
    const record: AmbulanceCall = {
      id,
      kind: newCall.kind,
      priority: newCall.priority,
      receivedAt: `${day}T11:05`,
      from: newCall.from.trim(),
      to: newCall.to,
      patientMrn: patient?.mrn,
      patientName: patient?.name,
      complaint: newCall.complaint || undefined,
      crew: { driverId: fleet.drivers[1].id, attendant: 'Staff nurse R. Akter' },
      state: 'Waiting',
      infectious: newCall.infectious,
      note: `Received by the control desk at ${day} 11:05; waiting for a vehicle.`,
    };
    setFleet((f) => ({
      ...f,
      calls: [...f.calls, record],
      stats: { ...f.stats, callsToday: f.stats.callsToday + 1, waiting: f.stats.waiting + 1 },
    }));
    setCallId(id);
    setNewCall({ ...newCall, from: '', mrn: '', complaint: '', infectious: false });
    push({ title: `${id} logged. The response clock starts at the time the call was received — ${record.receivedAt.slice(11)}.`, tone: 'success' });
  };

  /* ---------------------------------------------------------------- columns */

  const callColumns: Array<Column<AmbulanceCall>> = [
    { key: 'id', header: 'Call', width: '100px' },
    { key: 'receivedAt', header: 'Received', width: '96px', render: (c) => c.receivedAt.slice(11) },
    { key: 'kind', header: 'Kind', width: '130px' },
    { key: 'priority', header: 'Priority', hideBelow: 'lg', width: '150px', render: (c) => (
      <span className={cx(c.priority.startsWith('P1') ? TONE_TEXT.critical : c.priority.startsWith('P2') ? TONE_TEXT.warning : TONE_TEXT.neutral)}>{c.priority}</span>
    ) },
    { key: 'from', header: 'From → to', render: (c) => (
      <span>
        {c.from}
        <span className="mx-1 text-text-tertiary">→</span>
        {c.to}
        {c.patientName && <span className="ml-2 text-xs text-text-tertiary">{c.patientName}{c.infectious ? ' · infectious' : ''}</span>}
      </span>
    ) },
    { key: 'vehicleId', header: 'Vehicle', hideBelow: 'md', width: '140px', render: (c) => fleet.vehicles.find((v) => v.id === c.vehicleId)?.plate ?? '—' },
    { key: 'response', header: 'Response', width: '130px', render: (c) => {
      const v = responseVerdict(c);
      return (
        <span className={cx(v.verdict === 'missed' ? TONE_TEXT.critical : v.verdict === 'met' ? TONE_TEXT.success : TONE_TEXT.neutral)}>
          {v.measured !== null ? `${v.measured} min / ${v.target}` : v.verdict === 'not measured' ? 'booked' : 'running'}
        </span>
      );
    } },
    { key: 'state', header: 'State', width: '120px', render: (c) => (
      <span className={cx('rounded-full px-2 py-0.5 text-xs', CALL_TONE[c.state])}>{c.state}</span>
    ) },
  ];

  const vehicleColumns: Array<Column<Vehicle>> = [
    { key: 'plate', header: 'Vehicle', width: '160px' },
    { key: 'kind', header: 'Kind', width: '150px' },
    { key: 'base', header: 'Base', hideBelow: 'md', width: '130px' },
    { key: 'state', header: 'State', width: '150px', render: (v) => (
      <span className={cx('rounded-full px-2 py-0.5 text-xs', VEHICLE_CHIP[v.state])}>{v.state}</span>
    ) },
    { key: 'oxygenPct', header: 'Oxygen', numeric: true, align: 'right', width: '100px', render: (v) => (
      <span className={cx(v.kind === 'Mortuary van' ? TONE_TEXT.neutral : v.oxygenPct < OXYGEN_FLOOR_PCT ? TONE_TEXT.critical : TONE_TEXT.success)}>
        {v.kind === 'Mortuary van' ? 'n/a' : `${v.oxygenPct} %`}
      </span>
    ) },
    { key: 'nextService', header: 'Next service', hideBelow: 'lg', width: '120px' },
    { key: 'fitnessTo', header: 'Fitness to', hideBelow: 'xl', width: '120px', render: (v) => (
      <span className={cx(v.fitnessTo < day ? TONE_TEXT.critical : TONE_TEXT.neutral)}>{v.fitnessTo}</span>
    ) },
  ];

  const driverColumns: Array<Column<Driver>> = [
    { key: 'name', header: 'Driver', width: '150px' },
    { key: 'phone', header: 'Phone', hideBelow: 'md', width: '150px' },
    { key: 'licence', header: 'Licence', hideBelow: 'lg', width: '150px' },
    { key: 'licenceTo', header: 'Valid to', width: '120px', render: (d) => (
      <span className={cx(d.licenceTo < day ? TONE_TEXT.critical : TONE_TEXT.neutral)}>{d.licenceTo}</span>
    ) },
    { key: 'hoursToday', header: 'Driven today', numeric: true, align: 'right', width: '130px', render: (d) => (
      <span className={cx(d.hoursToday >= MAX_DRIVE_HOURS - 2 ? TONE_TEXT.warning : TONE_TEXT.neutral)}>
        {d.hoursToday} h / {MAX_DRIVE_HOURS}
      </span>
    ) },
    { key: 'kinds', header: 'Cleared for', render: (d) => d.kinds.join(', '), hideBelow: 'xl' },
    { key: 'onShift', header: 'Shift', width: '110px', render: (d) => (
      <span className={cx(d.onShift ? TONE_TEXT.success : TONE_TEXT.neutral)}>{d.onShift ? 'On shift' : 'Off shift'}</span>
    ) },
  ];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Ambulance className="size-5 text-brand-600" aria-hidden />
            Ambulance control
          </h1>
          <p className="text-sm text-text-secondary">
            Calls, vehicles, crew and the response clock — {day}. Every refusal on this screen names the rule that refused it.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Calls today" value={String(fleet.stats.callsToday)} definition="Every call logged at the control desk, emergency and booked." asOf={day} />
        <KpiTile label="Running now" value={String(fleet.stats.running)} definition="Vehicles dispatched, on scene or conveying a patient." asOf={day} />
        <KpiTile label="Waiting for a vehicle" value={String(waiting.length)} definition="Calls accepted and not yet dispatched — the queue the board exists to empty." asOf={day} />
        <KpiTile label="Average response" value={fleet.stats.averageResponse !== null ? `${fleet.stats.averageResponse} min` : '—'} definition="Mean of call received → on scene for every completed emergency today." asOf={day} />
        <KpiTile label="Targets met" value={`${fleet.stats.targetsMet} / ${fleet.stats.targetsMet + fleet.stats.targetsMissed}`} definition={`Emergencies where on-scene time met the target of ${RESPONSE_TARGET_MIN['P1 — immediate']} minutes.`} asOf={day} />
        <KpiTile label="Vehicles free" value={`${fleet.stats.freeVehicles} / ${fleet.vehicles.length}`} definition="Free now; out of service means maintenance or decontamination, both with a reason recorded." asOf={day} />
      </div>

      {(fleet.stats.targetsMissed > 0 || fleet.stats.lowOxygen > 0) && (
        <div className="flex flex-wrap items-start gap-2 rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-safety-warning" aria-hidden />
          <div className="space-y-1">
            {fleet.stats.targetsMissed > 0 && (
              <p>
                <span className="font-medium">A response missed its target today.</span> The reason is recorded on the call, because a
                response time without a reason cannot be improved — someone was fuelling the van, or waiting for a signature.
              </p>
            )}
            {fleet.stats.lowOxygen > 0 && (
              <p>
                <span className="font-medium">{fleet.stats.lowOxygen} vehicle is below the {OXYGEN_FLOOR_PCT} % oxygen floor.</span> It may not take a
                transfer until it is refilled — that is the reason a booked run is waiting, and the screen says so rather than inventing a delay.
              </p>
            )}
          </div>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'dispatch', label: 'Dispatch board', count: waiting.length || undefined },
          { id: 'fleet', label: 'Vehicles', count: fleet.vehicles.length },
          { id: 'crew', label: 'Crew', count: fleet.drivers.filter((d) => d.onShift).length },
          { id: 'fares', label: 'Fares and rules' },
        ]}
      />

      {tab === 'dispatch' && (
        <div className="space-y-3">
          <Panel title="Log a call" actions={<span className="text-xs text-text-secondary">The clock starts when the call is received, not when the vehicle leaves</span>}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs text-text-secondary">
                Kind
                <select value={newCall.kind} onChange={(e) => setNewCall({ ...newCall, kind: e.target.value as CallKind })} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                  {(['Emergency', 'Booked transfer', 'Discharge drop', 'Sample run', 'Mortuary'] as CallKind[]).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label className="text-xs text-text-secondary">
                Priority
                <select value={newCall.priority} onChange={(e) => setNewCall({ ...newCall, priority: e.target.value as CallPriority })} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                  {(['P1 — immediate', 'P2 — within the hour', 'P3 — booked time'] as CallPriority[]).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="text-xs text-text-secondary">
                From
                <input value={newCall.from} onChange={(e) => setNewCall({ ...newCall, from: e.target.value })} placeholder="Mirpur 10, block C" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
              </label>
              <label className="text-xs text-text-secondary">
                To
                <input value={newCall.to} onChange={(e) => setNewCall({ ...newCall, to: e.target.value })} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
              </label>
              <label className="text-xs text-text-secondary">
                Patient (optional)
                <select value={newCall.mrn} onChange={(e) => setNewCall({ ...newCall, mrn: e.target.value })} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                  <option value="">Not a registered patient</option>
                  {patients.slice(0, 12).map((p) => <option key={p.mrn} value={p.mrn}>{p.name} · {p.mrn}</option>)}
                </select>
              </label>
              <label className="text-xs text-text-secondary sm:col-span-2 lg:col-span-1">
                Complaint / reason
                <input value={newCall.complaint} onChange={(e) => setNewCall({ ...newCall, complaint: e.target.value })} placeholder="Chest pain, conscious" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
              </label>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-xs text-text-secondary">
                  <input type="checkbox" checked={newCall.infectious} onChange={(e) => setNewCall({ ...newCall, infectious: e.target.checked })} className="size-4" />
                  Infectious — the vehicle is decontaminated after
                </label>
              </div>
              <div className="flex items-end">
                <Button onClick={raiseCall}>
                  <Siren className="size-4" aria-hidden /> Log the call
                </Button>
              </div>
            </div>
          </Panel>

          <Panel title="The day’s calls" actions={<span className="text-xs text-text-secondary">{fleet.stats.completed} completed · {fleet.stats.running} running · {waiting.length} waiting</span>}>
            <ListView id="amb-calls" caption="Calls today" rows={fleet.calls} columns={callColumns} rowId={(c) => c.id} onRowClick={(c) => { setCallId(c.id); setRefusal(null); }} />
          </Panel>
        </div>
      )}

      {tab === 'fleet' && (
        <Panel title="Vehicles" actions={<span className="text-xs text-text-secondary">A vehicle is in one state at a time</span>}>
          <ListView id="amb-vehicles" caption="Vehicles" rows={fleet.vehicles} columns={vehicleColumns} rowId={(v) => v.id} onRowClick={(v) => setVehicleId(v.id)} />
        </Panel>
      )}

      {tab === 'crew' && (
        <Panel title="Drivers on the roster" actions={<span className="text-xs text-text-secondary">Duty hours are recorded, not remembered: {MAX_DRIVE_HOURS} h is the day’s limit</span>}>
          <ListView id="amb-drivers" caption="Drivers on the roster" rows={fleet.drivers} columns={driverColumns} rowId={(d) => d.id} onRowClick={(d) => setDriverId(d.id)} />
        </Panel>
      )}

      {tab === 'fares' && (
        <div className="space-y-3">
          <Panel title="Fare table" actions={<span className="text-xs text-text-secondary">Every trip lands on the patient’s invoice with the trip id beside it</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <caption className="sr-only">Ambulance fares</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Vehicle</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Base</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Per km</th>
                    <th scope="col" className="py-1.5 font-medium">What that buys</th>
                  </tr>
                </thead>
                <tbody>
                  {FARE_TABLE.map((f) => (
                    <tr key={f.kind} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{f.kind}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{money(f.base)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{money(f.perKm)}</td>
                      <td className="py-1.5 text-text-secondary">{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-text-secondary">
              Fares collected today: <span className="font-medium tabular-nums">{money(fleet.stats.fareToday)}</span>.
              {fleet.stats.unbilled > 0 && ` ${fleet.stats.unbilled} completed trip(s) have no fare recorded — a trip that moves a patient is billable whether the family remembers or not.`}
            </p>
          </Panel>
          <Panel title="How a trip is run">
            <ul className="space-y-2 text-sm">
              <li><span className="font-medium text-text-primary">Four timestamps.</span> <span className="text-text-secondary">Received, dispatched, on scene, handover. The response figure on the dashboard is the difference between two real clock readings.</span></li>
              <li><span className="font-medium text-text-primary">Emergency before booked.</span> <span className="text-text-secondary">A booked transfer dispatched ahead of a waiting emergency is allowed, recorded, and named as a decision.</span></li>
              <li><span className="font-medium text-text-primary">Checked before it moves.</span> <span className="text-text-secondary">Oxygen, stretcher, suction and the sealed drug bag are recorded on the call at dispatch time — not remembered afterwards.</span></li>
              <li><span className="font-medium text-text-primary">{TURNAROUND_MIN} minutes between patients.</span> <span className="text-text-secondary">Cleaning and the check sheet. {DECONTAMINATION_MIN} minutes after an infectious patient, as a separate state, so the vehicle is visibly out of the pool rather than quietly unavailable.</span></li>
              <li><span className="font-medium text-text-primary">One patient, one unit.</span> <span className="text-text-secondary">A crew conveys one patient; a second patient needs a second vehicle, however short the second trip looks.</span></li>
            </ul>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- call sheet */}
      <Sheet
        open={Boolean(call)}
        onClose={() => { setCallId(null); setRefusal(null); }}
        title={call ? `${call.id} — ${call.kind}` : 'Call'}
        description={call ? `${call.priority} · ${call.from} → ${call.to}` : undefined}
        footer={
          call && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => { patchCall(call.id, { state: 'Cancelled' }); setCallId(null); push({ title: `${call.id} cancelled.`, tone: 'info' }); }}>
                Cancel the call
              </Button>
              <Button variant="ghost" onClick={() => push({ title: `${call.id} slip sent to the printer (preview: nothing prints here).`, tone: 'info' })}>
                <Printer className="size-4" aria-hidden /> Print the trip slip
              </Button>
              {call.state === 'Dispatched' && <Button variant="ghost" onClick={() => arriveOnScene(call)}>Record arrival on scene</Button>}
              {(call.state === 'Conveying' || call.state === 'On scene') && (
                <>
                  <Button variant="ghost" onClick={() => complete(call, true, Boolean(call.infectious))}>
                    Handed over{call.infectious ? ' + decontaminate' : ''}
                  </Button>
                </>
              )}
            </div>
          )
        }
      >
        {call && (() => {
          const verdict = responseVerdict(call);
          const assigned = fleet.vehicles.find((v) => v.id === call.vehicleId);
          const crewDriver = driverOf(call.crew.driverId);
          const check = dispatchCheck(call, assigned, crewDriver, day);
          const patient = patients.find((p) => p.mrn === call.patientMrn);
          return (
            <div className="space-y-3">
              <ol className="space-y-1 text-sm">
                {[
                  ['Received', call.receivedAt],
                  ['Dispatched', call.dispatchedAt],
                  ['On scene', call.onSceneAt],
                  ['Handover', call.handoverAt],
                  ['Back at base', call.returnedAt],
                ].map(([label, at], i, all) => (
                  <li key={label} className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-1.5">
                    <span className="font-medium text-text-primary">{label}</span>
                    <span className="tabular-nums text-text-secondary">
                      {at ? `${(at as string).slice(11)}${i > 0 && all[i - 1][1] ? ` · +${minutesBetween(all[i - 1][1] as string, at as string)} min` : ''}` : '—'}
                    </span>
                  </li>
                ))}
              </ol>

              <div className={cx('rounded-md border px-3 py-2 text-sm', verdict.verdict === 'missed' ? 'border-safety-critical/40 bg-safety-critical/5' : 'border-border-subtle bg-surface-sunken')}>
                <p className="font-medium text-text-primary">
                  {verdict.verdict === 'met' ? 'Response target met' : verdict.verdict === 'missed' ? 'Response target missed' : verdict.verdict === 'not measured' ? 'Booked run' : 'Still running'}
                </p>
                <p className="text-text-secondary">{verdict.text}</p>
                {call.note && <p className="mt-1 text-xs text-text-tertiary">{call.note}</p>}
              </div>

              {patient && (
                <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="font-medium text-text-primary">{patient.name} · {patient.mrn}</p>
                  <p className="text-text-secondary">
                    {patient.age} · {patient.sex} · {patient.phone} · allergies: {patient.allergies || 'none recorded'}
                    {call.complaint ? ` · ${call.complaint}` : ''}
                  </p>
                </div>
              )}

              {call.checks ? (
                <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="font-medium text-text-primary">Checks recorded at dispatch ({call.checks.at.slice(11)})</p>
                  <p className="text-text-secondary">
                    Oxygen {call.checks.oxygenPct} % · stretcher {call.checks.stretcher ? 'ok' : 'faulty'} · suction {call.checks.suction ? 'ok' : 'faulty'} · drug bag sealed to {call.checks.bagSealedTo}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-text-secondary">
                    <span className="font-medium text-text-primary">Nothing is assigned yet.</span> The vehicles below are ordered by what can actually go now: a free vehicle, above the oxygen floor, close to the pick-up.
                  </p>
                  <ul className="space-y-1">
                    {suggestions.map(({ vehicle: v, minutes, because }) => {
                      const ok = dispatchCheck(call, v, crewDriver, day);
                      return (
                        <li key={v.id} className={cx('flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm', ok.ok ? 'border-border-subtle' : 'border-safety-critical/30 bg-safety-critical/5')}>
                          <span>
                            <span className="font-medium">{v.plate}</span>
                            <span className="ml-2 text-xs text-text-tertiary">{v.kind} · {because} · about {minutes} min away</span>
                          </span>
                          <span className="flex items-center gap-2">
                            {!ok.ok && <span className={cx('max-w-[24rem] text-xs', TONE_TEXT.critical)}>{ok.blockers[0]}</span>}
                            <Button variant="ghost" onClick={() => dispatch(call, v)}>{ok.ok ? 'Dispatch' : 'Try anyway'}</Button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {assigned && (
                <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="font-medium text-text-primary">{assigned.plate} · {assigned.kind} · crew</p>
                  <p className="text-text-secondary">
                    Driver {crewDriver?.name ?? '—'} ({crewDriver?.hoursToday ?? 0} h driven today of {MAX_DRIVE_HOURS}), attendant {call.crew.attendant}
                    {assigned.note ? ` · ${assigned.note}` : ''}
                  </p>
                  {check.warnings.length > 0 && <p className="mt-1 text-xs text-safety-warning">{check.warnings.join(' ')}</p>}
                </div>
              )}

              {call.fare && (
                <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="font-medium text-text-primary">Fare {money(call.fare.total)}</p>
                  <p className="text-text-secondary">
                    Base {money(call.fare.base)} + {call.fare.km} km × {money(call.fare.perKm)}
                    {call.fare.waiting ? ` + ${call.fare.waiting} min waiting` : ''} — charged to the patient’s invoice on{' '}
                    <Link href="/billing" className="underline">billing</Link>, with the trip id beside the line so a query can be answered.
                  </p>
                </div>
              )}

              {refusal && (
                <div className={cx('rounded-md border px-3 py-2 text-sm', refusal.startsWith('Refused') ? 'border-safety-critical/40 bg-safety-critical/5' : 'border-safety-warning/40 bg-safety-warning/5')} role="status">
                  {refusal}
                </div>
              )}
            </div>
          );
        })()}
      </Sheet>

      {/* ------------------------------------------------------------- vehicle sheet */}
      <Sheet
        open={Boolean(vehicle)}
        onClose={() => setVehicleId(null)}
        title={vehicle ? vehicle.plate : 'Vehicle'}
        description={vehicle ? `${vehicle.kind} · ${vehicle.model} · based at ${vehicle.base}` : undefined}
        footer={
          vehicle && (
            <div className="flex flex-wrap justify-end gap-2">
              {vehicle.state === 'Free' && (
                <Button variant="ghost" onClick={() => { patchVehicle(vehicle.id, { state: 'Under maintenance', note: 'Taken off the road by the fleet engineer' }); push({ title: `${vehicle.plate} is out of service.`, tone: 'info' }); }}>
                  Take out of service
                </Button>
              )}
              {vehicle.state !== 'Free' && vehicle.state !== 'On a call' && (
                <Button onClick={() => { patchVehicle(vehicle.id, { state: 'Free', note: undefined }); push({ title: `${vehicle.plate} is back in the pool.`, tone: 'success' }); }}>
                  Return to service
                </Button>
              )}
              {vehicle.kind !== 'Mortuary van' && (
                <Button variant="ghost" onClick={() => { patchVehicle(vehicle.id, { oxygenPct: 100 }); push({ title: `${vehicle.plate} refilled to 100 %. It may take a transfer again.`, tone: 'success' }); }}>
                  Mark the cylinder refilled
                </Button>
              )}
            </div>
          )
        }
      >
        {vehicle && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-text-secondary">State</dt><dd className={cx('font-medium', vehicle.state === 'Free' ? TONE_TEXT.success : TONE_TEXT.warning)}>{vehicle.state}</dd></div>
              <div><dt className="text-xs text-text-secondary">Odometer</dt><dd className="font-medium tabular-nums">{vehicle.odometer.toLocaleString('en-IN')} km</dd></div>
              <div><dt className="text-xs text-text-secondary">Oxygen</dt><dd className="font-medium tabular-nums">{vehicle.kind === 'Mortuary van' ? 'not fitted' : `${vehicle.oxygenPct} %`}</dd></div>
              <div><dt className="text-xs text-text-secondary">Next service</dt><dd className="font-medium">{vehicle.nextService}</dd></div>
              <div><dt className="text-xs text-text-secondary">Fitness certificate</dt><dd className={cx('font-medium', vehicle.fitnessTo < day ? TONE_TEXT.critical : undefined)}>{vehicle.fitnessTo}</dd></div>
              <div><dt className="text-xs text-text-secondary">Insurance</dt><dd className="font-medium">{vehicle.insuranceTo}</dd></div>
            </dl>
            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="font-medium text-text-primary">Equipment check</p>
              <ul className="mt-1 space-y-1 text-text-secondary">
                <li>· Stretcher: <span className={vehicle.stretcher === 'ok' ? TONE_TEXT.success : TONE_TEXT.critical}>{vehicle.stretcher}</span></li>
                <li>· Suction: <span className={vehicle.suction === 'ok' ? TONE_TEXT.success : TONE_TEXT.critical}>{vehicle.suction}</span></li>
                <li>· Oxygen: <span className={vehicle.oxygenPct >= OXYGEN_FLOOR_PCT || vehicle.kind === 'Mortuary van' ? TONE_TEXT.success : TONE_TEXT.critical}>{vehicle.oxygenPct} % (floor for transfers {OXYGEN_FLOOR_PCT} %)</span></li>
              </ul>
              {vehicle.note && <p className="mt-1 text-xs text-text-tertiary">{vehicle.note}</p>}
            </div>
            <p className="text-xs text-text-tertiary">
              The check sheet is part of the vehicle record, not a clipboard by the door: when a cylinder is low the
              next dispatch is refused rather than discovered in a traffic jam.
            </p>
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------- driver sheet */}
      <Sheet
        open={Boolean(driver)}
        onClose={() => setDriverId(null)}
        title={driver ? driver.name : 'Driver'}
        description={driver ? `${driver.phone} · licence ${driver.licence}` : undefined}
      >
        {driver && (
          <dl className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-text-secondary">Licence valid to</dt><dd className="font-medium">{driver.licenceTo}</dd></div>
              <div><dt className="text-xs text-text-secondary">Driven today</dt><dd className="font-medium tabular-nums">{driver.hoursToday} h of {MAX_DRIVE_HOURS}</dd></div>
              <div><dt className="text-xs text-text-secondary">First aid</dt><dd className="font-medium">{driver.firstAid ? 'current' : 'not recorded'}</dd></div>
              <div><dt className="text-xs text-text-secondary">ACLS</dt><dd className="font-medium">{driver.acls ? 'current' : 'not held'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-text-secondary">Cleared to drive</dt><dd className="font-medium">{driver.kinds.join(', ')}</dd></div>
            </div>
            <div className="rounded-md border border-border-subtle px-3 py-2 text-text-secondary">
              {driver.hoursToday >= MAX_DRIVE_HOURS - 2
                ? `${driver.name} has ${MAX_DRIVE_HOURS - driver.hoursToday} h left today. A run longer than that needs the second driver, and the dispatch screen will refuse it rather than let a tired driver take a highway.`
                : `${MAX_DRIVE_HOURS - driver.hoursToday} h remain today. Duty hours are recorded per driver, so the refusal is arithmetic and not a judgement call at the gate.`}
            </div>
          </dl>
        )}
      </Sheet>

      {tab === 'dispatch' && waiting.length > 0 && (
        <Panel title="Waiting for a vehicle" actions={<span className="text-xs text-text-secondary">Ordered by priority, then by how long the call has been open</span>}>
          <ul className="space-y-2">
            {waiting.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{c.id}</span>
                  <span className="ml-2 text-text-secondary">{c.priority} · {c.from} → {c.to}</span>
                  {c.infectious && <span className="ml-2 rounded-full bg-safety-warning/10 px-2 py-0.5 text-[10px] text-safety-warning">infectious · decontaminate after</span>}
                </span>
                <Button variant="ghost" onClick={() => { setCallId(c.id); setRefusal(null); }}>
                  <Crosshair className="size-4" aria-hidden /> Find a vehicle
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tab === 'dispatch' && fleet.calls.length === 0 && (
        <EmptyState title="No calls today" description="The control desk has taken no calls yet." />
      )}

      <p className="text-xs text-text-tertiary">
        Related screens: <Link href="/ward" className="underline">the ward</Link> raises transfers,{' '}
        <Link href="/diagnostics" className="underline">diagnostics</Link> uses the sample run, and{' '}
        <Link href="/billing" className="underline">billing</Link> carries the fare.
      </p>
    </div>
  );
}
