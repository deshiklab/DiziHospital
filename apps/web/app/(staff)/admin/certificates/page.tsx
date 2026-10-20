'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { Ban, FileSignature, Printer, ScrollText, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  CERTIFICATES,
  CERTIFICATE_KINDS,
  DOCUMENT_WAITING,
  NUMBER_BLOCKS,
  blockFor,
  blockRemaining,
  certificateByNo,
  certificateSpec,
  checkCertificate,
  documentDigest,
  nextNumber,
  type Certificate,
  type CertificateKind,
} from '@/lib/documents';

/* Certificate (P8) — the numbered documents a hospital hands over.
 *
 * A certificate is a statement with a hospital's name on it, and the screen is built as though it is: every kind
 * carries the evidence the hospital has to already hold before it may be issued at all.
 *
 *   - a **medical certificate** needs a consultation inside ninety days — a statement about an illness the
 *     hospital saw, and ninety days is where that stops being true;
 *   - a **fitness certificate** needs the vitals from that consultation, because it is an opinion about a body
 *     today, and it is signed by the consultant rather than the desk;
 *   - a **character certificate** cannot be issued during probation or while a disciplinary case is open;
 *   - a **salary certificate** needs a payroll run, so it cannot state a figure the register does not show.
 *
 * Nothing is edited after it is handed over: the register supersedes or revokes, and both keep the number out of
 * circulation. The number itself is drawn from the block already reserved to this node, which is what lets the
 * desk print a certificate with the uplink down — and what makes a run-out block stop the desk rather than let it
 * invent a number.
 */

const KIND_TONE: Record<Certificate['status'], string> = {
  issued: 'text-safety-success',
  superseded: 'text-text-tertiary',
  revoked: 'text-safety-critical-text',
};

const STATUS_LABEL: Record<Certificate['status'], string> = {
  issued: 'In force',
  superseded: 'Superseded',
  revoked: 'Revoked',
};

export default function CertificatePage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [certificates, setCertificates] = useState<Certificate[]>(CERTIFICATES);
  const [view, setView] = useState('In force');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'issue' | 'revoke'>('issue');
  const [revoking, setRevoking] = useState<Certificate | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [draft, setDraft] = useState(() => ({
    kind: 'medical' as CertificateKind,
    subjectKind: 'patient' as 'patient' | 'staff',
    subjectMrn: '',
    subjectStaffCode: '',
    subjectName: '',
    purpose: '',
    body: '',
    validUntil: '',
    supersedes: '',
  }));

  const block = blockFor('CERT-2026')!;
  const digest = useMemo(() => documentDigest(certificates, [], day, block), [certificates, day, block]);
  const spec = certificateSpec(draft.kind);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return certificates
      .filter((c) => (view === 'In force' ? c.status === 'issued' : view === 'Superseded' ? c.status === 'superseded' : view === 'Revoked' ? c.status === 'revoked' : view === 'Patients' ? c.subjectKind === 'patient' : view === 'Staff' ? c.subjectKind === 'staff' : true))
      .filter((c) => !q || c.no.toLowerCase().includes(q) || c.subjectName.toLowerCase().includes(q) || c.subjectMrn.toLowerCase().includes(q) || c.purpose.toLowerCase().includes(q))
      .sort((a, b) => b.no.localeCompare(a.no));
  }, [certificates, view, query]);

  const evidence = useMemo(() => {
    const staffCert = draft.kind === 'experience' || draft.kind === 'salary' || draft.kind === 'character';
    return {
      lastConsultationOn: draft.subjectMrn ? '2026-10-15' : null,
      diagnosisRecorded: Boolean(draft.subjectMrn),
      vitalsRecorded: draft.kind !== 'fitness',
      staffJoinedOn: staffCert ? '2019-03-11' : null,
      probationEndsOn: staffCert ? '2020-03-11' : null,
      disciplinaryOpen: false,
      payrollMonths: draft.kind === 'salary' ? ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'] : [],
      licenceExpiry: null,
    };
  }, [draft.kind, draft.subjectMrn]);

  const check = useMemo(
    () =>
      checkCertificate(
        { ...draft },
        { today: day, certificates, cards: [], evidence, block, signedInRole: 'Consultant', signedInName: 'Dr. A. Rahman' },
      ),
    [draft, day, certificates, evidence, block],
  );

  const issue = () => {
    if (!check.ok) {
      push({ title: `The certificate is refused — ${check.reasons[0].code}`, description: check.reasons[0].message, tone: 'critical' });
      return;
    }
    const no = nextNumber(block);
    const certificate: Certificate = {
      no,
      kind: draft.kind,
      subjectKind: draft.subjectKind,
      subjectMrn: draft.subjectMrn.trim(),
      subjectStaffCode: draft.subjectStaffCode.trim(),
      subjectName: draft.subjectName.trim(),
      purpose: draft.purpose.trim(),
      body: draft.body.trim(),
      issuedBy: `${spec.issuedBy.split(' ')[0]} (Dr. A. Rahman)`,
      issuedOn: day,
      validUntil: draft.validUntil || null,
      templateKey: spec.templateKey,
      status: 'issued',
      supersedes: draft.supersedes.trim(),
      revokedOn: null,
      revokeReason: '',
      printed: 1,
      evidenceRef: evidence.lastConsultationOn ? `OPD visit ${evidence.lastConsultationOn}` : 'Staff record',
    };
    setCertificates((list) => [certificate, ...list.map((c) => (c.no === draft.supersedes ? { ...c, status: 'superseded' as const } : c))]);
    setOpen(false);
    const wrote = queueWrite(`Issue ${no} — ${spec.label} for ${certificate.subjectName}`, {
      id: 'issueCertificate',
      recordId: no,
      fields: { certificateNo: no, kind: certificate.kind, subjectKind: certificate.subjectKind, subject: certificate.subjectName, mrn: certificate.subjectMrn || null, staffCode: certificate.subjectStaffCode || null, purpose: certificate.purpose, template: certificate.templateKey, validUntil: certificate.validUntil, supersedes: certificate.supersedes || null, nodeId: block.node },
    });
    setDraft((d) => ({ ...d, subjectMrn: '', subjectStaffCode: '', subjectName: '', purpose: '', body: '', validUntil: '', supersedes: '' }));
    push({
      title: `${no} issued`,
      description: `Drawn from ${block.node}’s own ${block.series} block — ${blockRemaining(block)} left after this one. The certificate prints here and the register row drains later, so the patient does not wait for the uplink.${
        certificate.supersedes ? ` ${certificate.supersedes} is now superseded: the register can still say which certificate a patient was holding.` : ''
      } ${spec.defaultValidityDays > 0 ? `Default validity for this kind is ${spec.defaultValidityDays} days.` : 'This kind has no expiry: it is a statement about the past.'}${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  const revoke = () => {
    if (!revoking) return;
    if (revokeReason.trim().length < 12) {
      push({ title: 'A revocation needs a reason', description: 'It is appended to the register with your name against it, and it is the sentence the hospital answers a query with a year later.', tone: 'critical' });
      return;
    }
    setCertificates((list) => list.map((c) => (c.no === revoking.no ? { ...c, status: 'revoked' as const, revokedOn: day, revokeReason: revokeReason.trim() } : c)));
    const wrote = queueWrite(`Revoke ${revoking.no} — ${revoking.subjectName}`, {
      id: 'revokeCertificate',
      recordId: revoking.no,
      fields: { certificateNo: revoking.no, reason: revokeReason.trim(), at: day },
    });
    push({
      title: `${revoking.no} revoked`,
      description: `The number stays out of circulation: a revoked certificate is one the hospital has stopped standing behind, not one that never existed. If the patient still holds the paper, the desk has to tell them — the register is not what they read.${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
    setOpen(false);
    setRevoking(null);
    setRevokeReason('');
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="certificate"
        subtitle={`${day} · ${certificates.length} certificates on the register · ${digest.certificatesIssued} in force · block ${block.series} has ${digest.blockRemaining} numbers left.`}
        actions={
          <>
            <Link href="/admin/id-cards/staff">
              <Button variant="ghost">ID cards</Button>
            </Link>
            <Link href="/admin/printing">
              <Button variant="ghost">Print templates</Button>
            </Link>
            <Button variant="primary" onClick={() => { setRevoking(null); setMode('issue'); setOpen(true); }}>
              <FileSignature className="size-4" aria-hidden /> Issue a certificate
            </Button>
          </>
        }
        waiting={digest.revoked ? `${digest.revoked} certificate(s) revoked. The register keeps them visible on purpose: patients hold paper, and a register that hides a revoked certificate is one that cannot answer “is this one real?”.` : undefined}
      />

      <AdminSiblings screenId="certificate" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="In force" value={String(digest.certificatesIssued)} definition="Certificates the hospital is currently standing behind. Each one points at the evidence it was issued from, which is what makes it a statement rather than a letter." asOf={day} />
        <KpiTile label="Superseded" value={String(digest.superseded)} definition="Replaced because the hospital was wrong, not the patient. The replaced certificate stays on the register so a receiving office can be told exactly which version is current." asOf={day} />
        <KpiTile label="Revoked" value={String(digest.revoked)} definition="Withdrawn after issue. The number is never reused: a revoked certificate is one the hospital stopped standing behind, and the series says so by leaving the gap." asOf={day} footnote={digest.revoked ? 'the reason is on each row' : undefined} />
        <KpiTile label="Kinds" value={String(CERTIFICATE_KINDS.length)} definition="Each kind carries its own evidence rule and its own signer. The kind is what decides whether the desk may issue at all, which is the difference between a certificate and a template." asOf={day} />
        <KpiTile label="Prints" value={String(digest.printed)} definition="Sheets printed across the register. Counted because a certificate is physical: “printed three times” is a question an audit asks, and the answer has to be somewhere." asOf={day} />
        <KpiTile label="Numbers left" value={String(digest.blockRemaining)} definition={`What ${block.node} can still issue from ${block.series}, reserved ${block.reservedOn}. When it reaches zero the screen stops: a made-up number is a certificate the register cannot find again.`} asOf={day} />
      </div>

      <SafetyBanner severity="info" title="Every kind of certificate has an evidence rule, and the screen enforces it">
        <p>
          A medical certificate needs a consultation inside ninety days; a fitness certificate needs the vitals from it and a consultant’s signature; a
          character certificate cannot be issued during probation or with an open disciplinary case; a salary certificate needs a payroll run. The rule is
          the reason the kind exists — without it, a certificate is a template with a hospital’s name on it.
        </p>
      </SafetyBanner>

      <Panel
        title="The certificate register"
        actions={
          <Segmented
            label="Which certificates"
            name="certificate-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'In force', label: `In force (${digest.certificatesIssued})` },
              { value: 'Patients', label: 'For patients' },
              { value: 'Staff', label: 'For staff' },
              { value: 'Superseded', label: `Superseded (${digest.superseded})` },
              { value: 'Revoked', label: `Revoked (${digest.revoked})` },
              { value: 'Everything', label: `Everything (${certificates.length})` },
            ]}
          />
        }
      >
        <ListView
          id="certificate-register"
          caption={`Certificates issued at Main Campus`}
          rows={rows}
          rowId={(row) => row.no}
          onRowClick={(row) => (row.status === 'issued' ? (setRevoking(row), setMode('revoke'), setOpen(true)) : undefined)}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Number, name, MRN or purpose' }}
          rowActions={(row) => [
            { label: 'Print again', onSelect: () => push({ title: `${row.no} sent to the printer`, description: `The register counts it: ${row.printed} print(s) so far. A certificate printed twice with the same number is a question an audit asks, so the count is kept.`, tone: 'info' }) },
            ...(row.status === 'issued' ? [{ label: 'Revoke', onSelect: () => { setRevoking(row); setMode('revoke'); setOpen(true); } }] : []),
            ...(row.status === 'issued' ? [{ label: 'Supersede', onSelect: () => { setDraft((d) => ({ ...d, kind: row.kind, subjectKind: row.subjectKind, subjectMrn: row.subjectMrn, subjectStaffCode: row.subjectStaffCode, subjectName: row.subjectName, purpose: row.purpose, supersedes: row.no })); setRevoking(null); setMode('issue'); setOpen(true); } }] : []),
          ]}
          columns={[
            { key: 'no', header: 'Number', width: '9rem', render: (row) => <span className="font-numeric text-xs">{row.no}</span> },
            { key: 'kind', header: 'Kind', width: '10rem', render: (row) => certificateSpec(row.kind).label },
            { key: 'subject', header: 'About', render: (row) => <span className="block"><span className="block">{row.subjectName}</span><span className="font-numeric block text-xs text-text-tertiary">{row.subjectMrn || row.subjectStaffCode}</span></span> },
            { key: 'purpose', header: 'Purpose', render: (row) => <span className="line-clamp-1 text-text-secondary">{row.purpose}</span> },
            { key: 'issued', header: 'Issued', width: '9rem', render: (row) => <span className="block"><span className="font-numeric block">{row.issuedOn}</span><span className="line-clamp-1 block text-xs text-text-tertiary">{row.issuedBy}</span></span>, sortable: true },
            { key: 'status', header: 'State', width: '9rem', render: (row) => <span className={cx('font-medium', KIND_TONE[row.status])} title={row.revokedOn ? `${row.revokeReason}` : row.supersedes ? `Supersedes ${row.supersedes}` : undefined}>{STATUS_LABEL[row.status]}</span> },
          ]}
        />
      </Panel>

      <Panel title="What each kind may and may not say" actions={<span className="text-xs text-text-secondary">{CERTIFICATE_KINDS.length} kinds · each with evidence and a signer</span>}>
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {CERTIFICATE_KINDS.map((k) => (
            <li key={k.kind} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-center gap-1 text-sm font-medium text-text-primary">
                <ScrollText className="size-3.5" aria-hidden /> {k.label}
              </p>
              <p className="text-xs text-text-secondary">{k.purpose}</p>
              <p className="mt-1 text-xs text-text-tertiary">Evidence: {k.evidence}</p>
              <p className="text-xs text-text-tertiary">Signed by: {k.issuedBy}</p>
              <p className="mt-1 flex items-start gap-1 text-xs text-safety-warning-text">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Cannot: {k.cannot}
              </p>
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
        <p className="mt-2 flex items-center gap-1 text-xs text-text-tertiary">
          <Printer className="size-3.5" aria-hidden /> The sheet comes from {CERTIFICATE_KINDS[0].templateKey} and its siblings — the twelve print templates from P7,
          so the number on the paper and the number in the register are drawn once.
        </p>
      </Panel>

      <Sheet
        open={open && mode === 'issue'}
        onClose={() => setOpen(false)}
        title={`Issue a ${spec.label.toLowerCase()}`}
        description="The evidence is checked before the number is drawn: a certificate the hospital cannot point at evidence for is a letter."
        width="xl"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {check.ok ? `Next number: ${nextNumber(block)} · ${blockRemaining(block)} left in ${block.series}` : `${check.reasons.length} refusal(s) — nothing is issued until they are answered.`}
            </span>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={issue} disabled={!check.ok}>
              <FileSignature className="size-4" aria-hidden /> Issue and print
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!check.ok && (
            <SafetyBanner severity="critical" title={`The certificate is refused — ${check.reasons[0].code}`}>
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

          <FieldSection title="What kind, and about whom" description="The kind decides the evidence rule and the signer. The subject decides which series the number comes from.">
            <SelectField label="Kind" name="kind" value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as CertificateKind, subjectKind: ['experience', 'salary', 'character'].includes(e.target.value) ? 'staff' : 'patient' }))} options={CERTIFICATE_KINDS.map((k) => ({ value: k.kind, label: k.label }))} hint={spec.evidence} required />
            <SelectField
              label="About"
              name="subjectKind"
              value={draft.subjectKind}
              onChange={(e) => setDraft((d) => ({ ...d, subjectKind: e.target.value as 'patient' | 'staff' }))}
              options={[
                { value: 'patient', label: 'A patient' },
                { value: 'staff', label: 'A member of staff' },
              ]}
              hint={['experience', 'salary', 'character'].includes(draft.kind) ? 'This kind is about a member of staff: the sheet refuses a patient here.' : 'A medical kind is about a patient: the sheet refuses a staff member here.'}
            />
            {draft.subjectKind === 'patient' ? (
              <>
                <TextField label="MRN" name="subjectMrn" value={draft.subjectMrn} onChange={(e) => setDraft((d) => ({ ...d, subjectMrn: e.target.value }))} hint="The evidence for this certificate is checked against that record — a medical certificate with no consultation behind it is refused." required />
                <TextField label="Patient name" name="subjectName" value={draft.subjectName} onChange={(e) => setDraft((d) => ({ ...d, subjectName: e.target.value }))} hint="As the receiving office will read it." required />
              </>
            ) : (
              <>
                <TextField label="Employee number" name="subjectStaffCode" value={draft.subjectStaffCode} onChange={(e) => setDraft((d) => ({ ...d, subjectStaffCode: e.target.value }))} hint="The number the register finds the experience, the salary or the probation by." required />
                <TextField label="Staff name" name="subjectName" value={draft.subjectName} onChange={(e) => setDraft((d) => ({ ...d, subjectName: e.target.value }))} hint="As the employment record spells it — a name that differs from the payroll record causes a rejection at the bank." required />
              </>
            )}
            <TextField label="Purpose" name="purpose" value={draft.purpose} onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))} hint="Who it is for and what for. A certificate without a stated purpose is a template with a signature on it." required />
          </FieldSection>

          <FieldSection title="What it says" description="The body is the certificate. Leave it empty to print the standard wording for this kind.">
            <div className="md:col-span-2 xl:col-span-3">
              <TextAreaField
                label="Body"
                name="body"
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                rows={4}
                hint={`What the receiving office has to read. This kind may not say: ${spec.cannot.toLowerCase()}.`}
              />
            </div>
            <TextField label="Valid until" name="validUntil" value={draft.validUntil} onChange={(e) => setDraft((d) => ({ ...d, validUntil: e.target.value }))} placeholder="YYYY-MM-DD" hint={spec.defaultValidityDays > 0 ? `Usually ${spec.defaultValidityDays} days for a ${spec.label.toLowerCase()}. Leave empty for a statement about the past.` : 'This kind does not usually carry an expiry: it is a statement about the past.'} />
            <TextField label="Supersedes" name="supersedes" value={draft.supersedes} onChange={(e) => setDraft((d) => ({ ...d, supersedes: e.target.value }))} hint="The certificate number this one replaces, e.g. CERT/5129. The replaced one stays on the register as superseded — a patient may still be holding it." />
          </FieldSection>

          <div className="rounded-md border border-border-subtle px-3 py-2">
            <p className="text-xs font-medium text-text-primary">Evidence the hospital holds for this certificate</p>
            <ul className="mt-1 space-y-0.5 text-xs text-text-secondary">
              <li>{evidence.lastConsultationOn ? `Last consultation: ${evidence.lastConsultationOn}${evidence.vitalsRecorded ? ', with vitals' : ', without vitals'}` : 'No consultation for this patient at this hospital'}</li>
              <li>{evidence.diagnosisRecorded ? 'The diagnosis is on the record' : 'The diagnosis is not recorded'}</li>
              {draft.subjectKind === 'staff' && <li>Staff record since {evidence.staffJoinedOn ?? '—'}{evidence.probationEndsOn && evidence.probationEndsOn > day ? `, on probation until ${evidence.probationEndsOn}` : ', probation completed'}{evidence.disciplinaryOpen ? ', with an open disciplinary case' : ''}</li>}
              {draft.kind === 'salary' && <li>Payroll runs held: {evidence.payrollMonths.length ? evidence.payrollMonths.join(', ') : 'none'}</li>}
              <li>Signed by: {spec.issuedBy}</li>
            </ul>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={open && mode === 'revoke'}
        onClose={() => { setOpen(false); setRevoking(null); }}
        title={revoking ? `Revoke ${revoking.no}` : 'Revoke a certificate'}
        description="The certificate is withdrawn, not deleted: the register has to be able to answer “is the one in my hand real?”."
        width="md"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-tertiary">{revokeReason.trim().length < 12 ? 'A reason is required — it is what the hospital answers a query with.' : 'Appended with your name and today’s date.'}</span>
            <Button variant="ghost" onClick={() => { setOpen(false); setRevoking(null); }}>Cancel</Button>
            <Button variant="primary" onClick={revoke} disabled={revokeReason.trim().length < 12}>
              <Ban className="size-4" aria-hidden /> Revoke
            </Button>
          </>
        }
      >
        {revoking && (
          <div className="space-y-3">
            <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-text-secondary">
              <p className="text-sm font-medium text-text-primary">
                {certificateSpec(revoking.kind).label} · {revoking.subjectName}
              </p>
              <p>
                <span className="font-numeric">{revoking.no}</span> · issued {revoking.issuedOn} by {revoking.issuedBy} · evidence: {revoking.evidenceRef}
              </p>
              <p className="mt-1">{revoking.purpose}</p>
            </div>
            <FieldSection title="Why" description="This sentence goes on the register, and it is what the desk reads when the patient telephones.">
              <div className="md:col-span-2 xl:col-span-3">
                <TextAreaField label="Reason" name="revokeReason" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} rows={3} hint="“Signed by the wrong role”, “the dates were wrong”, “the patient asked us to withdraw it” — different failures, and the fix differs with them." required />
              </div>
            </FieldSection>
            <SafetyBanner severity="warning" title="The paper is already in somebody’s hand">
              <p>
                Revoking a certificate does not reach the school, the employer or the bank that received it. The register keeps the number out of circulation and the
                reason on the record; telling whoever is holding the paper is a telephone call, and this screen will not pretend otherwise.
              </p>
            </SafetyBanner>
          </div>
        )}
      </Sheet>

      <p className="flex items-center gap-1 text-xs text-text-tertiary">
        <ShieldAlert className="size-3.5" aria-hidden /> A revoked or superseded number is never reissued: {NUMBER_BLOCKS.filter((b) => b.series.startsWith('CERT')).map((b) => `${b.series} has drawn to ${b.lastDrawn}`).join(' · ')}.
      </p>
    </div>
  );
}
