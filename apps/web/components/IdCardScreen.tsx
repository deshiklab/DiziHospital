'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { BadgeCheck, Ban, IdCard, Printer, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { staffDirectory } from '@/lib/hr';
import {
  CARD_COLUMNS,
  CARD_VALIDITY,
  DOCUMENT_WAITING,
  IDENTITY_CARDS,
  NUMBER_BLOCKS,
  blockFor,
  blockRemaining,
  cardByNo,
  cardFieldsFor,
  cardsExpiring,
  checkCard,
  documentDigest,
  nextNumber,
  type CardSubject,
  type IdentityCard,
} from '@/lib/documents';

/* The staff card and the patient card (P8) — one screen component, two screens.
 *
 * They are the same register with different columns, and the difference is exactly what is printed on the card:
 * eleven columns for a member of staff — designation, department, employee number, photograph — and seven for a
 * patient, whose identity is the MRN. Sharing the component is what stops the pair drifting; the column lists
 * live in `lib/documents.ts` beside the field definitions, and the harness asserts the counts.
 *
 * Two rules carry the weight. A staff card may not outlive the professional licence it is the physical evidence
 * of, and a card number is drawn from the block already reserved to this node — which is why a card can be
 * printed with the uplink down, and why a node that has run out stops the desk rather than letting it invent a
 * number. Revocation never returns a number to the series.
 */

const STATUS_TONE: Record<IdentityCard['status'], string> = {
  active: 'text-safety-success',
  superseded: 'text-text-tertiary',
  revoked: 'text-safety-critical-text',
};

const STATUS_LABEL: Record<IdentityCard['status'], string> = {
  active: 'In use',
  superseded: 'Superseded',
  revoked: 'Revoked',
};

const REVOKE_REASONS: Array<{ value: string; label: string; because: string }> = [
  { value: 'LOST', label: 'Reported lost', because: 'The card is dead in the register from this moment, which is the whole reason the register is online before the gate is.' },
  { value: 'DAMAGED', label: 'Damaged', because: 'A damaged card is replaced, and the replacement points at it so the register shows one live card.' },
  { value: 'REPLACED', label: 'Replaced — details corrected', because: 'A name, a spelling or a photograph was wrong. The old card is superseded by the new one rather than simply dead.' },
  { value: 'LEFT SERVICE', label: 'Left service', because: 'The card is the hospital’s statement that somebody works here. The register stops making it the day the employment ends.' },
  { value: 'OTHER', label: 'Other', because: 'Anything else needs the note: the sentence is what a security review reads.' },
];

export function IdCardScreen({ subject }: { subject: CardSubject }) {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const directory = useMemo(() => staffDirectory(day), [day]);
  const [cards, setCards] = useState<IdentityCard[]>(IDENTITY_CARDS);
  const [view, setView] = useState('In use');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'issue' | 'revoke'>('issue');
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState<IdentityCard | null>(null);
  const [revokeReason, setRevokeReason] = useState('LOST');
  const [revokeNote, setRevokeNote] = useState('');
  const [draft, setDraft] = useState(() => ({
    holderName: '',
    holderNameBn: '',
    staffCode: '',
    mrn: '',
    designation: '',
    department: '',
    bloodGroup: '',
    phone: '',
    address: '',
    photoRef: '',
    validUntil: subject === 'staff' ? '2029-06-30' : '2031-10-16',
    supersedes: '',
  }));

  const block = blockFor(subject === 'staff' ? 'CARD-S-2026' : 'CARD-P-2026')!;
  const mine = cards.filter((c) => c.subject === subject);
  const digest = useMemo(() => documentDigest([], mine, day, block), [mine, day, block]);
  const expiring = useMemo(() => cardsExpiring(mine, day, 90), [mine, day]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mine
      .filter((c) => (view === 'In use' ? c.status === 'active' : view === 'Superseded' ? c.status === 'superseded' : view === 'Revoked' ? c.status === 'revoked' : view === 'Expiring' ? c.status === 'active' && expiring.includes(c) : true))
      .filter((c) => !q || c.holderName.toLowerCase().includes(q) || c.no.toLowerCase().includes(q) || (subject === 'staff' ? c.staffCode : c.mrn).toLowerCase().includes(q))
      .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
  }, [mine, view, query, expiring, subject]);

  const evidence = useMemo(
    () => ({
      lastConsultationOn: subject === 'patient' ? '2026-10-15' : null,
      diagnosisRecorded: true,
      vitalsRecorded: true,
      staffJoinedOn: subject === 'staff' ? '2026-04-01' : null,
      probationEndsOn: subject === 'staff' ? '2027-04-01' : null,
      disciplinaryOpen: false,
      payrollMonths: subject === 'staff' ? ['2026-09'] : [],
      licenceExpiry: subject === 'staff' ? '2029-06-30' : null,
    }),
    [subject],
  );

  const check = useMemo(
    () =>
      checkCard(
        { subject, ...draft },
        { today: day, certificates: [], cards: mine, evidence, block, signedInRole: 'Administrator', signedInName: 'R. Howlader' },
      ),
    [subject, draft, day, mine, evidence, block],
  );

  const staffMember = directory.find((m) => m.code === draft.staffCode);

  const issue = () => {
    if (!check.ok) {
      push({ title: `The card is refused — ${check.reasons[0].code}`, description: check.reasons[0].message, tone: 'critical' });
      return;
    }
    const no = nextNumber(block);
    const card: IdentityCard = {
      no,
      subject,
      holderName: draft.holderName.trim(),
      holderNameBn: draft.holderNameBn.trim(),
      staffCode: draft.staffCode.trim(),
      mrn: draft.mrn.trim(),
      designation: draft.designation.trim(),
      department: draft.department.trim(),
      bloodGroup: draft.bloodGroup.trim(),
      phone: draft.phone.trim(),
      address: draft.address.trim(),
      photoRef: draft.photoRef.trim(),
      validUntil: draft.validUntil,
      issuedOn: day,
      issuedBy: 'R. Howlader',
      templateKey: subject === 'staff' ? 'id-card-staff' : 'id-card-patient',
      status: 'active',
      supersedes: draft.supersedes.trim(),
      revokedOn: null,
      revokeReason: '',
      printed: 1,
      licenceExpiry: subject === 'staff' ? evidence.licenceExpiry : null,
    };
    setCards((list) => [card, ...list.map((c) => (c.no === draft.supersedes ? { ...c, status: 'superseded' as const, revokedOn: day, revokeReason: 'REPLACED' as const } : c))]);
    setOpen(false);
    const wrote = queueWrite(`Issue ${no} — ${card.holderName} (${subject} card)`, {
      id: 'issueIdCard',
      recordId: no,
      fields: { cardNo: no, subject, holder: card.holderName, holderBn: card.holderNameBn, staffCode: card.staffCode, mrn: card.mrn, photo: card.photoRef, validUntil: card.validUntil, supersedes: card.supersedes || null, nodeId: block.node },
    });
    setDraft((d) => ({ ...d, holderName: '', holderNameBn: '', staffCode: '', mrn: '', designation: '', department: '', bloodGroup: '', phone: '', address: '', photoRef: '', supersedes: '' }));
    push({
      title: `Card ${no} issued and printed`,
      description: `Drawn from ${block.node}’s own series — ${blockRemaining(block)} left after this one. The card is printed here and the register row drains when the uplink returns.${
        card.supersedes ? ` ${card.supersedes} is now superseded, not deleted: the register can still say which card was in circulation.` : ''
      }${check.warnings.length ? ` Noted: ${check.warnings.map((w) => w.message).join(' ')}` : ''}${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? (check.warnings.length ? 'warning' : 'success') : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId={subject === 'staff' ? 'staff-id-card' : 'patient-id-card'}
        subtitle={`${day} · ${mine.length} ${subject} cards on the register · ${digest.cardsActive} in use · block ${block.series} has ${digest.blockRemaining} numbers left.`}
        actions={
          <>
            <Link href={subject === 'staff' ? '/admin/id-cards/patient' : '/admin/id-cards/staff'}>
              <Button variant="ghost">{subject === 'staff' ? 'Patient cards' : 'Staff cards'}</Button>
            </Link>
            <Link href="/admin/certificates">
              <Button variant="ghost">Certificates</Button>
            </Link>
            <Button variant="primary" onClick={() => { setMode('issue'); setOpen(true); }}>
              <IdCard className="size-4" aria-hidden /> Issue a card
            </Button>
          </>
        }
        waiting={digest.blockRemaining < 50 ? `The ${block.series} block has ${digest.blockRemaining} numbers left. When it reaches zero the screen stops issuing — a card number is drawn from a reserved block, never invented.` : undefined}
      />

      <AdminSiblings screenId={subject === 'staff' ? 'staff-id-card' : 'patient-id-card'} />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Cards in use" value={String(digest.cardsActive)} definition={`${subject === 'staff' ? 'Staff' : 'Patient'} cards that are the current card for somebody. Only one card per holder is ever in use, and a re-issue supersedes the one before it.`} asOf={day} />
        <KpiTile label={subject === 'staff' ? 'Employee numbers' : 'MRNs'} value={String(new Set(mine.map((c) => (subject === 'staff' ? c.staffCode : c.mrn))).size)} definition="Distinct holders. Two live cards for one person is the failure this count would show: a stale card in a wallet and a new one in a drawer." asOf={day} />
        <KpiTile label="Superseded" value={String(digest.superseded)} definition="Replaced because something on the card was wrong — a spelling, a photograph, a department. The old card is not deleted, so a review can still say which card was in circulation when." asOf={day} />
        <KpiTile label="Revoked" value={String(digest.cardsRevoked)} definition="Dead in the register: reported lost, or the holder left service. A revoked number never returns to the series." asOf={day} footnote={digest.cardsRevoked ? 'the reason is on each row' : undefined} />
        <KpiTile label="Expiring in 90 days" value={String(expiring.length)} definition="Cards whose validity ends soon. Re-issuing before a gate refuses one is cheaper than an argument at the door, and the list is here rather than in somebody’s head." asOf={day} />
        <KpiTile label="Numbers left" value={String(digest.blockRemaining)} definition={`What ${block.node} can still issue from ${block.series}, reserved on ${block.reservedOn}. The block is replenished by the cloud; a node that runs out stops rather than inventing a number.`} asOf={day} />
      </div>

      {expiring.length > 0 && (
        <SafetyBanner severity="info" title={`${expiring.length} ${subject} card(s) expire within 90 days`}>
          <p>
            {expiring.slice(0, 4).map((c) => `${c.holderName} (${c.no}) on ${c.validUntil}`).join(' · ')}
            {expiring.length > 4 ? ` and ${expiring.length - 4} more` : ''}. {CARD_VALIDITY.note}
          </p>
        </SafetyBanner>
      )}

      <Panel
        title={subject === 'staff' ? 'The staff card register' : 'The patient card register'}
        actions={
          <Segmented
            label="Which cards"
            name={`${subject}-card-view`}
            value={view}
            onChange={setView}
            options={[
              { value: 'In use', label: `In use (${digest.cardsActive})` },
              { value: 'Expiring', label: `Expiring (${expiring.length})` },
              { value: 'Superseded', label: `Superseded (${digest.superseded})` },
              { value: 'Revoked', label: `Revoked (${digest.cardsRevoked})` },
              { value: 'Everything', label: `Everything (${mine.length})` },
            ]}
          />
        }
      >
        <ListView
          id={`${subject}-card-register`}
          caption={subject === 'staff' ? 'Staff identity cards' : 'Patient identity cards'}
          rows={rows}
          rowId={(row) => row.no}
          onRowClick={(row) => { setRevoking(row); setMode('revoke'); setOpen(true); }}
          quickSearch={{ value: query, onChange: setQuery, placeholder: subject === 'staff' ? 'Name, card number or employee number' : 'Name, card number or MRN' }}
          rowActions={(row) => [
            { label: 'Print again', onSelect: () => push({ title: `${row.no} sent to the printer`, description: `The register counts this: ${row.printed} print(s) so far. “Printed twice” is a question a security review asks, and the answer is here.`, tone: 'info' }) },
            ...(row.status === 'active' ? [{ label: row.revokeReason === 'LEFT SERVICE' ? 'Restore' : 'Revoke', onSelect: () => { setRevoking(row); setMode('revoke'); setOpen(true); } }] : []),
            { label: 'Re-issue', onSelect: () => { setDraft((d) => ({ ...d, holderName: row.holderName, holderNameBn: row.holderNameBn, staffCode: row.staffCode, mrn: row.mrn, designation: row.designation, department: row.department, bloodGroup: row.bloodGroup, phone: row.phone, address: row.address, photoRef: row.photoRef, supersedes: row.no })); setMode('issue'); setOpen(true); } },
          ]}
          columns={CARD_COLUMNS[subject].map((col) => ({
            key: col.key as string,
            header: col.header,
            ...(col.width ? { width: col.width } : {}),
            ...(col.hideBelow ? { hideBelow: col.hideBelow } : {}),
            render: (row: IdentityCard): React.ReactNode => {
              const value = String(row[col.key as keyof IdentityCard] ?? '');
              if (col.key === 'status') return <span className={cx('font-medium', STATUS_TONE[row.status])} title={row.revokedOn ? `${row.revokeReason} on ${row.revokedOn}` : undefined}>{STATUS_LABEL[row.status]}</span>;
              if (col.key === 'no') return <span className="font-numeric text-xs">{row.no}</span>;
              if (col.key === 'validUntil') return <span className="font-numeric">{row.validUntil}</span>;
              if (col.key === 'photoRef') return row.photoRef ? <span className="text-text-secondary">on file</span> : <span className="text-safety-warning-text">no photograph</span>;
              if (col.key === 'bloodGroup') return value || <span className="text-text-tertiary">not known</span>;
              if (col.key === 'holderNameBn') return <span lang="bn">{value}</span>;
              return value || <span className="text-text-tertiary">—</span>;
            },
          }))}
        />
      </Panel>

      <Panel title={subject === 'staff' ? 'What goes on a staff card' : 'What goes on a patient card'} actions={<span className="text-xs text-text-secondary">{cardFieldsFor(subject).length} fields · {cardFieldsFor(subject).filter((f) => f.rule).length} with a rule</span>}>
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {cardFieldsFor(subject).map((f) => (
            <li key={f.key} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="text-sm font-medium text-text-primary">
                {f.label}
                {f.required && <span className="ml-1 text-xs text-text-tertiary">required</span>}
              </p>
              <p className="text-xs text-text-secondary">Source: {f.source}</p>
              {f.rule && <p className="text-xs text-text-tertiary">{f.rule}</p>}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="What this screen is waiting for">
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
          {DOCUMENT_WAITING.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Panel>

      <Sheet
        open={open && mode === 'issue'}
        onClose={() => setOpen(false)}
        title={subject === 'staff' ? 'Issue a staff card' : 'Issue a patient card'}
        description="The number is drawn from this node’s own block, so the card prints now and the register row drains later."
        width="xl"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {check.ok ? `Next number: ${nextNumber(block)} · ${blockRemaining(block)} left in ${block.series}` : `${check.reasons.length} refusal(s) — nothing is printed until they are answered.`}
            </span>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={issue} disabled={!check.ok}>
              <BadgeCheck className="size-4" aria-hidden /> Issue and print
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!check.ok && (
            <SafetyBanner severity="critical" title={`The card is refused — ${check.reasons[0].code}`}>
              <ul className="list-disc space-y-1 pl-5">
                {check.reasons.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}
          {check.ok && check.warnings.length > 0 && (
            <SafetyBanner severity="warning" title="Issued, with something the register notes">
              <ul className="list-disc space-y-1 pl-5">
                {check.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}

          <FieldSection title="The holder" description={subject === 'staff' ? 'Look the employee up rather than typing them in: the card and the payroll have to say the same thing about a person.' : 'Look the patient up by MRN. The card is only worth carrying because the MRN on it finds the record.'}>
            {subject === 'staff' ? (
              <>
                <SelectField
                  label="Employee number"
                  name="staffCode"
                  value={draft.staffCode}
                  onChange={(e) => {
                    const m = directory.find((x) => x.code === e.target.value);
                    setDraft((d) => ({ ...d, staffCode: e.target.value, holderName: m?.name ?? '', holderNameBn: m?.nameBn ?? '', designation: m?.designation ?? '', department: m?.departmentId ?? '', phone: m?.phone ?? '' }));
                  }}
                  options={[{ value: '', label: 'Choose from the staff register…' }, ...directory.slice(0, 40).map((m) => ({ value: m.code, label: `${m.code} — ${m.name} (${m.designation})` }))]}
                  hint="Taken from the payroll register, so a card cannot exist for somebody the hospital cannot roster or pay."
                  required
                />
                <TextField label="Bangla name" name="holderNameBn" value={draft.holderNameBn} onChange={(e) => setDraft((d) => ({ ...d, holderNameBn: e.target.value }))} hint="From the staff record. The card is read by its holder and by a gate, and both read Bangla first." required />
                <TextField label="Photograph reference" name="photoRef" value={draft.photoRef} onChange={(e) => setDraft((d) => ({ ...d, photoRef: e.target.value }))} hint="The photograph already on the node, e.g. photo/EMP-1031-2026.jpg. A staff card without one is refused." required />
              </>
            ) : (
              <>
                <TextField label="MRN" name="mrn" value={draft.mrn} onChange={(e) => setDraft((d) => ({ ...d, mrn: e.target.value }))} hint="The identity of the card. A card with a name and no MRN is a search at the desk, not an answer." required />
                <TextField label="Holder name" name="holderName" value={draft.holderName} onChange={(e) => setDraft((d) => ({ ...d, holderName: e.target.value }))} hint="As recorded on the patient record." required />
                <TextField label="Bangla name" name="holderNameBn" value={draft.holderNameBn} onChange={(e) => setDraft((d) => ({ ...d, holderNameBn: e.target.value }))} hint="Required. The screen will not transliterate a name — the Bangla name comes from the record." required />
                <TextField label="Photograph reference" name="photoRef" value={draft.photoRef} onChange={(e) => setDraft((d) => ({ ...d, photoRef: e.target.value }))} hint="Optional for a patient. Without one the card prints an explicit “no photograph” block rather than a placeholder face." />
                <TextField label="Address" name="address" value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} hint="Optional. It is what the ambulance and the follow-up letter need, and the card is the one document a patient keeps." />
              </>
            )}
            <TextField label="Blood group" name="bloodGroup" value={draft.bloodGroup} onChange={(e) => setDraft((d) => ({ ...d, bloodGroup: e.target.value }))} hint="Empty prints as “not known”. A guessed blood group on a card is worse than an empty field." />
            <TextField label="Telephone" name="phone" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} hint="From the record. A card is often the moment the desk notices the number is out of date." />
          </FieldSection>

          <FieldSection title="The card" description="Validity is a rule, not a preference: a clinical card cannot outlive the licence, and a patient card cannot outlive its photograph.">
            <TextField label="Valid until" name="validUntil" value={draft.validUntil} onChange={(e) => setDraft((d) => ({ ...d, validUntil: e.target.value }))} placeholder="YYYY-MM-DD" hint={subject === 'staff' ? `Clinical staff: the card runs to the licence expiry and never past it. Others: ${CARD_VALIDITY.staffYears} years.` : `Five years at most, and the sheet refuses anything longer.`} required />
            <TextField label="Re-issues" name="supersedes" value={draft.supersedes} onChange={(e) => setDraft((d) => ({ ...d, supersedes: e.target.value }))} hint="The card number this one replaces. The replaced card is superseded, never deleted — the register has to be able to say which card was in circulation when." />
            <SelectField
              label="Template"
              name="templateKey"
              value={draft.photoRef ? 'with-photo' : 'no-photo'}
              onChange={() => undefined}
              options={[
                { value: 'with-photo', label: subject === 'staff' ? 'Staff card, with photograph' : 'Patient card, with photograph' },
                { value: 'no-photo', label: subject === 'staff' ? 'Staff card, no photograph — refused' : 'Patient card, explicit “no photograph” block' },
              ]}
              hint="One of the twelve print templates, so the printed card and the register cannot disagree about the number or the name."
            />
          </FieldSection>
        </div>
      </Sheet>

      <Sheet
        open={open && mode === 'revoke'}
        onClose={() => { setOpen(false); setRevoking(null); }}
        title={revoking ? `Revoke ${revoking.no}` : 'Revoke a card'}
        description="A revoked card is dead in the register from this moment; its number never returns to the series."
        width="md"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-tertiary">
              {revokeReason === 'OTHER' && revokeNote.trim().length < 12 ? '“Other” needs the note: the sentence is what a security review reads.' : 'Appended with your name and today’s date.'}
            </span>
            <Button variant="ghost" onClick={() => { setOpen(false); setRevoking(null); }}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!revoking) return;
                if (revokeReason === 'OTHER' && revokeNote.trim().length < 12) {
                  push({ title: '“Other” needs the note', description: 'The reason is the sentence a security review reads three months from now. A one-word reason is worse than none.', tone: 'critical' });
                  return;
                }
                setCards((list) => list.map((c) => (c.no === revoking.no ? { ...c, status: 'revoked' as const, revokedOn: day, revokeReason: revokeReason as IdentityCard['revokeReason'] } : c)));
                const wrote = queueWrite(`Revoke ${revoking.no} — ${revoking.holderName} (${revokeReason})`, {
                  id: 'revokeIdCard',
                  recordId: revoking.no,
                  fields: { cardNo: revoking.no, subject, holder: revoking.holderName, reason: revokeReason, note: revokeNote.trim(), at: day },
                });
                push({
                  title: `${revoking.no} revoked`,
                  description: `${
                    revokeReason === 'LOST'
                      ? 'The card is dead in the register from now on. The gate that reads it is hardware and arrives with the pilot, so today the register is the only place that knows — and it is the right place.'
                      : revokeReason === 'LEFT SERVICE'
                        ? 'The hospital has stopped saying this person works here. Their card cannot be re-issued without a staff record that says they do.'
                        : 'The card is dead and the reason is on it. A revocation is an append: nothing is deleted, so the register can still say the card existed.'
                  }${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
                  tone: wrote.queued ? 'success' : 'warning',
                });
                setOpen(false);
                setRevoking(null);
                setRevokeNote('');
              }}
            >
              <Ban className="size-4" aria-hidden /> Revoke the card
            </Button>
          </>
        }
      >
        {revoking && (
          <div className="space-y-3">
            <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-text-secondary">
              <p className="text-sm font-medium text-text-primary">{revoking.holderName}</p>
              <p className="font-numeric">
                {revoking.no} · {subject === 'staff' ? revoking.staffCode : revoking.mrn} · issued {revoking.issuedOn} · valid until {revoking.validUntil}
              </p>
              <p>Printed {revoking.printed} time(s). {revoking.status === 'revoked' ? `Already revoked: ${revoking.revokeReason} on ${revoking.revokedOn}.` : 'Currently in use.'}</p>
            </div>
            <FieldSection title="Why" description="The reason decides what happens next: a lost card is a security event, a corrected one is a printing job.">
              <SelectField label="Reason" name="revokeReason" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} options={REVOKE_REASONS.map((r) => ({ value: r.value, label: r.label }))} hint={REVOKE_REASONS.find((r) => r.value === revokeReason)?.because} />
              <div className="md:col-span-2 xl:col-span-3">
                <TextAreaField label="Note" name="revokeNote" value={revokeNote} onChange={(e) => setRevokeNote(e.target.value)} rows={2} hint="Required for “other”. Optional otherwise, and it is what explains the case three months later." />
              </div>
            </FieldSection>
            {revokeReason === 'LOST' && (
              <SafetyBanner severity="warning" title="A lost card is a security event, not a filing one">
                <p>
                  The register is dead from the moment you press this, which is the whole point of keeping it here rather than on paper. Someone
                  holding a card that says “active” and a register that says “lost” is the case this screen exists to prevent — tell the security
                  supervisor at the gate as well, as the register alone does not walk to the door.
                </p>
              </SafetyBanner>
            )}
          </div>
        )}
      </Sheet>

      {/* A quiet line for the printer: the card sheet and the register come from the same template, and the
          difference between the two cards is exactly the columns above. */}
      <p className="flex items-center gap-1 text-xs text-text-tertiary">
        <Printer className="size-3.5" aria-hidden /> Printed on the {subject === 'staff' ? 'staff' : 'patient'} card template; the number on the sheet and the number
        in the register are the same number, drawn once. A card the desk cannot attribute is one the register refuses to have printed.
      </p>
      <p className="flex items-center gap-1 text-xs text-text-tertiary">
        <ShieldAlert className="size-3.5" aria-hidden /> {cardByNo(mine[0]?.no ?? '') ? 'The register is the source for the gate, the fire roll call and the payroll: one employee number, three places that resolve to it.' : 'No cards on this register yet.'}
      </p>
    </div>
  );
}
