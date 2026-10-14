/* -----------------------------------------------------------------------------
 * Masters and setup — every "Setup › …" screen from the legacy module, as one registry with rules.
 *
 * The legacy product had twelve near-identical screens for twelve lists: ICD-10 codes, symptoms, findings,
 * charges, drugs, items, laboratory tests, imaging, vitals, blood products, wards, theatres. Each one was a
 * stand-alone CRUD page, each with its own way of saying "deleted", and none of them recorded who changed what.
 * The new platform keeps the lists here instead — one shape, one audit trail, one rule set:
 *
 *  1. **A code is an identity.** Two rows cannot share one code in a catalogue; a code that a record already
 *     points at cannot be deleted, only retired.
 *  2. **Nothing is deleted, ever.** A retired entry keeps its code, leaves the pickers, and stays resolvable so an
 *     old bill or an old report still prints what it said at the time. That is the difference between a master
 *     list and a memo.
 *  3. **Every change carries who and when**, because a tariff change shows up in a bill three months later and
 *     somebody has to be able to explain it.
 *  4. **Money rows are versioned by date, not overwritten.** A charge has an effective-from, so re-pricing does not
 *     rewrite last month's revenue.
 */

import { TARIFF, type Category, type TariffItem } from './billing';
import { EXPENSE_HEADS, INCOME_HEADS, PAYER_AGREEMENTS, REFERRERS } from './finance-tables';
import { TESTS, type LabTest } from './diagnostics';
import { DRUGS, type Drug } from './pharmacy';
import { ICD10, VITALS, type IcdCode, type VitalDef } from './clinical';
import { inventoryItems, type StockItem } from './inventory';
import { WARDS, BED_CHARGE, type BedClass } from './ward';

export interface MasterColumn {
  key: string;
  header: string;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
  width?: string;
}

export interface MasterRow {
  id: string;
  /** The code somebody types at a counter. Unique inside its catalogue. */
  code: string;
  label: string;
  /** Free-form, catalogue-specific columns, rendered from the catalogue's own definition. */
  values: Record<string, string | number>;
  active: boolean;
  /** Set when the row is retired: it leaves the pickers and stays resolvable. */
  retiredAt?: string;
  retiredBecause?: string;
  effectiveFrom?: string;
  lastChange: { at: string; by: string; what: string };
}

export interface Catalogue {
  id: string;
  name: string;
  nameBn: string;
  /** Which legacy setup screen this replaces, so the mapping is auditable. */
  legacy: string;
  purpose: string;
  columns: MasterColumn[];
  rows: MasterRow[];
  /** What happens if this catalogue is wrong. The reason it has its own screen rather than an appendix. */
  risk: string;
  /** Who may edit it: a master that changes money is not the same as a master that changes a picklist. */
  owner: string;
}

const changed = (at: string, by: string, what: string) => ({ at, by, what });

/** The day the seed data is dated to; deterministic like the rest of the preview. */
const SEED_DAY = '2026-10-14';

const icdRows: MasterRow[] = ICD10.map((c: IcdCode, i) => ({
  id: `icd-${c.code}`,
  code: c.code,
  label: c.label,
  values: { chapter: c.chapter, bangla: c.labelBn, used: 40 + ((i * 37) % 380) },
  active: true,
  lastChange: changed(SEED_DAY, 'Clinical lead', 'Imported from the ICD-10 extract'),
}));

const symptomRows: MasterRow[] = [
  ['S-01', 'Fever', 'জ্বর', 'General'],
  ['S-02', 'Cough', 'কাশি', 'Respiratory'],
  ['S-03', 'Shortness of breath', 'শ্বাসকষ্ট', 'Respiratory'],
  ['S-04', 'Chest pain', 'বুকে ব্যথা', 'Cardiac'],
  ['S-05', 'Abdominal pain', 'পেটে ব্যথা', 'Gastrointestinal'],
  ['S-06', 'Headache', 'মাথাব্যথা', 'Neurological'],
  ['S-07', 'Dizziness', 'মাথা ঘোরা', 'Neurological'],
  ['S-08', 'Joint pain', 'জয়েন্টে ব্যথা', 'Musculoskeletal'],
  ['S-09', 'Burning urination', 'প্রস্রাবে জ্বালা', 'Urological'],
  ['S-10', 'Vomiting', 'বমি', 'Gastrointestinal'],
  ['S-11', 'Rash', 'চামড়ায় র‍্যাশ', 'Dermatology'],
  ['S-12', 'Weight loss', 'ওজন কমা', 'General'],
].map(([code, label, bn, system], i) => ({
  id: `sym-${code}`,
  code,
  label,
  values: { bangla: bn, system, used: 12 + ((i * 23) % 140) },
  active: i !== 11,
  ...(i === 11 ? { retiredAt: '2026-08-02', retiredBecause: 'Superseded — weight loss is captured as a diagnosis, not a symptom' } : {}),
  lastChange: changed(SEED_DAY, 'Clinical lead', i === 11 ? 'Retired' : 'Reviewed against the OPD picklist'),
}));

const findingRows: MasterRow[] = [
  ['F-01', 'Chest clear on auscultation', 'Respiratory'],
  ['F-02', 'Basal crepitations', 'Respiratory'],
  ['F-03', 'Bilateral pedal oedema', 'Cardiac'],
  ['F-04', 'Murmur on auscultation', 'Cardiac'],
  ['F-05', 'Hepatomegaly', 'Gastrointestinal'],
  ['F-06', 'Splenomegaly', 'Gastrointestinal'],
  ['F-07', 'Pallor', 'General'],
  ['F-08', 'Icterus', 'General'],
  ['F-09', 'Lymphadenopathy', 'General'],
  ['F-10', 'Calf tenderness', 'Musculoskeletal'],
].map(([code, label, system], i) => ({
  id: `fnd-${code}`,
  code,
  label,
  values: { system, used: 8 + ((i * 17) % 90) },
  active: true,
  lastChange: changed(SEED_DAY, 'Clinical lead', 'Reviewed against the examination picklist'),
}));

export const chargeRows: MasterRow[] = TARIFF.map((t: TariffItem) => ({
  id: `chg-${t.code}`,
  code: t.code,
  label: t.name,
  values: { category: t.category, price: t.price, effective: '2026-07-01', used: 30 + ((t.price * 7) % 300) },
  active: true,
  effectiveFrom: '2026-07-01',
  lastChange: changed('2026-07-01', 'Finance — Main Campus', 'Tariff revision approved for FY 2026–27'),
}));

const drugRows: MasterRow[] = DRUGS.map((d: Drug, i) => ({
  id: `drug-${d.id}`,
  code: d.id,
  label: `${d.brand} · ${d.generic} ${d.strength}`,
  values: {
    form: d.form,
    class: d.klass,
    price: d.price,
    controlled: d.controlled ? 'yes' : 'no',
    highAlert: d.highAlert ? 'yes' : 'no',
    allergen: d.allergenTags.join(', ') || '—',
    used: 20 + ((i * 41) % 260),
  },
  active: true,
  lastChange: changed(SEED_DAY, 'Pharmacy in-charge', 'Formulary review — price and class checked'),
}));

const itemRows: MasterRow[] = inventoryItems(SEED_DAY).map((it: StockItem, i) => ({
  id: `item-${it.id}`,
  code: it.id,
  label: it.name,
  values: {
    category: it.category,
    unit: it.unit,
    pack: `${it.packSize} ${it.packUnit}`,
    reorder: it.reorderQuantity,
    lead: `${it.leadTimeDays} day(s)`,
    store: it.store,
    used: 15 + ((i * 13) % 200),
  },
  active: true,
  lastChange: changed(SEED_DAY, 'Store keeper', 'Stock parameters checked against last quarter'),
}));

const testRows: MasterRow[] = TESTS.map((t: LabTest) => ({
  id: `test-${t.code}`,
  code: t.code,
  label: t.name,
  values: {
    kind: t.kind === 'lab' ? 'Laboratory' : 'Imaging',
    sample: t.sample ?? t.modality ?? '—',
    container: t.container ?? '—',
    tat: `${t.tatHours} h`,
    analytes: t.analytes.length || '—',
    price: t.price,
    used: 40 + ((t.price * 3) % 300),
  },
  active: true,
  effectiveFrom: '2026-07-01',
  lastChange: changed(SEED_DAY, 'Laboratory in-charge', 'Catalogue and turn-around times reviewed'),
}));

const vitalRows: MasterRow[] = VITALS.map((v: VitalDef) => ({
  id: `vit-${v.key}`,
  code: v.key,
  label: v.label,
  values: {
    bangla: v.labelBn,
    unit: v.unit,
    low: v.low,
    high: v.high,
    criticalLow: v.criticalLow ?? '—',
    criticalHigh: v.criticalHigh ?? '—',
  },
  active: true,
  lastChange: changed(SEED_DAY, 'Clinical lead', 'Reference ranges signed off for the ward chart'),
}));

const bloodProductRows: MasterRow[] = [
  { id: 'bp-wb', code: 'WB', label: 'Whole blood', values: { component: 'Whole blood', shelf: '35 day(s)', storage: '2–6 °C', crossMatch: 'required', charge: 1800 }, active: true, lastChange: changed(SEED_DAY, 'Blood bank in-charge', 'Storage and shelf life verified') },
  { id: 'bp-prbc', code: 'PRBC', label: 'Packed red cells', values: { component: 'Packed cells', shelf: '42 day(s)', storage: '2–6 °C', crossMatch: 'required', charge: 2400 }, active: true, lastChange: changed(SEED_DAY, 'Blood bank in-charge', 'Storage and shelf life verified') },
  { id: 'bp-ffp', code: 'FFP', label: 'Fresh frozen plasma', values: { component: 'Plasma', shelf: '12 month(s) frozen', storage: '−30 °C', crossMatch: 'group only', charge: 2600 }, active: true, lastChange: changed(SEED_DAY, 'Blood bank in-charge', 'Storage and shelf life verified') },
  { id: 'bp-pc', code: 'PLT', label: 'Platelet concentrate', values: { component: 'Platelets', shelf: '5 day(s)', storage: '20–24 °C agitated', crossMatch: 'group only', charge: 6200 }, active: true, lastChange: changed(SEED_DAY, 'Blood bank in-charge', 'Storage and shelf life verified') },
  { id: 'bp-cryo', code: 'CRYO', label: 'Cryoprecipitate', values: { component: 'Cryoprecipitate', shelf: '12 month(s) frozen', storage: '−30 °C', crossMatch: 'group only', charge: 3400 }, active: true, lastChange: changed(SEED_DAY, 'Blood bank in-charge', 'Storage and shelf life verified') },
];

const wardRows: MasterRow[] = WARDS.map((w) => ({
  id: `ward-${w.id}`,
  code: w.id,
  label: w.name,
  values: { floor: w.floor, beds: w.beds, cabins: w.cabins, classes: w.classes.join(' · '), inCharge: w.inCharge, ratio: w.nurseRatio },
  active: true,
  lastChange: changed(SEED_DAY, 'Nursing superintendent', 'Bed count and nursing ratio confirmed'),
}));

const bedClassRows: MasterRow[] = (Object.keys(BED_CHARGE) as BedClass[]).map((klass) => ({
  id: `bedclass-${klass}`,
  code: klass,
  label: `${klass} bed`,
  values: { nightly: BED_CHARGE[klass], nursing: klass === 'HDU' ? '1 : 2' : klass === 'Cabin' ? '1 : 4' : '1 : 8' },
  active: true,
  effectiveFrom: '2026-07-01',
  lastChange: changed('2026-07-01', 'Finance — Main Campus', 'Nightly charge approved for FY 2026–27'),
}));

const theatreRows: MasterRow[] = [
  { id: 'ot-1', code: 'OT-1', label: 'Operating theatre 1 — major', values: { specialty: 'General surgery', cleaning: '20 min', equipment: 'Laparoscopy tower · anaesthesia machine 1', state: 'In use' }, active: true, lastChange: changed(SEED_DAY, 'Theatre in-charge', 'Equipment list and turn-around checked') },
  { id: 'ot-2', code: 'OT-2', label: 'Operating theatre 2 — major', values: { specialty: 'Orthopaedics', cleaning: '20 min', equipment: 'C-arm · anaesthesia machine 2', state: 'Available' }, active: true, lastChange: changed(SEED_DAY, 'Theatre in-charge', 'Equipment list and turn-around checked') },
  { id: 'ot-3', code: 'OT-3', label: 'Operating theatre 3 — minor', values: { specialty: 'Minor procedures · dressing', cleaning: '10 min', equipment: 'Procedure table · diathermy', state: 'Available' }, active: true, lastChange: changed(SEED_DAY, 'Theatre in-charge', 'Equipment list and turn-around checked') },
  { id: 'ot-4', code: 'OT-4', label: 'Obstetric theatre', values: { specialty: 'Obstetrics · caesarean', cleaning: '15 min', equipment: 'Neonatal resuscitaire · warmer', state: 'Cleaning' }, active: true, lastChange: changed(SEED_DAY, 'Theatre in-charge', 'Equipment list and turn-around checked') },
];

/**
 * The two head masters finance owns. They live here rather than in the finance screens because a head is a
 * setting: the ledger, the day book and every report read the same list, so adding one is a setup change and
 * never a code change.
 */
export const incomeHeadRows: MasterRow[] = INCOME_HEADS.map((h) => ({
  id: `ih-${h.code}`,
  code: h.code,
  label: h.label,
  values: { group: h.group, billedAs: h.categories.length > 0 ? h.categories.join(' · ') : 'no billing category', taken: h.categories.length > 0 ? 'Through the counter, against an invoice' : 'Direct counter income' },
  active: true,
  lastChange: changed(SEED_DAY, 'Finance manager — S. Chowdhury', 'Reviewed against the ledger heads'),
}));

export const expenseHeadRows: MasterRow[] = EXPENSE_HEADS.map((h) => ({
  id: `eh-${h.code}`,
  code: h.code,
  label: h.label,
  values: { klass: h.klass, ait: h.aitPct == null ? 'none' : `${h.aitPct} %`, vat: h.vatPct == null ? 'none' : `${h.vatPct} %`, quoted: h.quotable ? 'quotation required' : 'meter or agreement' },
  active: true,
  lastChange: changed(SEED_DAY, 'Finance manager — S. Chowdhury', 'Withholding and VAT reviewed for the year'),
}));

/**
 * The referral register as a master. A commission rate is a commercial agreement with an expiry date, so the
 * catalogue that holds it has to show both: a rate nobody has renewed is not a rate, and a referrer whose heads
 * are wrong is paid on work they had nothing to do with.
 */
export const referralRows: MasterRow[] = REFERRERS.map((r, i) => ({
  id: `rc-${r.code}`,
  code: r.code,
  label: r.name,
  values: {
    kind: r.kind,
    rate: r.commissionPct === 0 ? 'none — consultant share instead' : `${r.commissionPct} %`,
    heads: r.heads.length > 0 ? `${r.heads.length} head${r.heads.length === 1 ? '' : 's'}` : 'none — not payable',
    agreement: `to ${r.agreementTo}`,
    tin: r.tin ?? 'not on file',
  },
  active: true,
  lastChange: changed(SEED_DAY === r.agreementTo ? SEED_DAY : SEED_DAY, i % 2 === 0 ? 'Finance manager — S. Chowdhury' : 'Managing director — A. H. Khan', 'Agreement renewed for the year'),
}));

/**
 * The payer agreements as a master. The hospital's tariff for a payer, its settlement period and what it requires
 * before it pays are contract terms, and a claim desk that cannot see them is guessing.
 */
export const payerAgreementRows: MasterRow[] = PAYER_AGREEMENTS.map((a) => ({
  id: `pa-${a.payer.replace(/\W+/g, '-').toLowerCase()}`,
  code: a.payer,
  label: a.tpa ? `via ${a.tpa}` : a.kind,
  values: {
    kind: a.kind,
    settles: `${a.settlementDays} days`,
    discount: `${a.discountPct} %`,
    preAuth: `above ৳ ${a.preAuthAbove.toLocaleString('en-IN')}`,
    coPay: `${a.coPayPct} %`,
    documents: `${a.documents.length} required`,
  },
  active: true,
  lastChange: changed(SEED_DAY, 'Finance manager — S. Chowdhury', 'Terms taken from the signed agreement'),
}));

export const CATALOGUES: Catalogue[] = [
  {
    id: 'incomeHeads',
    name: 'Income heads',
    nameBn: 'আয়ের খাত',
    legacy: 'Setup › Finance',
    purpose: 'Every head a receipt may post to, and the billing category it collects.',
    columns: [
      { key: 'group', header: 'Group' },
      { key: 'billedAs', header: 'Billed as' },
      { key: 'taken', header: 'How it is taken' },
    ],
    rows: incomeHeadRows,
    risk: 'A head that is missing becomes “miscellaneous”, and a ledger whose largest line is miscellaneous cannot be reconciled or reported against. Retiring a head that has history hides the money rather than moving it.',
    owner: 'Finance manager',
  },
  {
    id: 'expenseHeads',
    name: 'Expense heads',
    nameBn: 'ব্যয়ের খাত',
    legacy: 'Setup › Finance',
    purpose: 'What money may be spent on, whether it is capital, and what tax has to be held back.',
    columns: [
      { key: 'klass', header: 'Class' },
      { key: 'ait', header: 'Withholding' },
      { key: 'vat', header: 'VAT' },
      { key: 'quoted', header: 'Quotation' },
    ],
    rows: expenseHeadRows,
    risk: 'The withholding percentage here is a legal obligation, not a preference: paying a supplier gross because the head says “none” is the hospital carrying the supplier’s tax. Whether a head is capital decides whether a purchase lands on the asset register or in this month’s cost.',
    owner: 'Finance manager',
  },
  {
    id: 'referralCommission',
    name: 'Referral commission',
    nameBn: 'রেফারেল কমিশন',
    legacy: 'Setup › Referral',
    purpose: 'Who may be paid a commission, on which heads, at what rate, and under which dated agreement.',
    columns: [
      { key: 'kind', header: 'Kind' },
      { key: 'rate', header: 'Rate' },
      { key: 'heads', header: 'Heads' },
      { key: 'agreement', header: 'Agreement' },
      { key: 'tin', header: 'TIN' },
    ],
    rows: referralRows,
    risk: 'A commission rate that is wrong is money out of the hospital’s pocket, and a rate that applies to the wrong heads pays a clinician to prescribe. An expired agreement left in the register is the one an auditor finds first.',
    owner: 'Finance manager, with the managing director',
  },
  {
    id: 'payerAgreements',
    name: 'TPA and insurer agreements',
    nameBn: 'টিপিএ ও বীমা চুক্তি',
    legacy: 'Setup › Finance',
    purpose: 'What each payer pays, when, at what discount, and what it needs before it pays at all.',
    columns: [
      { key: 'kind', header: 'Kind' },
      { key: 'settles', header: 'Settles in' },
      { key: 'discount', header: 'Agreed discount' },
      { key: 'preAuth', header: 'Pre-authorisation' },
      { key: 'coPay', header: 'Patient co-pay' },
      { key: 'documents', header: 'Documents' },
    ],
    rows: payerAgreementRows,
    risk: 'The claim desk follows these terms, and the claim register measures ageing against the settlement period here. Get the discount wrong and every claim is short-paid for a reason the hospital wrote into its own contract.',
    owner: 'Finance manager, with the managing director',
  },
  {
    id: 'charges',
    name: 'Hospital charges',
    nameBn: 'হাসপাতালের চার্জ',
    legacy: 'Setup › Hospital Charges',
    purpose: 'The tariff every bill is built from.',
    columns: [
      { key: 'category', header: 'Category' },
      { key: 'price', header: 'Price', numeric: true },
      { key: 'effective', header: 'Effective from' },
      { key: 'used', header: 'Billed on', numeric: true },
    ],
    rows: chargeRows,
    risk: 'A wrong price is money taken from a patient or lost by the hospital, and it is the one master a bill cannot argue with. Changes start from a date, so last month’s revenue is not rewritten.',
    owner: 'Finance, with the billing in-charge',
  },
  {
    id: 'drugs',
    name: 'Medicine master',
    nameBn: 'ঔষধ তালিকা',
    legacy: 'Setup › Pharmacy',
    purpose: 'The formulary: brands, strengths, prices and the two flags that change behaviour.',
    columns: [
      { key: 'form', header: 'Form' },
      { key: 'class', header: 'Class' },
      { key: 'price', header: 'Unit price', numeric: true },
      { key: 'controlled', header: 'Controlled' },
      { key: 'highAlert', header: 'High alert' },
      { key: 'allergen', header: 'Allergen group' },
      { key: 'used', header: 'Used on', numeric: true },
    ],
    rows: drugRows,
    risk: 'The controlled and high-alert flags are not decoration: they decide whether the counter asks for a witness and whether the ward demands a double check. Un-flagging one is a clinical decision.',
    owner: 'Pharmacy in-charge, with the clinical lead',
  },
  {
    id: 'items',
    name: 'Item and inventory master',
    nameBn: 'মালামাল তালিকা',
    legacy: 'Setup › Inventory',
    purpose: 'Consumables and reagents, with the parameters the replenishment list runs on.',
    columns: [
      { key: 'category', header: 'Category' },
      { key: 'unit', header: 'Unit' },
      { key: 'pack', header: 'Pack' },
      { key: 'reorder', header: 'Reorder at', numeric: true },
      { key: 'lead', header: 'Lead time' },
      { key: 'store', header: 'Default store' },
      { key: 'used', header: 'Used on', numeric: true },
    ],
    rows: itemRows,
    risk: 'Lead time and reorder level decide whether the store runs out. A lead time typed as days when it was weeks empties a shelf quietly.',
    owner: 'Store keeper, with the pharmacy in-charge',
  },
  {
    id: 'tests',
    name: 'Laboratory and imaging catalogue',
    nameBn: 'পরীক্ষার তালিকা',
    legacy: 'Setup › Pathology · Setup › Radiology',
    purpose: 'Every test with its sample, container, turn-around time, analytes and price.',
    columns: [
      { key: 'kind', header: 'Kind' },
      { key: 'sample', header: 'Sample / modality' },
      { key: 'container', header: 'Container' },
      { key: 'tat', header: 'Turn-around' },
      { key: 'analytes', header: 'Analytes', numeric: true },
      { key: 'price', header: 'Price', numeric: true },
      { key: 'used', header: 'Ordered', numeric: true },
    ],
    rows: testRows,
    risk: 'The turn-around time is the deadline the worklist chases, and the analytes decide which reference ranges a result is checked against. Both are clinical parameters wearing a catalogue’s clothes.',
    owner: 'Laboratory in-charge, with the radiologist',
  },
  {
    id: 'icd10',
    name: 'ICD-10 diagnosis codes',
    nameBn: 'আইসিডি-১০ কোড',
    legacy: 'Setup › ICD-10',
    purpose: 'The diagnosis codes a consultation can be coded with.',
    columns: [
      { key: 'chapter', header: 'Chapter' },
      { key: 'bangla', header: 'Bangla' },
      { key: 'used', header: 'Coded on', numeric: true },
    ],
    rows: icdRows,
    risk: 'Case mix, the reports and any insurance claim are built from these codes. A retired code stays resolvable so an old record still reads correctly, but it leaves the picker.',
    owner: 'Medical records, with the clinical lead',
  },
  {
    id: 'symptoms',
    name: 'Symptoms',
    nameBn: 'উপসর্গ',
    legacy: 'Setup › Symptoms',
    purpose: 'The symptom picklist the registration and the consultation start from.',
    columns: [
      { key: 'bangla', header: 'Bangla' },
      { key: 'system', header: 'System' },
      { key: 'used', header: 'Recorded', numeric: true },
    ],
    rows: symptomRows,
    risk: 'Low risk, high irritation: a symptom nobody can find gets typed into a free-text box, and then it cannot be counted.',
    owner: 'Medical records',
  },
  {
    id: 'findings',
    name: 'Examination findings',
    nameBn: 'পরীক্ষার ফলাফল',
    legacy: 'Setup › Findings',
    purpose: 'The examination picklist, so findings are recorded the same way by every doctor.',
    columns: [
      { key: 'system', header: 'System' },
      { key: 'used', header: 'Recorded', numeric: true },
    ],
    rows: findingRows,
    risk: 'A shorthand only its author understands is not a finding. The picklist is what makes the chart readable by the next clinician.',
    owner: 'Clinical lead',
  },
  {
    id: 'vitals',
    name: 'Vital signs and reference ranges',
    nameBn: 'ভাইটাল সাইন',
    legacy: 'Setup › Vitals',
    purpose: 'Every vital with the range that flags it, the band that makes it critical, and the early-warning points it scores.',
    columns: [
      { key: 'bangla', header: 'Bangla' },
      { key: 'unit', header: 'Unit' },
      { key: 'low', header: 'Low', numeric: true },
      { key: 'high', header: 'High', numeric: true },
      { key: 'criticalLow', header: 'Critical low', numeric: true },
      { key: 'criticalHigh', header: 'Critical high', numeric: true },
    ],
    rows: vitalRows,
    risk: 'These ranges decide what the ward chart flags and how the early-warning score is computed. A wrong high limit silences a deteriorating patient.',
    owner: 'Clinical lead, signed off with the nursing superintendent',
  },
  {
    id: 'blood',
    name: 'Blood products',
    nameBn: 'রক্তের উপাদান',
    legacy: 'Setup › Blood Bank',
    purpose: 'Components with their storage, shelf life, cross-match requirement and charge.',
    columns: [
      { key: 'component', header: 'Component' },
      { key: 'shelf', header: 'Shelf life' },
      { key: 'storage', header: 'Storage' },
      { key: 'crossMatch', header: 'Cross-match' },
      { key: 'charge', header: 'Charge', numeric: true },
    ],
    rows: bloodProductRows,
    risk: 'Shelf life and storage decide what can be issued. A wrong shelf life issues blood that should have been discarded.',
    owner: 'Blood bank in-charge',
  },
  {
    id: 'wards',
    name: 'Wards and nursing',
    nameBn: 'ওয়ার্ড',
    legacy: 'Setup › Bed',
    purpose: 'The wards, their beds and cabins, and the nursing ratio each one runs on.',
    columns: [
      { key: 'floor', header: 'Floor' },
      { key: 'beds', header: 'Beds', numeric: true },
      { key: 'cabins', header: 'Cabins', numeric: true },
      { key: 'classes', header: 'Classes' },
      { key: 'inCharge', header: 'In charge' },
      { key: 'ratio', header: 'Nursing ratio' },
    ],
    rows: wardRows,
    risk: 'The bed count is the denominator of every occupancy figure the hospital reports.',
    owner: 'Nursing superintendent',
  },
  {
    id: 'bedclass',
    name: 'Bed classes and nightly charges',
    nameBn: 'বেড শ্রেণি',
    legacy: 'Setup › Bed',
    purpose: 'What a night in each class costs, and what it is staffed at.',
    columns: [
      { key: 'nightly', header: 'Per night', numeric: true },
      { key: 'nursing', header: 'Nursing' },
    ],
    rows: bedClassRows,
    risk: 'The ward bill is this number times the nights. A stale nightly charge is a month of wrong bills.',
    owner: 'Finance, with the nursing superintendent',
  },
  {
    id: 'theatres',
    name: 'Operating theatres',
    nameBn: 'অপারেশন থিয়েটার',
    legacy: 'Setup › Operations',
    purpose: 'Every theatre with its specialty, its equipment and its cleaning turn-around.',
    columns: [
      { key: 'specialty', header: 'Specialty' },
      { key: 'cleaning', header: 'Turn-around' },
      { key: 'equipment', header: 'Equipment' },
      { key: 'state', header: 'State' },
    ],
    rows: theatreRows,
    risk: 'The turn-around time decides how many cases fit in a list. It is a promise to the surgeon and to the next patient.',
    owner: 'Theatre in-charge',
  },
];

export const catalogueById = (id: string): Catalogue | undefined => CATALOGUES.find((c) => c.id === id);

/* ------------------------------------------------------------------ the rules, as functions */

export interface MasterChange {
  catalogueId: string;
  code: string;
  kind: 'edit' | 'retire' | 'restore' | 'add';
  at: string;
  by: string;
  what: string;
  detail?: string;
}

/** Which of these codes a record already points at. A code in use cannot be deleted — only retired. */
export function usageCount(catalogue: Catalogue, code: string): number {
  const row = catalogue.rows.find((r) => r.code === code);
  if (!row) return 0;
  const value = row.values.used;
  if (typeof value === 'number') return value;
  const numeric = Number(String(value ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

export interface CodeCheck {
  ok: boolean;
  problem?: string;
  hint?: string;
}

/** What a code may be: unique, non-empty, and shaped like its catalogue. */
export function checkCode(catalogue: Catalogue, code: string, editingCode?: string): CodeCheck {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, problem: 'A code cannot be empty — it is how records point at this row.' };
  const clash = catalogue.rows.find((r) => r.code.toLowerCase() === trimmed.toLowerCase() && r.code !== editingCode);
  if (clash) return { ok: false, problem: `“${trimmed}” is already used by “${clash.label}”.`, hint: 'Codes are identities: rename the label, not the code.' };
  if (catalogue.id === 'icd10' && !/^[A-Z]\d{2}(\.\d+)?$/.test(trimmed.toUpperCase())) {
    return { ok: false, problem: 'ICD-10 codes look like F32 or E11.9.', hint: 'A free-text diagnosis belongs in the note, not in the code list.' };
  }
  if (catalogue.id === 'charges' && !/^[A-Z]{2,4}-\d{2,4}$/.test(trimmed.toUpperCase())) {
    return { ok: false, problem: 'Charge codes look like CONS-101 or PATH-205.', hint: 'A charge without a code cannot be found at the counter.' };
  }
  return { ok: true };
}

/** What a retire would cost, before somebody presses it. */
export function retireImpact(catalogue: Catalogue, row: MasterRow): { used: number; message: string | null } {
  const used = usageCount(catalogue, row.code);
  if (used === 0) return { used, message: null };
  return {
    used,
    message: `“${row.label}” is on ${used} record(s). Retiring it removes it from every picker but keeps those records resolving to it: nothing already written changes, and nothing that is written later can point at it.`,
  };
}

export function catalogueStats(catalogue: Catalogue) {
  const active = catalogue.rows.filter((r) => r.active);
  const retired = catalogue.rows.filter((r) => !r.active);
  const money = catalogue.rows.filter((r) => typeof r.values.price === 'number' || typeof r.values.nightly === 'number' || typeof r.values.charge === 'number');
  return {
    total: catalogue.rows.length,
    active: active.length,
    retired: retired.length,
    priced: money.length,
    /** Codes that are in use somewhere: the population a retire has to be careful about. */
    inUse: catalogue.rows.filter((r) => usageCount(catalogue, r.code) > 0).length,
    lastChange: catalogue.rows
      .map((r) => r.lastChange.at)
      .sort()
      .at(-1),
  };
}

/** The categories a charge can belong to, straight from the billing module so they cannot drift. */
export const CHARGE_CATEGORIES: Category[] = ['Consultation', 'Pathology', 'Radiology', 'Procedure', 'Pharmacy', 'Bed', 'Ambulance'];
