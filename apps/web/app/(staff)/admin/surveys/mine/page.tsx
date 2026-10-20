'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, cx, useToast } from '@dizi/ui';
import { CalendarClock, CheckCircle2, FileWarning, Send, Users } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  SURVEY_ASSIGNMENTS,
  SURVEY_FORMS,
  SURVEY_RESPONSES,
  SURVEY_WAITING,
  checkAnswers,
  minutesToAnswer,
  surveyStats,
  type SurveyAssignment,
  type SurveyForm,
  type SurveyResponse,
} from '@/lib/surveys';

/* My Survey Forms (P8) — the forms assigned to me, answered at a desk, with the person who asked still known.
 *
 * The answering end is where a survey is won or lost, and there are four rules on this screen:
 *
 *  - **Both languages are offered, and the Bangla is the one that is read.** A form handed over in one language on
 *    a tablet in another collects answers to questions nobody understood.
 *  - **A closed form keeps what you wrote.** The refusal is the contract's `dizi.form-closed`, and the draft stays
 *    on the device with the option to send it as feedback — nobody should lose five minutes of typing because the
 *    round ended at midnight.
 *  - **An anonymous form does not record who answered.** The assignment row shows the form was answered and the
 *    response row carries no author; the two are deliberately not joinable, and the screen says so both before the
 *    first question and after the last one.
 *  - **An answer is appended, never edited.** A correction is a second response with a note, because what somebody
 *    said at a time is the only thing a survey has.
 */

const STATUS_TONE: Record<SurveyAssignment['status'], string> = {
  assigned: 'text-brand-700',
  submitted: 'text-safety-success',
  withdrawn: 'text-text-tertiary',
};

const STATUS_LABEL: Record<SurveyAssignment['status'], string> = {
  assigned: 'To answer',
  submitted: 'Answered',
  withdrawn: 'Withdrawn',
};

/** One answer, as `checkAnswers` and the contract both take it. */
type Answer = { questionId: string; value: string };

export default function MySurveyFormsPage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [assignments, setAssignments] = useState<SurveyAssignment[]>(SURVEY_ASSIGNMENTS);
  const [responses, setResponses] = useState<SurveyResponse[]>(SURVEY_RESPONSES);
  const [view, setView] = useState('Mine, to answer');
  const [answering, setAnswering] = useState<SurveyAssignment | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [draftKept, setDraftKept] = useState(false);
  const [query, setQuery] = useState('');

  const MINE = 'EMP-1042';

  const formOf = (assignment: SurveyAssignment): SurveyForm | undefined => SURVEY_FORMS.find((form) => form.id === assignment.formId);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assignments
      .filter((assignment) =>
        view === 'Mine, to answer'
          ? assignment.assigneeCode === MINE && assignment.status === 'assigned'
          : view === 'Answered'
            ? assignment.status === 'submitted'
            : view === 'Overdue'
              ? assignment.status === 'assigned' && assignment.dueAt < day
              : view === 'Withdrawn'
                ? assignment.status === 'withdrawn'
                : true,
      )
      .filter((assignment) => !q || assignment.assigneeName.toLowerCase().includes(q) || (formOf(assignment)?.title.toLowerCase().includes(q) ?? false))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }, [assignments, view, day, query]);

  const mine = assignments.filter((assignment) => assignment.assigneeCode === MINE);
  const overdue = assignments.filter((assignment) => assignment.status === 'assigned' && assignment.dueAt < day);
  const form = answering ? formOf(answering) : undefined;

  const answerList: Answer[] = useMemo(
    () => Object.entries(answers).filter(([, value]) => value.trim()).map(([questionId, value]) => ({ questionId, value })),
    [answers],
  );

  const verdict = useMemo(() => (form ? checkAnswers(form, answerList, { today: day }) : null), [form, answerList, day]);

  const openAnswering = (assignment: SurveyAssignment) => {
    setAnswering(assignment);
    setAnswers({});
    setNote('');
    setDraftKept(false);
  };

  const submit = () => {
    if (!form || !answering || !verdict) return;
    // The one refusal that keeps the writing: a form that closed under the person answering.
    const closed = verdict.reasons.find((reason) => reason.code === 'dizi.form-closed');
    if (!verdict.ok) {
      if (closed) {
        setDraftKept(true);
        push({
          title: `dizi.form-closed — “${form.title}” closed on ${form.closesOn}`,
          description: 'Nothing you typed has been thrown away: it is held as a draft on this device, and “Send as feedback instead” puts it in front of a person even though it will not be counted in the form’s results.',
          tone: 'critical',
        });
        return;
      }
      push({ title: `The answer is not accepted — ${verdict.reasons[0].code}`, description: verdict.reasons[0].message, tone: 'critical' });
      return;
    }

    const id = `sr-new-${responses.length + 1}`;
    const clock = new Date().toTimeString().slice(0, 5);
    const response: SurveyResponse = {
      id,
      formId: form.id,
      assignmentId: answering.id,
      submittedAt: `${day} ${clock}`,
      channel: 'paper',
      answers: answerList,
      ...(form.anonymity === 'anonymous' ? {} : { respondentCode: MINE }),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    setResponses((list) => [response, ...list]);
    setAssignments((list) => list.map((assignment) => (assignment.id === answering.id ? { ...assignment, status: 'submitted', submittedOn: day, responseId: id } : assignment)));
    const wrote = queueWrite(`Answer “${form.title}” (${form.questions.length} questions)`, {
      id: 'submitSurveyResponse',
      recordId: id,
      fields: {
        response: id,
        form: form.id,
        assignment: answering.id,
        answers: answerList.length,
        anonymity: form.anonymity,
        author: form.anonymity === 'anonymous' ? '' : MINE,
        channel: 'paper',
      },
    });
    setAnswering(null);
    setAnswers({});
    setNote('');
    setDraftKept(false);
    push({
      title: form.anonymity === 'anonymous' ? 'Answer recorded — with no author' : 'Answer recorded',
      description: `Appended and never corrected: a survey answer is what somebody said at a time. ${
        form.anonymity === 'anonymous'
          ? 'The assignment row shows the form was answered and the response row carries no name — the two are not joinable, which is the promise the form makes.'
          : 'Linked to your staff record, because this form is named and you were told so before the first question.'
      }${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  const withdraw = (assignment: SurveyAssignment) => {
    setAssignments((list) =>
      list.map((item) =>
        item.id === assignment.id
          ? { ...item, status: 'withdrawn', reason: 'Withdrawn by the assignee: the form does not apply to this role this quarter.' }
          : item,
      ),
    );
    push({
      title: `${formOf(assignment)?.title ?? assignment.formId} withdrawn`,
      description: 'The withdrawal is a row, not a deletion: the person who assigned it sees why, rather than an assignment that quietly stops being overdue.',
      tone: 'warning',
    });
  };

  const stats = useMemo(() => (form ? surveyStats(form, responses) : null), [form, responses]);
  const myOverdue = overdue.filter((assignment) => assignment.assigneeCode === MINE);

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="my-survey-forms"
        subtitle={`${day} · ${mine.filter((assignment) => assignment.status === 'assigned').length} of mine to answer · ${mine.filter((assignment) => assignment.status === 'submitted').length} answered · ${myOverdue.length} overdue.`}
        actions={
          <>
            <Link href="/admin/surveys">
              <Button variant="ghost">Survey forms</Button>
            </Link>
            <Link href="/admin/messaging">
              <Button variant="ghost">Ask the assigner</Button>
            </Link>
          </>
        }
        waiting={
          myOverdue.length
            ? `${myOverdue.length} of mine is past its due date. The same figure is shown to the person who assigned the form — a quiet assignment is one nobody answers.`
            : undefined
        }
      />

      <AdminSiblings screenId="my-survey-forms" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile
          label="Mine, to answer"
          value={String(mine.filter((assignment) => assignment.status === 'assigned').length)}
          definition="Forms issued to me and not yet answered. Each is a row of its own with a due date, because answering a survey is a task rather than a suggestion."
          asOf={day}
        />
        <KpiTile
          label="Answered"
          value={String(mine.filter((assignment) => assignment.status === 'submitted').length)}
          definition="Submitted, and appended: an answer is what somebody said at a time and the register never corrects it. A mistake is a new response with a note."
          asOf={day}
        />
        <KpiTile
          label="Overdue"
          value={String(myOverdue.length)}
          definition="Past the due date. The same figure is shown to whoever assigned the form, which is what makes a due date mean anything."
          asOf={day}
          {...(myOverdue.length ? { footnote: 'the assigner sees it too' } : {})}
        />
        <KpiTile
          label="Anonymous"
          value={String(mine.filter((assignment) => formOf(assignment)?.anonymity === 'anonymous').length)}
          definition="Forms of mine that record no author. The assignment row shows the form was answered; the response row has no name, and the two are not joined."
          asOf={day}
        />
        <KpiTile
          label="Typical length"
          value={`${Math.round(mine.reduce((total, assignment) => total + minutesToAnswer(formOf(assignment) ?? { questions: [] }), 0) / Math.max(1, mine.length))} min`}
          definition="What answering these costs. The builder refuses a form over five minutes, because the answers past that point are given to make it stop."
          asOf={day}
        />
        <KpiTile
          label="Written answers"
          value={String(stats?.comments ?? 0)}
          definition="Free-text answers in this form's responses. The number that says whether a form is worth running: scale answers alone mean it was filled in rather than answered."
          asOf={day}
        />
      </div>

      {draftKept && (
        <SafetyBanner severity="warning" title="Your answers are kept as a draft">
          <p>
            The form closed while you were answering. Nothing you typed was thrown away — it is held as a draft on this device, and “Send as feedback instead”
            puts it in front of a person even though it will not be counted in the form’s results. This is the one refusal in the module that keeps working for
            the person it refuses: <span className="font-numeric">dizi.form-closed</span> stops the answer set, not the writing.
          </p>
        </SafetyBanner>
      )}

      <Panel
        title="The assignments"
        actions={
          <Segmented
            label="Which assignments"
            name="assignment-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'Mine, to answer', label: `Mine (${mine.filter((assignment) => assignment.status === 'assigned').length})` },
              { value: 'Overdue', label: `Overdue (${myOverdue.length})` },
              { value: 'Answered', label: `Answered (${mine.filter((assignment) => assignment.status === 'submitted').length})` },
              { value: 'Withdrawn', label: `Withdrawn (${mine.filter((assignment) => assignment.status === 'withdrawn').length})` },
              { value: 'Everyone', label: `Everyone (${assignments.length})` },
            ]}
          />
        }
      >
        <ListView
          id="my-survey-assignments"
          caption="Survey assignments"
          rows={rows}
          rowId={(row) => row.id}
          onRowClick={(row) => (row.status === 'assigned' ? openAnswering(row) : undefined)}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Form title or assignee' }}
          rowActions={(row) => [
            ...(row.status === 'assigned' && row.assigneeCode === MINE ? [{ label: 'Answer it', onSelect: () => openAnswering(row) }] : []),
            ...(row.status === 'assigned' && row.assigneeCode === MINE ? [{ label: 'Withdraw, with a reason', onSelect: () => withdraw(row), danger: true }] : []),
            {
              label: 'Who assigned it',
              onSelect: () =>
                push({
                  title: `Assigned by ${row.assignedBy} on ${row.assignedOn}`,
                  description: row.reason ?? 'No note was left with the assignment. The row still says who wrote it and when, which is where a query about it starts.',
                  tone: 'info',
                }),
            },
          ]}
          columns={[
            {
              key: 'form',
              header: 'Form',
              render: (row) => (
                <span className="block">
                  <span className="block">{formOf(row)?.title ?? row.formId}</span>
                  <span className="block text-xs text-text-tertiary">
                    {formOf(row)?.questions.length ?? 0} questions · {formOf(row)?.anonymity === 'anonymous' ? 'anonymous' : 'named'} · v{formOf(row)?.version ?? 1}
                  </span>
                </span>
              ),
            },
            {
              key: 'assignee',
              header: 'Who answers',
              width: '13rem',
              render: (row) => (
                <span className="block">
                  <span className="block">{row.assigneeName}</span>
                  <span className="font-numeric block text-xs text-text-tertiary">{row.assigneeCode}</span>
                </span>
              ),
            },
            { key: 'assignedBy', header: 'Assigned by', width: '11rem', hideBelow: 'lg', render: (row) => row.assignedBy },
            {
              key: 'due',
              header: 'Due',
              width: '8rem',
              render: (row) => <span className={cx('font-numeric', row.status === 'assigned' && row.dueAt < day ? 'font-medium text-safety-critical-text' : '')}>{row.dueAt}</span>,
              sortable: true,
            },
            {
              key: 'status',
              header: 'State',
              width: '8.5rem',
              render: (row) => (
                <span className={cx('font-medium', STATUS_TONE[row.status])} title={row.reason || undefined}>
                  {STATUS_LABEL[row.status]}
                </span>
              ),
            },
            { key: 'submitted', header: 'Answered on', width: '9rem', hideBelow: 'lg', render: (row) => (row.submittedOn ? <span className="font-numeric">{row.submittedOn}</span> : <span className="text-text-tertiary">—</span>) },
            { key: 'reason', header: 'Note on the row', hideBelow: 'xl', render: (row) => <span className="line-clamp-1 text-text-secondary">{row.reason ?? '—'}</span> },
          ]}
        />
      </Panel>

      {stats && form && (
        <Panel title={`What the answers to “${form.title}” say so far`} actions={<span className="text-xs text-text-secondary">{stats.responses} loaded · {form.responseCount} on the register</span>}>
          <p className="text-xs text-text-secondary">
            {stats.average !== null ? `Average ${stats.average.toFixed(1)} across the scale questions. ` : ''}
            {stats.yesShare !== null ? `${Math.round(stats.yesShare * 100)}% answered yes. ` : ''}
            {stats.worst
              ? `Weakest: “${stats.worst.question.text}” at ${stats.worst.average.toFixed(1)} — that is the question the next round should ask better, not the ward that should try harder.`
              : ''}
          </p>
          <p className="mt-1 text-xs text-text-tertiary">
            {stats.invited ? `${stats.responses} of ${form.invited} invited have answered (${Math.round(stats.responseRate * 100)}%). ` : ''}
            Every figure on this panel carries that rate, because the people who did not answer are usually the ones with something to say.
          </p>
        </Panel>
      )}

      <Panel title="What this screen is waiting for">
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
          {SURVEY_WAITING.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Panel>

      <Sheet
        open={Boolean(answering)}
        onClose={() => setAnswering(null)}
        title={form ? form.title : 'Answer'}
        description={form?.purpose}
        width="lg"
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {verdict && !verdict.ok
                ? `${verdict.reasons.length} thing(s) to answer before this can be submitted${draftKept ? ' — the draft is kept in the meantime.' : '.'}`
                : `${answerList.length} of ${form?.questions.filter((question) => question.required).length ?? 0} required question(s) answered.`}
            </span>
            <Button variant="ghost" onClick={() => setAnswering(null)}>
              Keep it for now
            </Button>
            <Button variant="primary" onClick={submit} disabled={!verdict?.ok && !verdict?.reasons.some((reason) => reason.code === 'dizi.form-closed')}>
              <Send className="size-4" aria-hidden /> {draftKept ? 'Send as feedback instead' : 'Submit the answers'}
            </Button>
          </>
        }
      >
        {form && verdict && (
          <div className="space-y-3">
            {!verdict.ok && (
              <SafetyBanner
                severity={verdict.reasons.some((reason) => reason.code === 'dizi.form-closed') ? 'warning' : 'critical'}
                title={verdict.reasons.some((reason) => reason.code === 'dizi.form-closed') ? 'This form has closed' : `The answer is not accepted yet — ${verdict.reasons[0].code}`}
              >
                <ul className="list-disc space-y-1 pl-5">
                  {verdict.reasons.map((reason) => (
                    <li key={reason.code}>{reason.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}
            {verdict.ok && verdict.warnings.length > 0 && (
              <SafetyBanner severity="info" title="Worth a second look">
                <ul className="list-disc space-y-1 pl-5">
                  {verdict.warnings.map((warning) => (
                    <li key={warning.code}>{warning.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}

            <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-text-secondary">
              <p>
                {form.anonymity === 'anonymous' ? (
                  <span className="flex items-start gap-1.5">
                    <FileWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Anonymous: nobody — not the ward manager, not the HR file — can see who wrote
                    this. That is why no question on it asks who you are.
                  </span>
                ) : (
                  <span className="flex items-start gap-1.5">
                    <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Named: your answers are linked to your staff record, and you were told that before the
                    first question.
                  </span>
                )}
              </p>
              <p className="mt-1 flex items-center gap-1">
                <CalendarClock className="size-3.5" aria-hidden /> {form.opensOn} → {form.closesOn} · about {minutesToAnswer(form).toFixed(0)} minutes to answer ·
                version {form.version}.
              </p>
            </div>

            <FieldSection title="The questions" description="The Bangla is what the person answering reads; the English beneath it is for whoever is holding the tablet.">
              <div className="md:col-span-2 xl:col-span-3 space-y-3">
                {form.questions.map((question, index) => (
                  <div key={question.id} className="rounded-md border border-border-subtle px-3 py-2">
                    <p className="text-sm font-medium text-text-primary">
                      <span className="font-numeric mr-1 text-xs text-text-tertiary">{index + 1}</span>
                      {question.text}
                      {question.required && <span className="ml-1 text-xs text-text-tertiary">required</span>}
                    </p>
                    {question.textBn && (
                      <p lang="bn" className="text-sm text-text-secondary">
                        {question.textBn}
                      </p>
                    )}
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {question.type === 'text' && (
                        <TextAreaField
                          label="Answer in your own words"
                          name={`a-${question.id}`}
                          value={answers[question.id] ?? ''}
                          onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                          rows={3}
                          hint={question.required ? 'Required for this form.' : 'Optional — a missing answer is information too.'}
                        />
                      )}
                      {question.type === 'yesno' && (
                        <SelectField
                          label="Answer"
                          name={`a-${question.id}`}
                          value={answers[question.id] ?? ''}
                          onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                          options={[
                            { value: '', label: 'Choose…' },
                            { value: 'Yes', label: 'হ্যাঁ / Yes' },
                            { value: 'No', label: 'না / No' },
                          ]}
                          required={question.required}
                        />
                      )}
                      {question.type === 'choice' && (
                        <SelectField
                          label="Answer"
                          name={`a-${question.id}`}
                          value={answers[question.id] ?? ''}
                          onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                          options={[{ value: '', label: 'Choose…' }, ...(question.choices ?? []).map((choice) => ({ value: choice, label: choice }))]}
                          required={question.required}
                        />
                      )}
                      {question.type === 'scale' && (
                        <div>
                          <SelectField
                            label={`Answer, 1 to ${question.scaleMax ?? 5}`}
                            name={`a-${question.id}`}
                            value={answers[question.id] ?? ''}
                            onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                            options={[{ value: '', label: 'Choose…' }, ...Array.from({ length: question.scaleMax ?? 5 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]}
                            hint={`1 = ${question.scaleLowLabel || '—'} · ${question.scaleMax ?? 5} = ${question.scaleHighLabel || '—'}`}
                          />
                          <p className="mt-1 text-xs text-text-tertiary">
                            1 = {question.scaleLowLabel} · {question.scaleMax ?? 5} = {question.scaleHighLabel}. Both ends are labelled on purpose: a bare number
                            means different things to different people, and “3” is what somebody answers when they cannot tell what was asked.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </FieldSection>

            <FieldSection title="Anything else" description="Kept with the answers. It is also what survives when a form closes mid-answer — the draft is sent as feedback instead.">
              <div className="md:col-span-2 xl:col-span-3">
                <TextAreaField
                  label="Note"
                  name="note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  hint={form.anonymity === 'anonymous' ? 'Do not name a patient here: a note naming somebody ends the anonymity the answers were given under.' : 'Optional, and read by whoever assigned the form.'}
                />
              </div>
            </FieldSection>

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-center gap-1 text-xs font-medium text-text-primary">
                <CheckCircle2 className="size-3.5" aria-hidden /> What happens to this when you press submit
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-secondary">
                <li>The answers are appended to the register and never edited: a correction is a second response with a note saying what changed.</li>
                <li>
                  {form.anonymity === 'anonymous'
                    ? 'The response carries no author. The assignment row records that the form was answered — and the two records are not joinable, on purpose.'
                    : 'The response is linked to your staff record, because the form is named and you were told so.'}
                </li>
                <li>If the form closes before the queue drains, the answer is kept as a draft and nothing typed is lost.</li>
                <li>
                  {form.responseCount} people have answered this version so far, and free-text answers are read by a person{form.questions.some((question) => question.type === 'text') ? '' : ' — this version has none'}.
                </li>
              </ul>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
