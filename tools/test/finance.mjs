#!/usr/bin/env node
/**
 * The cash book's rules, exercised (P6).
 *
 * `apps/web/lib/finance.ts` holds the rules a hospital's money obeys: which voucher may be paid and who has to
 * sign it, what has to be withheld on the way out, which counter's drawer is which, and what a difference
 * between the book and the till means. This test bundles that module — the real one, not a copy — and checks:
 *
 *   1. **The approval ladder.** Amount decides the role, a second signature, a quotation — and one person may
 *      not sign twice, may not approve their own voucher, and cash stops at the counter limit.
 *   2. **Withholding and VAT.** Deducted when the supplier is paid, not promised later; the payable is
 *      gross + VAT − withholding, and a head that attracts neither says so.
 *   3. **Reconciliation has three states, and they are different questions.** *Agrees* is a complete book and a
 *      drawer that adds up; *explained* is a receipt still queued on the device that took it; *investigate* is a
 *      short drawer, and a queue never explains that.
 *   4. **The counters are counted**: the billing counter against the day-end sheet, the pharmacy window against
 *      what it dispensed, the ambulance desk against the trips that completed — and geometry is not left to
 *      chance, because a book that totals is not a book that reconciles.
 *   5. **The two setup screens keep their promises**: a head may not re-label money it has already had matched, a
 *      rate the law does not have is refused, a lapsed agreement pays nothing, and the heads no agreement may
 *      name are the same list on the screen and in the register. Every seeded row is put through the rules its own
 *      screen enforces, because a fixture that would be refused on save is a fixture nobody can edit.
 *
 * Needs one dev-only package, like the other harnesses:
 *
 *     npm i --no-save esbuild && npm run test:finance
 *
 * Exit code 0 when every case passes, 1 otherwise.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('\nThis test needs one dev-only package:\n\n    npm i --no-save esbuild\n\nthen run `npm run test:finance` again.\n');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'dizi-finance-test-'));
const failures = [];
const money = (n) => `৳${Math.round(n).toLocaleString('en-US')}`;

function pass(what, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(what);
}

try {
  await esbuild.build({
    entryPoints: [join(root, 'apps/web/lib/finance.ts')],
    outdir: work,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    absWorkingDir: root,
    tsconfig: join(root, 'apps/web/tsconfig.json'),
    logLevel: 'error',
  });

  await esbuild.build({
    entryPoints: [join(root, 'apps/web/lib/finance-setup.ts')],
    outdir: work,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    absWorkingDir: root,
    tsconfig: join(root, 'apps/web/tsconfig.json'),
    logLevel: 'error',
  });

  const F = await import(pathToFileURL(join(work, 'finance.js')).href);
  const S = await import(pathToFileURL(join(work, 'finance-setup.js')).href);
  const DAY = '2026-10-14';
  const draft = (over = {}) => ({
    headCode: 'EXP-DRUG',
    payee: 'Square Pharmaceuticals — depot',
    gross: 24_000,
    method: 'Bank transfer',
    preparedBy: 'Accounts officer — N. Haque',
    day: DAY,
    today: DAY,
    ...over,
  });

  console.log('\nfinance — the cash book rules\n');

  /* ---------------------------------------------------------------- the approval ladder */
  console.log('  the ladder');
  const small = F.checkExpense(draft({ gross: 4_000, preparedBy: 'Accounts officer — N. Haque' }));
  pass('the bottom of the ladder asks for no second name', small.ok && small.approval.role === 'Accounts officer', `${money(4_000)} → ${small.approval.role}, no approver asked for`);

  const noSigner = F.checkExpense(draft({ gross: 24_000, approvedBy: undefined }));
  pass('above 5 000 a voucher without a signature is refused, naming the role', !noSigner.ok && noSigner.refusals.some((r) => /Finance manager/.test(r.message)), noSigner.refusals[0]?.message ?? '');

  const manager = F.checkExpense(draft({ gross: 24_000, approvedBy: 'Finance manager — S. Chowdhury' }));
  pass('the finance manager clears it', manager.ok, manager.refusals.map((r) => r.message).join(' | '));

  const director = F.checkExpense(draft({ gross: 120_000, approvedBy: 'Director — Dr. A. Rahman', secondApprover: 'Director — Prof. N. Sultana', quotationRef: 'QT-2026-0412' }));
  pass('above 50 000 it needs the director, a second signature and a quotation', director.ok, director.refusals.map((r) => r.message).join(' | '));

  const oneSignature = F.checkExpense(draft({ gross: 120_000, approvedBy: 'Director — Dr. A. Rahman', secondApprover: 'Director — Dr. A. Rahman', quotationRef: 'QT-2026-0412' }));
  pass('one person signing twice is refused', !oneSignature.ok && oneSignature.refusals.some((r) => r.code === 'same-signature'), oneSignature.refusals.find((r) => r.code === 'same-signature')?.message ?? 'not refused');

  const ownVoucher = F.checkExpense(draft({ gross: 24_000, preparedBy: 'Finance manager — S. Chowdhury', approvedBy: 'Finance manager — S. Chowdhury' }));
  pass('nobody approves their own voucher', !ownVoucher.ok && ownVoucher.refusals.some((r) => r.code === 'self-approval'), ownVoucher.refusals.find((r) => r.code === 'self-approval')?.message ?? 'not refused');

  const bigCash = F.checkExpense(draft({ gross: 150_000, method: 'Cash', approvedBy: 'Director — Dr. A. Rahman', secondApprover: 'Director — Prof. N. Sultana', quotationRef: 'QT-1' }));
  pass(`cash above ${money(F.CASH_PAYMENT_LIMIT)} is refused whatever the signature`, !bigCash.ok && bigCash.refusals.some((r) => r.code === 'cash-over-limit'), bigCash.refusals.find((r) => r.code === 'cash-over-limit')?.message ?? 'not refused');

  const meterBill = F.checkExpense(draft({ headCode: 'EXP-UTIL', gross: 96_000, approvedBy: 'Director — Dr. A. Rahman', secondApprover: 'Director — Prof. N. Sultana' }));
  pass('a meter or tariff bill is not asked for a quotation', meterBill.ok, meterBill.refusals.map((r) => r.message).join(' | '));

  const capitalGuard = F.checkExpense(draft({ headCode: 'EXP-REPAIR', gross: 300_000, approvedBy: 'Director — Dr. A. Rahman', secondApprover: 'Director — Prof. N. Sultana', quotationRef: 'TENDER-09' }));
  pass('a large bill on a revenue head is flagged for an asset check rather than refused', capitalGuard.ok && capitalGuard.notes.some((n) => /not an asset/.test(n)), capitalGuard.notes.find((n) => /not an asset/.test(n)) ?? 'no note');

  const belowFloor = F.checkExpense(draft({ headCode: 'EXP-EQUIP', gross: 30_000, approvedBy: 'Finance manager — S. Chowdhury' }));
  pass('equipment below the capital floor is expensed and says so', belowFloor.ok && belowFloor.notes.some((n) => /capitalisation floor/.test(n)), belowFloor.notes.find((n) => /capitalisation floor/.test(n)) ?? 'no note');

  const unknown = F.checkExpense(draft({ headCode: 'EXP-NOPE' }));
  pass('an unknown head refuses the voucher', !unknown.ok && unknown.refusals.some((r) => r.code === 'unknown-head'));

  /* ---------------------------------------------------------------- withholding and VAT */
  console.log('\n  what leaves the bank');
  const drugs = F.expenseHeadByCode('EXP-DRUG');
  const d = F.deductionsFor(drugs, 120_000);
  pass('drugs: 3 % withheld, 5 % VAT recorded, payable = gross + VAT − withholding', d.ait === 3_600 && d.vat === 6_000 && d.payable === 122_400, `ait ${money(d.ait)} · vat ${money(d.vat)} · payable ${money(d.payable)}`);

  const salary = F.deductionsFor(F.expenseHeadByCode('EXP-SALARY'), 400_000);
  pass('salary carries no voucher-level withholding — it is deducted per employee', salary.ait === 0 && salary.vat === 0 && salary.payable === 400_000, `payable ${money(salary.payable)}`);

  const prof = F.deductionsFor(F.expenseHeadByCode('EXP-PROF'), 35_000);
  pass('professional fees are withheld at the highest rate on the list', prof.ait === 3_500, `ait ${money(prof.ait)}`);

  pass('the VAT treatment is stated, because a branch outside the VAT net absorbs input tax', typeof F.INPUT_VAT_NOTE === 'string' && F.INPUT_VAT_NOTE.length > 80 && F.INPUT_VAT_CREDITABLE === false);

  /* ---------------------------------------------------------------- the day book */
  console.log('\n  the day book');
  const book = F.dayBook(DAY);
  pass('the day book totals and reconciles', book.verdict === 'agrees', `verdict ${book.verdict} — ${book.because}`);
  pass('every check passes on a clean day', book.checks.every((c) => c.ok), book.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.because}`).join(' | '));

  pass(
    'the drawer is the opening float plus cash in, less cash out',
    Math.abs(book.cash.closing - (book.cash.opening + book.cash.in - book.cash.out)) < 0.5,
    `${money(book.cash.opening)} + ${money(book.cash.in)} − ${money(book.cash.out)} = ${money(book.cash.closing)}`,
  );
  pass('the deposit leaves the retained float behind', Math.abs(book.cash.depositDue - Math.max(0, book.cash.closing - F.CASH_FLOAT_RETAINED)) < 0.5, `deposit ${money(book.cash.depositDue)}`);

  pass(
    'income vouchers are numbered gaplessly, in one series, in time order',
    book.income.every((v, i) => v.sequence === i + 1) && book.income.every((v, i) => i === 0 || book.income[i - 1].at <= v.at),
    `${book.income.length} vouchers, 1–${book.income.length}`,
  );

  const routes = new Set(book.income.map((v) => v.route));
  pass('a payer account is not the drawer', book.income.every((v) => (v.route === 'Payer account') === (v.method === 'Insurance' || v.method === 'Corporate')), `routes: ${[...routes].join(', ')}`);

  pass(
    'every counter is reconciled against its own module',
    book.points.length === 3 && book.points.every((p) => p.variance === 0),
    book.points.map((p) => `${p.point} ${money(p.recorded)}/${money(p.expected)}`).join(' · '),
  );

  pass(
    'a voucher waiting for a signature is not paid in the book',
    book.postedExpenses.every((v) => v.status === 'Posted') && book.awaiting.every((v) => v.refusals && v.refusals.length > 0),
    `${book.postedExpenses.length} posted · ${book.awaiting.length} awaiting${book.awaiting.length ? ` (${book.awaiting[0].refusals[0].slice(0, 60)}…)` : ''}`,
  );

  pass(
    'withholding and VAT are recorded per voucher, not only in a total',
    book.postedExpenses.every((v) => Math.round(v.ait) === Math.round(F.deductionsFor(F.expenseHeadByCode(v.headCode), v.gross).ait)),
    `AIT ${money(book.withholding.ait)} · VAT ${money(book.withholding.vat)}`,
  );

  /* ---------------------------------------------------------------- queued receipts */
  console.log('\n  a receipt the server has not seen');
  const queued = { ...book.income[0], id: 'QUEUED-1', no: 'RV-QUEUED', queued: true, amount: 1_500, route: 'Cash', method: 'Cash', point: 'Billing counter', invoiceNo: 'INV-TEST-1' };
  const queuedBook = F.dayBook(DAY, { queuedIncome: [queued] });
  pass('a queued receipt is listed but not booked', queuedBook.income.some((v) => v.id === 'QUEUED-1') && !queuedBook.points.some((p) => p.recorded > p.expected), 'in the list, not in the book');
  pass('and the day says so, by name and amount', queuedBook.awaitingSync.count === 1 && queuedBook.awaitingSync.amount === 1_500 && queuedBook.awaitingSync.numbers.includes('RV-QUEUED'), `${money(queuedBook.awaitingSync.amount)} — ${queuedBook.awaitingSync.numbers.join(', ')}`);
  pass('the verdict is explained, not agreed and not alarming', queuedBook.verdict === 'explained', `verdict ${queuedBook.verdict}`);
  pass('the money is in the box even though the ledger has not seen it', queuedBook.cash.in === book.cash.in + 1_500 && queuedBook.cash.bookedIn === book.cash.bookedIn, `in the box ${money(queuedBook.cash.in)} · booked ${money(queuedBook.cash.bookedIn)}`);
  pass('the counter it came from knows its drawer holds it', queuedBook.points.find((p) => p.point === 'Billing counter').drawer === book.points.find((p) => p.point === 'Billing counter').drawer + 1_500, money(queuedBook.points.find((p) => p.point === 'Billing counter').drawer));

  /* ---------------------------------------------------------------- counting the drawer */
  console.log('\n  counting the drawer');
  const countedRight = F.dayBook(DAY, { counted: Object.fromEntries(book.points.map((p) => [p.point, p.drawer])) });
  pass('a drawer that adds up leaves the day agreed', countedRight.verdict === 'agrees' && countedRight.points.every((p) => p.drawerVariance === 0), countedRight.points.map((p) => `${p.point} ${money(p.counted)}`).join(' · '));

  const short = book.points[1].drawer - 500;
  const countedShort = F.dayBook(DAY, { counted: { [book.points[1].point]: short } });
  pass('a drawer counted 500 short is investigated, not adjusted', countedShort.verdict === 'investigate' && countedShort.points[1].drawerVariance === -500, countedShort.points[1].because);
  pass('exactly one check fails, and it is the one about counting', countedShort.checks.filter((c) => !c.ok).length === 1 && /counted/i.test(countedShort.checks.find((c) => !c.ok).label), countedShort.checks.filter((c) => !c.ok).map((c) => c.label).join(', '));

  // A queued receipt is in the box: counting the drawer must not be confused by the queue.
  const countedWithQueue = F.dayBook(DAY, { queuedIncome: [queued], counted: { 'Billing counter': queuedBook.points.find((p) => p.point === 'Billing counter').drawer } });
  pass('a counted drawer that already includes a queued receipt adds up', countedWithQueue.points.find((p) => p.point === 'Billing counter').drawerVariance === 0, `counted ${money(countedWithQueue.points.find((p) => p.point === 'Billing counter').counted)}`);

  /* ---------------------------------------------------------------- the window the reports read */
  console.log('\n  the window the reports read');
  const window14 = F.financeWindow(DAY, 14);
  pass('a fourteen-day window carries one row per day', window14.days.length === 14 && window14.byDay.length === 14, `${window14.from} → ${window14.to}`);
  const dayCash = window14.days.reduce((n, day) => n + F.dayBook(day).cash.in, 0);
  pass('the window totals the days it covers, to the taka', Math.abs(window14.cash.in - dayCash) < 0.5, `${money(window14.cash.in)} across ${window14.days.length} days`);
  pass('and it separates the drawer from the bank and from what payers owe', window14.cash.in > 0 && window14.bank.out > 0 && window14.receivables.payerShare >= 0, `cash in ${money(window14.cash.in)} · cash out ${money(window14.cash.out)} · bank out ${money(window14.bank.out)} · owed by payers ${money(window14.receivables.payerShare)}`);
  pass(
    'income and expense heads come back sorted, ready to rank',
    window14.income.every((h, i) => i === 0 || window14.income[i - 1].amount >= h.amount) && window14.expense.every((h, i) => i === 0 || window14.expense[i - 1].amount >= h.amount),
    `${window14.income.length} income heads · ${window14.expense.length} expense heads`,
  );
  pass(
    'every head in the window is a head the register knows',
    [...window14.income, ...window14.expense].every((h) => Boolean(F.incomeHeadByCode(h.code) ?? F.expenseHeadByCode(h.code))),
  );

  /* ---------------------------------------------------------------- the payer's money: claims */
  console.log('\n  the claim register');
  const claims = F.generateClaims(DAY, DAY);
  const claimSnap = F.claimsSnapshot(claims);
  const finalClaims = claims.filter((c) => c.basis === 'Final bill');
  pass('the register is built from bills that exist, not from a list of its own',
    finalClaims.every((c) => /^[A-Z]{1,3}-\d{6,8}-\d{4}$/.test(c.invoiceNo) && c.mrn.startsWith('SH-') && c.patientName.length > 0)
      && finalClaims.every((c) => c.invoiceNo !== c.claimNo),
    `${finalClaims.length} against bills · ${claims.length - finalClaims.length} estimates`);
  const key = (c) => `${c.invoiceNo}|${c.payer}`;
  pass('one invoice, one claim, per payer — in the register as well as in the rule',
    new Set(finalClaims.map(key)).size === finalClaims.length,
    finalClaims.length + ' lines');

  const filed = claims.filter((c) => c.basis === 'Final bill' && c.submittedAt);
  pass('ageing runs from the day the claim was filed, never from the day of the bill',
    filed.every((c) => c.ageDays === F.daysBetween(c.submittedAt.slice(0, 10), DAY) && c.ageDays < F.daysBetween(c.raisedAt, DAY)),
    `oldest bill ${claims.reduce((m, c) => (c.raisedAt < m ? c.raisedAt : m), DAY)} · oldest filing ${filed.reduce((m, c) => (c.submittedAt.slice(0, 10) < m ? c.submittedAt.slice(0, 10) : m), DAY)}`);

  pass('a late filing is a real state: the paper arrived after the service did',
    filed.some((c) => F.daysBetween(c.raisedAt, c.submittedAt.slice(0, 10)) > F.CLAIM_FILING_DELAY_DAYS));

  const interim = claimSnap.interim;
  pass('the inpatients still in a bed are on the register as estimates, not as claims',
    interim.length > 0 && interim.every((c) => c.invoiceNo.startsWith('EST-') && c.basis === 'Interim estimate'),
    interim.map((c) => `${c.claimNo} ${money(c.claimed)}`).join(' · '));

  const approvedEstimate = interim.find((c) => c.status === 'Pre-auth approved') ?? interim[0];
  const interimCheck = F.checkClaim(approvedEstimate, claims);
  pass('submitting an estimate is refused for one reason: there is no bill yet',
    !interimCheck.ok && interimCheck.refusals.length === 1 && interimCheck.refusals[0].code === 'not-discharged',
    interimCheck.refusals[0]?.message.slice(0, 90));

  const underwritten = interim.filter((c) => c.claimed > F.payerAgreement(c.payer).preAuthAbove);
  pass('every estimate above its payer’s threshold is on the pre-authorisation watchlist',
    underwritten.length > 0 && underwritten.every((c) => ['Pre-auth requested', 'Pre-auth approved'].includes(c.status)),
    underwritten.map((c) => `${c.claimNo} ${c.status}`).join(' · '));

  const bigDraft = { ...claims.find((c) => c.basis === 'Final bill'), status: 'Draft', claimed: 90_000, preAuth: null, basis: 'Final bill', documents: F.payerAgreement(claims[0].payer).documents };
  pass('a bill above the threshold with no pre-authorisation is refused at the desk', F.checkClaim(bigDraft, claims).refusals.some((r) => r.code === 'pre-auth'));
  const noDocs = { ...bigDraft, claimed: 200, preAuth: 'PA-2610-0001', documents: [] };
  pass('and a claim missing its documents is refused by name', F.checkClaim(noDocs, claims).refusals.some((r) => r.code === 'documents' && /missing/.test(r.message)));
  const duplicate = { ...claims[0], status: 'Draft', claimNo: 'CL-999999-9999' };
  pass('one invoice, one claim, per payer: a second is refused with the claim that holds it',
    F.checkClaim(duplicate, claims).refusals.some((r) => r.code === 'duplicate-invoice'));

  const queried = claims.find((c) => c.status === 'Query raised');
  pass('a query is waiting on a document, and the register says which',
    Boolean(queried) && F.payerAgreement(queried.payer).documents.some((d) => !queried.documents.includes(d) && queried.notes.some((n) => n.includes(d))),
    queried ? queried.notes.find((n) => n.startsWith('Waiting on')) : 'no queried claim in the register');

  const shortPaid = claimSnap.claims.filter((c) => c.disallowed > 0);
  pass('a short payment is carried whole by the hospital or not at all',
    shortPaid.length > 0 && shortPaid.every((c) => c.absorbed === 0 || c.absorbed === c.disallowed),
    `${shortPaid.length} short-paid lines`);
  pass('money the hospital carries is either signed for or the claim stays open',
    shortPaid.every((c) => c.absorbed === 0 || c.absorbedBy !== null || c.status !== 'Settled')
      && claimSnap.totals.unassigned === claimSnap.claims.filter((c) => c.absorbed > 0 && !c.absorbedBy).reduce((n, c) => n + c.absorbed, 0),
    `unassigned ${money(claimSnap.totals.unassigned)}`);
  pass('a short payment always carries a reason code — an unexplained one teaches nothing',
    shortPaid.every((c) => c.rejectionReason !== null || c.shortPayCode !== null),
    [...new Set(shortPaid.map((c) => c.shortPayCode ?? c.rejectionReason))].join(' · '));

  const line = F.settleClaim({ ...claims[0], status: 'Submitted', allowed: 0, disallowed: 0 }, { allowed: Math.round(claims[0].claimed * 0.8), code: 'tariff', at: `${DAY} 16:00` });
  pass('recording an answer with nobody named to carry the difference leaves the claim open',
    line.status === 'Partially settled' && line.absorbed > 0 && line.absorbedBy === null && /Nobody has been named/.test(line.because),
    line.because);
  const rejected = F.settleClaim({ ...claims[0], status: 'Submitted' }, { allowed: 0, rejection: F.REJECTION_REASONS[0], at: `${DAY} 16:00` });
  pass('and a rejection is refused until somebody accepts it',
    rejected.status === 'Rejected' && rejected.absorbed === 0 && /unassigned/.test(rejected.because), rejected.because);

  pass('ageing buckets are the payer’s own promise first, and they add up to the register',
    F.AGEING_BUCKETS[0] === 'Within terms' && claimSnap.ageing.reduce((n, b) => n + b.count, 0) === claims.length,
    claimSnap.ageing.map((b) => `${b.bucket} ${b.count}`).join(' · '));
  pass('a reason code with no money against it is not reported as a short payment',
    claimSnap.reasons.every((r) => r.amount > 0), claimSnap.reasons.map((r) => `${r.code} ${money(r.amount)}`).join(' · '));
  pass('the register names what it cannot show, rather than inventing an old claim',
    /no payer bill older than/.test(F.CLAIM_REGISTER_NOTE) && claims.every((c) => F.daysBetween(c.raisedAt, DAY) <= F.CLAIM_REGISTER_DAYS + F.CLAIM_LATE_FILING_DAYS + 1),
    `${claimSnap.ageing.map((b) => `${b.bucket}:${b.count}`).join(' ')}`);

  /* ---------------------------------------------------------------- referral commission */
  console.log('\n  referral commission');
  const accruals = F.referralAccruals(DAY, 30);
  const run = F.payoutRun(accruals, DAY);
  pass('commission accrues on money collected, not on what was billed',
    accruals.every((a) => a.base <= a.collected));
  const blocked = accruals.filter((a) => F.COMMISSION_BLOCKED_HEADS.includes(a.headCode));
  pass('a head that is never commissioned earns nothing, whoever the agreement names',
    blocked.every((a) => a.commission === 0 && a.rate === 0 && a.status === 'Excluded' && /never commissioned/.test(a.exclusion ?? '')),
    `${blocked.length} blocked-head lines · blocked: ${F.COMMISSION_BLOCKED_HEADS.join(', ')}`);
  const offAgreement = accruals.filter((a) => /not in this agreement/.test(a.exclusion ?? ''));
  pass('a head the agreement does not name earns nothing either, and says which',
    offAgreement.length > 0 && offAgreement.every((a) => a.commission === 0 && a.rate === 0),
    `${offAgreement.length} lines outside the referrer’s heads`);
  const inHouseLines = accruals.filter((a) => a.referrerCode === 'REF-PROFS');
  const lapsed = accruals.filter((a) => a.referrerCode === 'REF-NURJAHAN');
  pass('a head that may never be commissioned outranks a lapsed agreement, because renewing would not pay it',
    lapsed.length > 0
      && lapsed.filter((a) => F.COMMISSION_BLOCKED_HEADS.includes(a.headCode)).every((a) => /never commissioned/.test(a.exclusion ?? ''))
      && lapsed.filter((a) => !F.COMMISSION_BLOCKED_HEADS.includes(a.headCode)).every((a) => /expired on/.test(a.exclusion ?? '')),
    `${lapsed.length} lines from the lapsed agreement · ${lapsed.filter((a) => /never commissioned/.test(a.exclusion ?? '')).length} named the head rule`);

  pass('an in-house consultant is refused a referral commission by name — one consultation, one payout',
    inHouseLines.length > 0 && inHouseLines.every((a) => a.commission === 0
      && a.status === 'Excluded'
      && /consultant share, not a referral commission|never commissioned/.test(a.exclusion ?? '')),
    `${inHouseLines.length} lines, none payable`);
  pass('the hold is a fortnight, so a refund can net off before the money leaves',
    accruals.every((a) => F.daysBetween(a.collectedAt.slice(0, 10), a.payableFrom) === F.COMMISSION_HOLD_DAYS),
    `${F.COMMISSION_HOLD_DAYS} days · ${accruals.filter((a) => a.status === 'Held').length} still held`);
  pass('a run pays what has become payable and shows what is still held',
    run.totalPayable > 0 && run.lines.every((l) => l.payable + l.held === l.accrued) && run.totalNet === run.totalPayable - run.totalTds,
    `payable ${money(run.totalPayable)} · held ${money(run.lines.reduce((n, l) => n + l.held, 0))} · net ${money(run.totalNet)}`);
  pass('withholding leaves with the payment, at the professional rate',
    run.lines.every((l) => l.tds === Math.round((l.payable * F.COMMISSION_TDS_PCT) / 100)),
    `${F.COMMISSION_TDS_PCT} % · ${money(run.totalTds)}`);
  pass('every exclusion names its reason, and an excluded line earns nothing',
    accruals.filter((a) => a.exclusion).every((a) => a.commission === 0 && a.status === 'Excluded' && a.exclusion.length > 40),
    `${accruals.filter((a) => a.status === 'Excluded').length} excluded lines`);

  /* ---------------------------------------------------------------- the setup rules (Setup › Finance, Setup › Referral) */
  console.log('\n  the setup rules');
  const seedVerdicts = S.SEED_HEADS.map((h) => S.checkHead(h, S.SEED_HEADS, { editing: true, hasMoneyInPeriod: true, periodEnds: DAY }));
  pass('every head on the ledger passes the rules its own setup screen enforces',
    seedVerdicts.every((v) => v.ok),
    `${S.SEED_HEADS.length} heads · ${seedVerdicts.filter((v) => !v.ok).map((v) => v.refusals[0]?.code).join(',') || 'none refused'}`);

  const incomeDraft = S.SEED_HEADS.find((h) => h.code === 'INC-OPD');
  const expenseDraft = S.SEED_HEADS.find((h) => h.code === 'EXP-SALARY');
  const opts = { editing: true, hasMoneyInPeriod: true, periodEnds: DAY, hasCapitalisedAssets: true };

  const bothSides = S.checkHead({ ...expenseDraft, code: 'INC-OPD' }, S.SEED_HEADS, opts);
  pass('one code may not sit on both sides of the book',
    !bothSides.ok && bothSides.refusals.some((r) => r.code === 'code-across-kinds'),
    bothSides.refusals.find((r) => r.code === 'code-across-kinds')?.message ?? 'not refused');

  const taxedIncome = S.checkHead({ ...incomeDraft, aitPct: 5 }, S.SEED_HEADS, opts);
  pass('an income head may not withhold — tax belongs to what the hospital pays',
    !taxedIncome.ok && taxedIncome.refusals.some((r) => r.code === 'tax-on-income'));

  const invented = S.checkHead({ ...incomeDraft, code: 'INC-NEW', categories: ['Imaging'] }, S.SEED_HEADS, { periodEnds: DAY });
  pass('a billing category this branch does not bill under is refused',
    !invented.ok && invented.refusals.some((r) => r.code === 'unknown-category'));

  const reDated = { ...S.SEED_HEADS.find((h) => h.code === 'INC-DIAG'), categories: ['Pathology', 'Radiology'] };
  const inside = S.checkHead({ ...reDated, effectiveFrom: DAY }, S.SEED_HEADS, opts);
  const after = S.checkHead({ ...reDated, effectiveFrom: '2026-11-01' }, S.SEED_HEADS, opts);
  pass('re-labelling a category while the period has money is refused, and dating it after the period is not',
    !inside.ok && inside.refusals.some((r) => r.code === 'category-moves-history')
      && after.ok && after.warnings.some((w) => /already matched keep the head/.test(w)),
    `dated ${DAY}: ${inside.refusals[0]?.code ?? 'allowed'} · dated 2026-11-01: ${after.ok ? 'allowed' : after.refusals[0]?.code}`);

  const offRegister = S.checkHead({ ...S.SEED_HEADS.find((h) => h.code === 'EXP-EQUIP'), group: 'Revenue' }, S.SEED_HEADS, opts);
  pass('a capital head may not become revenue while its assets are on the register',
    !offRegister.ok && offRegister.refusals.some((r) => r.code === 'capital-flip'),
    offRegister.refusals.find((r) => r.code === 'capital-flip')?.message?.slice(0, 60) ?? 'not refused');

  const oddRate = S.checkHead({ ...expenseDraft, aitPct: 7 }, S.SEED_HEADS, opts);
  const oddVat = S.checkHead({ ...expenseDraft, vatPct: 12, effectiveFrom: '2026-11-01' }, S.SEED_HEADS, opts);
  pass('a withholding or VAT rate the law does not have is refused',
    !oddRate.ok && oddRate.refusals.some((r) => r.code === 'ait-not-a-rate') && !oddVat.ok && oddVat.refusals.some((r) => r.code === 'vat-not-a-rate'),
    `withholding 7 % → ${oddRate.refusals[0]?.code} · VAT 12 % → ${oddVat.refusals[0]?.code}`);

  const noDate = S.checkHead({ ...expenseDraft, vatPct: 15, effectiveFrom: '' }, S.SEED_HEADS, opts);
  pass('a rate change with no effective date is refused',
    !noDate.ok && noDate.refusals.some((r) => r.code === 'no-effective'));

  const coverage = S.categoryCoverage();
  const shared = coverage.find((c) => c.state === 'shared');
  pass('the reconciliation credits the first head a category maps to, and the screen says which',
    coverage.every((c) => c.state !== 'unmapped' || c.winner === null)
      && (shared?.winner === shared?.heads[0]) === true,
    `${coverage.filter((c) => c.state === 'unmapped').map((c) => c.category).join(', ') || 'no gaps'} · shared: ${shared?.category} → ${shared?.winner}`);

  const withImaging = [...S.SEED_HEADS.filter((h) => h.kind === 'Income'), { ...incomeDraft, code: 'INC-IMAG', categories: ['Radiology'] }];
  pass('a head that collects a category nobody collected closes the gap the gap list reports',
    S.UNMAPPED_CATEGORIES(S.SEED_HEADS.filter((h) => h.kind === 'Income')).length === 1 && S.UNMAPPED_CATEGORIES(withImaging).length === 0,
    `${S.UNMAPPED_CATEGORIES(S.SEED_HEADS.filter((h) => h.kind === 'Income')).join(',')} → ${S.UNMAPPED_CATEGORIES(withImaging).length}`);

  pass('the heads no agreement may name are the same heads the register refuses',
    S.NEVER_COMMISSIONABLE().map((b) => b.head.code).sort().join(',') === [...F.COMMISSION_BLOCKED_HEADS].sort().join(','),
    S.NEVER_COMMISSIONABLE().map((b) => b.head.code).join(', '));

  const withheld = S.WITHHOLDING_HEADS();
  pass('the withholding list is ordered by what it holds back, and every row holds something',
    withheld.every((h) => h.aitPct != null || h.vatPct != null)
      && withheld.every((h, i) => i === 0 || (withheld[i - 1].aitPct ?? 0) >= (h.aitPct ?? 0)),
    `${withheld.length} heads · ${withheld[0]?.code} ${withheld[0]?.aitPct} % first`);

  const lapsedAgreement = S.SEED_AGREEMENTS.find((a) => a.code === 'REF-NURJAHAN');
  const lapsedState = S.agreementStatus(lapsedAgreement, DAY);
  const renewed = S.renewAgreement(lapsedAgreement, { to: '2027-09-30', by: 'Finance manager — S. Chowdhury', at: `${DAY} 16:10` });
  pass('a lapsed agreement pays nothing, and a renewal dated today starts it again',
    lapsedState.pays === false && lapsedState.daysToExpiry < 0 && S.agreementStatus(renewed, DAY).pays === true,
    `${lapsedAgreement.code} expired ${lapsedState.daysToExpiry} days ago → renewed to ${renewed.expiresOn}`);

  const weakTds = S.checkAgreement({ ...lapsedAgreement, tdsPct: 1 }, S.SEED_AGREEMENTS, DAY);
  const oneName = S.checkAgreement({ ...lapsedAgreement, approvedBy: lapsedAgreement.preparedBy }, S.SEED_AGREEMENTS, DAY);
  pass('an agreement may withhold more than the statute, never less — and it takes two names',
    !weakTds.ok && weakTds.refusals.some((r) => r.code === 'tds-low')
      && !oneName.ok && oneName.refusals.some((r) => r.code === 'self-approval'),
    `1 % → ${weakTds.refusals[0]?.code} · one name → ${oneName.refusals[0]?.code}`);

  pass('every agreement on file passes the rules its own screen enforces',
    S.SEED_AGREEMENTS.every((a) => S.checkAgreement(a, S.SEED_AGREEMENTS, DAY).ok),
    `${S.SEED_AGREEMENTS.length} agreements`);

  if (failures.length) {
    console.log(`\nFAILED — ${failures.length} case${failures.length === 1 ? '' : 's'}\n`);
    process.exitCode = 1;
  } else {
    console.log('\nOK — the ladder decides by amount, the tax leaves with the payment, the book explains a difference before it alarms, a claim is filed against a bill, and the two setup screens refuse what would break the ledger.\n');
  }
  process.exit(process.exitCode ?? 0);
} finally {
  rmSync(work, { recursive: true, force: true });
}
