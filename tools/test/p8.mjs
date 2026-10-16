#!/usr/bin/env node
/**
 * Communication, content, the portal and the website — the P8 rules, exercised.
 *
 * Phase 8 is twelve admin screens, a patient portal and a public site over one idea that keeps turning up in
 * different clothes: **something is written once and read by somebody who was not there when it was written.** A
 * form, a notice, a certificate, a card, a page of the website, a bill in the portal. What is worth testing is
 * therefore not the layout — it is the arithmetic the reader will act on, and the refusals that protect them.
 *
 * The claims, in the order a day at the desk happens:
 *
 *   1. **A form is a version, and its questions are answerable.** Both languages present, both ends of every scale
 *      labelled, at most twelve questions and two written ones, and an anonymous form that asks who you are is
 *      refused — the promise was the reason somebody answered honestly.
 *   2. **An answer is appended, and a closed form keeps what was written.** The refusal is the contract's
 *      `dizi.form-closed` with the reason on the form, and the response rate is printed beside every score.
 *   3. **The website is content, not a page builder.** One parser reads the stored body for the editor and for the
 *      public page, the published revision is the one the public sees, and a draft is not live by accident.
 *   4. **A notice that cannot be recalled is treated differently from one that can.** The board works with the
 *      uplink down; WhatsApp and e-mail — the two channels the contract says this node carries — each carry their own
 *      consent, and no attachment and no clinical detail goes out on either.
 *   5. **Numbered documents come from this node's own block.** A card cannot outlive a licence, an exhausted block
 *      refuses rather than renumbering, and both registers are looked up by the number they print.
 *   6. **The portal's refusals are the patient's, in Bangla.** A lost slot comes back with the next free times, a
 *      cancellation inside the last two hours names the desk, a withheld result says the report is ready and why it
 *      is not shown, and payment says there is no gateway rather than taking money twice.
 *   7. **The phase is the plan.** The twelve registered screens are diffed field by field against
 *      `docs/plan/03-SCREEN-MAP.md`, every route has a page behind it, the runtime harness visits them all, and the
 *      contract declares every operation these screens queue — including the five acts that are online-only.
 *
 * Needs one dev-only package:
 *
 *     npm i --no-save esbuild && npm run test:p8
 *
 * Exit code 0 when every case passes, 1 otherwise, 2 when the tooling is missing.
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('\nThis test needs one dev-only package:\n\n    npm i --no-save esbuild\n\nthen run `npm run test:p8` again.\n');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'dizi-p8-test-'));
const failures = [];
const DAY = '2026-10-16';
const NIGHT = 23 * 60;

/** Assert one claim. Printed as it is checked, so a failure names the case rather than a line number. */
function pass(what, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures.push(what);
}
const codes = (check) => (check.reasons ?? []).map((r) => r.code);
const warns = (check) => (check.warnings ?? []).map((w) => w.code);
const hasBengali = (text) => /[\u0980-\u09FF]/.test(String(text ?? ''));
const sum = (rows, pick) => rows.reduce((n, r) => n + (pick(r) ?? 0), 0);

/** Route groups are not part of the URL: the staff app lives under `app/(staff)/admin/…`, the portal and the
 * public site under their own groups. A screen registered at `/admin/visitors` is a file two levels down. */
const pageAt = (route) =>
  ['(staff)', '(portal)', '(site)', '']
    .map((group) => join(root, 'apps/web/app', group, route.replace(/^\//, ''), 'page.tsx'))
    .find((path) => existsSync(path));

try {
  const libs = ['surveys', 'cms', 'messaging', 'documents', 'portal', 'content', 'telemedicine', 'admin'];
  await esbuild.build({
    entryPoints: libs.map((n) => join(root, `apps/web/lib/${n}.ts`)),
    outdir: work,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    absWorkingDir: root,
    tsconfig: join(root, 'apps/web/tsconfig.json'),
    logLevel: 'error',
  });

  const load = (name) => import(pathToFileURL(join(work, `${name}.js`)).href);
  const [SV, CM, MG, DC, PT, CT, TM, AD] = await Promise.all(libs.map(load));

  console.log('\np8 — the forms, the site, the notices, the numbered papers and the portal\n');

  /* ===================================================== 1. the forms and the refusals */

  const forms = SV.SURVEY_FORMS;
  const open = forms.filter((f) => f.status === 'open');
  const closed = forms.filter((f) => f.status === 'closed');
  const drafts = forms.filter((f) => f.status === 'draft');
  pass('six forms, each with two languages and a stated purpose', forms.length === 6 && new Set(forms.map((f) => f.id)).size === 6 && forms.every((f) => f.title.trim() && f.titleBn.trim() && f.purpose.length > 40 && f.audience.length >= 8 && f.questions.length > 0), forms.map((f) => `${f.id} v${f.version}`).join(' · '));
  const questions = forms.flatMap((f) => f.questions);
  pass('every question is written in both languages', questions.length > 0 && questions.every((q) => q.text.trim() && (q.textBn ?? '').trim()), `${questions.length} questions`);
  const scales = questions.filter((q) => q.type === 'scale');
  pass('every scale runs from at least two points and has words on both ends', scales.length > 0 && scales.every((q) => (q.scaleMax ?? 0) >= 2 && (q.scaleLowLabel ?? '').trim() && (q.scaleHighLabel ?? '').trim()), `${scales.length} scale questions`);
  const choices = questions.filter((q) => q.type === 'choice');
  pass('every list question carries at least two options', choices.length > 0 && choices.every((q) => (q.choices ?? []).length >= 2), choices.map((q) => (q.choices ?? []).length).join('/'));

  const ctx = { today: DAY, responses: SV.SURVEY_RESPONSES };
  pass('the forms that are open pass their own checks', open.length === 3 && open.every((f) => SV.checkForm(f, ctx).ok), `${open.length} open, ${closed.length} closed, ${drafts.length} draft`);
  pass('a closed form is refused with its closing date, and a draft is nobody’s to answer', closed.length === 2 && closed.every((f) => codes(SV.checkForm(f, ctx)).includes('closed-in-the-past')) && drafts.every((f) => f.invited === 0));

  const sample = open[0];
  const mutate = (patch) => SV.checkForm({ ...sample, ...patch }, ctx);
  pass('a form with a title in one language only is refused', codes(mutate({ titleBn: '' })).includes('title-missing'));
  pass('a purpose shorter than a sentence somebody answering can read is refused', codes(mutate({ purpose: 'To improve things.' })).includes('no-purpose'));
  pass('a form with no questions is refused', codes(mutate({ questions: [] })).includes('no-questions'));
  const many = Array.from({ length: 13 }, (_, i) => ({ ...sample.questions[0], id: `x${i}` }));
  pass('thirteen questions is over the limit of twelve', codes(mutate({ questions: many })).includes('too-many-questions'));
  const texts = [0, 1, 2, 3].map((i) => ({ id: `t${i}`, type: 'text', text: `Written question ${i}`, textBn: `লিখিত প্রশ্ন ${i}`, required: false }));
  const picks = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: `p${i}`, type: 'choice', text: `Which one ${i}?`, textBn: `কোনটি ${i}?`, required: false, choices: ['One', 'Two'] }));
  const long = [...texts, ...picks];
  pass('three written-answer questions are refused, and a form that runs past five minutes is warned about before it is published', codes(mutate({ questions: texts.slice(0, 3) })).includes('too-many-text') && warns(mutate({ questions: long })).includes('long-form'), `${long.length} questions, about ${SV.minutesToAnswer({ questions: long })} minutes`);
  const unlabelled = [...sample.questions, { id: 'u1', type: 'scale', text: 'How was it?', textBn: 'কেমন ছিল?', required: true, scaleMax: 5 }];
  pass('a scale with an end that has no words on it is refused', codes(mutate({ questions: unlabelled })).includes('scale-unlabelled'));
  pass('a one-point scale is a statement with a button beside it, and is refused', codes(mutate({ questions: [...sample.questions, { id: 'u2', type: 'scale', text: 'Fine?', textBn: 'ঠিক আছে?', required: true, scaleMax: 1, scaleLowLabel: 'yes', scaleHighLabel: 'yes' }] })).includes('scale-too-short'));
  pass('a list question with one option is refused', codes(mutate({ questions: [...sample.questions, { id: 'c1', type: 'choice', text: 'Which ward?', textBn: 'কোন ওয়ার্ড?', required: false, choices: ['Ward 2'] }] })).includes('choice-too-few'));
  const anonSample = forms.find((f) => f.anonymity === 'anonymous');
  const identifying = [...anonSample.questions, { id: 'n1', type: 'text', text: 'What is your name?', textBn: 'আপনার নাম কী?', required: false }];
  pass('an anonymous form that asks who you are is refused, with the question quoted back', codes(SV.checkForm({ ...anonSample, questions: identifying }, ctx)).includes('anonymous-identifies') && SV.checkForm({ ...anonSample, questions: identifying }, ctx).reasons.some((r) => r.message.includes('What is your name?')));
  pass('the same question on a form that is honest about being named is allowed', !codes(SV.checkForm({ ...anonSample, anonymity: 'named', questions: identifying }, ctx)).includes('anonymous-identifies'));
  const repeated = [...sample.questions, { ...sample.questions[0], id: 'dup' }];
  pass('the same question twice is refused: the two answers cannot be added up', codes(mutate({ questions: repeated })).includes('question-repeated'));
  pass('a form that closes before it opens is refused, with both dates in the sentence', codes(mutate({ opensOn: '2026-11-01', closesOn: '2026-10-01' })).includes('closes-before-opens'));
  pass('a closing date in the past is refused', codes(mutate({ closesOn: '2026-01-31' })).includes('closed-in-the-past'));
  pass('a draft with people invited to it is refused: nobody can answer a draft', codes(mutate({ status: 'draft', invited: 40 })).includes('invited-while-draft'));
  pass('a change to a form that already has answers is a new version, and the screen is warned before it saves', warns(SV.checkForm({ ...sample, version: 1 }, ctx)).includes('first-version'));

  const closeShort = SV.checkClosure(open[0], 'done');
  const closeGood = SV.checkClosure(open[0], 'The round is over and the infection-control committee has read the answers.');
  const alreadyClosed = SV.checkClosure(closed[0], 'The round is over and everybody who was asked has answered.');
  pass('closing needs a reason, and the answers already given stay readable', codes(closeShort).includes('no-reason') && warns(closeGood).includes('answers-kept'), warns(closeGood).join(', '));
  pass('closing a form that is already closed is refused as a duplicate', codes(alreadyClosed).includes('dizi.duplicate-operation'));

  /* ===================================================== 2. the answering end */

  const assignment = SV.SURVEY_ASSIGNMENTS.find((a) => a.id === 'sa-4');
  const closedUnder = SV.SURVEY_FORMS.find((f) => f.id === assignment.formId);
  const closedVerdict = SV.checkAnswers(closedUnder, [{ questionId: 'q1', value: '5' }], { today: DAY });
  pass('an assignment whose round closed underneath it refuses with dizi.form-closed, and keeps the draft', closedUnder.status === 'closed' && codes(closedVerdict).includes('dizi.form-closed') && closedVerdict.reasons[0].message.includes(closedUnder.closesOn) && closedVerdict.reasons[0].message.includes('draft'), closedVerdict.reasons[0].message.slice(0, 110) + '…');

  const answerSet = Object.fromEntries(sample.questions.map((q) => [q.id, q.type === 'scale' ? '4' : q.type === 'yesno' ? 'Yes' : q.type === 'choice' ? (q.choices ?? ['a'])[0] : 'It was fine.']));
  const asList = (obj) => Object.entries(obj).map(([questionId, value]) => ({ questionId, value }));
  const good = SV.checkAnswers(sample, asList(answerSet), { today: DAY });
  pass('a complete set of answers on an open form is accepted', good.ok, codes(good).join(', ') || `${Object.keys(answerSet).length} answers`);
  const missing = SV.checkAnswers(sample, asList({ ...answerSet, [sample.questions[0].id]: '' }), { today: DAY });
  pass('a required question left blank is refused, and the person is told to leave rather than guess', codes(missing).includes('required-unanswered') && missing.reasons.some((r) => r.message.includes('guess')));
  pass('an answer off the end of the scale is refused with the range', codes(SV.checkAnswers(sample, asList({ ...answerSet, [scales[0].id !== undefined ? sample.questions.find((q) => q.type === 'scale').id : ''] : '9' }), { today: DAY })).includes('scale-out-of-range'));
  const choiceQ = sample.questions.find((q) => q.type === 'choice');
  pass('an answer that is not one of the options is refused', codes(SV.checkAnswers(sample, asList({ ...answerSet, [choiceQ.id]: 'Somewhere else entirely' }), { today: DAY })).includes('not-an-option'));
  const anonymous = forms.find((f) => f.anonymity === 'anonymous');
  const anonAnswers = (text) => asList(Object.fromEntries(anonymous.questions.map((q) => [q.id, q.type === 'scale' ? '3' : q.type === 'yesno' ? 'No' : q.type === 'choice' ? (q.choices ?? ['a'])[0] : text])));
  pass('an anonymous form refuses an answer carrying a staff number or an MRN', codes(SV.checkAnswers(anonymous, anonAnswers('It was the nurse EMP-1042 who helped me'), { today: DAY })).includes('anonymous-identifies'));
  pass('the same answer on a named form is allowed, because it was asked for', !codes(SV.checkAnswers(forms.find((f) => f.anonymity === 'named'), anonAnswers('It was the nurse EMP-1042 who helped me'), { today: DAY })).includes('anonymous-identifies'));
  pass('nothing typed at all is refused rather than submitted as a blank', codes(SV.checkAnswers(sample, [], { today: DAY })).includes('nothing-answered'));

  const stats = SV.surveyStats(sample, SV.SURVEY_RESPONSES);
  const own = SV.SURVEY_RESPONSES.filter((r) => r.formId === sample.id).length;
  pass('the answers are counted from the register, and the rate is printed beside the score', stats.responses === own && stats.invited === sample.invited && Math.abs(stats.responseRate - own / sample.invited) < 1e-9, `${stats.responses} of ${stats.invited} (${Math.round(stats.responseRate * 100)}%)`);
  pass('every scale answer lands between 1 and its own scale’s maximum', stats.byQuestion.filter((s) => s.average !== null).every((s) => s.average >= 1 && s.average <= (s.question.scaleMax ?? 5)), stats.byQuestion.filter((s) => s.average !== null).map((s) => s.average.toFixed(1)).join(', '));
  pass('the weakest question is the lowest average, and the completion never exceeds one form', stats.byQuestion.length === sample.questions.length && (stats.worst === null || stats.best === null || stats.worst.average <= stats.best.average) && stats.completion <= 1, stats.worst ? `weakest “${stats.worst.question.text}” at ${stats.worst.average.toFixed(1)}` : 'no scale questions');
  const digest = SV.surveyDigest(forms, SV.SURVEY_ASSIGNMENTS, DAY);
  const mine = SV.SURVEY_ASSIGNMENTS.filter((a) => a.assigneeCode === 'EMP-1042' && a.status === 'assigned').length;
  pass('the digest adds up from the forms and the assignments rather than from a second list', digest.forms === forms.length && digest.answers === sum(forms, (f) => f.responseCount) && digest.invited === sum(forms, (f) => f.invited) && digest.open === open.filter((f) => f.closesOn >= DAY).length && digest.closed === closed.length && digest.anonymous === forms.filter((f) => f.anonymity === 'anonymous').length && digest.mine === mine, `${digest.open} open · ${digest.answers} answers of ${digest.invited} invited · ${digest.mine} of mine`);

  /* ===================================================== 3. the website as content */

  pass('nine sections, each with one address and one purpose', CM.SECTIONS.length === 9 && new Set(CM.SECTIONS.map((s) => s.slug)).size === 9 && CM.SECTIONS.every((s) => s.purpose.length > 40 && s.labelBn.trim()), CM.SECTIONS.map((s) => s.section).join(' '));
  const blocks = [
    { kind: 'heading', en: 'Outpatient hours', bn: 'বহির্বিভাগের সময়' },
    { kind: 'paragraph', en: 'The outdoor clinic opens at eight and closes at two.', bn: 'বহির্বিভাগ সকাল আটটায় খোলে, দুপুর দুইটায় বন্ধ হয়।' },
    { kind: 'list', en: '', bn: '', rows: [{ en: 'Medicine', bn: 'মেডিসিন' }, { en: 'Surgery', bn: 'সার্জারি' }, { en: 'Obstetrics', bn: 'প্রসূতি' }] },
    { kind: 'facts', en: '', bn: '', rows: [{ en: 'Emergency: 02 9876 500', bn: 'জরুরি: ০২ ৯৮৭৬ ৫০০' }, { en: 'Ambulance: 02 9876 555', bn: 'অ্যাম্বুলেন্স: ০২ ৯৮৭৬ ৫৫৫' }] },
    { kind: 'notice', en: '2026-11-04 Blood donation camp on the fourth of November.', bn: '২০২৬-১১-০৪ নভেম্বরের চার তারিখে রক্তদান শিবির।' },
    { kind: 'callout', en: 'Bring the old prescription if you have it.', bn: 'পুরোনো প্রেসক্রিপশন থাকলে সঙ্গে আনুন।' },
  ];
  const roundTrip = (lang) => CM.parseBody(CM.serialiseBody(blocks, lang), lang);
  const en = roundTrip('en');
  const bn = roundTrip('bn');
  const sameKinds = (parsed) => parsed.length === blocks.length && parsed.every((b, i) => b.kind === blocks[i].kind);
  const liveBody = CM.publishedPages()[0];
  const stable = CM.parseBody(CM.serialiseBody(CM.parseBody(liveBody.bodyEn, 'en'), 'en'), 'en');
  pass('the body parser and the writer are one pair: what the editor stored is what the site reads', sameKinds(en) && sameKinds(bn) && stable.length === CM.parseBody(liveBody.bodyEn, 'en').length && CM.MARKERS.length === 6 && new Set(CM.MARKERS.map((m) => m.kind)).size === 6, en.map((b) => b.kind).join(' → '));
  const published = CM.publishedPages();
  pass('every published page is written in both languages and parses on both sides', published.length >= 8 && published.every((p) => p.titleEn && p.titleBn && CM.parseBody(p.bodyEn, 'en').length > 0 && CM.parseBody(p.bodyBn, 'bn').length > 0), `${published.length} of ${CM.CMS_PAGES.length} pages live`);
  const home = CM.pageBySlug('');
  const pageCtx = { today: DAY, pages: CM.CMS_PAGES };
  const newsDraft = CM.CMS_PAGES.find((p) => p.state === 'draft');
  pass('a drafted page is not published, and the address says so rather than going blank', Boolean(newsDraft) && !published.some((p) => p.slug === newsDraft.slug), newsDraft ? `${newsDraft.slug} is ${newsDraft.state}` : 'no draft pages');
  const retired = CM.CMS_PAGES.find((p) => p.state === 'retired');
  const siteSlug = readFileSync(join(root, 'apps/web/app/(site)/site/[...slug]/page.tsx'), 'utf8');
  const aSection = published.find((p) => p.section !== 'home');
  pass('a retired page is not published, and the address that served it explains itself rather than going blank', (retired ? !published.some((p) => p.slug === retired.slug) : CM.checkPage({ ...aSection, state: 'retired' }, pageCtx).ok) && /retired/.test(siteSlug), retired ? `${retired.slug} retired` : `retiring /${aSection.slug} is allowed and the front page is not`);
  const newAtTakenSlug = CM.checkPage({ ...published[0], slug: published[1].slug }, { ...pageCtx, editing: null });
  const editingItself = CM.checkPage({ ...published[0] }, { ...pageCtx, editing: published[0].slug });
  pass('a second page at an address already in use is refused by name', codes(newAtTakenSlug).includes('slug-taken') && newAtTakenSlug.reasons.some((r) => r.message.includes(published[1].slug)), codes(newAtTakenSlug).join(', '));
  pass('the page being edited is not refused against itself, which is the difference the context carries', !codes(editingItself).includes('slug-taken'), codes(editingItself).join(', ') || 'an edit of a page is not a second page');
  pass('a page filed under a section its address does not belong to is refused', codes(CM.checkPage({ ...published[0], slug: 'about', section: 'news' }, pageCtx)).includes('slug-section-mismatch'));
  pass('a title in one language only is refused', codes(CM.checkPage({ ...published[0], titleBn: '' }, pageCtx)).includes('title-missing'));
  pass('a page with one of its two bodies missing is refused', codes(CM.checkPage({ ...published[0], bodyBn: '' }, pageCtx)).includes('bangla-missing') && codes(CM.checkPage({ ...published[0], bodyEn: '' }, pageCtx)).includes('english-missing'), 'Bangla written first, the English beneath it');
  pass('placeholder text is refused: it is how a page about a service nobody offers stays up for two years', codes(CM.checkPage({ ...published[0], bodyEn: 'Lorem ipsum dolor sit amet.' }, pageCtx)).includes('placeholder'));
  pass('a published page with no author is refused, because the name is the answer to “who do I ask?”', codes(CM.checkPage({ ...published[0], author: '' }, pageCtx)).includes('no-author'));
  pass('the front page cannot be retired', codes(CM.checkPage({ ...home, state: 'retired' }, pageCtx)).includes('home-retired'));
  const snap = CM.siteSnapshot();
  pass('the menu is built from published pages only, and every address points at one', snap.menu.length >= 5 && snap.home.slug === '' && snap.menu.every((m) => m.href.startsWith('/site')) && snap.menu.flatMap((m) => m.pages).every((p) => CM.pageBySlug(p.slug)?.state === 'published'), snap.menu.map((m) => m.label).join(' · '));
  pass('the facts a page must never type by hand come from the hospital’s own figures, and every notice is dated', snap.facts.length >= 5 && snap.pageCount === published.length && snap.notices.length > 0 && snap.notices.every((n) => /\d/.test(n)), `${snap.facts.length} facts · ${snap.notices.length} notices`);
  const cms = CM.cmsStats();
  pass('the register’s counts add up and the events name real people', cms.pages === cms.published + cms.drafts + cms.retired && cms.words > 500 && cms.editors >= 3 && CM.PAGE_EVENTS.every((e) => e.by && e.at && e.what), cms.published + ' published · ' + cms.words + ' words · last edit ' + cms.lastEdit);
  pass('what publication does is stated on the screen rather than implied', CM.PUBLISH_RULES.length >= 4 && CM.PUBLISH_RULES.every((r) => r.length > 80) && CM.PUBLISH_RULES.some((r) => /cache/i.test(r)) && CM.PUBLISH_RULES.some((r) => /Bangla/i.test(r)) && CM.PUBLISH_RULES.some((r) => /online-only/i.test(r)));

  /* ===================================================== 4. notices and outbound messages */

  const dutyRoles = ['Consultant', 'Registrar', 'Intern', 'Senior staff nurse', 'Staff nurse', 'Midwife', 'Aya', 'Ward boy'];
  pass('every role the duty roster names is an audience the register recognises', dutyRoles.every((r) => MG.RECOGNISED_ROLES.includes(r)), `${MG.RECOGNISED_ROLES.length} recognised roles`);
  const audiences = MG.audiences(DAY);
  const roleAudiences = audiences.filter((a) => a.kind === 'role');
  const emptyRole = roleAudiences.find((a) => a.members.length === 0);
  const team = audiences.find((a) => a.members.length > 3);
  pass('a role nobody holds stays in the picker at zero rather than vanishing from it', MG.RECOGNISED_ROLES.every((r) => roleAudiences.some((a) => a.ref === r)) && Boolean(emptyRole) && new Set(audiences.map((a) => `${a.kind}:${a.ref}`)).size === audiences.length, `${roleAudiences.filter((a) => a.members.length === 0).length} of ${roleAudiences.length} role audiences hold nobody`);
  const mctx = { today: DAY, nowMinute: 10 * 60, audiences, notices: MG.NOTICES, receipts: MG.RECEIPTS, cloudReachable: true };
  const notice = (patch) => MG.checkNotice({ subject: 'Lift out of service this afternoon', body: 'The lift is being serviced today and will be out of service until 16:00. Use the stairs by the pharmacy.', priority: 'normal', audienceRef: `${team.kind}:${team.ref}`, relatedTo: '', channel: 'board', ...patch }, mctx);
  const cleanNotice = notice({});
  pass('a notice to a real audience resolves its recipients from the staff register', cleanNotice.ok && cleanNotice.recipients.length === team.members.length, `${cleanNotice.recipients.length} people`);
  pass('a notice with no subject, or four words of body, is refused', codes(notice({ subject: '' })).includes('no-subject') && codes(notice({ body: 'Lift out.' })).includes('too-short'));
  pass('a notice with nobody in the audience is refused rather than sent', codes(notice({ audienceRef: `${emptyRole.kind}:${emptyRole.ref}` })).includes('empty-audience') && codes(notice({ audienceRef: '' })).includes('no-audience'), `${emptyRole.ref} holds nobody`);
  pass('a notice carrying a diagnosis is refused: the board is read by the whole hospital', codes(notice({ body: 'The patient in bed 4 is HIV positive and everyone must take care with sharps.' })).includes('clinical-detail'));
  pass('an urgent notice with no time in it is warned about rather than refused', MG.checkNotice({ subject: 'Night shift on Ward 3 needs covering', body: 'The night shift needs covering and somebody must come in.', priority: 'urgent', audienceRef: `${team.kind}:${team.ref}`, relatedTo: '', channel: 'board' }, mctx).ok && warns(MG.checkNotice({ subject: 'Night shift on Ward 3 needs covering', body: 'The night shift needs covering and somebody must come in.', priority: 'urgent', audienceRef: `${team.kind}:${team.ref}`, relatedTo: '', channel: 'board' }, mctx)).includes('urgent-without-when'));
  pass('a notice already sent to the board today is flagged as a correction rather than sent twice', warns(MG.checkNotice({ subject: MG.NOTICES[0].subject, body: 'The same notice again, to the same people, this afternoon.', priority: 'normal', audienceRef: `${team.kind}:${team.ref}`, relatedTo: '', channel: 'board' }, mctx)).includes('already-sent'));
  pass('the board works with the uplink down: a notice is queued while an outward message is refused', MG.checkNotice({ subject: 'Pharmacy stock count this afternoon', body: 'The pharmacy will count stock from 14:00 and the counter will be slow for about an hour.', priority: 'normal', audienceRef: `${team.kind}:${team.ref}`, relatedTo: '', channel: 'board' }, { ...mctx, cloudReachable: false }).ok);

  /* WhatsApp, not SMS: the contract's `x-dizi-notifications.channels` names the two channels this node carries, and
     SMS is not one of them. A screen offering a channel no driver carries is a screen offering a send that cannot
     happen — so the battery tests the two that can. */
  const consent = MG.CONSENTS.find((c) => c.channel === 'whatsapp' && !c.withdrawnOn);
  const message = { channel: 'whatsapp', patientMrn: consent.mrn, patientName: consent.patientName, phone: '01711 000 111', body: 'Your appointment with the medicine clinic is on 22 October at 11:00. Please arrive fifteen minutes early and bring your card.', template: 'appointment-reminder', attachments: 0, consent };
  const outbound = (patch) => MG.checkOutbound({ ...message, ...patch }, mctx);
  pass('a patient message with a consent, a number from the record and a template is accepted', outbound({}).ok, codes(outbound({})).join(', ') || `to ${consent.patientName} on ${consent.channel}`);
  const noConsent = outbound({ consent: undefined });
  pass('the same message with no consent is refused by the contract’s own code', codes(noConsent).includes('consent-missing') && noConsent.reasons.some((r) => r.message.includes('dizi.consent-missing')));
  pass('WhatsApp and e-mail are separate consents, and one does not stand for the other', MG.CONSENTS.some((c) => c.channel === 'email') && MG.consentFor(consent.mrn, 'whatsapp')?.channel !== MG.consentFor(consent.mrn, 'email')?.channel, `whatsapp: ${Boolean(MG.consentFor(consent.mrn, 'whatsapp'))}, email: ${Boolean(MG.consentFor(consent.mrn, 'email'))}`);
  pass('the channels the screen offers are the two the contract carries, and SMS is not one of them', MG.CHANNELS.filter((c) => !c.worksOffline).map((c) => c.channel).join(' · ') === 'whatsapp · email', MG.CHANNELS.map((c) => c.channel).join(' · '));
  pass('a message with no number on the record is refused rather than typed in here', codes(outbound({ phone: '' })).includes('no-number') && MG.checkOutbound({ ...message, phone: '' }, mctx).reasons.some((r) => r.message.includes('mistyped digit')));
  pass('an attachment is refused on every outbound channel: a share can be withdrawn, an email cannot', codes(outbound({ attachments: 1 })).includes('no-attachments'));
  pass('a message long enough to be a letter is refused, in a sentence about a telephone rather than about a tariff', codes(outbound({ body: 'x'.repeat(500) })).includes('too-long') && outbound({ body: 'x'.repeat(500) }).reasons.some((r) => r.message.includes('letter on a telephone')));
  pass('a message carrying a diagnosis is refused', codes(outbound({ body: 'Your biopsy shows cancer and the oncologist will see you next week about treatment.' })).includes('clinical-detail'));
  pass('the quiet hours are the contract’s numbers rather than the screen’s own', MG.QUIET_HOURS.from === 21 * 60 && MG.QUIET_HOURS.to === 8 * 60 && MG.QUIET_HOURS.note.includes('23:40'), `${MG.QUIET_HOURS.from / 60}:00 → ${MG.QUIET_HOURS.to / 60}:00`);
  pass('an outward channel with the uplink down is refused as online-only, and the sentence says why', codes(MG.checkOutbound(message, { ...mctx, cloudReachable: false })).includes('offline-not-allowed') && MG.checkOutbound(message, { ...mctx, cloudReachable: false }).reasons.some((r) => r.message.includes('online-only')), 'a queued message is one the hospital believes it sent');
  pass('a message sent at 23:00 is given the quiet hours back, and the window is the contract’s rather than the screen’s memory of it', warns(MG.checkOutbound(message, { ...mctx, nowMinute: NIGHT })).includes('quiet-hours') && MG.QUIET_HOURS.from === 21 * 60 && MG.QUIET_HOURS.to === 8 * 60);
  const oneNotice = MG.NOTICES[0];
  const itsAudience = audiences.find((a) => `${a.kind}:${a.ref}` === oneNotice.audience) ?? team;
  const readCodes = new Set(MG.receiptsFor(oneNotice.id).map((r) => r.staffCode));
  pass('a receipt is one row per person per notice, and the unread list is the difference', MG.NOTICES.every((n) => MG.receiptsFor(n.id).length <= n.recipientCount) && MG.receiptsFor(oneNotice.id).length <= oneNotice.readCount + 1 && MG.unreadBy(oneNotice, itsAudience, MG.RECEIPTS).length === itsAudience.members.filter((m) => !readCodes.has(m.code)).length, `${MG.receiptsFor(oneNotice.id).length} receipts on “${oneNotice.subject.slice(0, 30)}…”`);
  const digestM = MG.messagingDigest(MG.NOTICES, MG.CONSENTS);
  pass('the notice digest counts the board and the outward channels apart, which is the whole design', digestM.notices === MG.NOTICES.length && digestM.failed === MG.NOTICES.filter((n) => n.status === 'failed').length && digestM.consents === MG.CONSENTS.filter((c) => !c.withdrawnOn).length, `${digestM.notices} notices · ${digestM.failed} failed · ${digestM.consents} consents`);
  pass('the templates are written for the patient and carry the number to call', MG.TEMPLATES.length >= 3 && MG.TEMPLATES.every((t) => t.body.length > 60 && t.when.length > 20 && t.label.length > 5), MG.TEMPLATES.map((t) => t.key).join(' '));

  /* ===================================================== 5. certificates and cards */

  const blocksOut = DC.NUMBER_BLOCKS;
  const exhausted = blocksOut.filter((b) => DC.blockExhausted(b));
  pass('every number comes from a block reserved to one node, and the exhausted block is the single one', blocksOut.length >= 4 && exhausted.length === 1 && exhausted[0].node === 'DHK-02' && blocksOut.every((b) => b.to >= b.from && b.lastDrawn >= b.from - 1 && b.reservedOn), blocksOut.map((b) => `${b.series} ${DC.blockRemaining(b)} left`).join(' · '));
  pass('the card’s columns are data, so the staff card and the patient card cannot drift apart', DC.CARD_COLUMNS.staff.length === 11 && DC.CARD_COLUMNS.patient.length === 7 && DC.cardFieldsFor('staff').length > 0 && DC.cardFieldsFor('patient').length > 0, `${DC.cardFieldsFor('staff').length} staff fields, ${DC.cardFieldsFor('patient').length} patient fields`);
  pass('every certificate names the evidence it points at, and every card its template', DC.CERTIFICATES.every((c) => c.no && c.issuedBy && c.evidenceRef && c.templateKey) && DC.IDENTITY_CARDS.every((c) => c.no && c.templateKey && c.issuedOn), `${DC.CERTIFICATES.length} certificates, ${DC.IDENTITY_CARDS.length} cards`);
  pass('a register is looked up by the number it prints, not by a second id', DC.CERTIFICATES.every((c) => DC.certificateByNo(c.no)?.no === c.no) && DC.IDENTITY_CARDS.every((c) => DC.cardByNo(c.no)?.no === c.no));
  const staffCard = DC.IDENTITY_CARDS.find((c) => c.subject === 'staff' && c.status === 'active');
  const cardBlock = DC.NUMBER_BLOCKS.find((b) => b.series.startsWith('CARD-S')) ?? DC.NUMBER_BLOCKS[1];
  const evidence = { lastConsultationOn: '2026-10-02', diagnosisRecorded: true, vitalsRecorded: true, staffJoinedOn: '2021-04-01', probationEndsOn: null, disciplinaryOpen: false, payrollMonths: ['2026-09', '2026-10'], licenceExpiry: '2027-06-30' };
  const dctx = { today: DAY, certificates: DC.CERTIFICATES, cards: DC.IDENTITY_CARDS, evidence, block: cardBlock, signedInRole: 'Hospital admin', signedInName: 'M. Hoque' };
  const cardDraft = { ...staffCard };
  delete cardDraft.no;
  delete cardDraft.status;
  delete cardDraft.issuedOn;
  delete cardDraft.printed;
  delete cardDraft.revokedOn;
  delete cardDraft.revokeReason;
  const cleanCard = DC.checkCard({ ...cardDraft, validUntil: '2026-12-31', supersedes: '' }, dctx);
  pass('a card with a photograph, a name in both languages and a validity inside the licence is issued', cleanCard.ok, codes(cleanCard).join(', ') || `from ${cardBlock.series}, ${DC.blockRemaining(cardBlock)} numbers left`);
  pass('a card without a photograph is refused: a card is a security claim with a face on it', codes(DC.checkCard({ ...cardDraft, validUntil: '2026-12-31', photoRef: '' }, dctx)).includes('no-photo'));
  pass('a card that would outlive the licence behind it is refused', codes(DC.checkCard({ ...cardDraft, validUntil: '2028-01-01' }, dctx)).includes('outlives-licence'));
  pass('an exhausted block refuses rather than renumbering somebody else’s card', codes(DC.checkCard({ ...cardDraft, validUntil: '2026-12-31' }, { ...dctx, block: exhausted[0] })).includes('number-block-exhausted'));
  const certDraft = { kind: 'salary', subjectKind: 'staff', subjectMrn: '', subjectStaffCode: 'EMP-1042', subjectName: 'R. Howlader', purpose: 'For the bank, stating the monthly salary on the payroll register.', body: 'This is to certify that the person named above is employed by the hospital and that the salary on the payroll register is paid monthly.', validUntil: '', supersedes: '' };
  pass('a certificate with no stated purpose is refused', codes(DC.checkCertificate({ ...certDraft, purpose: '' }, dctx)).includes('no-purpose'));
  const fitnessDraft = { ...certDraft, kind: 'fitness', subjectKind: 'patient', subjectStaffCode: '', subjectMrn: 'SH-102311', subjectName: 'Rahima Khatun', purpose: 'For the employer, stating fitness to return to work after the illness recorded.', body: 'The patient named above was examined at this hospital and is fit to return to work.' };
  const clerkSigned = DC.checkCertificate(fitnessDraft, { ...dctx, signedInRole: 'Records clerk' });
  pass('a fitness certificate signed at the records desk is refused, because that is the error that gets one withdrawn', codes(clerkSigned).includes('wrong-signer') && clerkSigned.reasons.some((r) => r.message.includes('records desk')), codes(clerkSigned).join(', ') || 'the desk may not sign a fitness opinion');
  pass('the same fitness certificate signed by the consultant who examined the patient is issued', DC.checkCertificate(fitnessDraft, { ...dctx, signedInRole: 'Consultant' }).ok, codes(DC.checkCertificate(fitnessDraft, { ...dctx, signedInRole: 'Consultant' })).join(', ') || 'evidence: the consultation holds the vitals');
  const expiring = DC.cardsExpiring(DC.IDENTITY_CARDS, DAY, 90);
  pass('expiring cards are the active ones inside the window, and nothing else', expiring.length === DC.IDENTITY_CARDS.filter((c) => c.status === 'active' && c.validUntil >= DAY && c.validUntil <= '2027-01-14').length && expiring.every((c) => c.status === 'active'), `${expiring.length} within ninety days of ${DAY}`);
  pass('the screen says what it is waiting for in sentences rather than in keywords', DC.DOCUMENT_WAITING.length >= 3 && DC.DOCUMENT_WAITING.every((w) => w.length > 60));

  /* ===================================================== 6. the portal */

  pass('the portal counts in Bangla by default, and the English switch is a switch', PT.bnDigits('0123456789') === '০১২৩৪৫৬৭৮৯' && PT.moneyIn(1200, 'bn').includes('৳') && PT.moneyIn(1200, 'bn') !== PT.moneyIn(1200, 'en'), `${PT.moneyIn(1200, 'bn')} / ${PT.moneyIn(1200, 'en')}`);
  pass('the bills’ own arithmetic is the arithmetic the screen shows', PT.BILLS.every((b) => Math.abs(PT.billTotal(b) - sum(b.lines, (l) => l.qty * l.rate)) < 0.001 && PT.billDue(b) === Math.max(0, PT.billTotal(b) - b.paid)) && Math.abs(PT.outstanding(PT.BILLS) - sum(PT.BILLS, (b) => Math.max(0, PT.billTotal(b) - b.paid))) < 0.001, `৳ ${PT.outstanding(PT.BILLS).toLocaleString('en-IN')} outstanding over ${PT.BILLS.length} bills`);
  const withheld = PT.RESULTS.filter((r) => r.state === 'withheld');
  const released = PT.RESULTS.filter((r) => r.state === 'released');
  pass('a withheld result is on the list with the reason and the desk number, not hidden', withheld.length > 0 && withheld.every((r) => (r.withheldReason ?? '').length > 20) && released.length > 0, withheld.map((r) => r.test).join(', '));
  pass('a prescription says what it is and is not a repeat', PT.PRESCRIPTIONS.length > 0 && PT.PRESCRIPTIONS.every((p) => p.items.length > 0), `${PT.PRESCRIPTIONS.length} prescriptions`);
  const pctx = { today: DAY, nowMinute: 10 * 60, appointments: PT.APPOINTMENTS, bills: PT.BILLS, gatewayConnected: false };
  const takenSlot = PT.TAKEN_SLOTS[0].split(' ');
  const taken = PT.checkBooking({ clinicId: PT.PORTAL_CLINICS[0].id, on: takenSlot[0], time: takenSlot[1] }, pctx);
  pass('a slot that went while the patient was choosing is refused, and the next free times are offered', codes(taken).includes('dizi.slot-taken') && taken.reasons[0].message.includes('Nothing has been booked'), taken.reasons[0].message.replace(/  +/g, ' ').slice(0, 120) + '…');
  pass('every portal refusal is written in Bangla as well as in English', taken.reasons.every((r) => hasBengali(r.messageBn)) && PT.checkBooking({ clinicId: '', on: '', time: '' }, pctx).reasons.every((r) => hasBengali(r.messageBn)));
  /* The hospital has more than one branch, and a patient who books into a clinic at another one without noticing
   * arrives at the wrong gate — with the appointment already given away. */
  const away = PT.PORTAL_CLINICS.find((c) => c.branch !== PT.PATIENT.branch);
  const here = PT.PORTAL_CLINICS.find((c) => c.branch === PT.PATIENT.branch);
  const awayCheck = PT.checkBooking({ clinicId: away.id, on: PT.ADD_DAYS ? PT.ADD_DAYS(pctx.today, 3) : '2026-10-20', time: away.times[0] }, pctx);
  const hereCheck = PT.checkBooking({ clinicId: here.id, on: PT.ADD_DAYS ? PT.ADD_DAYS(pctx.today, 3) : '2026-10-20', time: here.times[0] }, pctx);
  pass('a clinic that meets at another branch says so before the booking is sent, and one at the patient’s own branch does not', awayCheck.ok && awayCheck.warnings.some((w) => w.code === 'another-branch' && w.messageBn.includes('শাখা')) && !hereCheck.warnings.some((w) => w.code === 'another-branch'), awayCheck.warnings.map((w) => w.code).join(', ') || 'no warning');
  pass('booking in the past, or further ahead than the window, is refused with the window named', codes(PT.checkBooking({ clinicId: PT.PORTAL_CLINICS[0].id, on: '2026-09-01', time: '10:00' }, pctx)).includes('in-the-past') && codes(PT.checkBooking({ clinicId: PT.PORTAL_CLINICS[0].id, on: '2027-03-01', time: '10:00' }, pctx)).includes('too-far'));
  const busy = [{ id: 'x1', state: 'booked', on: '2026-10-29', time: '09:00', department: 'other' }, { id: 'x2', state: 'booked', on: '2026-10-30', time: '09:00', department: 'other' }, { id: 'x3', state: 'booked', on: '2026-10-31', time: '09:00', department: 'other' }];
  pass('a fourth open appointment is refused before a fifth is taken', codes(PT.checkBooking({ clinicId: PT.PORTAL_CLINICS[1].id, on: '2026-10-29', time: PT.PORTAL_CLINICS[1].times[0] }, { ...pctx, appointments: busy })).includes('too-many-open'));
  const soon = PT.APPOINTMENTS.find((a) => a.state === 'booked');
  const inside = PT.checkCancellation({ ...soon, on: DAY, time: '10:30' }, { ...pctx, nowMinute: 10 * 60 });
  pass('cancelling inside the last two hours is refused, and the desk number is given instead', codes(inside).includes('inside-cutoff') && inside.reasons.some((r) => r.message.includes('02 9876 540')) && PT.CANCEL_CUTOFF_HOURS === 2);
  pass('a visit that has happened cannot be cancelled, and cancelling twice is a duplicate', codes(PT.checkCancellation(PT.APPOINTMENTS.find((a) => a.state === 'attended'), pctx)).includes('already-seen') && codes(PT.checkCancellation({ ...soon, state: 'cancelled' }, pctx)).includes('dizi.duplicate-operation'));
  const due = PT.BILLS.find((b) => PT.billDue(b) > 0);
  const noGateway = PT.checkPayment(due, 100, pctx);
  pass('paying with no gateway connected is refused, and says that nothing has been charged', codes(noGateway).includes('dizi.offline-not-allowed') && noGateway.reasons.some((r) => r.message.includes('Nothing has been charged')) && hasBengali(noGateway.reasons.find((r) => r.code === 'dizi.offline-not-allowed').messageBn));
  pass('paying more than the balance, or nothing at all, is refused', codes(PT.checkPayment(due, PT.billDue(due) + 1, { ...pctx, gatewayConnected: true })).includes('over-balance') && codes(PT.checkPayment(due, 0, { ...pctx, gatewayConnected: true })).includes('no-amount'));
  const settled = PT.BILLS.find((b) => PT.billDue(b) === 0);
  pass('a settled bill cannot be paid a second time', settled ? codes(PT.checkPayment(settled, 100, { ...pctx, gatewayConnected: true })).includes('dizi.duplicate-operation') : false, settled ? `${settled.reference} is settled` : 'no settled bill on the register');
  const feedback = (patch) => PT.checkFeedback({ subject: 'Waiting time', about: 'Outdoor clinic', whatINoticed: 'I waited from eight until half past ten before the doctor saw me.', mayTelephone: true, ...patch }, pctx);
  pass('feedback that is an emergency is refused with the number to call now, not queued behind a form', codes(feedback({ whatINoticed: 'My father has Chest Pain and cannot breathe properly since this morning.' })).includes('emergency') && feedback({ whatINoticed: 'My father has Chest Pain and cannot breathe properly since this morning.' }).reasons[0].message.includes('02 9876 500'));
  pass('a clinical question is refused and pointed at the doctor rather than answered here', codes(feedback({ whatINoticed: 'Should I take my blood pressure medicine twice a day now?' })).includes('clinical-question'));
  const named = feedback({ whatINoticed: 'Nurse Fatima was very kind and explained the medicine carefully to my mother.' });
  pass('a complaint that names a member of staff is accepted, and the person named is shown it', named.ok && warns(named).includes('names-a-person'), named.ok ? 'warning: names-a-person' : codes(named).join(', '));
  pass('a two-word complaint is refused, because nobody can act on it', codes(feedback({ whatINoticed: 'It was bad.' })).includes('too-short'));
  pass('the portal’s sign-in is an honest stub that says what is missing rather than a password box', PT.PORTAL_AUTH.built === false && PT.PORTAL_AUTH.what.length > 60 && hasBengali(PT.PORTAL_AUTH.whatBn) && PT.PORTAL_WAITING.length >= 3, PT.PORTAL_AUTH.waits.slice(0, 80) + '…');
  const labels = Object.values(PT.STR);
  pass('the portal’s labels are bilingual, which is what makes it readable in Bangla by default', labels.length >= 50 && labels.filter((v) => v && typeof v === 'object' && hasBengali(v.bn)).length >= labels.length * 0.9, `${labels.length} labels, ${labels.filter((v) => v && typeof v === 'object' && hasBengali(v.bn)).length} in Bangla`);

  /* ===================================================== 7. the contract these screens queue against */

  const contract = JSON.parse(readFileSync(join(root, 'packages/contracts/dist/capabilities.json'), 'utf8'));
  const ops = contract.operations;
  const entities = Object.keys(contract.entities ?? {});
  const p8Entities = ['telemedicine.session', 'content.item', 'content.type', 'certificate.issue', 'identity.card', 'survey.form', 'survey.assignment', 'survey.response', 'cms.page', 'message.notice', 'portal.feedback', 'prescription', 'lab.result'];
  const missingEntities = p8Entities.filter((e) => !entities.includes(e));
  pass('every P8 entity is one the contract’s schemas declare', missingEntities.length === 0, missingEntities.join(', ') || `${p8Entities.length} entities of ${entities.length}`);
  const writes = ['bookTeleSession', 'startTeleSession', 'endTeleSession', 'createContentType', 'updateContentType', 'uploadContent', 'updateContentItem', 'shareContent', 'revokeContentShare', 'approveContentItem', 'issueCertificate', 'revokeCertificate', 'issueIdCard', 'revokeIdCard', 'createSurveyForm', 'updateSurveyForm', 'publishSurveyForm', 'assignSurveyForm', 'submitSurveyResponse', 'createCmsPage', 'updateCmsPage', 'publishCmsPage', 'sendNotice', 'recordNoticeReceipt', 'sendPatientMessage', 'bookPortalAppointment', 'cancelPortalAppointment', 'recordResultDownload', 'payPortalBill', 'submitPortalFeedback'];
  const missingOps = writes.filter((id) => !ops[id]);
  pass('every write the twelve screens and the portal queue is an operation the contract declares', missingOps.length === 0, missingOps.join(', ') || `${writes.length} operations`);
  /* Two operations answer without naming a record, and both are computations rather than facts: `health` is the
     liveness probe, and `reportAggregate` is a table built by reading the registers. They are listed rather than
     exempted by method, so a read added later cannot quietly drop the entity it queues against. */
  const noEntity = ['health', 'reportAggregate'];
  const badMeta = Object.entries(ops).filter(([, o]) => !['queue', 'cache', 'online-only'].includes(o.offline) || !o.authority || !o.because || (!noEntity.includes(o.id) && !o.entity));
  pass('every operation states what it queues against, on whose authority, and why it exists', badMeta.length === 0, badMeta.map(([id]) => id).join(', ') || `${Object.keys(ops).length} operations, ${noEntity.length} of them computations with no record`);
  pass('every reason is a sentence rather than a label', Object.values(ops).every((o) => o.because.length >= 80 && o.because.trim().endsWith('.')) && Object.values(ops).every((o) => (o.offline === 'online-only' ? (o.notes ?? '').length > 20 : true)), `shortest is ${Math.min(...Object.values(ops).map((o) => o.because.length))} characters`);
  const p8Tags = new Set(['telemedicine', 'content', 'records', 'engagement', 'cms', 'messaging', 'portal']);
  const p8Ops = Object.values(ops).filter((o) => p8Tags.has(o.tag));
  const p8Online = p8Ops.filter((o) => o.offline === 'online-only').map((o) => o.id);
  /* Six, not five: `retryNotificationDelivery` arrived with P0-403's delivery log and is online-only for the same
     reason `sendPatientMessage` is — an attempt that was recorded is a fact, and a retry queued for later sends
     tomorrow a message the desk expected to leave today. The list is here rather than derived so that an operation
     cannot become online-only without somebody writing down which act it is and why. */
  const onlineActs = ['approveContentItem', 'publishSurveyForm', 'publishCmsPage', 'sendPatientMessage', 'retryNotificationDelivery', 'payPortalBill'];
  pass('the acts a node cannot do alone are online-only, and they are the six the screens explain', p8Online.length === onlineActs.length && onlineActs.every((id) => p8Online.includes(id)), p8Online.join(' · '));
  pass('the P8 operations carry their idempotency key where the contract requires one', writes.every((id) => ops[id].requiresIdempotencyKey === true) && contract.idempotencyHeader.requiredOn.includes('submitSurveyResponse') && contract.idempotencyHeader.requiredOn.includes('payPortalBill'), `${p8Ops.filter((o) => o.offline === 'queue').length} queued, ${p8Ops.filter((o) => o.offline === 'cache').length} read from the replica`);
  const problems = Object.keys(contract.problemTypes ?? {});
  pass('the refusals the screens show are contract problem types rather than invented strings', ['dizi.form-closed', 'dizi.consent-missing', 'dizi.slot-taken', 'dizi.number-block-exhausted', 'dizi.duplicate-operation', 'dizi.offline-not-allowed'].every((c) => problems.includes(c)), `${problems.length} problem types`);
  pass('the seven areas the phase covers are the seven tags the operations carry', p8Ops.length >= 40 && [...p8Tags].every((tag) => Object.values(ops).some((o) => o.tag === tag)));

  /* ===================================================== 8. the phase is the plan */

  const plan = readFileSync(join(root, 'docs/plan/03-SCREEN-MAP.md'), 'utf8');
  const section = plan.slice(plan.indexOf('## P8 —'), plan.indexOf('## Summary'));
  const planRows = section.split('\n').filter((l) => l.startsWith('| **')).map((line) => {
    const cells = line.split('|').map((c) => c.trim());
    return { title: cells[1].replace(/\*\*/g, ''), legacy: cells[2].replace(/`/g, ''), size: cells[3], fields: Number(cells[4]), grids: Number(cells[5]), maxCols: Number(cells[6]), dialogs: Number(cells[8]) };
  });
  pass('the plan names twelve screens and no sub-screens for the phase', planRows.length === 12 && /0 sub-screens/.test(section), `${planRows.length} rows`);
  const screens = AD.ADMIN_SCREENS.filter((s) => s.phase === 'P8' && s.kind === 'screen');
  pass('the registry is twelve screens, and the phase’s own count says the same', screens.length === 12 && AD.P8_SCREEN_COUNT.screens === 12 && AD.P8_SCREEN_COUNT.subs === 0, `${screens.length} screens · ${AD.P8_SCREEN_COUNT.subs} sub-screens`);
  const drifted = planRows.filter((row) => {
    const found = AD.ADMIN_SCREENS.find((s) => s.legacy === row.legacy);
    return !found || found.title !== row.title || found.size !== row.size || found.fields !== row.fields || found.grids !== row.grids || found.maxCols !== row.maxCols || found.dialogs !== row.dialogs || found.phase !== 'P8';
  });
  pass('the registry matches the plan field by field', drifted.length === 0, drifted.map((r) => r.title).join(' · ') || 'title, size, fields, grids, columns and dialogs all agree with the screen map');
  const noPage = screens.filter((s) => !pageAt(s.route));
  pass('every registered screen has a page behind it', noPage.length === 0, noPage.map((s) => s.route).join(', ') || `${screens.length} routes on disk`);
  const runtime = readFileSync(join(root, 'tools/test/runtime.mjs'), 'utf8');
  const unvisited = screens.filter((s) => !runtime.includes(`'${s.route}'`));
  pass('every registered screen is visited by the runtime harness, which also checks that it hydrates', unvisited.length === 0, unvisited.map((s) => s.route).join(', ') || 'rendered, hydrated and read for console errors');
  const nav = readFileSync(join(root, 'apps/web/lib/nav.ts'), 'utf8');
  pass('the hub the phase is entered from exists, and the nav points at it', existsSync(join(root, 'apps/web/app/(staff)/admin/comms/page.tsx')) && nav.includes('/admin/comms'));
  pass('every group on the hub holds screens that exist on disk, and says why they are one group', AD.COMMS_GROUPS.length === 6 && AD.COMMS_GROUPS.every((g) => g.members.length >= 1 && g.because.length > 40 && g.members.every((m) => { const screen = AD.adminScreenById(m); return Boolean(screen) && Boolean(pageAt(screen.route)); })), AD.COMMS_GROUPS.map((g) => `${g.title} (${g.members.length})`).join(' · '));
  pass('the phase says what it is waiting for, and every screen states what it is for', AD.P8_WAITING.length >= 3 && AD.P8_WAITING.every((w) => w.length > 60) && screens.every((s) => s.purpose.length > 60) && new Set(screens.map((s) => s.route)).size === screens.length, `${AD.P8_WAITING.length} waiting items`);
  /* ---------------------------------------------------------------- one report, one visit
   *
   * The list answers “is it ready?”; the detail screen answers what it said. Three claims hold it up: a value
   * outside its range carries the sentence that explains it, a withheld report has no values at all, and every
   * visit the doctor released has something written behind it.
   */
  const lines = PT.reportLinesFor('rs-2');
  const flagged = PT.outsideRange(lines);
  pass(
    'a value outside its range is found by its own arithmetic and carries a sentence',
    flagged.length === 1 && flagged[0].key === 'hb' && flagged[0].meaning.length > 40 && flagged[0].meaningBn.length > 20 && PT.valueFlag(lines.find((l) => l.key === 'plt')) === 'normal',
    `${lines.length} lines · ${flagged.map((l) => l.key).join(',')} outside`,
  );
  /* Every value the register flags is checked for the sentence beside it — read from the register rather than from
   * the one report the screen above happens to show. */
  const unexplained = Object.entries(PT.LAB_VALUES).flatMap(([reportId, list]) =>
    PT.outsideRange(list).filter((v) => !(v.meaning && v.meaningBn)).map((v) => `${reportId}/${v.key}`),
  );
  pass('no report posts a number the hospital cannot explain', unexplained.length === 0, unexplained.join(', ') || `${Object.keys(PT.LAB_VALUES).length} reports with values`);
  pass(
    'a released report has values and a withheld one has none',
    PT.reportLinesFor('rs-2').length > 0 && PT.resultById('rs-5').state === 'withheld' && PT.reportLinesFor('rs-5').length === 0,
    `${PT.reportLinesFor('rs-2').length} shown · ${PT.reportLinesFor('rs-5').length} withheld`,
  );
  const wordLines = PT.reportLinesFor('rs-4');
  pass(
    'a finding that is a word is not dressed up as a number between two equal numbers',
    wordLines.every((l) => l.kind === 'text') && wordLines.every((l) => l.meaning.length > 40 && l.meaningBn.length > 20) && PT.outsideRange(wordLines).length === 0,
    wordLines.map((l) => `${l.label}: ${l.value}`).join(' · '),
  );

  const visited = PT.APPOINTMENTS.filter((a) => a.state === 'attended');
  const noted = visited.filter((a) => PT.visitNote(a.id));
  pass(
    'every visit that happened has a summary behind it, released by the doctor',
    noted.length === visited.length && noted.every((a) => PT.visitNote(a.id).releasedOn && PT.visitNote(a.id).advice.length >= 2 && PT.visitNote(a.id).adviceBn.length === PT.visitNote(a.id).advice.length),
    `${noted.length} of ${visited.length} visits`,
  );
  pass(
    'a visit that did not happen has no note, because nothing happened',
    PT.APPOINTMENTS.filter((a) => a.state === 'missed' || a.state === 'cancelled').every((a) => !PT.visitNote(a.id)),
    `${PT.VISIT_NOTES.length} notes · none for a missed or cancelled visit`,
  );
  /* The booking fee follows the desk's rule, read from the desk's module rather than retyped here — and the outcome
   * turns on *when* the cancellation happened, which is the part a screen can get wrong by being kind. */
  const feeWindow = PT.FEE_CUTOFF_HOURS;
  pass(
    'the booking fee follows the hospital’s own rule rather than a second one',
    PT.bookingFeeOutcome({ state: 'attended' }) === 'adjusted' &&
      PT.bookingFeeOutcome({ state: 'missed' }) === 'retained' &&
      PT.bookingFeeOutcome({ state: 'booked' }) === 'held' &&
      PT.bookingFeeOutcome({ state: 'cancelled', cancelledBeforeHours: feeWindow + 2 }) === 'refunded' &&
      PT.bookingFeeOutcome({ state: 'cancelled', cancelledBeforeHours: feeWindow - 2 }) === 'retained' &&
      PT.bookingFeeOutcome({ state: 'cancelled' }) === 'retained' &&
      PT.BOOKING_FEE === 200 &&
      PT.FEE_CUTOFF_HOURS === 4,
    `৳${PT.BOOKING_FEE} · refund window ${feeWindow} h, read from the desk’s own module · a cancellation inside it keeps the fee`,
  );
  pass(
    'cancelling shortly before the slot says what it costs before it happens, not after',
    PT.checkCancellation({ id: 'ap-9', on: '2026-10-20', time: '09:00', department: 'x', departmentBn: 'x', doctor: 'x', room: 'x', branch: 'Main Campus', token: '—', state: 'booked', fee: 800 }, { ...pctx, today: '2026-10-20', nowMinute: 6 * 60 }).warnings.some((w) => w.code === 'short-notice' && w.message.includes('booking fee is kept')),
    '3 hours before the slot',
  );
  const badAddress = ['ap-3', 'rs-2'].map((id) => id);
  pass(
    'the detail screens look a record up by id, and an id that is not on the register is answered rather than crashed',
    badAddress.every((id) => Boolean(PT.appointmentById(id) || PT.resultById(id))) && PT.appointmentById('nope') === undefined && PT.resultById('nope') === undefined,
    'appointmentById · resultById',
  );

  pass('the portal and the public site are routes of their own, not screens inside the staff app', existsSync(join(root, 'apps/web/app/(portal)/portal/page.tsx')) && existsSync(join(root, 'apps/web/app/(site)/site/page.tsx')) && !nav.includes('/portal') && !nav.includes('/site'));

  if (failures.length > 0) {
    console.log(`\n${failures.length} failure(s):\n${failures.map((f) => `  · ${f}`).join('\n')}\n`);
    process.exit(1);
  }
  console.log('\np8 — every case passed\n');
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
