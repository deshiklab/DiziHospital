/* -----------------------------------------------------------------------------
 * Patient import (P1) — reading a register out of a spreadsheet without creating a second one.
 *
 * Every hospital migration arrives with a spreadsheet, and every spreadsheet creates duplicates. So the rules are:
 *
 *  1. **Nothing is imported blind.** Each row is validated, and each row shows the reason it cannot be imported
 *     rather than disappearing into a count.
 *  2. **A duplicate is never merged silently.** An existing MRN wins; a row that matches on phone or on
 *     name+age+sex is *possible* duplicate and goes to the merge queue for a human, because merging two real
 *     patients is worse than leaving two rows for an afternoon — and that includes two rows of the *same file*,
 *     which the register cannot know about.
 *  3. **The file is not the truth.** Missing fields stay missing: an import that invents a phone number produces a
 *     record nobody can call.
 *
 * The parser is deliberately small and strict — quoted fields, embedded commas, CRLF — because a CSV parser that
 * guesses is a parser that silently shifts every column by one.
 */

import { branches, payers, patients, type Patient } from './mock';
import { strongestDuplicate, duplicateSummary, type DuplicateIdentity } from './duplicate-rules';

export interface ImportField {
  key: keyof Pick<Patient, 'mrn' | 'name' | 'nameBn' | 'age' | 'sex' | 'phone' | 'branch' | 'payer' | 'lastVisit' | 'allergies'>;
  label: string;
  required: boolean;
  /** Header spellings the mapping recognises automatically. */
  synonyms: string[];
  hint: string;
}

export const IMPORT_FIELDS: ImportField[] = [
  { key: 'mrn', label: 'MRN (hospital number)', required: true, synonyms: ['mrn', 'patient id', 'hospital id', 'reg no', 'registration', 'hn'], hint: 'Left blank only if the hospital series is to be continued automatically.' },
  { key: 'name', label: 'Patient name', required: true, synonyms: ['name', 'patient name', 'full name', 'patient'], hint: 'As written in the register.' },
  { key: 'nameBn', label: 'Name in Bangla', required: false, synonyms: ['bangla', 'name bn', 'bangla name', 'নাম'], hint: 'Used on slips and labels.' },
  { key: 'age', label: 'Age', required: true, synonyms: ['age', 'years', 'age years', 'বয়স'], hint: 'Whole years. Ages over 120 are rejected.' },
  { key: 'sex', label: 'Sex', required: true, synonyms: ['sex', 'gender'], hint: 'Male / Female / M / F / পুরুষ / মহিলা.' },
  { key: 'phone', label: 'Phone', required: false, synonyms: ['phone', 'mobile', 'contact', 'cell', 'মোবাইল'], hint: 'Bangladeshi 11-digit mobile, or leave empty.' },
  { key: 'branch', label: 'Branch', required: false, synonyms: ['branch', 'campus', 'location', 'site'], hint: `One of: ${branches.join(', ')}.` },
  { key: 'payer', label: 'Payer', required: false, synonyms: ['payer', 'payment', 'scheme', 'corporate', 'insurance'], hint: `One of: ${payers.join(', ')}.` },
  { key: 'lastVisit', label: 'Last visit', required: false, synonyms: ['last visit', 'visit date', 'last seen', 'date'], hint: 'YYYY-MM-DD. Used for the follow-up lists.' },
  { key: 'allergies', label: 'Allergies', required: false, synonyms: ['allergy', 'allergies', 'drug allergy'], hint: 'Free text; it is shown on every screen that prescribes.' },
];

export const TEMPLATE_HEADER = 'mrn,name,bangla name,age,sex,phone,branch,payer,last visit,allergies';

/** The sample the screen loads when nobody has a file to hand: clean rows, duplicates and rejections, in that order. */
export const SAMPLE_IMPORT_CSV = `mrn,name,bangla name,age,sex,phone,branch,payer,last visit,allergies
SH-210001,Abul Kalam,আবুল কালাম,54,Male,01711000101,Main Campus,Self pay,2026-09-30,
SH-210002,Rokeya Sultana,রোকেয়া সুলতানা,38,Female,01711000102,Main Campus,Corporate — BRAC,2026-10-01,Penicillin
SH-210003,Jasim Uddin,জসিম উদ্দিন,66,Male,01711000103,Uttara Branch,Govt. scheme,2026-08-14,
SH-210004,Shahana Begum,শাহানা বেগম,29,Female,01711000104,Main Campus,Self pay,2026-10-05,
SH-210005,Md. Selim,মোঃ সেলিম,45,M,01711000105,Mirpur Branch,Self pay,2026-09-22,
SH-210006,Nusrat Jahan,নুসরাত জাহান,31,মহিলা,01711000106,Main Campus,Insurance — MetLife,2026-10-09,
SH-210007,Farid Ahmed,ফরিদ আহমেদ,58,Male,01711000107,Main Campus,Self pay,2026-07-19,NSAIDs
SH-210008,Ayesha Khatun,আয়েশা খাতুন,24,Female,01711000108,Uttara Branch,Self pay,2026-10-11,
SH-210009,Habibur Rahman,হাবিবুর রহমান,71,Male,01711000109,Main Campus,Self pay,2026-06-02,
SH-210010,Sumaiya Islam,সুমাইয়া ইসলাম,19,Female,01711000110,Main Campus,Corporate — BRAC,2026-10-12,
SH-210011,Kamal Hossain,কামাল হোসেন,49,Male,01711000111,Mirpur Branch,Self pay,2026-09-15,
SH-210012, Rina Das,রিনা দাস,35,Female,01711000112,Main Campus,Self pay,2026-10-03,
SH-102311,Mizanur Rahman,মিজানুর রহমান,43,Male,01711000113,Main Campus,Self pay,2026-10-13,
SH-210013,Nasima Akter,নাসিমা আক্তার,42,Female,01711000113,Main Campus,Self pay,2026-09-28,
SH-210014,Abdur Rob,আবদুর রব,55,Male,01711000114,Main Campus,Self pay,2026-10-07,
SH-210015,Taslima Akter,তাসলিমা আক্তার,33,Female,01711000115,Uttara Branch,Govt. scheme,2026-10-10,
SH-210016,Rafiqul Islam,রফিকুল ইসলাম,60,Male,,Main Campus,Self pay,2026-09-05,
SH-210017,Sabina Yasmin,সাবিনা ইয়াসমিন,,Female,01711000116,Main Campus,Self pay,2026-09-05,
SH-210018,Jahangir Alam,জাহাঙ্গীর আলম,150,Male,01711000117,Chittagong Branch,Self pay,2026-09-06,
SH-210019, Marufa Khatun,মারুফা খাতুন,27,Female,0171-100-1118,Main Campus,Self pay,2026-09-30,
SH-210020,Delwar Hossain,দেলোয়ার হোসেন,63,Male,01711000119,Main Campus,Self pay,2026-10-13,`;

export type RowStatus = 'ready' | 'duplicate' | 'error';

export interface ImportRow {
  line: number;
  values: Partial<Record<ImportField['key'], string>>;
  status: RowStatus;
  problems: string[];
  /** Set for a duplicate: what it collided with. */
  duplicateOf?: string;
}

/** Minimal, strict CSV reader: quoted fields, doubled quotes, embedded newlines, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.length > 0));
}

const normalise = (value: string) => value.trim().toLowerCase().replace(/[_\-.]/g, ' ').replace(/\s+/g, ' ');

/** Guess the mapping from the header row; the screen shows the answer and lets a human overrule it. */
export function guessMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of IMPORT_FIELDS) {
    const hit = headers.find((h) => {
      const n = normalise(h);
      return field.synonyms.some((s) => normalise(s) === n) || field.synonyms.some((s) => n.includes(normalise(s)));
    });
    if (hit) mapping[field.key] = hit;
  }
  return mapping;
}

const SEXES: Record<string, Patient['sex']> = {
  m: 'Male', male: 'Male', পুরুষ: 'Male', man: 'Male',
  f: 'Female', female: 'Female', মহিলা: 'Female', woman: 'Female',
  o: 'Other', other: 'Other',
};

const digits = (value: string) => value.replace(/[^\d]/g, '');

export interface ImportPreview {
  headers: string[];
  mapping: Record<string, string>;
  rows: ImportRow[];
  counts: { ready: number; duplicate: number; error: number; total: number };
  /** Rows the registration desk is asked to look at before anything is written. */
  needsReview: ImportRow[];
}

/**
 * Turn a CSV into rows with verdicts. The existing register is the authority on identity, so a clash with it is
 * always reported — never resolved — here.
 */
export function previewImport(csv: string, mapping?: Record<string, string>, existing: Patient[] = patients): ImportPreview {
  const table = parseCsv(csv);
  const headers = table[0] ?? [];
  const map = mapping ?? guessMapping(headers);
  const indexOf = (key: ImportField['key']) => (map[key] ? headers.indexOf(map[key]) : -1);

  /* Rows already read from this file, in order. A migration spreadsheet that holds the same person twice is as
   * common as one that collides with the register, and until this existed the import checked each row against the
   * register and never against its neighbours — so two rows for one patient both came in. */
  const seen: Array<{ line: number; identity: DuplicateIdentity }> = [];

  const rows: ImportRow[] = table.slice(1).map((cells, i) => {
    const values: ImportRow['values'] = {};
    for (const field of IMPORT_FIELDS) {
      const at = indexOf(field.key);
      if (at >= 0) values[field.key] = cells[at] ?? '';
    }
    const problems: string[] = [];
    let duplicateOf: string | undefined;
    const row: ImportRow = { line: i + 2, values, status: 'ready', problems };

    // required fields
    for (const field of IMPORT_FIELDS.filter((f) => f.required)) {
      if (!values[field.key]) problems.push(`${field.label} is empty`);
    }

    // age and sex have to make sense before a record can be created
    const age = Number(values.age);
    if (values.age && (!Number.isFinite(age) || age <= 0 || age > 120)) problems.push(`Age “${values.age}” is not a whole number between 1 and 120`);
    if (values.sex && !SEXES[normalise(values.sex ?? '')]) problems.push(`Sex “${values.sex}” is not one this hospital records (Male, Female, Other)`);

    // a phone number that survives normalisation, or none at all
    const phone = digits(values.phone ?? '');
    if (values.phone && phone.length !== 11) problems.push(`Phone “${values.phone}” is not an 11-digit number — it is imported empty rather than wrong`);

    // places and schemes are enums, so a typo is a rejection rather than a new branch
    if (values.branch && !branches.includes(values.branch as never)) problems.push(`Branch “${values.branch}” is not one of this hospital’s branches`);
    if (values.payer && !payers.includes(values.payer as never)) problems.push(`Payer “${values.payer}” is not in the payer list`);
    if (values.lastVisit && !/^\d{4}-\d{2}-\d{2}$/.test(values.lastVisit)) problems.push(`Last visit “${values.lastVisit}” is not YYYY-MM-DD`);

    /* Identity, by the register's own rule set — `lib/duplicate-rules.ts`, the same seven weighted rules the
     * desk form runs. A migration and a registration desk disagreeing about who is already registered is the
     * whole reason this is one module rather than two copies.
     *
     * The MRN keeps its own line and its own wording: it is not a similarity verdict but a data error in the
     * file — the register already has that number — and the desk fixing the spreadsheet needs to be told
     * exactly that. Everything else is a candidate with evidence, scored against the contract's thresholds. */
    const mrn = values.mrn?.toLowerCase();
    const hitMrn = mrn ? existing.find((p) => p.mrn.toLowerCase() === mrn) : undefined;
    if (hitMrn) {
      problems.push(`MRN ${values.mrn} already exists — ${hitMrn.name}`);
      duplicateOf = `${hitMrn.mrn} · ${hitMrn.name}`;
    } else {
      const strongest = strongestDuplicate(
        {
          mrn: values.mrn ?? '',
          name: values.name ?? '',
          age: values.age ?? '',
          sex: SEXES[normalise(values.sex ?? '')] ?? values.sex ?? '',
          phone: values.phone ?? '',
        },
        existing,
      );
      if (strongest) {
        duplicateOf = `${strongest.record.mrn} · ${strongest.record.name}`;
        problems.push(duplicateSummary(strongest));
      }
    }

    // And against the rows above it in this file, which the register cannot know about.
    const identity: DuplicateIdentity = {
      mrn: values.mrn ?? '',
      name: values.name ?? '',
      age: values.age ?? '',
      sex: SEXES[normalise(values.sex ?? '')] ?? values.sex ?? '',
      phone: values.phone ?? '',
    };
    if (!duplicateOf) {
      const earlier = strongestDuplicate(
        identity,
        seen.map((entry) => ({ ...entry.identity, line: entry.line })),
      );
      if (earlier) {
        const line = (earlier.record as DuplicateIdentity & { line?: number }).line;
        duplicateOf = `${earlier.record.mrn ?? ''} · ${earlier.record.name ?? ''} (line ${line})`;
        const tail = earlier.vetoed
          ? ` — two rows in this file (line ${line}), probably two people, so check before merging`
          : ` — two rows in this file may be one person (line ${line})`;
        problems.push(`${earlier.matches.map((m) => m.evidence).join('; ')}${tail}`);
      }
    }
    seen.push({ line: row.line, identity });

    if (problems.length > 0) row.status = duplicateOf ? 'duplicate' : 'error';
    if (duplicateOf) row.status = 'duplicate';
    return row;
  });

  const counts = {
    ready: rows.filter((r) => r.status === 'ready').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    error: rows.filter((r) => r.status === 'error').length,
    total: rows.length,
  };

  return { headers, mapping: map, rows, counts, needsReview: rows.filter((r) => r.status !== 'ready') };
}

/** The rejected and duplicate rows, as a CSV the registration desk can fix and bring back. */
export function rejectedCsv(preview: ImportPreview): string {
  const header = ['line', 'status', 'problem', ...IMPORT_FIELDS.map((f) => f.key)].join(',');
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const body = preview.needsReview.map((r) =>
    [String(r.line), r.status, r.problems.join('; '), ...IMPORT_FIELDS.map((f) => r.values[f.key] ?? '')].map(escape).join(','),
  );
  return [header, ...body].join('\n');
}
