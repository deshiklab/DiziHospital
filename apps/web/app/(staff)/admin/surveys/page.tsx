'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { ClipboardList, Clock, Plus, Send, ShieldQuestion, Trash2 } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  MAX_MINUTES,
  MAX_QUESTIONS,
  MAX_TEXT_QUESTIONS,
  QUESTION_LIBRARY,
  SURVEY_ASSIGNMENTS,
  SURVEY_FORMS,
  SURVEY_RESPONSES,
  SURVEY_RULES,
  SURVEY_WAITING,
  checkClosure,
  checkForm,
  draftQuestion,
  formById,
  minutesToAnswer,
  surveyDigest,
  surveyStats,
  type Question,
  type QuestionType,
  type SurveyForm,
} from '@/lib/surveys';

/* Survey Forms (P8) — the forms the hospital asks with.
 *
 * The screen is a builder, and the builder exists to refuse four things that decide whether the answers mean
 * anything at all:
 *
 *  - **a scale with no words at its ends**, because a bare number is answered differently by everybody and “3” is
 *    what somebody picks when they cannot tell what was asked;
 *  - **an anonymous form that asks who you are**, which is worse than a named one — the promise was the reason the
 *    answer was honest;
 *  - **a form that takes longer than five minutes**, because the last answers past that point are given to make it
 *    stop;
 *  - **a question the hospital cannot act on**, which is why the purpose has to be written down in words the person
 *    answering can read.
 *
 * The register shows the response rate beside the score on every row. “71% satisfied” from nine replies out of four
 * hundred is the figure that gets quoted, and the only defence is to print the other number next to it.
 */

const STATUS_TONE: Record<SurveyForm['status'], string> = {
  open: 'text-safety-success',
  draft: 'text-safety-warning',
  closed: 'text-text-tertiary',
};

const STATUS_LABEL: Record<SurveyForm['status'], string> = { open: 'Open', draft: 'Draft', closed: 'Closed' };

/** The builder holds a whole form, not a fragment: every refusal the checks make is about a field somebody has to be shown. */
type Draft = SurveyForm;

export default function SurveyFormsPage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [forms, setForms] = useState<SurveyForm[]>(SURVEY_FORMS);
  const [view, setView] = useState('Everything');
  const [query, setQuery] = useState('');
  const [building, setBuilding] = useState<Draft | null>(null);
  const [closing, setClosing] = useState<SurveyForm | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [assigning, setAssigning] = useState<SurveyForm | null>(null);
  const [assignTo, setAssignTo] = useState('EMP-1042');
  const [dueAt, setDueAt] = useState(day);
  const [reading, setReading] = useState<SurveyForm | null>(null);

  const digest = useMemo(() => surveyDigest(forms, SURVEY_ASSIGNMENTS, day), [forms, day]);
  const verdict = useMemo(() => (building ? checkForm(building, { today: day, responses: SURVEY_RESPONSES }) : null), [building, day]);
  const closeVerdict = useMemo(() => (closing ? checkClosure(closing, closeReason) : null), [closing, closeReason]);
  const stats = useMemo(() => (reading ? surveyStats(reading, SURVEY_RESPONSES) : null), [reading]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return forms
      .filter((form) => (view === 'Open' ? form.status === 'open' : view === 'Drafts' ? form.status === 'draft' : view === 'Closed' ? form.status === 'closed' : view === 'Anonymous' ? form.anonymity === 'anonymous' : true))
      .filter((form) => !q || form.title.toLowerCase().includes(q) || form.titleBn.includes(q) || form.createdBy.toLowerCase().includes(q))
      .sort((a, b) => a.status.localeCompare(b.status) || b.opensOn.localeCompare(a.opensOn));
  }, [forms, view, query]);

  const openBuilder = (form: SurveyForm) => {
    setBuilding({ ...form, questions: form.questions.map((question) => ({ ...question })) });
  };

  const saveForm = (publish: boolean) => {
    if (!building || !verdict) return;
    if (publish && !verdict.ok) {
      push({ title: `The form was not published — ${verdict.reasons[0].code}`, description: verdict.reasons[0].message, tone: 'critical' });
      return;
    }
    const existing = forms.find((form) => form.id === building.id);
    const next: SurveyForm = {
      ...building,
      // A form with answers keeps its version: rewording a question after answers exist changes what those answers meant.
      version: existing && existing.responseCount > 0 && existing.status !== 'draft' ? existing.version : (existing?.version ?? 1),
      status: publish ? 'open' : 'draft',
    };
    setForms((list) => (existing ? list.map((form) => (form.id === next.id ? next : form)) : [next, ...list]));
    const wrote = queueWrite(`${publish ? 'Publish' : 'Save'} “${next.title}” (version ${next.version}, ${next.questions.length} questions)`, {
      id: publish ? 'publishSurveyForm' : existing ? 'updateSurveyForm' : 'createSurveyForm',
      recordId: next.id,
      fields: { form: next.id, version: next.version, questions: next.questions.length, anonymity: next.anonymity, closesOn: next.closesOn },
    });
    push({
      title: publish ? `“${next.title}” is open` : `“${next.title}” saved as a draft`,
      description: publish
        ? `${next.questions.length} questions, about ${minutesToAnswer(next).toFixed(1)} minutes, closing ${next.closesOn}. Publication is part of the cloud record — the portal and the counters ask the same questions — so the contract makes it online-only. ${
            wrote.queued ? '' : `Refused here: ${wrote.because}`
          }`
        : `A draft nobody can answer yet. ${verdict.warnings.length ? `Noted: ${verdict.warnings.map((w) => w.message).join(' ')} ` : ''}${wrote.queued ? '' : `Not queued: ${wrote.because}`}`,
      tone: wrote.queued ? (publish ? 'success' : 'info') : 'warning',
    });
    setBuilding(null);
  };

  const close = () => {
    if (!closing || !closeVerdict) return;
    if (!closeVerdict.ok) {
      push({ title: `The form was not closed — ${closeVerdict.reasons[0].code}`, description: closeVerdict.reasons[0].message, tone: 'critical' });
      return;
    }
    setForms((list) => list.map((form) => (form.id === closing.id ? { ...form, status: 'closed', closedReason: closeReason } : form)));
    const wrote = queueWrite(`Close “${closing.title}”`, { id: 'updateSurveyForm', recordId: closing.id, fields: { form: closing.id, status: 'closed', reason: closeReason } });
    push({
      title: `“${closing.title}” closed`,
      description: `Closed rather than deleted: the ${closing.responseCount} answer(s) stay readable against this version of the form, because they were given under a purpose somebody stated. ${
        closeVerdict.warnings.map((w) => w.message).join(' ')
      }${wrote.queued ? '' : ` Not queued: ${wrote.because}`}`,
      tone: 'warning',
    });
    setClosing(null);
    setCloseReason('');
  };

  const assign = () => {
    if (!assigning) return;
    const wrote = queueWrite(`Assign “${assigning.title}” to ${assignTo}`, { id: 'assignSurveyForm', recordId: `${assigning.id}:${assignTo}`, fields: { form: assigning.id, assignee: assignTo, dueAt } });
    push({
      title: `Assignment sent to ${assignTo}`,
      description: `Due ${dueAt}. The assignment is a row rather than a broadcast: the person can see who asked them for it, and the register shows who has not answered yet. ${
        wrote.queued ? '' : `Not queued: ${wrote.because}`
      }`,
      tone: wrote.queued ? 'success' : 'warning',
    });
    setAssigning(null);
  };

  const addQuestion = (type: QuestionType) => {
    if (!building) return;
    const id = `q${building.questions.length + 1}`;
    setBuilding({ ...building, questions: [...building.questions, { ...draftQuestion(type, id), text: '', textBn: '' }] });
  };

  const patchQuestion = (id: string, patch: Partial<Question>) => {
    if (!building) return;
    setBuilding({ ...building, questions: building.questions.map((question) => (question.id === id ? { ...question, ...patch } : question)) });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="survey-forms"
        subtitle={`${day} · ${digest.forms} forms · ${digest.open} open · ${digest.answers} answers from ${digest.invited} invitations (${Math.round(digest.responseRate * 100)}%) · ${digest.anonymous} form(s) promise no names.`}
        actions={
          <>
            <Link href="/admin/surveys/mine">
              <Button variant="ghost">
                <ClipboardList className="size-4" aria-hidden /> My forms ({digest.mine})
              </Button>
            </Link>
            <Button
              variant="primary"
              onClick={() =>
                setBuilding({ id: `sv-new-${forms.length + 1}`, title: '', titleBn: '', purpose: '', audience: '', anonymity: 'anonymous', status: 'draft', version: 1, opensOn: day, closesOn: day.slice(0, 4) + '-12-31', createdBy: 'R. Howlader', invited: 0, responseCount: 0, questions: [] })
              }
            >
              <Plus className="size-4" aria-hidden /> New form
            </Button>
          </>
        }
        waiting={digest.drafts ? `${digest.drafts} form(s) are drafts. Nobody can answer a draft, and the response rate on the register is only meaningful for the forms that were actually handed out.` : undefined}
      />

      <AdminSiblings screenId="survey-forms" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Forms" value={String(digest.forms)} definition="Every form the hospital holds, open or not. A closed form keeps its answers readable against the version they were given under." asOf={day} />
        <KpiTile label="Open" value={String(digest.open)} definition="Published and still collecting. Publication is online-only in the contract: the portal and the counters ask the same questions, so the form has to be one record in one place." asOf={day} />
        <KpiTile label="Answers" value={String(digest.answers)} definition="Responses on the register. Appended and never edited: what somebody said at a time is the only thing a survey has." asOf={day} footnote={`of ${digest.invited} invited`} />
        <KpiTile label="Response rate" value={`${Math.round(digest.responseRate * 100)}%`} definition="Answered of invited, across every form. It sits beside the score on each row deliberately: a satisfaction figure from a tenth of the invitations is not a figure anybody should act on." asOf={day} />
        <KpiTile label="Anonymous" value={String(digest.anonymous)} definition="Forms that promise no names. The builder refuses one that asks who you are — the promise was the reason somebody answered honestly." asOf={day} />
        <KpiTile label="Mine to answer" value={String(digest.mine)} definition="Assignments waiting on me. Every assignment is a row rather than a broadcast, so the person who asked is known and the register can show who has not answered." asOf={day} />
      </div>

      <Panel
        title="The register"
        actions={
          <Segmented
            label="Which forms"
            name="form-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'Everything', label: `Everything (${digest.forms})` },
              { value: 'Open', label: `Open (${digest.open})` },
              { value: 'Drafts', label: `Drafts (${digest.drafts})` },
              { value: 'Closed', label: `Closed (${digest.closed})` },
              { value: 'Anonymous', label: `Anonymous (${digest.anonymous})` },
            ]}
          />
        }
      >
        <ListView
          id="survey-forms"
          caption="Survey forms"
          rows={rows}
          rowId={(row) => row.id}
          onRowClick={(row) => setReading(row)}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Title or author' }}
          rowActions={(row) => [
            { label: 'Edit the form', onSelect: () => openBuilder(row) },
            ...(row.status !== 'closed' ? [{ label: 'Close it, with a reason', onSelect: () => { setClosing(row); setCloseReason(''); } }] : []),
            { label: 'Assign it to somebody', onSelect: () => { setAssigning(row); setAssignTo('EMP-1042'); setDueAt(day); } },
            { label: 'What the answers say', onSelect: () => setReading(row) },
          ]}
          columns={[
            {
              key: 'form',
              header: 'Form',
              render: (row) => (
                <span className="block">
                  <span className="block font-medium">{row.title}</span>
                  <span lang="bn" className="block text-sm text-text-secondary">{row.titleBn}</span>
                  <span className="block text-xs text-text-tertiary">
                    {row.questions.length} questions · about {minutesToAnswer(row).toFixed(1)} min · {row.anonymity === 'anonymous' ? 'no names' : 'named'}
                  </span>
                </span>
              ),
            },
            { key: 'audience', header: 'Who answers it', width: '13rem', hideBelow: 'lg', render: (row) => <span className="line-clamp-2 text-text-secondary">{row.audience}</span> },
            { key: 'status', header: 'State', width: '8rem', render: (row) => <span className={cx('font-medium', STATUS_TONE[row.status])} title={row.closedReason}>{STATUS_LABEL[row.status]}</span> },
            { key: 'version', header: 'Version', width: '7rem', hideBelow: 'lg', render: (row) => <span className="font-numeric">v{row.version}</span> },
            { key: 'closes', header: 'Closes', width: '9rem', render: (row) => <span className={cx('font-numeric', row.closesOn < day && row.status !== 'closed' ? 'text-safety-warning' : '')}>{row.closesOn}</span> },
            {
              key: 'answers',
              header: 'Answers / invited',
              width: '10rem',
              render: (row) => (
                <span className="block">
                  <span className="font-numeric">
                    {row.responseCount} / {row.invited}
                  </span>
                  <span className={cx('block text-xs', row.invited && row.responseCount / row.invited < 0.4 ? 'text-safety-warning' : 'text-text-tertiary')}>
                    {row.invited ? `${Math.round((row.responseCount / row.invited) * 100)}% answered` : 'not handed out yet'}
                  </span>
                </span>
              ),
            },
            { key: 'rate', header: 'Average where it means something', hideBelow: 'xl', render: (row) => { const s = surveyStats(row, SURVEY_RESPONSES); return s.average === null ? <span className="text-text-tertiary">no scale questions</span> : <span className="font-numeric">{s.average.toFixed(1)} / 5{s.worst ? ` · weakest: ${s.worst.question.text.slice(0, 42)}…` : ''}</span>; } },
          ]}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="The questions the builder refuses" actions={<span className="flex items-center gap-1 text-xs text-text-secondary"><ShieldQuestion className="size-3.5" aria-hidden /> {SURVEY_RULES.length} rules</span>}>
          <ul className="space-y-2 text-xs text-text-secondary">
            {SURVEY_RULES.map((rule) => (
              <li key={rule.title}>
                <span className="font-medium text-text-primary">{rule.title}</span> — {rule.because}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="The limits, and why they are numbers rather than taste">
          <ul className="space-y-2 text-sm text-text-secondary">
            <li>
              <span className="font-medium text-text-primary">At most {MAX_QUESTIONS} questions.</span> Past that the answers to the last five are given to make the
              form stop, which is worse than not asking them.
            </li>
            <li>
              <span className="font-medium text-text-primary">At most {MAX_TEXT_QUESTIONS} written answers.</span> The first is written carefully; the second is
              written to finish. Somebody then has to read both.
            </li>
            <li>
              <span className="font-medium text-text-primary">Under {MAX_MINUTES} minutes.</span> {minutesToAnswer({ questions: [] }) === 0 ? 'A scale or a yes/no costs seconds; a written answer costs a minute.' : ''} The screen
              shows the estimate while the form is being written, because the author is the worst judge of how long their own questions take.
            </li>
            <li>
              <span className="font-medium text-text-primary">Both languages, always.</span> The Bangla is what is asked; the English is what the report reads.
            </li>
          </ul>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-text-tertiary">
            <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> A form takes {Math.round(minutesToAnswer({ questions: forms.flatMap((f) => f.questions) }) * 60)} seconds of questions in
            total across the register, which is the honest cost of asking all of it.
          </p>
        </Panel>
      </div>

      <Panel title="What this screen is waiting for">
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
          {SURVEY_WAITING.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Panel>

      {/* ------------------------------------------------------------------- the builder */}
      <Sheet
        open={Boolean(building)}
        onClose={() => setBuilding(null)}
        title={building ? building.title || 'New form' : 'Form'}
        description={building ? `${building.questions.length} questions · about ${minutesToAnswer(building).toFixed(1)} minutes · v${building.version}${building.invited ? ` · ${building.invited} invited under this version` : ''}` : undefined}
        width="xl"
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {verdict?.ok ? 'The checks pass. Publishing puts the same questions in front of everybody, so it happens in one place.' : `${verdict?.reasons.length ?? 0} thing(s) to fix before this can be published.`}
            </span>
            <Button variant="ghost" onClick={() => saveForm(false)} disabled={!building}>
              Save as a draft
            </Button>
            <Button variant="primary" onClick={() => saveForm(true)} disabled={!verdict?.ok}>
              <Send className="size-4" aria-hidden /> Publish and open it
            </Button>
          </>
        }
      >
        {building && verdict && (
          <div className="space-y-3">
            {!verdict.ok && (
              <SafetyBanner severity="critical" title={`This form cannot be published — ${verdict.reasons[0].code}`}>
                <ul className="list-disc space-y-1 pl-5">
                  {verdict.reasons.map((reason) => (
                    <li key={reason.code}>{reason.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}
            {verdict.warnings.length > 0 && (
              <SafetyBanner severity="info" title="Worth knowing">
                <ul className="list-disc space-y-1 pl-5">
                  {verdict.warnings.map((warning) => (
                    <li key={warning.code}>{warning.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}

            <FieldSection title="The form" description="What it is for, who receives it, and what happens to the answers.">
              <TextField label="Title" name="title" value={building.title} onChange={(e) => setBuilding({ ...building, title: e.target.value })} required />
              <TextField label="Title — Bangla" name="titleBn" value={building.titleBn} onChange={(e) => setBuilding({ ...building, titleBn: e.target.value })} lang="bn" required />
              <SelectField
                label="Who answers it"
                name="audience"
                value={building.audience}
                onChange={(e) => setBuilding({ ...building, audience: e.target.value })}
                options={[
                  { value: '', label: 'Choose…' },
                  { value: 'Outdoor patients, at the token counter', label: 'Outdoor patients, at the token counter' },
                  { value: 'Inpatients, at discharge', label: 'Inpatients, at discharge' },
                  { value: 'Clinical staff, this branch', label: 'Clinical staff, this branch' },
                  { value: 'Patients and attendants, in the portal', label: 'Patients and attendants, in the portal' },
                ]}
                hint="Naming the counter a form is handed over at is what makes the response rate mean something."
              />
              <SelectField
                label="Names"
                name="anonymity"
                value={building.anonymity}
                onChange={(e) => setBuilding({ ...building, anonymity: e.target.value as SurveyForm['anonymity'] })}
                options={[
                  { value: 'anonymous', label: 'Nobody’s name is recorded' },
                  { value: 'named', label: 'The answer is linked to the person' },
                ]}
                hint="The promise is made on the first screen and it has to hold to the last question. An anonymous form that asks who you are is refused."
              />
              <TextField label="Closes" name="closesOn" value={building.closesOn} onChange={(e) => setBuilding({ ...building, closesOn: e.target.value })} hint="YYYY-MM-DD. A form closes rather than being deleted: the answers stay readable." />
              <div className="md:col-span-2 xl:col-span-3">
                <TextAreaField
                  label="What the answers are used for"
                  name="purpose"
                  value={building.purpose}
                  onChange={(e) => setBuilding({ ...building, purpose: e.target.value })}
                  rows={3}
                  hint="Required, in words the person answering can read. A form without a stated purpose is one people answer badly, and rightly."
                  required
                />
              </div>
            </FieldSection>

            <FieldSection title="The questions" description={`${building.questions.length} of ${MAX_QUESTIONS}. Both languages are asked of the author: the Bangla is read by the person answering.`}>
              <div className="md:col-span-2 xl:col-span-3 space-y-2">
                {building.questions.map((question, index) => (
                  <div key={question.id} className="rounded-md border border-border-subtle p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-numeric text-xs text-text-tertiary">{index + 1}</span>
                      <span className="rounded-full border border-border-subtle px-1.5 text-xs text-text-secondary">{QUESTION_LIBRARY.find((kind) => kind.type === question.type)?.label}</span>
                      <span className="font-numeric text-xs text-text-tertiary">{question.id}</span>
                      {question.type === 'text' ? <span className="text-xs text-text-tertiary">about a minute to answer</span> : null}
                      <Button variant="ghost" className="ml-auto" onClick={() => setBuilding({ ...building, questions: building.questions.filter((q) => q.id !== question.id) })}>
                        <Trash2 className="size-3.5" aria-hidden /> Remove
                      </Button>
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <TextField label="Question" name={`q-${question.id}-en`} value={question.text} onChange={(e) => patchQuestion(question.id, { text: e.target.value })} required />
                      <TextField label="Question — Bangla" name={`q-${question.id}-bn`} value={question.textBn ?? ''} onChange={(e) => patchQuestion(question.id, { textBn: e.target.value })} lang="bn" required />
                      {question.type === 'scale' && (
                        <>
                          <SelectField label="Scale points" name={`q-${question.id}-max`} value={String(question.scaleMax ?? 5)} onChange={(e) => patchQuestion(question.id, { scaleMax: Number(e.target.value) })} options={[3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `1 to ${n}` }))} />
                          <TextField label="What 1 means" name={`q-${question.id}-low`} value={question.scaleLowLabel ?? ''} onChange={(e) => patchQuestion(question.id, { scaleLowLabel: e.target.value })} hint="Both ends are labelled: without words, “3” is what somebody picks when they cannot tell what was asked." />
                          <TextField label={`What ${question.scaleMax ?? 5} means`} name={`q-${question.id}-high`} value={question.scaleHighLabel ?? ''} onChange={(e) => patchQuestion(question.id, { scaleHighLabel: e.target.value })} />
                        </>
                      )}
                      {question.type === 'choice' && (
                        <div className="md:col-span-2">
                          <TextField
                            label="Options, separated by a comma"
                            name={`q-${question.id}-choices`}
                            value={(question.choices ?? []).join(', ')}
                            onChange={(e) => patchQuestion(question.id, { choices: e.target.value.split(',').map((choice) => choice.trim()).filter(Boolean) })}
                            hint="At least two, and include a way out such as “somewhere else” — without one, the answers pile onto the last option."
                          />
                        </div>
                      )}
                      <SelectField
                        label="Answer required?"
                        name={`q-${question.id}-req`}
                        value={question.required ? 'required' : 'optional'}
                        onChange={(e) => patchQuestion(question.id, { required: e.target.value === 'required' })}
                        options={[
                          { value: 'required', label: 'Required — the form will not submit without it' },
                          { value: 'optional', label: 'Optional — a missing answer is information too' },
                        ]}
                      />
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {QUESTION_LIBRARY.map((kind) => (
                    <Button key={kind.type} variant="secondary" onClick={() => addQuestion(kind.type)}>
                      <Plus className="size-3.5" aria-hidden /> {kind.label}
                    </Button>
                  ))}
                </div>
                <ul className="space-y-1 text-xs text-text-tertiary">
                  {QUESTION_LIBRARY.map((kind) => (
                    <li key={kind.type}>
                      <span className="font-medium text-text-secondary">{kind.label}</span> — {kind.note}
                    </li>
                  ))}
                </ul>
              </div>
            </FieldSection>
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------------- closing */}
      <Sheet
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        title={closing ? `Close “${closing.title}”` : 'Close the form'}
        description="A form is closed, never deleted: the answers stay readable against the version they were given under."
        width="md"
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">{closeVerdict?.ok ? 'The reason is recorded with the form.' : 'A reason of at least twenty characters is required.'}</span>
            <Button variant="ghost" onClick={() => setClosing(null)}>
              Keep it open
            </Button>
            <Button variant="primary" onClick={close} disabled={!closeVerdict?.ok}>
              Close the form
            </Button>
          </>
        }
      >
        {closing && closeVerdict && (
          <div className="space-y-3">
            {!closeVerdict.ok && (
              <SafetyBanner severity="critical" title="This form cannot be closed yet">
                <ul className="list-disc space-y-1 pl-5">
                  {closeVerdict.reasons.map((reason) => (
                    <li key={reason.code}>{reason.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}
            {closeVerdict.warnings.length > 0 && (
              <SafetyBanner severity="warning" title="Before it closes">
                <ul className="list-disc space-y-1 pl-5">
                  {closeVerdict.warnings.map((warning) => (
                    <li key={warning.code}>{warning.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}
            <FieldSection title="Why it is closing">
              <div className="md:col-span-2">
                <TextAreaField
                  label="The reason"
                  name="close-reason"
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  rows={3}
                  hint="The round is over, the session ended, a question was wrong. A form that just stops leaves the next person to guess — and leaves the answers already given without an explanation."
                  required
                />
              </div>
            </FieldSection>
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------------- assigning */}
      <Sheet
        open={Boolean(assigning)}
        onClose={() => setAssigning(null)}
        title={assigning ? `Assign “${assigning.title}”` : 'Assign'}
        description="An assignment is a row with a name on it, not a broadcast: the person can see who asked, and the register shows who has not answered."
        width="md"
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">{assigning?.anonymity === 'anonymous' ? 'The form promises no names, and the assignment is the hospital’s own record of who was asked.' : 'The answers will be linked to the person.'}</span>
            <Button variant="ghost" onClick={() => setAssigning(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={assign}>
              Assign it
            </Button>
          </>
        }
      >
        {assigning && (
          <FieldSection title="Who, and by when">
            <SelectField
              label="Who answers"
              name="assignee"
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              options={Array.from(new Set(SURVEY_ASSIGNMENTS.map((assignment) => `${assignment.assigneeCode}|${assignment.assigneeName}`))).map((pair) => {
                const [code, name] = pair.split('|');
                return { value: code, label: `${name} (${code})` };
              })}
              hint="The list is the staff register: an assignment to somebody who does not work here is a form nobody answers and everybody chases."
            />
            <TextField label="Due" name="due-at" value={dueAt} onChange={(e) => setDueAt(e.target.value)} hint="YYYY-MM-DD. An assignment with no date is one that stays open until somebody notices." />
          </FieldSection>
        )}
      </Sheet>

      {/* ------------------------------------------------------------------- the answers */}
      <Sheet
        open={Boolean(reading)}
        onClose={() => setReading(null)}
        title={reading ? `What “${reading.title}” says` : 'Answers'}
        description={reading ? `${reading.responseCount} answer(s) of ${reading.invited} invited · ${Math.round((reading.responseCount / Math.max(1, reading.invited)) * 100)}% answered · version ${reading.version}` : undefined}
        width="lg"
        footer={
          <Button variant="ghost" onClick={() => setReading(null)}>
            Close
          </Button>
        }
      >
        {reading && stats && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md border border-border-subtle px-2 py-1.5">
                <p className="text-xs text-text-tertiary">Answers</p>
                <p className="font-numeric text-base font-medium text-text-primary">{stats.responses}</p>
              </div>
              <div className="rounded-md border border-border-subtle px-2 py-1.5">
                <p className="text-xs text-text-tertiary">Response rate</p>
                <p className="font-numeric text-base font-medium text-text-primary">{Math.round(stats.responseRate * 100)}%</p>
              </div>
              <div className="rounded-md border border-border-subtle px-2 py-1.5">
                <p className="text-xs text-text-tertiary">Completion</p>
                <p className="font-numeric text-base font-medium text-text-primary">{Math.round(stats.completion * 100)}%</p>
              </div>
              <div className="rounded-md border border-border-subtle px-2 py-1.5">
                <p className="text-xs text-text-tertiary">Written answers</p>
                <p className="font-numeric text-base font-medium text-text-primary">{stats.comments}</p>
              </div>
            </div>

            {stats.responseRate < 0.4 && stats.responses > 0 && (
              <SafetyBanner severity="warning" title="Read this with the rate beside it">
                <p>
                  {stats.responses} answers from {stats.invited} invitations ({Math.round(stats.responseRate * 100)}%). Every figure on this sheet carries that
                  rate, because the people who did not answer are usually the ones with something to say — the patient who waited three hours is often the one who
                  went home without filling anything in.
                </p>
              </SafetyBanner>
            )}

            <ul className="space-y-2">
              {stats.byQuestion.map((stat) => (
                <li key={stat.question.id} className="rounded-md border border-border-subtle p-2">
                  <p className="text-sm font-medium text-text-primary">{stat.question.text}</p>
                  {stat.question.textBn && (
                    <p lang="bn" className="text-sm text-text-secondary">
                      {stat.question.textBn}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-text-secondary">
                    {stat.answered} answered
                    {stat.average !== null ? ` · average ${stat.average.toFixed(1)} of ${stat.question.scaleMax ?? 5}` : ''}
                    {stat.yesShare !== null ? ` · ${Math.round(stat.yesShare * 100)}% said yes` : ''}
                    {stat.question.scaleLowLabel ? ` · 1 = ${stat.question.scaleLowLabel}, ${stat.question.scaleMax ?? 5} = ${stat.question.scaleHighLabel}` : ''}
                  </p>
                  {stat.distribution.length > 1 && (
                    <ul className="mt-1 space-y-0.5">
                      {stat.distribution.slice(0, 6).map((bucket) => (
                        <li key={bucket.value} className="flex items-center gap-2 text-xs">
                          <span className="w-28 shrink-0 truncate text-text-secondary">{bucket.value}</span>
                          <span className="h-2 rounded-sm bg-brand-500" style={{ width: `${Math.round((bucket.count / Math.max(1, stat.answered)) * 180)}px` }} aria-hidden />
                          <span className="font-numeric text-text-tertiary">{bucket.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {stat.comments.length > 0 && (
                    <ul className="mt-1 space-y-1 text-sm text-text-secondary">
                      {stat.comments.slice(0, 3).map((comment, index) => (
                        <li key={index} className="border-l-2 border-border-subtle pl-2">
                          “{comment}”
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            {stats.worst && (
              <p className="text-xs text-text-secondary">
                Weakest question: “{stats.worst.question.text}” at {stats.worst.average.toFixed(1)}. That is the question to write better next round —
                or the ward to ask why it is answered that way, which is the point of running it at all.
              </p>
            )}
            <p className="text-xs text-text-tertiary">
              Arithmetic on the answers as given, with no weighting and no modelling. Anything that needs a statistician is not built here, and the numbers on this
              sheet are the ones a ward manager can check by counting.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
