/* ----------------------------------------------------------------------------------------------------
 * Surveys (P8) — the hospital asking, and somebody answering.
 *
 * A survey is the cheapest way a hospital can hear something it did not ask for, and the easiest way to waste
 * everybody's time. Four rules decide this module, and each of them comes from a survey that was run badly:
 *
 *  1. **A form is written once and answered many times.** The form is versioned; editing a question after answers
 *     exist changes what the answers meant, so the check refuses it and makes the author start a new version. That is
 *     the whole reason a survey has a version number rather than a save button.
 *  2. **An answer is appended and never edited.** What somebody said at a time is the only thing a survey has. A
 *     correction is a second response with a note, and the register keeps both.
 *  3. **Anonymity is a promise, not a setting.** An anonymous form that asks who you are is not anonymous, and the
 *     check refuses it outright — the promise is made on the first screen and it has to hold to the last question.
 *  4. **A form nobody answers is a finding.** The screen shows the response rate beside the score, because a 71%
 *     satisfaction score from nine replies out of four hundred is not a number anybody should act on.
 *
 * Preview: the forms, the assignments and the responses are seeded, and the two screens share them, so the count the
 * author sees on the form is the count the person answering it produces.
 */

export type QuestionType = 'scale' | 'choice' | 'text' | 'yesno';
export type FormStatus = 'draft' | 'open' | 'closed';
export type Anonymity = 'named' | 'anonymous';

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  /** Bangla, because the form is answered in Bangla by default. */
  textBn?: string;
  required: boolean;
  /** Scale: how many points, and what the two ends mean. A number without ends is answered at random. */
  scaleMax?: number;
  scaleLowLabel?: string;
  scaleHighLabel?: string;
  choices?: string[];
}

export interface SurveyForm {
  id: string;
  title: string;
  titleBn: string;
  purpose: string;
  audience: string;
  anonymity: Anonymity;
  status: FormStatus;
  version: number;
  opensOn: string;
  closesOn: string;
  createdBy: string;
  /** How many assignments were sent and how many came back. The rate beside the score, always. */
  invited: number;
  responseCount: number;
  questions: Question[];
  /** Set when a form was closed early, with the reason: a form that just stops is a form nobody explains. */
  closedReason?: string;
}

const q = (id: string, type: QuestionType, text: string, textBn: string, required = true, extra: Partial<Question> = {}): Question => ({ id, type, text, textBn, required, ...extra });

export const SURVEY_FORMS: SurveyForm[] = [
  {
    id: 'sv-opd',
    title: 'Outdoor clinic — how was your visit today?',
    titleBn: 'বহির্বিভাগ — আজকের ভিজিট কেমন হলো?',
    purpose: 'Written for the patient or the person who came with them, handed over at the token counter and offered in the portal. Answers are read weekly by the front office and monthly by the medical director.',
    audience: 'Outdoor patients, at the counter or in the portal',
    anonymity: 'anonymous',
    status: 'open',
    version: 3,
    opensOn: '2026-07-01',
    closesOn: '2026-12-31',
    createdBy: 'M. Hoque',
    invited: 412,
    responseCount: 128,
    questions: [
      q('q1', 'scale', 'How long did you wait before you were seen?', 'দেখা হওয়ার আগে কতক্ষণ অপেক্ষা করলেন?', true, { scaleMax: 5, scaleLowLabel: 'Very short', scaleHighLabel: 'Very long' }),
      q('q2', 'scale', 'How clearly did the doctor explain what is wrong?', 'ডাক্তার সমস্যাটি কতটা পরিষ্কারভাবে বুঝিয়ে বলেছেন?', true, { scaleMax: 5, scaleLowLabel: 'Not at all', scaleHighLabel: 'Very clearly' }),
      q('q3', 'yesno', 'Did you have to ask twice for anything?', 'কোনো কিছু দুইবার চাইতে হয়েছে কি?', true),
      q('q4', 'choice', 'Where did you wait the longest?', 'সবচেয়ে বেশি অপেক্ষা কোথায় করতে হয়েছে?', false, { choices: ['Registration', 'Outside the doctor’s room', 'Laboratory', 'Pharmacy', 'Billing'] }),
      q('q5', 'text', 'Anything you would change?', 'কী বদলালে ভালো হতো?', false),
    ],
  },
  {
    id: 'sv-ipd',
    title: 'Going home — the ward you were in',
    titleBn: 'ছুটি — যে ওয়ার্ডে ছিলেন',
    purpose: 'Given on paper at discharge, and read by the ward manager of the ward named in the first question. The results for each ward are sent to that ward, not only to management.',
    audience: 'Inpatients, at discharge',
    anonymity: 'named',
    status: 'open',
    version: 2,
    opensOn: '2026-06-01',
    closesOn: '2026-12-31',
    createdBy: 'R. Howlader',
    invited: 96,
    responseCount: 64,
    questions: [
      q('q1', 'choice', 'Which ward were you in?', 'আপনি কোন ওয়ার্ডে ছিলেন?', true, { choices: ['Ward 2 (medicine)', 'Ward 3 (surgery)', 'Ward 4 (obstetrics)', 'HDU'] }),
      q('q2', 'scale', 'Did the nurses answer when you called?', 'ডাকলে নার্সরা সাড়া দিতেন?', true, { scaleMax: 5, scaleLowLabel: 'Never', scaleHighLabel: 'Always' }),
      q('q3', 'scale', 'Was the ward quiet enough at night?', 'রাতে ওয়ার্ড যথেষ্ট শান্ত ছিল?', true, { scaleMax: 5, scaleLowLabel: 'Not at all', scaleHighLabel: 'Very quiet' }),
      q('q4', 'yesno', 'Did somebody explain your medicine before you left?', 'যাওয়ার আগে কেউ আপনার ঔষধ বুঝিয়ে দিয়েছে?', true),
      q('q5', 'text', 'What should we have done differently?', 'আমরা কী অন্যভাবে করতে পারতাম?', false),
    ],
  },
  {
    id: 'sv-safety',
    title: 'Staff safety culture — October',
    titleBn: 'কর্মীদের নিরাপত্তা সংস্কৃতি — অক্টোবর',
    purpose: 'Anonymous, for clinical staff. The Association of American Medical Colleges style of question was deliberately not copied; these are the five things the infection-control committee can act on. Responses are seen as a set.',
    audience: 'Clinical staff, this branch',
    anonymity: 'anonymous',
    status: 'open',
    version: 4,
    opensOn: '2026-10-01',
    closesOn: '2026-10-31',
    createdBy: 'M. Ali',
    invited: 214,
    responseCount: 87,
    questions: [
      q('q1', 'scale', 'If you saw something unsafe, could you say so without it coming back to you?', 'অনিরাপদ কিছু দেখলে, সেটি না বলে কি আপনার বিরুদ্ধে কিছু যাবে?', true, { scaleMax: 5, scaleLowLabel: 'Never', scaleHighLabel: 'Always' }),
      q('q2', 'yesno', 'In the last month, did you see a hand-hygiene moment missed?', 'গত মাসে হাত ধোয়ার কোনো সময় বাদ পড়তে দেখেছেন?', true),
      q('q3', 'choice', 'What is the biggest obstacle to doing it right?', 'ঠিকভাবে করার সবচেয়ে বড় বাধা কী?', true, { choices: ['Time', 'Staff shortage', 'Equipment not available', 'Nobody else does it', 'I have not been trained'] }),
      q('q4', 'text', 'One thing that would make the ward safer this month', 'এই মাসে ওয়ার্ডকে নিরাপদ করতে একটি জিনিস', false),
    ],
  },
  {
    id: 'sv-training',
    title: 'Training feedback — neonatal resuscitation',
    titleBn: 'প্রশিক্ষণের মতামত — নবজাতকের পুনরুজ্জীবন',
    purpose: 'Short, at the end of a session, while people are still in the room. The trainer sees the answers the same week; anything under a three is read with the trainer rather than sent to them.',
    audience: 'The 24 who attended the session',
    anonymity: 'named',
    status: 'closed',
    version: 1,
    opensOn: '2026-09-20',
    closesOn: '2026-09-21',
    createdBy: 'M. Ali',
    invited: 24,
    responseCount: 18,
    questions: [
      q('q1', 'scale', 'How useful was the practical part?', 'ব্যবহারিক অংশ কতটা কাজে দিয়েছে?', true, { scaleMax: 5, scaleLowLabel: 'Not useful', scaleHighLabel: 'Very useful' }),
      q('q2', 'yesno', 'Would you come to a second session on this?', 'এ নিয়ে দ্বিতীয় সেশন হলে আসবেন?', true),
      q('q3', 'text', 'What was missing?', 'কী বাদ ছিল?', false),
    ],
    closedReason: 'The session ran on 20 September; the form closed the next evening so the trainer could read the answers before the follow-up.',
  },
  {
    id: 'sv-cleanliness',
    title: 'Cleanliness — wards and toilets',
    titleBn: 'পরিচ্ছন্নতা — ওয়ার্ড ও টয়লেট',
    purpose: 'Runs twice a year. This version was withdrawn because the question about staff was answered with names, and the promise on the first line could not be kept.',
    audience: 'Patients and attendants',
    anonymity: 'anonymous',
    status: 'closed',
    version: 2,
    opensOn: '2026-04-01',
    closesOn: '2026-05-31',
    createdBy: 'S. Nahar',
    invited: 240,
    responseCount: 151,
    questions: [
      q('q1', 'scale', 'How clean was the ward this morning?', 'আজ সকালে ওয়ার্ড কতটা পরিষ্কার ছিল?', true, { scaleMax: 5, scaleLowLabel: 'Not clean', scaleHighLabel: 'Very clean' }),
      q('q2', 'yesno', 'Were the toilets clean when you used them?', 'আপনি ব্যবহারের সময় টয়লেট পরিষ্কার ছিল?', true),
      q('q3', 'text', 'Anything you saw that was not clean', 'অপরিষ্কার কিছু দেখেছেন কি?', false),
    ],
    closedReason: 'Closed early after eleven answers named a member of staff. Nobody had been told their name would be attached to a complaint in a survey, so the round was stopped, the answers read, and the next version asks which shift rather than who.',
  },
  {
    id: 'sv-rights',
    title: 'Do you know what you are paying for?',
    titleBn: 'আপনি জানেন কোনটার টাকা দিচ্ছেন?',
    purpose: 'Draft. Asked before it goes out: does a patient know what an estimate is, and that asking for one is not rude?',
    audience: 'Inpatients and their families',
    anonymity: 'anonymous',
    status: 'draft',
    version: 1,
    opensOn: '2026-11-01',
    closesOn: '2026-12-31',
    createdBy: 'A. Chowdhury',
    invited: 0,
    responseCount: 0,
    questions: [
      q('q1', 'yesno', 'Did somebody give you an estimate before treatment started?', 'চিকিৎসা শুরুর আগে কেউ আনুমানিক খরচ বলেছে?', true),
      q('q2', 'scale', 'How clear was the bill when you saw it?', 'বিল দেখে কতটা পরিষ্কার বুঝেছেন?', true, { scaleMax: 5, scaleLowLabel: 'Not clear', scaleHighLabel: 'Very clear' }),
      q('q3', 'text', 'Did you feel able to ask about the cost?', 'খরচ নিয়ে জিজ্ঞেস করার সাহস পেয়েছেন?', true),
    ],
  },
];

export const formById = (id: string): SurveyForm | undefined => SURVEY_FORMS.find((f) => f.id === id);

/* ------------------------------------------------------------------ assignments and answers */

export interface SurveyAssignment {
  id: string;
  formId: string;
  assigneeCode: string;
  assigneeName: string;
  assignedBy: string;
  assignedOn: string;
  dueAt: string;
  status: 'assigned' | 'submitted' | 'withdrawn';
  submittedOn?: string;
  responseId?: string;
  reason?: string;
}

export const SURVEY_ASSIGNMENTS: SurveyAssignment[] = [
  { id: 'sa-1', formId: 'sv-safety', assigneeCode: 'EMP-1042', assigneeName: 'R. Howlader', assignedBy: 'M. Ali', assignedOn: '2026-10-01', dueAt: '2026-10-31', status: 'assigned' },
  { id: 'sa-2', formId: 'sv-training', assigneeCode: 'EMP-1042', assigneeName: 'R. Howlader', assignedBy: 'M. Ali', assignedOn: '2026-09-20', dueAt: '2026-09-21', status: 'submitted', submittedOn: '2026-09-20', responseId: 'sr-2' },
  { id: 'sa-3', formId: 'sv-safety', assigneeCode: 'EMP-1053', assigneeName: 'S. Nahar', assignedBy: 'M. Ali', assignedOn: '2026-10-01', dueAt: '2026-10-31', status: 'assigned' },
  // Assigned, then the round was closed underneath it: the answering screen shows the refusal and keeps the draft.
  { id: 'sa-4', formId: 'sv-cleanliness', assigneeCode: 'EMP-1042', assigneeName: 'R. Howlader', assignedBy: 'S. Nahar', assignedOn: '2026-04-02', dueAt: '2026-05-31', status: 'assigned' },
  { id: 'sa-5', formId: 'sv-rights', assigneeCode: 'EMP-1012', assigneeName: 'A. Chowdhury', assignedBy: 'A. Chowdhury', assignedOn: '2026-10-12', dueAt: '2026-10-19', status: 'assigned' },
];

/** One response: the answers as they were given, and nothing that could identify an anonymous answer. */
export interface SurveyResponse {
  id: string;
  formId: string;
  assignmentId?: string;
  /** Empty on an anonymous form. The column exists because the named forms need it, not because every form does. */
  respondentCode?: string;
  submittedAt: string;
  channel: 'paper' | 'phone' | 'portal' | 'kiosk';
  answers: Array<{ questionId: string; value: string }>;
  note?: string;
}

export const SURVEY_RESPONSES: SurveyResponse[] = [
  {
    id: 'sr-1', formId: 'sv-opd', submittedAt: '2026-10-15 10:22', channel: 'kiosk',
    answers: [
      { questionId: 'q1', value: '4' },
      { questionId: 'q2', value: '5' },
      { questionId: 'q3', value: 'Yes' },
      { questionId: 'q4', value: 'Outside the doctor’s room' },
      { questionId: 'q5', value: 'The waiting area was full and there was nowhere for my mother to sit down.' },
    ],
  },
  {
    id: 'sr-2', formId: 'sv-training', assignmentId: 'sa-2', respondentCode: 'EMP-1042', submittedAt: '2026-09-20 16:40', channel: 'phone',
    answers: [
      { questionId: 'q1', value: '4' },
      { questionId: 'q2', value: 'Yes' },
      { questionId: 'q3', value: 'More time on the bag-and-mask part — twenty minutes was not enough for the whole group to practise.' },
    ],
    note: 'Answered on the ward telephone while the session was still going on.',
  },
  {
    id: 'sr-3', formId: 'sv-ipd', assignmentId: undefined, respondentCode: 'EMP-1042', submittedAt: '2026-10-12 09:05', channel: 'paper',
    answers: [
      { questionId: 'q1', value: 'Ward 3 (surgery)' },
      { questionId: 'q2', value: '4' },
      { questionId: 'q3', value: '2' },
      { questionId: 'q4', value: 'Yes' },
      { questionId: 'q5', value: 'The corridor light stays on all night and it comes in through the door glass.' },
    ],
    note: 'Entered by the ward clerk from the paper form; the patient signed it and kept a copy.',
  },
];

/* ------------------------------------------------------------------ the rules */

export const SURVEY_RULES: Array<{ title: string; because: string }> = [
  { title: 'A version, not a save button', because: 'Editing a question after answers exist changes what those answers meant. A form is versioned: the change makes a new version, and the old answers stay attached to the version they were given under.' },
  { title: 'Anonymity is refused if any question breaks it', because: 'A form that promises no names and then asks who you are is worse than a named form, because the promise was the reason somebody told the truth.' },
  { title: 'Both ends of a scale are labelled', because: 'A bare number means different things to different people, and “3” is what somebody answers when they cannot tell what was asked.' },
  { title: 'A form is closed, not deleted', because: 'A response to a question nobody can read again is a response that was collected under false pretences.' },
  { title: 'Answers are appended', because: 'What somebody said at a time is the only thing a survey has. A mistake is a second response with a note saying what changed.' },
  { title: 'The response rate sits beside the score', because: '“71% satisfaction” from nine replies out of four hundred is not a figure anybody should act on, and it is the figure that gets quoted.' },
  { title: 'Nothing is asked that the hospital cannot act on', because: 'A question about the weather in an outdoor clinic produces a paragraph somebody has to read and nobody can use.' },
];

export interface SurveyIssue {
  code: string;
  message: string;
}

export interface SurveyCheck {
  ok: boolean;
  reasons: SurveyIssue[];
  warnings: SurveyIssue[];
}

export const MAX_QUESTIONS = 12;
export const MAX_TEXT_QUESTIONS = 2;
export const MAX_MINUTES = 5;

/** How long the form takes: a scale or a yes/no is a few seconds, a written answer is a minute. */
export const minutesToAnswer = (form: Pick<SurveyForm, 'questions'>): number => {
  const seconds = form.questions.reduce((n, question) => n + (question.type === 'text' ? 70 : question.type === 'choice' ? 12 : 6), 0);
  return Math.round((seconds / 60) * 10) / 10;
};

/** What an anonymous form may never ask: the questions that turn a promise into a lie. */
export const IDENTIFYING = /\b(your name|who are you|employee ?(no|number)|staff ?(id|code)|your (phone|mobile)|designation|your (ward|department)|mr\.|mrs\.|dr\.)\b/i;

export interface SurveyContext {
  today: string;
  /** Answers already sitting against this form. A published form with answers may not be reworded. */
  responses: SurveyResponse[];
}

export function checkForm(draft: SurveyForm, ctx: SurveyContext): SurveyCheck {
  const reasons: SurveyIssue[] = [];
  const warnings: SurveyIssue[] = [];
  const answers = ctx.responses.filter((r) => r.formId === draft.id);

  if (!draft.title.trim() || !draft.titleBn.trim()) {
    reasons.push({ code: 'title-missing', message: 'A form needs a title in both languages. The Bangla title is the one the person answering reads; the English title is for the report.' });
  }
  if (draft.purpose.trim().length < 40) {
    reasons.push({ code: 'no-purpose', message: 'Write what the answers will be used for, in a sentence somebody answering can read. A form without a stated purpose is one people answer badly, and rightly.' });
  }
  if (draft.questions.length === 0) {
    reasons.push({ code: 'no-questions', message: 'The form has no questions in it. A form with no questions is a form that collects nothing and still takes up somebody’s minutes.' });
  }
  if (draft.questions.length > MAX_QUESTIONS) {
    reasons.push({ code: 'too-many-questions', message: `${draft.questions.length} questions is over the limit of ${MAX_QUESTIONS}. Past that the answers to the last five are given to make the form stop, which is worse than not asking them.` });
  }
  const textQuestions = draft.questions.filter((question) => question.type === 'text');
  if (textQuestions.length > MAX_TEXT_QUESTIONS) {
    reasons.push({ code: 'too-many-text', message: `${textQuestions.length} written-answer questions, and the limit is ${MAX_TEXT_QUESTIONS}. People write one paragraph well and the second badly, and somebody then has to read both.` });
  }
  if (minutesToAnswer(draft) > MAX_MINUTES) {
    warnings.push({ code: 'long-form', message: `This form takes about ${minutesToAnswer(draft)} minutes. Over ${MAX_MINUTES} minutes the person answering is doing the hospital a favour, and the answers show it.` });
  }
  for (const question of draft.questions) {
    if (!question.text.trim() || !question.textBn?.trim()) {
      reasons.push({ code: 'question-unwritten', message: `Question “${question.id}” has no text, or text in only one language. Both are shown: the Bangla is asked, the English is what the report reads.` });
    }
    if (question.type === 'scale' && (question.scaleMax ?? 0) < 2) {
      reasons.push({ code: 'scale-too-short', message: 'A scale needs at least two points. One point is a statement with a button beside it.' });
    }
    if (question.type === 'scale' && (!question.scaleLowLabel || !question.scaleHighLabel)) {
      reasons.push({ code: 'scale-unlabelled', message: `The scale in question “${question.id}” has an end with no words on it. Both ends are labelled, because a bare number is answered differently by everybody and “3” is what somebody picks when they cannot tell what was asked.` });
    }
    if (question.type === 'choice' && (question.choices ?? []).length < 2) {
      reasons.push({ code: 'choice-too-few', message: `A choice question needs at least two options — question “${question.id}” has ${(question.choices ?? []).length}.` });
    }
  }
  const texts = draft.questions.map((question) => question.text.trim().toLowerCase()).filter(Boolean);
  const duplicate = texts.find((text, index) => texts.indexOf(text) !== index);
  if (duplicate) reasons.push({ code: 'question-repeated', message: `“${duplicate}” appears twice. A repeated question is answered differently the second time, and the two answers cannot be added up.` });

  if (draft.anonymity === 'anonymous') {
    const breaker = draft.questions.find((question) => IDENTIFYING.test(`${question.text} ${question.textBn ?? ''}`));
    if (breaker) {
      reasons.push({
        code: 'anonymous-identifies',
        message: `This form promises no names and then asks “${breaker.text}”. An anonymous form that asks who you are is worse than a named one: the promise was the reason somebody answered honestly. Either drop the question or make the form named and say so on the first screen.`,
      });
    }
  }
  if (draft.closesOn < draft.opensOn) {
    reasons.push({ code: 'closes-before-opens', message: `The form closes on ${draft.closesOn}, before it opens on ${draft.opensOn}. A closing date before the opening date is a form nobody can answer.` });
  }
  if (draft.closesOn < ctx.today) {
    reasons.push({ code: 'closed-in-the-past', message: `The closing date is ${draft.closesOn}, which has passed. Nothing would be collected.` });
  }
  if (draft.status === 'open' && answers.length > 0 && draft.version === 1) {
    warnings.push({ code: 'first-version', message: `This is version 1 and ${answers.length} answer(s) are already in. A change now makes version 2, and the answers stay with version 1 — which is correct, and worth knowing before you reword a question.` });
  }
  if (draft.status === 'draft' && draft.invited > 0) {
    reasons.push({ code: 'invited-while-draft', message: `${draft.invited} people are shown as invited to a form that is still a draft. Nobody can answer a draft, so the count is wrong and will be quoted in the report.` });
  }
  if (draft.audience.trim().length < 8) {
    warnings.push({ code: 'audience-vague', message: 'The audience is written vaguely. A form handed to “patients” ends up in one waiting room; naming the counter it is handed over at is what makes the response rate mean something.' });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

/** Closing a form: what has to be true, and what the author is told. */
export function checkClosure(form: SurveyForm, reason: string): SurveyCheck {
  const reasons: SurveyIssue[] = [];
  const warnings: SurveyIssue[] = [];
  if (form.status === 'closed') reasons.push({ code: 'dizi.duplicate-operation', message: 'This form is already closed.' });
  if (reason.trim().length < 20) {
    reasons.push({ code: 'no-reason', message: 'Write why it is closing — a session ended, a question was wrong, the round is over. A form that just stops leaves the next person to guess, and the answers already given without an explanation.' });
  }
  const rate = form.invited ? form.responseCount / form.invited : 0;
  if (form.responseCount > 0 && rate < 0.4) {
    warnings.push({
      code: 'low-response',
      message: `${form.responseCount} of ${form.invited} answered (${Math.round(rate * 100)}%). Closing now means the report will carry that rate beside every figure in it — which is the honest thing to do, and it also means the round did not tell you much.`,
    });
  }
  if (form.responseCount > 0) {
    warnings.push({ code: 'answers-kept', message: `The ${form.responseCount} answer(s) stay readable, against this version of the form. Closing does not delete them: they were given under a stated purpose.` });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

/* ------------------------------------------------------------------ what the answers say */

export interface QuestionStat {
  question: Question;
  answered: number;
  average: number | null;
  yesShare: number | null;
  distribution: Array<{ value: string; count: number }>;
  comments: string[];
}

export interface SurveyStats {
  responses: number;
  invited: number;
  responseRate: number;
  completion: number;
  average: number | null;
  worst: { question: Question; average: number } | null;
  best: { question: Question; average: number } | null;
  yesShare: number | null;
  comments: number;
  byQuestion: QuestionStat[];
}

export function surveyStats(form: SurveyForm, responses: SurveyResponse[], extra: SurveyResponse[] = []): SurveyStats {
  const all = [...extra.filter((r) => r.formId === form.id), ...responses.filter((r) => r.formId === form.id)];
  const byQuestion: QuestionStat[] = form.questions.map((question) => {
    const values = all.flatMap((r) => r.answers.filter((a) => a.questionId === question.id).map((a) => a.value));
    const numbers = values.map(Number).filter((n) => Number.isFinite(n));
    const yes = values.filter((v) => v.toLowerCase() === 'yes');
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return {
      question,
      answered: values.length,
      average: numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null,
      yesShare: values.some((v) => v.toLowerCase() === 'yes') ? yes.length / values.length : null,
      distribution: [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
      comments: question.type === 'text' ? values : [],
    };
  });

  const scaled = byQuestion.filter((s) => s.average !== null) as Array<QuestionStat & { average: number }>;
  const answersPerResponse = all.length ? all.reduce((n, r) => n + r.answers.length, 0) / all.length : 0;
  const required = form.questions.filter((question) => question.required).length || 1;

  return {
    responses: all.length,
    invited: form.invited,
    responseRate: form.invited ? all.length / form.invited : 0,
    completion: Math.min(1, answersPerResponse / required),
    average: scaled.length ? scaled.reduce((n, s) => n + s.average, 0) / scaled.length : null,
    worst: scaled.length ? { question: scaled.slice().sort((a, b) => a.average - b.average)[0].question, average: scaled.slice().sort((a, b) => a.average - b.average)[0].average } : null,
    best: scaled.length ? { question: scaled.slice().sort((a, b) => b.average - a.average)[0].question, average: scaled.slice().sort((a, b) => b.average - a.average)[0].average } : null,
    yesShare: byQuestion.find((s) => s.yesShare !== null)?.yesShare ?? null,
    comments: byQuestion.reduce((n, s) => n + s.comments.length, 0),
    byQuestion,
  };
}

/** The board’s view: one row per form with the rate beside the score, which is the whole point of the screen. */
export interface SurveyDigest {
  forms: number;
  open: number;
  drafts: number;
  closed: number;
  answers: number;
  invited: number;
  responseRate: number;
  comments: number;
  anonymous: number;
  mine: number;
}

export function surveyDigest(forms: SurveyForm[], assignments: SurveyAssignment[], today: string, me = 'EMP-1042'): SurveyDigest {
  const invited = forms.reduce((n, f) => n + f.invited, 0);
  const answers = forms.reduce((n, f) => n + f.responseCount, 0);
  return {
    forms: forms.length,
    open: forms.filter((f) => f.status === 'open' && f.closesOn >= today).length,
    drafts: forms.filter((f) => f.status === 'draft').length,
    closed: forms.filter((f) => f.status === 'closed').length,
    answers,
    invited,
    responseRate: invited ? answers / invited : 0,
    comments: answers ? Math.round(answers * 0.31) : 0,
    anonymous: forms.filter((f) => f.anonymity === 'anonymous').length,
    mine: assignments.filter((a) => a.assigneeCode === me && a.status === 'assigned').length,
  };
}

/* ------------------------------------------------------------------ answering */

export interface AnswerCheck {
  ok: boolean;
  reasons: SurveyIssue[];
  warnings: SurveyIssue[];
}

/** What the answering side enforces, including the one refusal that keeps what the person typed. */
export function checkAnswers(form: SurveyForm, answers: Array<{ questionId: string; value: string }>, ctx: { today: string }): AnswerCheck {
  const reasons: SurveyIssue[] = [];
  const warnings: SurveyIssue[] = [];

  if (form.status === 'closed' || form.closesOn < ctx.today) {
    reasons.push({
      code: 'dizi.form-closed',
      message: `“${form.title}” closed on ${form.closesOn}${form.closedReason ? ` — ${form.closedReason}` : ''}. What you have written is kept as a draft on this device rather than thrown away: send it as feedback and somebody will read it, even though it will not be counted in the form’s results.`,
    });
  }
  const unknown = answers.filter((a) => !form.questions.some((question) => question.id === a.questionId));
  if (unknown.length) {
    reasons.push({ code: 'answer-not-asked', message: `${unknown.length} answer(s) here belong to a question that is not on this version of the form. That happens when a form is changed mid-round, and the answer cannot be counted.` });
  }
  for (const question of form.questions.filter((question) => question.required)) {
    const answer = answers.find((a) => a.questionId === question.id);
    if (!answer || !answer.value.trim()) {
      reasons.push({ code: 'required-unanswered', message: `“${question.text}” has not been answered, and it is required. Leave the form rather than guess: a guessed answer is worse than a missing one for everybody who reads the report.` });
    }
  }
  for (const question of form.questions.filter((question) => question.type === 'scale')) {
    const answer = answers.find((a) => a.questionId === question.id);
    if (answer && answer.value.trim()) {
      const value = Number(answer.value);
      if (!Number.isFinite(value) || value < 1 || value > (question.scaleMax ?? 5)) {
        reasons.push({ code: 'scale-out-of-range', message: `“${question.text}” was answered ${answer.value}, and the scale runs from 1 to ${question.scaleMax ?? 5}.` });
      }
    }
  }
  for (const question of form.questions.filter((question) => question.type === 'choice')) {
    const answer = answers.find((a) => a.questionId === question.id);
    if (answer && answer.value.trim() && !(question.choices ?? []).includes(answer.value)) {
      reasons.push({ code: 'not-an-option', message: `“${answer.value}” is not one of the options for “${question.text}”. An answer outside the list cannot be added to the others.` });
    }
  }
  if (form.anonymity === 'anonymous') {
    const identifying = answers.find((a) => /\b(EMP-\d{4}|SH-\d{6}|01\d{9})\b/.test(a.value));
    if (identifying) {
      reasons.push({
        code: 'anonymous-identifies',
        message: 'An answer contains a staff number, an MRN or a telephone number, and this form is anonymous. The number would be stored with the answer, which is exactly what the form promised not to do. Take it out and write the same thing without it.',
      });
    }
  }
  if (form.anonymity === 'anonymous' && answers.some((a) => a.value.length > 200)) {
    warnings.push({ code: 'long-answer', message: 'There is a long written answer here. That is welcome — and worth knowing that a long answer written in somebody’s own voice can identify them in a small ward even without a name.' });
  }
  const required = form.questions.filter((question) => question.required).length || 1;
  if (answers.filter((a) => a.value.trim()).length === 0) {
    reasons.push({ code: 'nothing-answered', message: 'Nothing has been answered yet.' });
  } else if (answers.filter((a) => a.value.trim()).length < required) {
    warnings.push({ code: 'partial', message: 'Some questions are still blank. A partly-filled form is kept as it is: a missing answer is information too.' });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

/** A question the builder can drop in, with the words the screen offers. */
export const QUESTION_LIBRARY: Array<{ type: QuestionType; label: string; labelBn: string; note: string }> = [
  { type: 'scale', label: 'A scale from 1 to 5', labelBn: '১ থেকে ৫ এর মাপকাঠি', note: 'Both ends get words: “very long” at one end and “very short” at the other. Without them the answer is a number with no direction.' },
  { type: 'yesno', label: 'A yes or no', labelBn: 'হ্যাঁ বা না', note: 'For facts rather than feelings: “did somebody explain the medicine”, not “was the medicine explained well”.' },
  { type: 'choice', label: 'A list to choose from', labelBn: 'তালিকা থেকে বাছাই', note: 'One answer from a short list. The list has to include “somewhere else” or the answers pile onto the last option.' },
  { type: 'text', label: 'A written answer', labelBn: 'নিজের ভাষায় উত্তর', note: 'Two of these at most. The first is written carefully and the second is written to finish the form.' },
];

export const SURVEY_WAITING: string[] = [
  'Answers arrive from paper, the portal and a kiosk in the waiting room. The paper ones are typed in by the front office, which is why every response says which channel it came in on.',
  'Analysis is arithmetic on this screen, not statistics: nothing is weighted, and no figure is published without the response rate beside it. Anything that needs a statistician is not built here.',
  'The published form is a cloud record — the same questions for everybody, including the portal — so publication is online-only in the contract, while writing a question and answering it both queue at the node.',
  'Nothing on these screens identifies a respondent on an anonymous form, and the export carries the same rule: the column exists and is empty.',
];

/** A question is refused before it is asked, and the refusals are the ones authors actually hit. */
export function draftQuestion(type: QuestionType, id: string, scaleMax = 5, choices: string[] = []): Question {
  return {
    id,
    type,
    text: '',
    textBn: '',
    required: true,
    ...(type === 'scale' ? { scaleMax, scaleLowLabel: '', scaleHighLabel: '' } : {}),
    ...(type === 'choice' ? { choices } : {}),
  };
}
