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

  const F = await import(pathToFileURL(join(work, 'finance.js')).href);
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

  if (failures.length) {
    console.log(`\nFAILED — ${failures.length} case${failures.length === 1 ? '' : 's'}\n`);
    process.exitCode = 1;
  } else {
    console.log('\nOK — the ladder decides by amount, the tax leaves with the payment, and the book explains a difference before it alarms.\n');
  }
  process.exit(process.exitCode ?? 0);
} finally {
  rmSync(work, { recursive: true, force: true });
}
