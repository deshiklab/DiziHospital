'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  EmptyState,
  KpiTile,
  Panel,
  Segmented,
  Sheet,
  Tabs,
  cx,
  useToast,
  type Column,
  type RowAction,
} from '@dizi/ui';
import { Droplet, Printer, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { patients } from '@/lib/mock';
import { useShell } from '@/lib/shell';
import {
  BLOOD_GROUPS,
  BLOOD_RULES,
  COMPONENT_LABEL,
  DONOR_CRITERIA,
  EXPIRY_WARN_DAYS,
  LOW_STOCK_UNITS,
  SAMPLE_VALID_DAYS,
  SHELF_LIFE_DAYS,
  OUT_OF_FRIDGE_MINUTES,
  acceptableDonors,
  bloodBankDay,
  checkSample,
  compatibility,
  daysBetween,
  shortGroups,
  trace,
  transfusionThreshold,
  type BloodGroup,
  type BloodUnit,
  type Component,
  type CrossMatchRequest,
  type Donor,
  type StockLine,
} from '@/lib/bloodbank';

/* Blood bank (legacy screens 016 / 031 / 042 — `admin/bloodbankstatus` — replaced) — the P4 sub-screen.
 *
 * The board answers "can we give this patient blood, tonight, without a phone call". Everything behind it is a
 * rule from `lib/bloodbank.ts` said out loud:
 *  - compatibility is computed from antigens and antibodies, and an incompatible unit says *why* it is wrong;
 *  - a stale sample stops an issue before somebody carries the bag across the hospital;
 *  - the numbers (haemoglobin, platelets, INR) are shown next to the indication, so a transfusion above the
 *    threshold is a decision with a name on it rather than a reflex;
 *  - a unit that came back from theatre is quarantined, never restocked.
 *
 * Preview: the register is synthetic and nothing survives a reload. The rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const STATE_CHIP: Record<BloodUnit['state'], string> = {
  available: 'bg-safety-success/10 text-safety-success',
  reserved: 'bg-brand-50 text-brand-700',
  issued: 'bg-safety-warning/10 text-safety-warning',
  quarantined: 'bg-safety-critical/10 text-safety-critical',
  discarded: 'bg-surface-sunken text-text-tertiary',
  transfused: 'bg-brand-50 text-brand-700',
};

const GROUP_BG: Record<string, string> = {
  'O−': 'bg-safety-critical/10 text-safety-critical',
  'O+': 'bg-safety-warning/10 text-safety-warning',
  'A−': 'bg-brand-50 text-brand-700',
  'A+': 'bg-brand-50 text-brand-700',
  'B−': 'bg-brand-50 text-brand-700',
  'B+': 'bg-brand-50 text-brand-700',
  'AB−': 'bg-surface-sunken text-text-secondary',
  'AB+': 'bg-surface-sunken text-text-secondary',
};

export default function BloodBankPage() {
  const { sync, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [register, setRegister] = useState(() => bloodBankDay(day));
  const [tab, setTab] = useState('board');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [donorId, setDonorId] = useState<string | null>(null);
  const [traceKey, setTraceKey] = useState('SH-102311');
  const [shortComponent, setShortComponent] = useState<Component>('PRBC');
  const [attempt, setAttempt] = useState<{ unitId: string; text: string; ok: boolean } | null>(null);
  const [mismatch, setMismatch] = useState(false);

  const open = register.requests.filter((r) => r.state === 'Requested' || r.state === 'Cross-matched');
  const request = register.requests.find((r) => r.id === requestId) ?? null;
  const donor = register.donors.find((d) => d.id === donorId) ?? null;
  const traced = useMemo(() => trace(register, { mrn: traceKey }), [register, traceKey]);
  const shortage = useMemo(() => shortGroups(register, shortComponent), [register, shortComponent]);

  /* ---------------------------------------------------------------- request actions */

  const patchUnit = (id: string, patch: Partial<BloodUnit>) =>
    setRegister((r) => ({ ...r, units: r.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));

  const patchRequest = (id: string, patch: Partial<CrossMatchRequest>) =>
    setRegister((r) => ({ ...r, requests: r.requests.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));

  const candidatesFor = (req: CrossMatchRequest) =>
    register.units
      .filter((u) => u.component === req.component && (u.state === 'available' || u.state === 'reserved'))
      .map((u) => ({ unit: u, verdict: compatibility(req.component, u.group, req.group) }))
      .sort((a, b) => Number(b.verdict.preferred) - Number(a.verdict.preferred) || b.unit.expiresOn.localeCompare(a.unit.expiresOn));

  /** Reserve: only a compatible unit, and only if the sample is still valid. */
  const reserve = (req: CrossMatchRequest, unit: BloodUnit) => {
    const sample = checkSample(req, day);
    const verdict = compatibility(req.component, unit.group, req.group);
    if (!verdict.compatible) {
      setAttempt({
        unitId: unit.id,
        ok: false,
        text: `Refused: ${unit.bag} is ${unit.group}. ${verdict.because}`,
      });
      push({ title: `Refused — ${unit.bag} (${unit.group}) is not compatible with ${req.group}.`, tone: 'critical' });
      return;
    }
    if (!sample.ok && req.urgency !== 'Emergency (uncrossmatched)') {
      setAttempt({ unitId: unit.id, ok: false, text: `Refused: ${sample.problem}` });
      push({ title: 'Refused — the sample has to be fresh before a unit is reserved.', tone: 'critical' });
      return;
    }
    patchUnit(unit.id, { state: 'reserved', forPatient: req.patientMrn, requestId: req.id, note: `Cross-matched for ${req.patientName} · compatible (${unit.group})` });
    patchRequest(req.id, { state: 'Cross-matched', units_issued: [...new Set([...req.units_issued, unit.id])] });
    setAttempt({ unitId: unit.id, ok: true, text: `Reserved ${unit.bag} (${unit.group}) for ${req.patientName}. ${unit.state === 'available' ? 'The label prints with the patient’s name, MRN and the cross-match result.' : ''}` });
    push({ title: `${unit.bag} reserved for ${req.patientName}.`, tone: 'success' });
  };

  const issue = (req: CrossMatchRequest) => {
    const unit = register.units.find((u) => u.requestId === req.id && u.state === 'reserved');
    if (!unit) {
      push({ title: 'Nothing is reserved for this request yet.', tone: 'critical' });
      return;
    }
    patchUnit(unit.id, { state: 'issued', issuedAt: `${day}T${String(12 + Math.floor(Math.random() * 4)).padStart(2, '0')}:05`, note: 'Issued to the ward; two-person check recorded at the bedside' });
    patchRequest(req.id, { state: 'Issued', units_issued: [...new Set([...req.units_issued, unit.id])] });
    push({ title: `${unit.bag} issued. The clock is running: start within ${OUT_OF_FRIDGE_MINUTES} minutes.`, tone: 'success' });
  };

  const transfuse = (req: CrossMatchRequest) => {
    const unit = register.units.find((u) => u.requestId === req.id && u.state === 'issued');
    if (!unit) {
      push({ title: 'No unit is out with this patient.', tone: 'critical' });
      return;
    }
    patchUnit(unit.id, { state: 'transfused', note: 'Transfused with 15-minute observations; no reaction, vitals recorded at the end' });
    patchRequest(req.id, { state: 'Transfused' });
    setRegister((r) => ({ ...r, transfused: [...r.transfused, { ...unit, state: 'transfused' as const }] }));
    push({ title: `${unit.bag} recorded as transfused. The 15-minute observation is what makes that record worth having.`, tone: 'success' });
  };

  const cancel = (req: CrossMatchRequest) => {
    register.units.filter((u) => u.requestId === req.id && u.state === 'reserved').forEach((u) => patchUnit(u.id, { state: 'available', forPatient: undefined, requestId: undefined, note: 'Reservation released when the request was cancelled' }));
    patchRequest(req.id, { state: 'Cancelled' });
    setRequestId(null);
    push({ title: `${req.id} cancelled; reserved units returned to the shelf.`, tone: 'info' });
  };

  /* ---------------------------------------------------------------- columns */

  const stockColumns: Array<Column<StockLine>> = [
    { key: 'group', header: 'Group', width: '84px', render: (s) => (
      <span className={cx('inline-flex min-w-11 justify-center rounded-md px-2 py-0.5 text-xs font-semibold', GROUP_BG[s.group])}>{s.group}</span>
    ) },
    { key: 'component', header: 'Component', render: (s) => COMPONENT_LABEL[s.component] },
    { key: 'units', header: 'On shelf', numeric: true, align: 'right', width: '90px' },
    { key: 'nextExpiry', header: 'Used first', width: '130px', render: (s) => (
      <span className={cx(daysBetween(day, s.nextExpiry ?? day) <= EXPIRY_WARN_DAYS ? TONE_TEXT.warning : TONE_TEXT.neutral)}>
        {s.nextExpiry} · {daysBetween(day, s.nextExpiry ?? day)} d
      </span>
    ) },
    { key: 'expiring', header: `≤ ${EXPIRY_WARN_DAYS} days`, numeric: true, align: 'right', width: '90px', render: (s) => (
      <span className={cx(s.expiring > 0 ? TONE_TEXT.warning : TONE_TEXT.neutral)}>{s.expiring || '—'}</span>
    ) },
    { key: 'low', header: 'Stock', width: '130px', render: (s) => (
      s.low
        ? <span className={cx('font-medium', TONE_TEXT.critical)}>Short of {LOW_STOCK_UNITS[s.component]} — call replacement donors</span>
        : <span className={TONE_TEXT.success}>Above the floor</span>
    ) },
  ];

  const requestColumns: Array<Column<CrossMatchRequest>> = [
    { key: 'id', header: 'Request', width: '96px' },
    { key: 'at', header: 'Raised', hideBelow: 'md', width: '150px', render: (q) => q.at.slice(11) },
    { key: 'patientName', header: 'Patient', render: (q) => (
      <span>
        {q.patientName}
        <span className="ml-2 text-xs text-text-tertiary">{q.patientMrn}</span>
      </span>
    ) },
    { key: 'group', header: 'Group', width: '76px', render: (q) => (
      <span className={cx('inline-flex min-w-11 justify-center rounded-md px-2 py-0.5 text-xs font-semibold', GROUP_BG[q.group])}>{q.group}</span>
    ) },
    { key: 'component', header: 'Needed', width: '150px', render: (q) => `${q.units} × ${COMPONENT_LABEL[q.component]}` },
    { key: 'urgency', header: 'Urgency', hideBelow: 'lg', width: '170px', render: (q) => (
      <span className={cx(q.urgency.startsWith('Emergency') ? TONE_TEXT.critical : q.urgency === 'Urgent' ? TONE_TEXT.warning : TONE_TEXT.neutral)}>{q.urgency}</span>
    ) },
    { key: 'sampleTakenOn', header: 'Sample', hideBelow: 'xl', width: '110px', render: (q) => {
      const age = daysBetween(q.sampleTakenOn, day);
      return <span className={cx(age > SAMPLE_VALID_DAYS ? TONE_TEXT.critical : TONE_TEXT.neutral)}>{age === 0 ? 'today' : `${age} d old`}</span>;
    } },
    { key: 'state', header: 'State', width: '130px', render: (q) => (
      <span className={cx('rounded-full px-2 py-0.5 text-xs', q.state === 'Transfused' ? 'bg-brand-50 text-brand-700' : q.state === 'Cancelled' ? 'bg-surface-sunken text-text-tertiary' : q.state === 'Issued' ? 'bg-safety-warning/10 text-safety-warning' : 'bg-surface-sunken text-text-secondary')}>{q.state}</span>
    ) },
  ];

  const donorColumns: Array<Column<Donor>> = [
    { key: 'id', header: 'Donor', width: '150px', render: (d) => d.id.slice(-6) },
    { key: 'kind', header: 'Type', width: '120px' },
    { key: 'age', header: 'Age', numeric: true, align: 'right', width: '70px' },
    { key: 'sex', header: 'Sex', width: '60px' },
    { key: 'group', header: 'Group', width: '76px', render: (d) => (
      <span className={cx('inline-flex min-w-11 justify-center rounded-md px-2 py-0.5 text-xs font-semibold', GROUP_BG[d.group])}>{d.group}</span>
    ) },
    { key: 'donations', header: 'Donations', numeric: true, align: 'right', width: '100px' },
    { key: 'lastDonation', header: 'Last', hideBelow: 'md', width: '110px', render: (d) => d.lastDonation ?? '—' },
    { key: 'phone', header: 'Phone', hideBelow: 'lg', width: '140px' },
    { key: 'deferred', header: 'Outcome', width: '260px', render: (d) => (
      d.deferred
        ? <span className={cx('font-medium', TONE_TEXT.warning)}>Deferred — {d.deferred.because}</span>
        : <span className={TONE_TEXT.success}>Accepted{d.deferred ? '' : ''}</span>
    ) },
  ];

  const unitColumns: Array<Column<BloodUnit>> = [
    { key: 'bag', header: 'Bag', width: '150px' },
    { key: 'component', header: 'Component', width: '170px', render: (u) => COMPONENT_LABEL[u.component] },
    { key: 'group', header: 'Group', width: '76px', render: (u) => (
      <span className={cx('inline-flex min-w-11 justify-center rounded-md px-2 py-0.5 text-xs font-semibold', GROUP_BG[u.group])}>{u.group}</span>
    ) },
    { key: 'collectedOn', header: 'Collected', hideBelow: 'md', width: '110px' },
    { key: 'expiresOn', header: 'Expires', width: '140px', render: (u) => (
      <span className={cx(daysBetween(day, u.expiresOn) <= EXPIRY_WARN_DAYS ? TONE_TEXT.warning : TONE_TEXT.neutral)}>
        {u.expiresOn} · {daysBetween(day, u.expiresOn)} d
      </span>
    ) },
    { key: 'temperature', header: 'Storage', hideBelow: 'lg', width: '140px' },
    { key: 'state', header: 'State', width: '120px', render: (u) => (
      <span className={cx('rounded-full px-2 py-0.5 text-xs', STATE_CHIP[u.state])}>{u.state}</span>
    ) },
    { key: 'forPatient', header: 'For', width: '110px', render: (u) => u.forPatient ?? '—' },
  ];

  const requestRowActions = (q: CrossMatchRequest): RowAction<CrossMatchRequest>[] => [
    { label: 'Open the request', onSelect: () => setRequestId(q.id) },
  ];

  /* ---------------------------------------------------------------- the sheet body */

  const matrix = (component: Component) => (
    <div tabIndex={0} role="region" aria-label="Blood bank register; scroll horizontally to read all columns" className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
      <table className="w-full min-w-[620px] border-collapse text-xs">
        <caption className="sr-only">Compatibility matrix for {COMPONENT_LABEL[component]}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-surface-default p-2 text-left font-medium text-text-secondary">Donor ↓ / patient →</th>
            {BLOOD_GROUPS.map((g) => (
              <th key={g} scope="col" className="p-2 text-center font-medium text-text-secondary">{g}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BLOOD_GROUPS.map((donorGroup) => (
            <tr key={donorGroup} className="border-t border-border-subtle">
              <th scope="row" className={cx('sticky left-0 bg-surface-default p-2 text-left font-semibold', GROUP_BG[donorGroup], 'rounded-md')}>{donorGroup}</th>
              {BLOOD_GROUPS.map((recipient) => {
                const v = compatibility(component, donorGroup, recipient);
                return (
                  <td key={recipient} className="p-1 text-center">
                    <span
                      className={cx(
                        'inline-flex size-6 items-center justify-center rounded-md text-xs font-semibold',
                        v.compatible ? 'bg-safety-success/10 text-safety-success' : 'bg-surface-sunken text-text-tertiary',
                      )}
                      title={v.because}
                    >
                      {v.compatible ? (v.preferred ? '●' : '○') : '·'}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Droplet className="size-5 text-brand-600" aria-hidden />
            Blood bank
          </h1>
          <p className="text-sm text-text-secondary">
            Stock, donors, cross-match requests and the rules that decide what may be issued — for {day}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cx('rounded-full px-3 py-1 text-xs', syncEngine.summary.pending > 0 ? 'bg-safety-warning/10 text-safety-warning' : 'bg-safety-success/10 text-safety-success')}>
            {syncEngine.summary.pending > 0 ? `Queued (${syncEngine.summary.pending})` : 'Everything synced'}
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              setRegister(bloodBankDay(day));
              setRequestId(null);
              setAttempt(null);
              push({ title: 'The register was rebuilt from the day’s seed: nothing you did here was written anywhere.', tone: 'info' });
            }}
          >
            <RefreshCw className="size-4" aria-hidden /> Rebuild the day
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Units on the shelf" value={String(register.stats.unitsOnShelf)} definition="Units available or reserved, excluding units already issued, transfused, quarantined or discarded." asOf={day} />
        <KpiTile label="Available now" value={String(register.stats.available)} definition="Units in the fridge that are not held for anybody." asOf={day} />
        <KpiTile label="Held for a patient" value={String(register.stats.reserved)} definition="Cross-matched and reserved, with the patient’s name on the label." asOf={day} />
        <KpiTile label={`Expiring in ${EXPIRY_WARN_DAYS} days`} value={String(register.stats.expiring)} definition={`Units whose expiry falls within ${EXPIRY_WARN_DAYS} days — they are offered first and reported if they are wasted.`} asOf={day} />
        <KpiTile label="Requests open" value={String(register.stats.requestsOpen)} definition="Requests that are neither issued nor cancelled." asOf={day} />
        <KpiTile label="Out with a patient" value={String(register.stats.issued)} definition={`Issued but not yet recorded as transfused — a unit out of the fridge must start within ${OUT_OF_FRIDGE_MINUTES} minutes.`} asOf={day} />
      </div>

      {register.stats.groupsBelow > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2 text-sm text-text-primary">
          <TriangleAlert className="size-4 text-safety-warning" aria-hidden />
          <span>
            {register.stats.groupsBelow} group/component line{register.stats.groupsBelow === 1 ? ' is' : 's are'} below the floor for tonight.
            The call list is on the board tab — replacement donors are chased before a case starts, not during it.
          </span>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'board', label: 'Stock board' },
          { id: 'requests', label: 'Cross-match', count: open.length },
          { id: 'donors', label: 'Donors', count: register.donors.length },
          { id: 'units', label: 'Units and trace' },
          { id: 'rules', label: 'Compatibility and rules' },
        ]}
      />

      {tab === 'board' && (
        <div className="space-y-3">
          <Panel
            title="Every line the board carries"
            actions={<span className="text-xs text-text-secondary">A line is short when available units fall under the floor: {Object.entries(LOW_STOCK_UNITS).map(([c, n]) => `${COMPONENT_LABEL[c as Component]} ${n}`).join(' · ')}</span>}
          >
            {register.stock.length === 0
              ? <EmptyState title="Nothing on the shelf" description="The register is empty for this day." />
              : <ListView id="bb-stock" caption="Blood stock lines by group and component" rows={register.stock} columns={stockColumns} rowId={(s) => `${s.group}-${s.component}`} />}
          </Panel>

          <Panel
            title="Replacement donor call list"
            actions={
              <Segmented
                name="bb-component"
                label="Component"
                value={shortComponent}
                onChange={(v) => setShortComponent(v as Component)}
                options={(['PRBC', 'FFP', 'PLT', 'WB', 'CRYO'] as Component[]).map((c) => ({ value: c, label: COMPONENT_LABEL[c].split(' ')[0] }))}
              />
            }
          >
            {shortage.length === 0 ? (
              <p className="text-sm text-safety-success">
                Every group has enough {COMPONENT_LABEL[shortComponent]} for tonight. Nothing to chase.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {shortage.join(', ')} — the register of previous donors is searched by group and last donation date, and
                  the ones who can donate are called. A replacement request is a conversation with a family, so the list
                  says who is eligible before anybody is asked.
                </p>
                <div tabIndex={0} role="region" aria-label="Donation history; scroll horizontally to read all columns" className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
                  <table className="w-full min-w-[520px] text-sm">
                    <caption className="sr-only">Donors who can be called for this component</caption>
                    <thead>
                      <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                        <th scope="col" className="py-1.5 pr-3 font-medium">Group</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium">Donors eligible</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium">Last donated</th>
                        <th scope="col" className="py-1.5 font-medium">Numbers available this month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shortage.map((group) => ({ group, eligible: register.donors.filter((d) => d.group === group && !d.deferred).length, last: register.donors.filter((d) => d.group === group && d.lastDonation).map((d) => d.lastDonation!).sort().at(-1) ?? '—' })).map((row) => (
                        <tr key={row.group} className="border-b border-border-subtle last:border-0">
                          <td className="py-1.5 pr-3">
                            <span className={cx('inline-flex min-w-11 justify-center rounded-md px-2 py-0.5 text-xs font-semibold', GROUP_BG[row.group])}>{row.group}</span>
                          </td>
                          <td className="py-1.5 pr-3">{row.eligible} on today’s register</td>
                          <td className="py-1.5 pr-3">{row.last}</td>
                          <td className="py-1.5">{acceptableDonors(shortComponent, row.group).length} groups can give {COMPONENT_LABEL[shortComponent]} to this patient group</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-text-tertiary">
                  Replacement donation is the reality in this market: the person who is asked is usually the patient’s
                  relative, and the record keeps that relationship. The screen says it plainly rather than pretending
                  the shelf fills itself.
                </p>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'requests' && (
        <Panel title="Cross-match and issue queue" actions={<span className="text-xs text-text-secondary">Open a request to cross-match, issue and observe</span>}>
          <ListView
            id="bb-requests"
            caption="Cross-match and issue queue"
            rows={register.requests}
            columns={requestColumns}
            rowId={(q) => q.id}
            rowActions={requestRowActions}
            onRowClick={(q) => setRequestId(q.id)} />
        </Panel>
      )}

      {tab === 'donors' && (
        <div className="space-y-3">
          <Panel
            title={`Donor register — ${register.stats.donationsToday} of ${register.stats.donorsToday} accepted today`}
            actions={<span className="text-xs text-text-secondary">Deferrals are recorded too: a safe deferral is not a wasted visit</span>}
          >
            <ListView id="bb-donors" caption="Donor register for the day" rows={register.donors} columns={donorColumns} rowId={(d) => d.id} onRowClick={(d) => setDonorId(d.id)} />
          </Panel>
          <Panel title="What the donor chair screens">
            <div tabIndex={0} role="region" aria-label="Donor screening rules; scroll horizontally to read all columns" className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Donor deferral criteria</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Rule</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Value</th>
                    <th scope="col" className="py-1.5 font-medium">Because</th>
                  </tr>
                </thead>
                <tbody>
                  {DONOR_CRITERIA.map((c) => (
                    <tr key={c.rule} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{c.rule}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{c.value}</td>
                      <td className="py-1.5 text-text-secondary">{c.because}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'units' && (
        <div className="space-y-3">
          <Panel
            title="Trace a unit"
            actions={
              <div className="flex items-center gap-2">
                <input
                  value={traceKey}
                  onChange={(e) => setTraceKey(e.target.value)}
                  className="h-9 w-44 rounded-md border border-border-default bg-surface-default px-2 text-sm"
                  placeholder="MRN or bag number"
                  aria-label="MRN or bag number"
                />
                <Button variant="ghost" onClick={() => push({ title: `Traced ${traced.units.length} unit(s) for ${traceKey}.`, tone: 'info' })}>
                  <Search className="size-4" aria-hidden /> Trace
                </Button>
              </div>
            }
          >
            {traced.units.length === 0 ? (
              <EmptyState title="Nothing recorded for this key" description="Try an MRN on today’s board (SH-102311, SH-101177, SH-103455) or a bag number." />
            ) : (
              <div className="space-y-2">
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-text-secondary">Units</dt>
                    <dd className="font-medium">{traced.units.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-secondary">Patients reached</dt>
                    <dd className="font-medium">{traced.patients.join(', ') || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-secondary">Donors behind them</dt>
                    <dd className="font-medium">{traced.donors.join(', ')}</dd>
                  </div>
                </dl>
                <ul className="space-y-1 text-sm text-text-secondary">
                  {traced.notes.map((n) => <li key={n}>· {n}</li>)}
                </ul>
              </div>
            )}
          </Panel>

          <Panel title="The day’s units" actions={<span className="text-xs text-text-secondary">Cash value is not the point; traceability is</span>}>
            <ListView id="bb-units" caption="Units in the register today" rows={[...register.units, ...register.discarded]} columns={unitColumns} rowId={(u) => u.id} onRowClick={(u) => setAttempt({ unitId: u.id, ok: true, text: `${u.bag} — ${COMPONENT_LABEL[u.component]}, ${u.group}, collected ${u.collectedOn}, expires ${u.expiresOn}. ${u.note ?? ''} ${u.discardedBecause ?? ''}`.trim() })} />
          </Panel>
        </div>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel
            title="Compatibility — red cells above, plasma below"
            actions={<span className="text-xs text-text-secondary">● same group · ○ compatible, not preferred · · would react</span>}
          >
            <div className="space-y-4">
              {matrix('PRBC')}
              <div className="border-t border-border-subtle pt-3">
                {matrix('FFP')}
                <p className="mt-2 text-sm text-text-secondary">
                  Plasma runs the other way: the donor’s antibodies attack the patient’s cells, so AB plasma is the
                  universal plasma and O plasma is the one to avoid. The engine computes both from antigens and
                  antibodies rather than from a remembered table.
                </p>
              </div>
            </div>
          </Panel>
          <Panel title="What the screen will not let happen">
            <ul className="space-y-2 text-sm">
              {BLOOD_RULES.map((r) => (
                <li key={r.title}>
                  <span className="font-medium text-text-primary">{r.title}.</span>{' '}
                  <span className="text-text-secondary">{r.because}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Shelf life as it is stored here">
            <div tabIndex={0} role="region" aria-label="Shelf-life by component; scroll horizontally to read all columns" className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
              <table className="w-full min-w-[480px] text-sm">
                <caption className="sr-only">Shelf life by component</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Component</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Shelf life</th>
                    <th scope="col" className="py-1.5 font-medium">The rule that bites</th>
                  </tr>
                </thead>
                <tbody>
                  {(['PRBC', 'WB', 'PLT', 'FFP', 'CRYO'] as Component[]).map((c) => (
                    <tr key={c} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{COMPONENT_LABEL[c]}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{SHELF_LIFE_DAYS[c]} day(s)</td>
                      <td className="py-1.5 text-text-secondary">
                        {c === 'PLT'
                          ? 'Five days, agitated at 20–24 °C: platelets are the component that is wasted by collecting too many.'
                          : c === 'FFP' || c === 'CRYO'
                            ? 'A year frozen, 24 hours once thawed — and it cannot be refrozen.'
                            : `Starts when it is collected, not when it is issued. ${c === 'WB' ? 'Whole blood is what a centre without component separation uses.' : ''}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- request sheet */}
      <Sheet
        open={Boolean(request)}
        onClose={() => { setRequestId(null); setAttempt(null); setMismatch(false); }}
        title={request ? `${request.id} — ${request.patientName}` : 'Request'}
        description={request ? `${request.units} × ${COMPONENT_LABEL[request.component]} · ${request.group} · ${request.ward}` : undefined}
        footer={
          request && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => cancel(request)}>Cancel the request</Button>
              <Button
                variant="ghost"
                onClick={() => push({ title: `${request.id} requisition sent to the print queue (preview: nothing prints here).`, tone: 'info' })}
              >
                <Printer className="size-4" aria-hidden /> Print the requisition
              </Button>
              <Button variant="ghost" onClick={() => issue(request)} disabled={!register.units.some((u) => u.requestId === request.id && u.state === 'reserved')}>
                Issue the unit
              </Button>
              <Button onClick={() => transfuse(request)} disabled={!register.units.some((u) => u.requestId === request.id && u.state === 'issued')}>
                Record the transfusion
              </Button>
            </div>
          )
        }
      >
        {request && (() => {
          const sample = checkSample(request, day);
          const threshold = transfusionThreshold(request);
          const candidates = candidatesFor(request);
          const held = register.units.filter((u) => u.requestId === request.id && (u.state === 'reserved' || u.state === 'issued'));
          const patient = patients.find((p) => p.mrn === request.patientMrn);
          return (
            <div className="space-y-3">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-text-secondary">Raised</dt>
                  <dd className="font-medium">{request.at.replace('T', ' · ')} by {request.requestedBy}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-secondary">Urgency</dt>
                  <dd className={cx('font-medium', request.urgency.startsWith('Emergency') ? TONE_TEXT.critical : TONE_TEXT.warning)}>{request.urgency}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-text-secondary">Indication, in the requester’s words</dt>
                  <dd className="text-text-primary">{request.indication}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-secondary">Haemoglobin / platelets / INR</dt>
                  <dd className="font-medium tabular-nums">
                    {request.hb !== undefined ? `${request.hb} g/dL` : '—'} · {request.platelets !== undefined ? `${request.platelets} ×10⁹/L` : '—'} · {request.inr !== undefined ? request.inr : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-text-secondary">Known allergies</dt>
                  <dd className="font-medium">{patient?.allergies ?? 'None recorded'}</dd>
                </div>
              </dl>

              <div className={cx('rounded-md border px-3 py-2 text-sm', threshold.meets ? 'border-border-subtle bg-surface-sunken' : 'border-safety-warning/40 bg-safety-warning/5')}>
                <p className="font-medium text-text-primary">{threshold.meets ? 'The numbers support this request' : 'Above the usual threshold — a decision, not a routine'}</p>
                <p className="text-text-secondary">{threshold.note}</p>
                {!threshold.meets && (
                  <p className="mt-1 text-xs text-text-tertiary">
                    The request is still accepted and the reason is recorded with it. A restrictive threshold is advice to the
                    prescriber, not a lock on the fridge: the patient in front of the doctor decides.
                  </p>
                )}
              </div>

              <div className={cx('rounded-md border px-3 py-2 text-sm', sample.ok ? 'border-safety-success/40 bg-safety-success/5' : 'border-safety-critical/40 bg-safety-critical/5')}>
                <p className="font-medium text-text-primary">{sample.ok ? 'Sample is valid for cross-match' : 'Cross-match cannot proceed'}</p>
                <p className="text-text-secondary">
                  {sample.ok
                    ? `Sample taken ${request.sampleTakenOn}, antibody screen ${request.antibodyScreen}. A sample is good for ${SAMPLE_VALID_DAYS} days.`
                    : sample.problem}
                </p>
              </div>

              <div>
                <h3 className="mb-1 text-sm font-semibold text-text-primary">Units in the bank for {request.group}</h3>
                {candidates.length === 0 ? (
                  <EmptyState title={`No ${COMPONENT_LABEL[request.component]} on the shelf`} description={`Nothing of this component is available at all, so ${request.group} is not the constraint — the component is. The call list on the board tab is the answer.`} />
                ) : (
                  <ul className="space-y-1">
                    {candidates.slice(0, 8).map(({ unit, verdict }) => (
                      <li key={unit.id} className={cx('flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm', verdict.compatible ? 'border-border-subtle' : 'border-safety-critical/30 bg-safety-critical/5')}>
                        <span className="flex items-center gap-2">
                          <span className={cx('inline-flex min-w-11 justify-center rounded-md px-2 py-0.5 text-xs font-semibold', GROUP_BG[unit.group])}>{unit.group}</span>
                          <span className="font-medium">{unit.bag}</span>
                          <span className="text-xs text-text-tertiary">expires {unit.expiresOn} · {unit.temperature}</span>
                          {verdict.preferred && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] text-brand-700">same group</span>}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={cx('max-w-[26rem] text-xs', verdict.compatible ? TONE_TEXT.neutral : TONE_TEXT.critical)}>{verdict.because}</span>
                          {unit.state === 'available' && (
                            <Button variant="ghost" onClick={() => reserve(request, unit)}>
                              {verdict.compatible ? 'Reserve' : 'Try anyway'}
                            </Button>
                          )}
                          {unit.state === 'reserved' && <span className="text-xs text-brand-700">Held for this patient</span>}
                          {unit.state === 'issued' && <span className="text-xs text-safety-warning">Out with the patient</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {held.length > 0 && (
                <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="font-medium text-text-primary">{held.length} unit(s) attached to this request</p>
                  <p className="text-text-secondary">
                    Reserved: {held.filter((u) => u.state === 'reserved').map((u) => u.bag).join(', ') || '—'}. Issued:{' '}
                    {held.filter((u) => u.state === 'issued').map((u) => `${u.bag} at ${u.issuedAt?.slice(11)}`).join(', ') || '—'}.
                  </p>
                </div>
              )}

              {attempt && (
                <div className={cx('rounded-md border px-3 py-2 text-sm', attempt.ok ? 'border-safety-success/40 bg-safety-success/5' : 'border-safety-critical/40 bg-safety-critical/5')} role="status">
                  {attempt.text}
                </div>
              )}

              <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                <p className="font-medium text-text-primary">Issuing a unit that is not the same group</p>
                <p className="text-text-secondary">
                  Compatible is not the same as interchangeable. {acceptableDonors(request.component, request.group).join(' → ')} are acceptable in that
                  order for {request.group} {COMPONENT_LABEL[request.component]}; the first is the same group and is what the counter picks when it is on
                  the shelf. Reserving a different group is allowed when it is compatible, and refused when it is not.
                </p>
                <label className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
                  <input type="checkbox" checked={mismatch} onChange={(e) => setMismatch(e.target.checked)} className="size-4" />
                  Show what the bedside two-person check looks for (group on the bag, group on the wristband, bag number, expiry)
                </label>
                {mismatch && (
                  <ul className="mt-1.5 space-y-1 text-xs text-text-secondary">
                    <li>· The bag number on the label and on the compatibility report are read aloud together.</li>
                    <li>· The group on the bag and the group on the patient’s wristband are read aloud together.</li>
                    <li>· The expiry and the appearance of the unit are checked — a discoloured unit is not transfused because the label is right.</li>
                    <li>· Only one patient is connected to one unit; a unit never splits.</li>
                  </ul>
                )}
              </div>
            </div>
          );
        })()}
      </Sheet>

      {/* ------------------------------------------------------------- donor sheet */}
      <Sheet open={Boolean(donor)} onClose={() => setDonorId(null)} title={donor ? `Donor ${donor.id.slice(-6)}` : 'Donor'}>
        {donor && (
          <dl className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-text-secondary">Type · age · sex</dt><dd className="font-medium">{donor.kind} · {donor.age} · {donor.sex === 'M' ? 'Male' : 'Female'}</dd></div>
              <div><dt className="text-xs text-text-secondary">Group</dt><dd className="font-medium">{donor.group}</dd></div>
              <div><dt className="text-xs text-text-secondary">Donations recorded</dt><dd className="font-medium tabular-nums">{donor.donations}</dd></div>
              <div><dt className="text-xs text-text-secondary">Last donation</dt><dd className="font-medium">{donor.lastDonation ?? 'First recorded visit'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-text-secondary">Phone</dt><dd className="font-medium">{donor.phone}</dd></div>
            </div>
            <div className={cx('rounded-md border px-3 py-2', donor.deferred ? 'border-safety-warning/40 bg-safety-warning/5' : 'border-safety-success/40 bg-safety-success/5')}>
              <p className="font-medium text-text-primary">{donor.deferred ? 'Deferred' : 'Accepted today'}</p>
              <p className="text-text-secondary">
                {donor.deferred
                  ? `${donor.deferred.because}. Eligible again ${donor.deferred.until ?? 'when reviewed'}.`
                  : 'Screened and accepted; the bags below are traceable to this donor.'}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">Units from this donor today</p>
              <ul className="mt-1 space-y-1">
                {register.units.filter((u) => u.donorId === donor.id).map((u) => (
                  <li key={u.id} className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-1.5">
                    <span>{u.bag} · {COMPONENT_LABEL[u.component]} · {u.group}</span>
                    <span className={cx('rounded-full px-2 py-0.5 text-xs', STATE_CHIP[u.state])}>{u.state}</span>
                  </li>
                ))}
                {register.units.every((u) => u.donorId !== donor.id) && <li className="text-text-tertiary">No units — the donor was deferred before collection.</li>}
              </ul>
            </div>
            <p className="text-xs text-text-tertiary">
              Donor identity is deliberately minimal here: a name, a phone, a group and the history. Look-back needs the
              unit, not the biography.
            </p>
          </dl>
        )}
      </Sheet>

      <p className="text-xs text-text-tertiary">
        Related screens: <Link href="/ward" className="underline">the ward</Link> requests and records the transfusion,{' '}
        <Link href="/diagnostics" className="underline">diagnostics</Link> shares the request queue, and{' '}
        <Link href="/setup" className="underline">Setup</Link> holds the blood-product master this board prices and stores against.
      </p>
    </div>
  );
}
