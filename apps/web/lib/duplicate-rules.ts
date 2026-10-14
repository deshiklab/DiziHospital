/* -----------------------------------------------------------------------------
 * Duplicate detection — one rule set, read from the contract (P0-301).
 *
 * Two places decide whether a patient is already registered: the desk form and the CSV import. They used to
 * decide it differently — the form checked a phone number and a national-ID suffix, the import checked a
 * normalised phone and then name + age + sex — which is how a duplicate comes in through the front door and a
 * false match gets flagged at the back. Both now call this.
 *
 * The rules, their weights, the two thresholds and the way matches combine are **not** written here: they are
 * read from `packages/contracts/openapi.json` (`x-dizi-duplicate-rules`) through the generated client, so a
 * branch that tunes them in Setup is tuning the one table both paths read, and the contract's guardrail compares
 * this file against the contract rather than against a copy of it kept in a component.
 *
 * Nothing here merges. A rule can only raise a candidate, with the evidence that raised it, and a person decides
 * — because merging two real patients is worse than leaving two rows for an afternoon.
 */

import { duplicateRules } from '@dizi/contracts/client';

/** The fields a rule can look at. A record may carry any subset: the import has no national ID, the form has no
 *  date of birth, and a rule whose field is absent simply does not fire rather than guessing. */
export interface DuplicateIdentity {
  mrn?: string | undefined;
  name?: string | undefined;
  age?: number | string | null | undefined;
  sex?: string | null | undefined;
  phone?: string | undefined;
  dateOfBirth?: string | undefined;
  nationalId?: string | undefined;
  branch?: string | undefined;
}

export interface DuplicateMatch {
  /** The rule's id in the contract, e.g. `identity.phone-normalised`. */
  id: string;
  label: string;
  weight: number;
  /** What raised it, in words a desk can check against the paper record. */
  evidence: string;
}

export interface DuplicateCandidate<T> {
  record: T;
  /** `min(1, the weights of the rules that matched)` — the contract's combination rule, computed here. */
  score: number;
  /** `block` refuses the write until somebody acknowledges the match; `warn` shows it and lets the desk continue. */
  verdict: 'warn' | 'block';
  /** True when a rule with `veto: true` fired: these are probably two people, and nothing may be refused on
   *  likeness alone. Callers use it to word the result honestly — a shared phone number whose sexes disagree is
   *  a household, not a duplicate. */
  vetoed: boolean;
  matches: DuplicateMatch[];
}

/** The thresholds the contract publishes. A branch tunes these in Setup; the defaults are the contract's. */
export const DUPLICATE_THRESHOLDS: { warn: number; block: number } = {
  warn: duplicateRules.thresholds.warn,
  block: duplicateRules.thresholds.block,
};

/** The rule ids this client can evaluate, in contract order. The guardrail checks this against the contract. */
export const DUPLICATE_RULE_IDS: string[] = duplicateRules.rules.map((rule) => rule.id);

/* ------------------------------------------------------------------ field normalisation */

const digits = (value: unknown): string => String(value ?? '').replace(/\D/g, '');

/** Spaces collapsed, case folded, Bangla left alone — `Md. Selim` and `MD SELIM` are the same person. */
const flat = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const sexOf = (value: unknown): string | null => {
  const s = flat(value);
  if (s.startsWith('m') || s === 'পুরুষ') return 'male';
  if (s.startsWith('f') || s === 'মহিলা') return 'female';
  return s === 'other' ? 'other' : null;
};

/**
 * One insertion, deletion or substitution apart — the commonest transcription error at a busy desk, and the one a
 * typo-by-typo exact match never finds. Deliberately not a similarity score: a rule either fires or it does not,
 * so its weight means the same thing every time and the total stays explainable to whoever is looking at it.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false; // an exact match is another rule's job
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  if (i < a.length || j < b.length) edits += 1;
  return edits <= 1;
}

/* ------------------------------------------------------------------ the rules themselves */

/**
 * Does this rule fire for the candidate against an existing record? Returns the evidence line, or null.
 *
 * Each `case` is a rule the contract declares. A rule the contract adds before this client implements it falls to
 * `default` and stays silent — the contract may be ahead of the client, and inventing a verdict for a rule we do
 * not understand is worse than missing that one signal.
 */
function fire(ruleId: string, candidate: DuplicateIdentity, record: DuplicateIdentity): string | null {
  switch (ruleId) {
    case 'identity.mrn-exact': {
      const mrn = flat(candidate.mrn);
      if (!mrn || mrn !== flat(record.mrn)) return null;
      return `Same MRN ${candidate.mrn} — this is the same record, not a lookalike`;
    }

    case 'identity.phone-normalised': {
      const phone = digits(candidate.phone);
      if (phone.length < 10 || phone !== digits(record.phone)) return null;
      return `Same phone number as ${record.name ?? record.mrn ?? 'another record'} (${record.mrn ?? '—'})`;
    }

    case 'identity.national-id-suffix': {
      const id = digits(candidate.nationalId);
      if (id.length < 4) return null;
      const tail = id.slice(-4);
      const mrn = flat(record.mrn);
      // The register already holds partial identifiers, so the tail is matched against the MRN — which is what
      // the desk form did before this rule had a name.
      if (!mrn.endsWith(tail)) return null;
      return `National ID ending ${tail} matches ${record.mrn ?? 'an existing record'}`;
    }

    case 'identity.name-age-sex': {
      if (!candidate.name || candidate.age === undefined || candidate.age === null || candidate.age === '' || !candidate.sex) return null;
      if (flat(candidate.name) !== flat(record.name)) return null;
      if (Number(candidate.age) !== Number(record.age)) return null;
      if (sexOf(candidate.sex) !== sexOf(record.sex)) return null;
      return `Same name, age and sex as ${record.name} (${record.mrn ?? '—'})`;
    }

    case 'identity.dob-exact': {
      const dob = flat(candidate.dateOfBirth);
      if (!dob || dob !== flat(record.dateOfBirth)) return null;
      return `Same date of birth ${candidate.dateOfBirth}`;
    }

    case 'identity.name-fuzzy': {
      const name = flat(candidate.name);
      if (name.length < 4 || !record.name) return null;
      if (!withinOneEdit(name, flat(record.name))) return null;
      return `Name within one edit of ${record.name} (${record.mrn ?? '—'})`;
    }

    case 'identity.sex-conflict': {
      const a = sexOf(candidate.sex);
      const b = sexOf(record.sex);
      if (!a || !b || a === b) return null;
      return `Sex disagrees: ${candidate.sex} here against ${record.sex} on ${record.mrn ?? 'the record'}`;
    }

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ the scan */

/**
 * Every existing record that looks like this candidate, strongest first.
 *
 * The scan is linear and deliberately so: it is a desk-side check over a page of the register, not the
 * cross-branch sweep — that is the API's job (P0-305), where an index and a rule set tuned per branch do the
 * work. What matters here is that the *same* rules decide in both places.
 */
export function findDuplicates<T extends DuplicateIdentity>(
  candidate: DuplicateIdentity,
  existing: readonly T[],
): Array<DuplicateCandidate<T>> {
  const found: Array<DuplicateCandidate<T>> = [];
  const rules = duplicateRules.rules as ReadonlyArray<{ id: string; label: string; weight: number; veto: boolean }>;

  for (const record of existing) {
    const matches: DuplicateMatch[] = [];
    for (const rule of rules) {
      const evidence = fire(rule.id, candidate, record);
      if (evidence) matches.push({ id: rule.id, label: rule.label, weight: rule.weight, evidence });
    }
    if (matches.length === 0) continue;

    const weighted = matches.filter((match) => !rules.find((rule) => rule.id === match.id)?.veto);
    const score = Math.min(1, weighted.reduce((sum, match) => sum + match.weight, 0));

    // A vetoing match means these are two people, so nothing here may *refuse* the write on similarity alone.
    // The one exception is the MRN: an MRN is identity rather than likeness, two records with one number is a
    // data error, and a desk has to look at it whatever else disagrees.
    const vetoed = matches.some((match) => rules.find((rule) => rule.id === match.id)?.veto);
    const sameMrn = matches.some((match) => match.id === 'identity.mrn-exact');
    if (score < DUPLICATE_THRESHOLDS.warn) continue;

    found.push({
      record,
      score,
      verdict: score >= DUPLICATE_THRESHOLDS.block && (!vetoed || sameMrn) ? 'block' : 'warn',
      vetoed,
      matches,
    });
  }

  return found.sort((a, b) => b.score - a.score);
}

/** The single strongest candidate, or null — what the desk form shows under the identity block. */
export function strongestDuplicate<T extends DuplicateIdentity>(
  candidate: DuplicateIdentity,
  existing: readonly T[],
): DuplicateCandidate<T> | null {
  return findDuplicates(candidate, existing)[0] ?? null;
}

/** One line an import row can carry, from its strongest match: the evidence, then what happens because of it. */
export function duplicateSummary<T extends DuplicateIdentity>(candidate: DuplicateCandidate<T>): string {
  const what = candidate.matches.map((match) => match.evidence).join('; ');
  const tail =
    candidate.verdict === 'block'
      ? ' — refused unless somebody acknowledges it'
      : candidate.vetoed
        ? ' — probably two people: the sex disagrees, so nothing is refused on the likeness alone'
        : ' — possible duplicate, for a person to decide';
  return `${what}${tail}`;
}
