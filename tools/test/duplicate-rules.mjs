#!/usr/bin/env node
/**
 * The duplicate rule set, exercised (P0-301).
 *
 * The rules live in `packages/contracts/openapi.json` and are implemented once in `apps/web/lib/duplicate-rules.ts`,
 * which the desk form and the CSV import both call. This test bundles that module — the real one, not a copy —
 * and checks three things:
 *
 *   1. **Every rule the contract declares is evaluated.** One crafted case per rule; a rule that stops firing is a
 *      rule the contract documents and the product no longer applies, which is exactly the drift the guardrail's
 *      `implementedBy`/`evidence` entries are meant to stop but cannot see at runtime.
 *   2. **The combination rule behaves as written**: `min(1, sum of the weights)`, a vetoing match caps the verdict
 *      below `block`, and the MRN is the one thing a veto does not soften.
 *   3. **The two callers agree.** The import runs the same rules, so a row that matches only by phone is a
 *      *possible duplicate* and never a silent insert.
 *
 * Needs one dev-only package, like the other harnesses:
 *
 *     npm i --no-save esbuild && npm run test:rules
 *
 * Exit code 0 when every case passes, 1 otherwise.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('\nThis test needs one dev-only package:\n\n    npm i --no-save esbuild\n\nthen run `npm run test:rules` again.\n');
  process.exit(2);
}

/* The contract's own numbers, so the assertions below are about behaviour rather than about the digits. */
const capabilities = JSON.parse(readFileSync(join(root, 'packages/contracts/dist/capabilities.json'), 'utf8'));
const rules = capabilities.duplicateRules.rules;
const thresholds = capabilities.duplicateRules.thresholds;

const work = mkdtempSync(join(tmpdir(), 'dizi-rules-test-'));
const outfile = join(work, 'rules.cjs');

try {
  await esbuild.build({
    entryPoints: [join(root, 'apps/web/lib/duplicate-rules.ts'), join(root, 'apps/web/lib/patient-import.ts')],
    outdir: work,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    absWorkingDir: root,
    tsconfig: join(root, 'apps/web/tsconfig.json'),
    logLevel: 'error',
  });

  const engine = await import(pathToFileURL(join(work, 'duplicate-rules.js')).href);
  const importer = await import(pathToFileURL(join(work, 'patient-import.js')).href);

  const failures = [];
  const pass = (name, condition, detail = '') => {
    if (condition) console.log(`  ✓ ${name}`);
    else {
      console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
      failures.push(name);
    }
  };

  const round = (n) => Math.round(n * 100) / 100;
  const summary = (candidate) => ({
    score: round(candidate.score),
    verdict: candidate.verdict,
    rules: candidate.matches.map((m) => m.id),
  });

  console.log('\nduplicate rules — the contract, the engine and the desk\n');
  console.log(`contract   warn ${thresholds.warn} · block ${thresholds.block} · ${rules.length} rules`);
  console.log(`engine     ${engine.DUPLICATE_RULE_IDS.length} rules evaluated · thresholds ${engine.DUPLICATE_THRESHOLDS.warn}/${engine.DUPLICATE_THRESHOLDS.block}\n`);

  /* ---------------------------------------------------------------- one case per rule --------------- */

  const CASES = [
    {
      rule: 'identity.mrn-exact',
      candidate: { mrn: 'SH-210001' },
      existing: [{ mrn: 'SH-210001', name: 'Abul Kalam' }],
      expect: { score: 1, verdict: 'block' },
    },
    {
      rule: 'identity.phone-normalised',
      candidate: { phone: '01711 000101' },
      existing: [{ mrn: 'SH-210001', name: 'Abul Kalam', phone: '01711000101' }],
      expect: { score: 0.8, verdict: 'warn' },
    },
    {
      rule: 'identity.national-id-suffix',
      candidate: { nationalId: '1990 1234 56789' },
      existing: [{ mrn: 'SH-2106789', name: 'Nasrin Akter' }],
      expect: { score: 0.7, verdict: 'warn' },
    },
    {
      rule: 'identity.name-age-sex',
      candidate: { name: 'Md. Selim', age: '45', sex: 'M' },
      existing: [{ mrn: 'SH-210005', name: 'md.  selim', age: 45, sex: 'Male' }],
      expect: { score: 0.6, verdict: 'warn' },
    },
    {
      rule: 'identity.dob-exact',
      candidate: { dateOfBirth: '1980-01-01' },
      existing: [{ mrn: 'SH-2107777', dateOfBirth: '1980-01-01' }],
      expect: { score: 0.5, verdict: 'warn' },
    },
    {
      rule: 'identity.name-fuzzy',
      candidate: { name: 'Kamrul Hossain' },
      existing: [{ mrn: 'SH-210009', name: 'Kamrul Hossai' }],
      expect: { score: 0.45, verdict: 'warn' },
    },
  ];

  for (const testCase of CASES) {
    const found = engine.findDuplicates(testCase.candidate, testCase.existing);
    const top = found[0] ? summary(found[0]) : null;
    const ok = top && top.rules.includes(testCase.rule) && top.score === testCase.expect.score && top.verdict === testCase.expect.verdict;
    pass(
      `${testCase.rule.padEnd(28)} → score ${testCase.expect.score}, ${testCase.expect.verdict}`,
      ok,
      `got ${top ? `score ${top.score}, ${top.verdict}, rules [${top.rules.join(', ')}]` : 'no candidate'}`,
    );
  }

  /* ---------------------------------------------------------------- the combination rule ------------ */

  // Two rules that both look at likeness add up; the remainder over 1 is dropped, so the score stays a share.
  const added = engine.findDuplicates(
    { name: 'Kamrul Hossain', phone: '01711000105' },
    [{ mrn: 'SH-210005', name: 'Kamrul Hossai', phone: '01711000105' }],
  )[0];
  pass(
    'a phone match (0.8) and a one-edit name (0.45) add up to a capped 1.0 and block',
    added && round(added.score) === 1 && added.verdict === 'block' && added.matches.length === 2,
    added ? `got ${round(added.score)}, ${added.verdict}, ${added.matches.length} rule(s)` : 'no candidate',
  );

  // A household shares a phone number. It must warn — never refuse — which is why 0.8 sits under the threshold.
  const sharedPhone = engine.findDuplicates({ phone: '01711000101' }, [{ mrn: 'SH-1', name: 'A', phone: '01711000101' }])[0];
  pass(
    `a shared phone number alone warns, never blocks (0.8 < ${thresholds.block})`,
    sharedPhone?.verdict === 'warn' && !sharedPhone.vetoed,
    `got ${sharedPhone?.verdict}`,
  );

  // A vetoing match caps the verdict: two people whose sex disagrees are not refused on likeness, however alike.
  const vetoCase = engine.findDuplicates(
    { name: 'Kamrul Hossain', phone: '01711000105', sex: 'M' },
    [{ mrn: 'SH-210005', name: 'Kamrul Hossai', phone: '01711000105', sex: 'Female' }],
  )[0];
  const vetoSummary = vetoCase ? summary(vetoCase) : null;
  pass(
    'a sex conflict vetoes a block (score would be 1.0)',
    vetoSummary && vetoSummary.score === 1 && vetoSummary.verdict === 'warn' && vetoSummary.rules.includes('identity.sex-conflict'),
    vetoSummary ? `got score ${vetoSummary.score}, ${vetoSummary.verdict}, rules [${vetoSummary.rules.join(', ')}]` : 'no candidate',
  );
  pass('the veto is published, so callers can word the result honestly', vetoCase?.vetoed === true, `got vetoed=${vetoCase?.vetoed}`);

  // The MRN is identity rather than likeness, so the veto does not soften it: one number, two records, is a data error.
  const mrnAndVeto = engine.findDuplicates(
    { mrn: 'SH-210005', sex: 'M' },
    [{ mrn: 'SH-210005', name: 'Kamrul Hossain', sex: 'Female' }],
  )[0];
  pass('a shared MRN blocks even when the sex disagrees', mrnAndVeto?.verdict === 'block', `got ${mrnAndVeto?.verdict}`);

  // Below the warning threshold nothing is shown: a desk warned about everything is warned about nothing.
  const nothing = engine.findDuplicates({ phone: '' }, [{ mrn: 'SH-1', name: 'A' }]);
  pass('an empty candidate produces no candidates at all', nothing.length === 0, `got ${nothing.length}`);

  // A name that differs by two edits is a different person as far as the rule set is concerned.
  const twoEdits = engine.findDuplicates({ name: 'Kamrul Hossain' }, [{ mrn: 'SH-1', name: 'Kamrul Hossai' }]);
  const twoEditsOther = engine.findDuplicates({ name: 'Kamrul Hossain' }, [{ mrn: 'SH-1', name: 'Kamrul Husein' }]);
  pass('one edit fires, two do not', twoEdits.length === 1 && twoEditsOther.length === 0, `one=${twoEdits.length} two=${twoEditsOther.length}`);

  /* ---------------------------------------------------------------- the second caller ---------------- */

  const preview = importer.previewImport(importer.SAMPLE_IMPORT_CSV);
  console.log(
    `\nimport     ${preview.counts.total} rows → ${preview.counts.ready} ready · ${preview.counts.duplicate} possible duplicate · ${preview.counts.error} rejected`,
  );
  const duplicateRows = preview.needsReview.filter((r) => r.status === 'duplicate');
  pass('the import finds duplicates with the same rules', duplicateRows.length > 0, `${duplicateRows.length} rows`);
  for (const row of duplicateRows.slice(0, 3)) {
    console.log(`             line ${row.line}: ${row.problems.find((p) => /phone|name|MRN|National/.test(p)) ?? row.problems[0]}`);
  }
  pass(
    'a duplicate row carries the evidence that raised it, not just a verdict',
    duplicateRows.every((row) => row.problems.length > 0),
  );
  pass(
    'nothing is merged by the import — it reports, it does not resolve',
    preview.rows.every((row) => ['ready', 'duplicate', 'error'].includes(row.status)) &&
      preview.counts.ready + preview.counts.duplicate + preview.counts.error === preview.counts.total,
    `statuses: ${[...new Set(preview.rows.map((r) => r.status))].join(', ')}`,
  );

  // Two rows of one file that share a phone number are two rows of one file — the register cannot know.
  const fileInternal = preview.needsReview.filter((r) => r.problems.some((p) => /two rows in this file/.test(p)));
  pass('a row that collides with a row above it in the same file is caught', fileInternal.length > 0, `${fileInternal.length} row(s)`);
  for (const row of fileInternal) console.log(`             line ${row.line}: ${row.problems.find((p) => /two rows in this file/.test(p))}`);

  /* Every rule in the contract has a case above, or this list is short. */
  const covered = new Set(CASES.map((c) => c.rule).concat(['identity.sex-conflict']));
  const missing = rules.map((r) => r.id).filter((id) => !covered.has(id));
  pass(`all ${rules.length} contract rules are exercised`, missing.length === 0, missing.length ? `not covered: ${missing.join(', ')}` : '');

  if (failures.length) {
    console.log(`\nFAILED — ${failures.length} case${failures.length === 1 ? '' : 's'}\n`);
    process.exitCode = 1;
  } else {
    console.log('\nOK — every rule fires, the combination rule holds, and both callers agree.\n');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
