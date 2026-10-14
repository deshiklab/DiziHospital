'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, Panel, SafetyBanner, Segmented, Tooltip, cx, useToast } from '@dizi/ui';
import { ConsultWorkspace } from '@/components/ConsultWorkspace';
import { generateEncounters, STATUS_FLOW, type Encounter, type EncounterStatus } from '@/lib/clinical';
import { DOCTORS } from '@/lib/appointments';
import { useShell } from '@/lib/shell';

/* OPD consultation (legacy screens 010/011 replaced) — the P2 module.
 *
 * The worklist on the left is the room's queue; the workspace on the right is one patient's consultation. The
 * two are deliberately on one screen: a doctor switching between a list and a record is how the wrong patient
 * gets the right diagnosis.
 *
 * Everything a doctor writes is a *draft* until it is signed, and a signed note is never edited — it takes an
 * addendum. Offline, signing still works; the banner says when it becomes final.
 */

const ROOM_STATUSES: Array<{ value: EncounterStatus | 'all'; label: string }> = [
  { value: 'Waiting', label: 'Waiting' },
  { value: 'In consultation', label: 'In room' },
  { value: 'Signed', label: 'Signed' },
  { value: 'all', label: 'All' },
];

export default function ClinicalPage() {
  const { sync, role } = useShell();
  const { push } = useToast();

  const [encounters, setEncounters] = useState<Encounter[]>(() => generateEncounters(new Date().toISOString().slice(0, 10)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roomFilter, setRoomFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<EncounterStatus | 'all'>('Waiting');

  const visible = useMemo(
    () => encounters.filter((e) => (roomFilter === 'all' || e.room === roomFilter) && (statusFilter === 'all' || e.status === statusFilter)),
    [encounters, roomFilter, statusFilter],
  );

  const selected = encounters.find((e) => e.id === selectedId) ?? null;
  const waiting = encounters.filter((e) => e.status === 'Waiting').length;
  const inRoom = encounters.filter((e) => e.status === 'In consultation').length;
  const signedCount = encounters.filter((e) => e.status === 'Signed').length;

  const update = (id: string, updater: (e: Encounter) => Encounter) =>
    setEncounters((list) => list.map((e) => (e.id === id ? updater(e) : e)));

  const sign = (encounter: Encounter) => {
    const now = new Date();
    const stamp = `${now.toISOString().slice(0, 10)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    update(encounter.id, (e) => ({
      ...e,
      status: 'Signed',
      signedAt: stamp,
      signedBy: role === 'doctor' ? 'Dr. A. Rahman (BMDC 42118)' : `${role} (on behalf of the doctor)`,
      // Signing is what turns drafts into real work: orders go to the worklists, specimens get their numbers.
      orders: e.orders.map((o, i) => ({
        ...o,
        status: o.kind === 'lab' ? 'Collected' : 'Ordered',
        specimenId: o.kind === 'lab' ? o.specimenId ?? `SP-${String(5200 + i)}` : o.specimenId,
      })),
    }));
    push({
      title: `${encounter.token} signed`,
      description:
        sync === 'live'
          ? `${encounter.orders.length} orders sent · prescription at the pharmacy`
          : 'Signature stored on this device; it becomes final when the connection returns',
      tone: sync === 'live' ? 'success' : 'warning',
      action: { label: 'Print prescription', onSelect: () => window.open(`/print/prescription?enc=${encounter.id}`, '_blank', 'noopener') },
    });
    setStatusFilter('Waiting');
    setSelectedId(null);
  };

  const addAddendum = (text: string) => {
    if (!selected) return;
    const now = new Date();
    update(selected.id, (e) => ({
      ...e,
      addenda: [
        ...e.addenda,
        {
          at: `${now.toISOString().slice(0, 10)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
          by: role === 'doctor' ? 'Dr. A. Rahman' : `${role}`,
          text,
        },
      ],
    }));
    push({ title: 'Addendum recorded', description: 'The signed note above it is unchanged', tone: 'info' });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">OPD consultation</h1>
          <p className="text-sm text-text-secondary">
            The room queue on one side, the consultation on the other. {waiting} waiting · {inRoom} in room ·{' '}
            {signedCount} signed today.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-text-secondary">
            Room
            <select
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
              className="h-8 rounded-md border border-border-default bg-surface-default px-2 text-sm"
            >
              <option value="all">All rooms</option>
              {DOCTORS.slice(0, 4).map((d) => (
                <option key={d.id} value={d.room}>
                  {d.room} · {d.department}
                </option>
              ))}
            </select>
          </label>
          <Segmented name="consult-status" label="Queue filter" value={statusFilter} onChange={setStatusFilter} options={ROOM_STATUSES} />
        </div>
      </div>

      <SafetyBanner severity="info" title="P2 module — preview screens, synthetic patients">
        The rules on this screen are the ones the clinical service will enforce: vitals reference ranges, the
        dangerous-abbreviation screen, the allergy check, and “a signed note takes an addendum, not an edit”.
        Until the clinical module is cut over, real notes are still written in the legacy system.
      </SafetyBanner>

      {sync !== 'live' && (
        <SafetyBanner severity="warning" title="Working without the uplink">
          Consultation, prescribing and printing all work. Orders queue here and reach the laboratory worklist when
          the connection returns; a signature taken now is marked as pending until it syncs.
        </SafetyBanner>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <Panel
          title={`Room queue (${visible.length})`}
          actions={
            <Tooltip content="The order here is the order the patients will be seen in; make it explicit rather than leaving it to the corridor.">
              <span className="text-xs text-text-tertiary">By arrival time</span>
            </Tooltip>
          }
        >
          <ul className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
            {visible.length === 0 && (
              <li className="p-2 text-sm text-text-tertiary">
                Nobody {statusFilter === 'all' ? 'in this room' : `in “${statusFilter}”`} right now.
              </li>
            )}
            {visible.map((e) => {
              const tone =
                e.status === 'Signed' ? 'border-border-subtle' : e.status === 'In consultation' ? 'border-brand-300 bg-brand-50' : 'border-border-subtle';
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    aria-current={selectedId === e.id}
                    className={cx(
                      'w-full rounded-md border p-2 text-left hover:bg-surface-sunken',
                      tone,
                      selectedId === e.id && 'ring-2 ring-brand-500',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-numeric text-xs text-text-tertiary">{e.token}</span>
                      <span className="truncate text-sm font-medium">{e.patient.name}</span>
                      <span className="font-numeric ml-auto text-xs text-text-tertiary">{e.arrivedAt.slice(11)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-text-secondary">
                      <span className="truncate">{e.reason}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-1">
                      <span
                        className={cx(
                          'rounded-full px-1.5 text-[10px]',
                          e.status === 'Waiting'
                            ? 'bg-safety-warning/10 text-safety-warning'
                            : e.status === 'In consultation'
                              ? 'bg-brand-100 text-brand-700'
                              : 'bg-surface-sunken text-text-tertiary',
                        )}
                      >
                        {e.status}
                      </span>
                      {e.patient.allergies && (
                        <span className="rounded-full border border-safety-critical px-1.5 text-[10px] text-safety-critical">
                          allergy: {e.patient.allergies}
                        </span>
                      )}
                      {e.orders.length > 0 && <span className="text-[10px] text-text-tertiary">{e.orders.length} order(s)</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap gap-2 border-t border-border-subtle pt-3">
            <Button
              size="sm"
              onClick={() => {
                const next = encounters.find((e) => e.status === 'Waiting');
                if (!next) {
                  push({ title: 'Nobody waiting', tone: 'info' });
                  return;
                }
                setSelectedId(next.id);
                update(next.id, (e) => ({ ...e, status: STATUS_FLOW[e.status].includes('In consultation') ? 'In consultation' : e.status }));
              }}
            >
              Call next patient
            </Button>
            <Link href="/appointments">
              <Button size="sm" variant="ghost">Appointment desk</Button>
            </Link>
          </div>
        </Panel>

        {selected ? (
          <ConsultWorkspace
            encounter={selected}
            onChange={(updater) => update(selected.id, updater)}
            onSign={() => sign(selected)}
            onAddendum={addAddendum}
            signedFinal={sync === 'live'}
          />
        ) : (
          <Panel>
            <EmptyState
              title="No patient open"
              description="Pick somebody from the room queue. The consultation screen keeps the queue visible, so “next patient” never means “leave the screen”."
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    const next = encounters.find((e) => e.status === 'Waiting');
                    if (next) setSelectedId(next.id);
                  }}
                >
                  Open the next patient
                </Button>
              }
            />
          </Panel>
        )}
      </div>
    </div>
  );
}
