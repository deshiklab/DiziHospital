/* ----------------------------------------------------------------------------------------------------
 * Print templates as data (P7's last item, the designer behind `/admin/printing`).
 *
 * The twelve templates used to exist only as JSX in `app/(staff)/print/[doc]/page.tsx`, which is why the register
 * has always said `authoredIn: 'designer'` and the rules have always said *the designer is where a template changes,
 * not the code* — a promise the print settings screen made on the product's behalf. This module is the language that
 * promise needed:
 *
 *  1. **A layout is millimetres on a sheet, not a hierarchy of divs.** A block has an `x`, a `y`, a width and a
 *     height in millimetres, measured from the top-left of the paper, and every one of them lands on a 2 mm grid.
 *     A designer whose blocks float cannot answer “will this print inside the tray”, which is the only question the
 *     person setting it up actually has.
 *  2. **The rules are checked, not hoped for.** `checkLayout` refuses a document with no hospital name, a data block
 *     with no field behind it, an empty text block, a block that hangs off the sheet, and a table with no rows; it
 *     warns where a decorative block crosses the printer's margin. A refusal names the block, because “invalid
 *     layout” has never helped anybody.
 *  3. **The specimen is a real record, not lorem ipsum.** A data block prints a value from the same registers the
 *     screens read, so what the designer shows is what comes out of the printer.
 *  4. **A published version is an event.** `LAYOUTS` holds what the branch prints now; `publish()` appends a
 *     version rather than editing one, so “what did the receipt look like in September” has an answer, and the
 *     queue carries the same write through the contract's own operation (`publishPrintTemplate`).
 */

import { SETTING_SCREENS } from '@/lib/admin';
import { PRINT_TEMPLATES, type PrintTemplate } from '@/lib/admin';

/* ------------------------------------------------------------------ the sheet */

export type PaperId = 'a4-portrait' | 'a4-landscape' | 'a5-portrait' | 'thermal-80' | 'card-cr80' | 'label-50x25';

export interface Paper {
  id: PaperId;
  label: string;
  /** How the print settings and the template register spell this paper. Kept beside the size so the two agree. */
  register: string;
  /** Millimetres, landscape where the width is the longer side. */
  w: number;
  h: number;
  /**
   * The edge most printers cannot reach. Nothing that matters is placed inside it, and a decorative block that
   * crosses it is a warning rather than a refusal — a full-bleed border on a card is a decision, not a mistake.
   */
  margin: number;
}

/* Every margin is a multiple of the grid on purpose: a sheet whose printable area starts at 3 mm can never have a
 * block dragged back onto the grid, and a designer that starts every layout off the grid is one where the first
 * thing a branch does is break its own rule. */
export const PAPERS: Record<PaperId, Paper> = {
  'a4-portrait': { id: 'a4-portrait', label: 'A4 portrait', register: 'A4', w: 210, h: 297, margin: 8 },
  'a4-landscape': { id: 'a4-landscape', label: 'A4 landscape', register: 'A4 landscape', w: 297, h: 210, margin: 8 },
  'a5-portrait': { id: 'a5-portrait', label: 'A5 portrait', register: 'A5', w: 148, h: 210, margin: 6 },
  'thermal-80': { id: 'thermal-80', label: 'Thermal 80 mm', register: 'Thermal 80 mm', w: 80, h: 297, margin: 4 },
  'card-cr80': { id: 'card-cr80', label: 'Card, CR80', register: 'CR80 card', w: 86, h: 54, margin: 2 },
  'label-50x25': { id: 'label-50x25', label: 'Label 50 × 25 mm', register: '50 × 25 mm', w: 50, h: 25, margin: 2 },
};

export const paperFor = (register: string): PaperId =>
  (Object.values(PAPERS).find((p) => p.register === register)?.id ?? 'a4-portrait') as PaperId;

/* ------------------------------------------------------------------ the blocks */

export type BlockKind = 'hospital' | 'title' | 'patient' | 'table' | 'totals' | 'signature' | 'barcode' | 'note' | 'footer' | 'watermark';

export interface BlockKindSpec {
  kind: BlockKind;
  label: string;
  /** What the block prints, in the words of the person placing it. */
  because: string;
  /** True when the block reads a record; a block that reads must name the field it reads. */
  data: boolean;
  /** The field a new block of this kind starts with, when it reads one. */
  field?: string;
  w: number;
  h: number;
  text?: string;
}

export const BLOCK_KINDS: BlockKindSpec[] = [
  { kind: 'hospital', label: 'Hospital header', because: 'The name, branch and telephone lines, authored once in Setup › Print Header Footer rather than typed into each template. Not a data block: it reads the setting, not a record.', data: false, w: 120, h: 18 },
  { kind: 'title', label: 'Document title', because: 'What the paper is — “Money receipt”, “Discharge summary”. A patient holding two slips needs to know which one the desk asked for.', data: false, w: 70, h: 8, text: 'Document' },
  { kind: 'patient', label: 'Patient block', because: 'Who the document is about: name, MRN, age and sex, and the bed or the room where they were seen.', data: true, field: 'patient.identity', w: 80, h: 20 },
  { kind: 'table', label: 'Table of rows', because: 'The lines of a bill, the medicines on a prescription, the columns of a register. The rows come from the record the document was printed for.', data: true, field: 'invoice.lines', w: 180, h: 60, },
  { kind: 'totals', label: 'Totals', because: 'The money or the count the document exists to state, with the payer’s share beside it where there is one.', data: true, field: 'invoice.totals', w: 80, h: 16 },
  { kind: 'signature', label: 'Signature line', because: 'Who signed it and what they signed for. A document that a person is accountable for says so on the paper.', data: false, w: 60, h: 16, text: 'Signature' },
  { kind: 'barcode', label: 'Barcode', because: 'The identifier the laboratory, the pharmacy or the gate scans. Drawn from the record’s own number, never retyped.', data: true, field: 'record.number', w: 50, h: 16 },
  { kind: 'note', label: 'Note', because: 'A sentence the branch adds to its own paper: what to bring, where to go, what the hospital does not do.', data: false, w: 90, h: 12, text: '' },
  { kind: 'footer', label: 'Footer', because: 'The line under every page, read from the print settings so twelve templates cannot disagree about it.', data: false, w: 150, h: 8 },
  { kind: 'watermark', label: 'Watermark or stamp', because: 'The word that decides how a document is read — “Duplicate”, “Cancelled”, “Copy”. Printed behind everything else and never instead of the words.', data: false, w: 90, h: 30, text: 'Copy' },
];

export const blockSpec = (kind: BlockKind): BlockKindSpec => BLOCK_KINDS.find((k) => k.kind === kind)!;

export interface PrintBlock {
  id: string;
  kind: BlockKind;
  /** Millimetres from the top-left of the sheet. */
  x: number;
  y: number;
  w: number;
  h: number;
  align?: 'left' | 'centre' | 'right';
  /** Type scale, not pixels: the renderer decides what `md` is on a card and on a sheet. */
  size?: 'sm' | 'md' | 'lg';
  bold?: boolean;
  text?: string;
  field?: string;
  rows?: number;
}

export interface PrintLayout {
  /** The template's id, spelled exactly as the print register spells it. */
  id: string;
  name: string;
  paper: PaperId;
  blocks: PrintBlock[];
  /** The version the node prints now; zero means nothing has been published and the code template still prints. */
  version: number;
  publishedAt?: string;
  publishedBy?: string;
  updatedAt: string;
  updatedBy: string;
}

/* ------------------------------------------------------------------ the printer's own numbers */

/** Every edge lands on this grid. Two people editing one receipt have to agree on where “next to” is. */
export const GRID = 2;
export const MIN_BLOCK = { w: 10, h: 6 };
export const MAX_BLOCKS = 40;
/** A document nobody can check is a document that gets filed; the ceiling is generous on purpose. */
export const EDGE_GUIDE = 3;

export const snap = (mm: number): number => Math.round(mm / GRID) * GRID;
/** Down to the grid: for a block anchored to the bottom of the sheet, rounding up would push it into the margin. */
export const floorGrid = (mm: number): number => Math.floor(mm / GRID) * GRID;
export const onGrid = (mm: number): boolean => Math.abs(mm - snap(mm)) < 0.001;

export const printable = (paper: Paper) => ({
  x: paper.margin,
  y: paper.margin,
  w: paper.w - paper.margin * 2,
  h: paper.h - paper.margin * 2,
});

const overlaps = (a: PrintBlock, b: PrintBlock): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The area two blocks share, in mm². Used to decide whether two blocks are printing over each other. */
export function overlapArea(a: PrintBlock, b: PrintBlock): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Decorative blocks print behind the words, so they may cross the margin — and are the only ones that may. */
const DECORATIVE: BlockKind[] = ['watermark'];

export interface LayoutIssue {
  code: string;
  /** Which block it is about, by its own label, because “invalid layout” has never helped anybody. */
  block?: string;
  title: string;
  message: string;
  messageBn?: string;
}

export interface LayoutCheck {
  ok: boolean;
  reasons: LayoutIssue[];
  warnings: LayoutIssue[];
}

const issue = (code: string, title: string, message: string, block?: string): LayoutIssue => ({ code, title, message, block });

/**
 * The printer's rules, checked before anything is published.
 *
 * The refusals are the ones that produce a document somebody cannot act on: no hospital name on the paper, a data
 * block with no field behind it (it would print a heading and a blank), a table with no rows, a block hanging off
 * the sheet, or a document with nothing on it at all. The warnings are what a person may mean on purpose — a
 * watermark crossing the printable edge, two notes overlapping, type at the smallest size on a thermal roll.
 */
export function checkLayout(layout: PrintLayout): LayoutCheck {
  const reasons: LayoutIssue[] = [];
  const warnings: LayoutIssue[] = [];
  const paper = PAPERS[layout.paper];
  const label = (b: PrintBlock) => b.text?.trim() || blockSpec(b.kind).label;

  if (layout.blocks.length === 0) {
    reasons.push(issue('dizi.layout-refused', 'Nothing to print', `${layout.name} has no blocks, so it would print an empty sheet. Add the hospital header and the record it is about.`));
  }
  if (layout.blocks.length > MAX_BLOCKS) {
    reasons.push(issue('dizi.layout-refused', 'Too many blocks', `${layout.blocks.length} blocks on one sheet is past the point where anybody reads it. The most a template here carries is ${MAX_BLOCKS}.`));
  }
  if (!layout.blocks.some((b) => b.kind === 'hospital')) {
    reasons.push(issue('dizi.layout-refused', 'No hospital name', 'Every document carries the hospital’s name and branch, from Setup › Print Header Footer. A paper with no hospital on it is a paper nobody can act on later.'));
  }

  for (const b of layout.blocks) {
    const spec = blockSpec(b.kind);
    const name = label(b);
    if (b.w < MIN_BLOCK.w || b.h < MIN_BLOCK.h) {
      reasons.push(issue('dizi.layout-refused', 'Block too small', `${name} is ${b.w} × ${b.h} mm. Below ${MIN_BLOCK.w} × ${MIN_BLOCK.h} mm nothing legible fits.`, name));
    }
    if (b.x < 0 || b.y < 0 || b.x + b.w > paper.w || b.y + b.h > paper.h) {
      reasons.push(issue('dizi.layout-refused', 'Off the sheet', `${name} runs off the ${paper.label} sheet (${paper.w} × ${paper.h} mm). The printer would cut it off, and the part it cuts is the part somebody needed.`, name));
    }
    if (spec.data && !b.field) {
      reasons.push(issue('dizi.layout-refused', 'No field behind the block', `${name} prints from a record but no field is chosen, so it would print its heading and a blank line.`, name));
    }
    if (b.kind === 'table' && (b.rows ?? 0) < 1) {
      reasons.push(issue('dizi.layout-refused', 'A table with no rows', `${name} is set to print no rows. Either give it rows or take the block off the sheet.`, name));
    }
    if ((b.kind === 'note' || b.kind === 'title') && !b.text?.trim()) {
      reasons.push(issue('dizi.layout-refused', 'Empty text block', `${name} has no words in it. An empty block prints a blank box, which reads as a mistake on paper.`, name));
    }
    if (!DECORATIVE.includes(b.kind) && (b.x < paper.margin || b.y < paper.margin || b.x + b.w > paper.w - paper.margin || b.y + b.h > paper.h - paper.margin)) {
      warnings.push(issue('inside-margin', 'Inside the printer’s margin', `${name} falls within ${paper.margin} mm of the edge. Many printers cannot reach there — a full-bleed border is a decision, so this is a warning rather than a refusal.`, name));
    }
  }

  /* Two blocks that both print words over the same millimetres produce a document that has to be read twice. A
   * watermark is meant to sit behind them, so only the non-decorative pairs are warned about. */
  const solid = layout.blocks.filter((b) => !DECORATIVE.includes(b.kind));
  for (let i = 0; i < solid.length; i += 1) {
    for (let j = i + 1; j < solid.length; j += 1) {
      const area = overlapArea(solid[i], solid[j]);
      if (area > 0) {
        warnings.push(
          issue('overlapping', 'Two blocks print over each other', `${label(solid[i])} and ${label(solid[j])} overlap by ${Math.round(area)} mm². Printing one over the other is a thing that happens on paper and cannot be undone.`, label(solid[i])),
        );
      }
    }
  }

  return { ok: reasons.length === 0, reasons, warnings };
}

/* ------------------------------------------------------------------ editing */

export type EditStep = { dx?: number; dy?: number; dw?: number; dh?: number };

/** Move or resize a block, snapped to the grid and kept on the sheet. A block may be dragged off and back. */
export function editBlock(block: PrintBlock, step: EditStep, paper: PaperId): PrintBlock {
  const p = PAPERS[paper];
  const x = snap((block.x ?? 0) + (step.dx ?? 0));
  const y = snap((block.y ?? 0) + (step.dy ?? 0));
  const w = Math.max(MIN_BLOCK.w, snap((block.w ?? MIN_BLOCK.w) + (step.dw ?? 0)));
  const h = Math.max(MIN_BLOCK.h, snap((block.h ?? MIN_BLOCK.h) + (step.dh ?? 0)));
  return {
    ...block,
    x: Math.max(0, Math.min(x, p.w - w)),
    y: Math.max(0, Math.min(y, p.h - h)),
    w: Math.min(w, p.w),
    h: Math.min(h, p.h),
  };
}

/** The block under a point, topmost first. The watermark is behind everything, so it is the last to be caught. */
export function blockAt(blocks: PrintBlock[], x: number, y: number): PrintBlock | undefined {
  const ordered = [...blocks].sort((a, b) => Number(DECORATIVE.includes(a.kind)) - Number(DECORATIVE.includes(b.kind)));
  return ordered.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
}

/**
 * The alignment guides drawn while a block is being dragged: where this block's edges line up with another's, so
 * two blocks can be made to agree without anybody counting millimetres. Returned in sheet coordinates.
 */
export function guidesFor(blocks: PrintBlock[], moving: PrintBlock, paper: PaperId): { x: number[]; y: number[] } {
  const p = PAPERS[paper];
  const x = new Set<number>([p.margin, p.w - p.margin]);
  const y = new Set<number>([p.margin, p.h - p.margin]);
  for (const other of blocks) {
    if (other.id === moving.id) continue;
    for (const edge of [other.x, other.x + other.w / 2, other.x + other.w]) if (Math.abs(edge - moving.x) <= EDGE_GUIDE || Math.abs(edge - (moving.x + moving.w)) <= EDGE_GUIDE) x.add(edge);
    for (const edge of [other.y, other.y + other.h / 2, other.y + other.h]) if (Math.abs(edge - moving.y) <= EDGE_GUIDE || Math.abs(edge - (moving.y + moving.h)) <= EDGE_GUIDE) y.add(edge);
  }
  return { x: [...x], y: [...y] };
}

export interface RoomVerdict {
  ok: boolean;
  /** Where a new block of this kind would land, and how tall it would be. */
  y: number;
  h: number;
  because?: string;
}

/**
 * Whether there is room for another block, and where it goes — asked before one is added.
 *
 * “Room” on a sheet with a header at the top and a footer at the bottom is not the space below everything: it is the
 * first gap between the blocks that is tall enough. A receipt with a signature line at 272 mm has 130 mm of free
 * paper above it, and a designer that answered “no room” there would have a branch believing its receipt was full.
 * When every gap is too small the sentence says so, rather than dropping a block off the bottom of the sheet and
 * complaining afterwards.
 */
export function roomFor(layout: PrintLayout, kind: BlockKind): RoomVerdict {
  const paper = PAPERS[layout.paper];
  const spec = blockSpec(kind);
  const top = snap(paper.margin);
  const bottom = floorGrid(paper.h - paper.margin);
  let cursor = top;
  for (const b of [...layout.blocks].sort((a, c) => a.y - c.y)) {
    const gap = floorGrid(b.y - cursor);
    if (gap >= MIN_BLOCK.h) return { ok: true, y: cursor, h: Math.min(spec.h, gap) };
    cursor = Math.max(cursor, snap(b.y + b.h));
  }
  const tail = floorGrid(bottom - cursor);
  if (tail >= MIN_BLOCK.h) return { ok: true, y: cursor, h: Math.min(spec.h, tail) };
  return {
    ok: false,
    y: cursor,
    h: 0,
    because: `Every gap on this ${paper.label} sheet is smaller than the ${MIN_BLOCK.w} × ${MIN_BLOCK.h} mm a block needs. Move a block, shorten a table, or print this document on a longer sheet.`,
  };
}

/** A new block, placed where there is room rather than on top of what is already there. */
export function addBlock(layout: PrintLayout, kind: BlockKind, id: string): PrintLayout {
  const spec = blockSpec(kind);
  const paper = PAPERS[layout.paper];
  const room = roomFor(layout, kind);
  const w = Math.min(spec.w, floorGrid(paper.w - paper.margin * 2));
  const h = Math.max(MIN_BLOCK.h, room.h || Math.min(spec.h, floorGrid(paper.h - paper.margin - snap(paper.margin))));
  const block: PrintBlock = {
    id,
    kind,
    x: snap(paper.margin),
    y: Math.min(room.y, floorGrid(paper.h - h)),
    w: snap(w),
    h: snap(h),
    align: 'left',
    size: 'md',
    bold: kind === 'title' || kind === 'hospital',
    ...(spec.text !== undefined ? { text: spec.text } : {}),
    ...(spec.field ? { field: spec.field } : {}),
    ...(kind === 'table' ? { rows: 6 } : {}),
  };
  return { ...layout, blocks: [...layout.blocks, block] };
}

export const removeBlock = (layout: PrintLayout, id: string): PrintLayout => ({ ...layout, blocks: layout.blocks.filter((b) => b.id !== id) });
export const updateBlock = (layout: PrintLayout, id: string, patch: Partial<PrintBlock>): PrintLayout => ({
  ...layout,
  blocks: layout.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
});

/* ------------------------------------------------------------------ the specimen

 * A data block prints a value from the register the document is about. The designer shows a real specimen — the same
 * patient, the same bill, the same staff member the print route would use with no query parameter — because a
 * designer that previews “Patient Name Here” is a designer that cannot show whether the name fits.
 */

const settingValue = (key: string): string => {
  for (const screen of SETTING_SCREENS) {
    for (const field of screen.fields) {
      if (field.key === key) return String(field.value ?? '');
    }
  }
  return '';
};

export const HOSPITAL_HEADER = {
  name: settingValue('hospitalName') || 'Dizi Hospital',
  branch: settingValue('branchLine') || 'Main Campus',
  note: settingValue('headerNote') || '',
  footer: settingValue('footerNote') || '',
};

/** The field a block may read, and what the specimen prints for it. */
export const FIELDS: Array<{ key: string; label: string; specimen: string }> = [
  { key: 'patient.identity', label: 'Patient — name, MRN, age, sex', specimen: 'Fatema Begum · SH-102355 · 28 y · female' },
  { key: 'patient.contact', label: 'Patient — mobile and address', specimen: '01711 000 000 · Mirpur, Dhaka' },
  { key: 'patient.allergy', label: 'Allergies', specimen: 'No known allergy' },
  { key: 'visit.identity', label: 'Visit — date, doctor, room', specimen: '16 Oct 2026 · Dr. R. Akter · OPD-4' },
  { key: 'record.number', label: 'The record’s own number', specimen: 'INV-2026-04188' },
  { key: 'invoice.lines', label: 'Bill — the lines', specimen: 'Obstetric ultrasound · ৳ 1,500' },
  { key: 'invoice.totals', label: 'Bill — total, paid, due', specimen: '৳ 2,300 · paid ৳ 0 · due ৳ 2,300' },
  { key: 'prescription.medicines', label: 'Prescription — the medicines', specimen: 'Ferrous sulphate 200 mg · twice daily · 30 days' },
  { key: 'lab.results', label: 'Laboratory — results and ranges', specimen: 'Haemoglobin 10.4 g/dL (11.0–14.0) · low' },
  { key: 'discharge.course', label: 'Discharge — course and condition', specimen: 'Admitted with preterm contractions · settled · discharged well' },
  { key: 'birth.record', label: 'Birth — register number and outcome', specimen: 'BHR-2026-0117 · live birth · 2.9 kg · Apgar 9/10' },
  { key: 'death.record', label: 'Death — cause and certificate', specimen: 'Cause I(a) Sepsis · certificate issued · 24 h' },
  { key: 'staff.member', label: 'Staff — name, code, designation', specimen: 'Nusrat Jahan · EMP-1042 · Senior staff nurse' },
  { key: 'attendance.month', label: 'Attendance — the month', specimen: 'October 2026 · 26 present · 2 late · 4 off' },
  { key: 'pass.number', label: 'Visitor — pass number and host', specimen: 'VP-2026-0421 · host: pharmacy store' },
];

export const fieldLabel = (key: string): string => FIELDS.find((f) => f.key === key)?.label ?? key;
export const specimenFor = (key: string): string => FIELDS.find((f) => f.key === key)?.specimen ?? '';

/* ------------------------------------------------------------------ the twelve templates */

const block = (id: string, kind: BlockKind, x: number, y: number, w: number, h: number, extra: Partial<PrintBlock> = {}): PrintBlock => ({
  id,
  kind,
  x,
  y,
  w,
  h,
  align: 'left',
  size: 'md',
  ...extra,
});

/** Header and footer every sheet carries, placed once so the twelve layouts cannot each invent their own. */
const shell = (paper: Paper): PrintBlock[] => {
  const p = printable(paper);
  return [
    block('b-hospital', 'hospital', snap(p.x), snap(p.y), snap(Math.min(120, p.w)), 16, { bold: true, size: 'md' }),
    block('b-footer', 'footer', snap(p.x), floorGrid(paper.h - paper.margin - 6), floorGrid(p.w), 6, { size: 'sm' }),
  ];
};

/**
 * A layout per template, built from the template's own paper and the fields it says it prints — so the starting
 * point is the register's, not a blank sheet somebody has to guess at. Blocks are laid out down the sheet in the
 * order the register lists what the document prints, which is the order the paper reads in.
 */
function defaultLayout(template: PrintTemplate): PrintLayout {
  const paperId = paperFor(template.paper);
  const paper = PAPERS[paperId];
  const p = printable(paper);
  const blocks: PrintBlock[] = shell(paper);
  const FIELDS_BY_TEMPLATE: Record<string, string[]> = {
    receipt: ['record.number', 'patient.identity', 'invoice.lines', 'invoice.totals'],
    invoice: ['record.number', 'patient.identity', 'invoice.lines', 'invoice.totals'],
    'opd-slip': ['patient.identity', 'visit.identity', 'record.number'],
    prescription: ['patient.identity', 'patient.allergy', 'prescription.medicines'],
    'lab-report': ['patient.identity', 'lab.results', 'staff.member'],
    'imaging-report': ['patient.identity', 'lab.results', 'staff.member'],
    discharge: ['patient.identity', 'discharge.course', 'visit.identity', 'staff.member'],
    'birth-certificate': ['birth.record', 'staff.member'],
    'death-certificate': ['death.record', 'staff.member'],
    payslip: ['staff.member', 'attendance.month', 'invoice.totals'],
    'attendance-sheet': ['attendance.month', 'staff.member'],
    'visitor-badge': ['pass.number', 'visit.identity'],
  };
  const fields = FIELDS_BY_TEMPLATE[template.id] ?? ['patient.identity'];
  let y = snap(p.y) + 20;
  for (const [i, field] of fields.entries()) {
    const isTable = field === 'invoice.lines' || field === 'prescription.medicines' || field === 'lab.results' || field === 'attendance.month';
    const h = isTable ? Math.min(56, paper.h - y - 24) : 16;
    if (h < MIN_BLOCK.h) break;
    blocks.push(
      block(`b-${i + 1}`, isTable ? 'table' : i === 0 ? 'patient' : 'note', snap(p.x), y, floorGrid(p.w), snap(h), {
        align: 'left',
        size: 'sm',
        field,
        ...(isTable ? { rows: paperId === 'thermal-80' ? 5 : 8 } : { text: fieldLabel(field) }),
      }),
    );
    y += h + 4;
    if (y > paper.h - paper.margin - 26) break;
  }
  const last = blocks[blocks.length - 1];
  if (last && last.y + last.h + 18 < paper.h - paper.margin) {
    blocks.push(block('b-sign', 'signature', snap(p.x), floorGrid(paper.h - paper.margin - 20), snap(Math.min(60, p.w / 2)), 14, { text: 'Signed', size: 'sm' }));
  }
  return {
    id: template.id,
    name: template.label,
    paper: paperId,
    blocks,
    version: 0,
    updatedAt: '2026-08-01',
    updatedBy: 'S. Nahar, system administrator',
  };
}

export const LAYOUTS: PrintLayout[] = PRINT_TEMPLATES.map(defaultLayout);

export const layoutFor = (id: string): PrintLayout | undefined => LAYOUTS.find((l) => l.id === id);
export const templateFor = (id: string): PrintTemplate | undefined => PRINT_TEMPLATES.find((t) => t.id === id);

/**
 * Publishing appends a version rather than editing one. The layout that comes back carries the new number and the
 * name of the person who published it, exactly as the contract's `publishPrintTemplate` operation records it.
 */
export function publish(layout: PrintLayout, by: string, at: string): PrintLayout {
  return { ...layout, version: layout.version + 1, publishedAt: at, publishedBy: by, updatedAt: at, updatedBy: by };
}

export interface TemplateVersion {
  templateId: string;
  version: number;
  paper: PaperId;
  blocks: PrintBlock[];
  publishedAt: string;
  publishedBy: string;
}

/**
 * The published versions this node knows about, newest first.
 *
 * It starts empty because a node starts empty: `LAYOUTS` is the register's record of what each template looks like,
 * and a version exists once somebody publishes one. That is what makes the rule — publishing appends rather than
 * edits — something the screen can show rather than assert: the list grows under the person using it.
 */
export const VERSIONS: TemplateVersion[] = [];

export const versionsOf = (templateId: string): TemplateVersion[] => VERSIONS.filter((v) => v.templateId === templateId).sort((a, b) => b.version - a.version);

/* ------------------------------------------------------------------ the node's own copy

 * A published layout has to reach the printer, and the printer is a page on the edge node. The contract's
 * `publishPrintTemplate` is the record of truth — the version is queued and carried to the cloud from here — but the
 * copy this node prints from is kept beside the outbox, so a branch that changed its receipt with the uplink down
 * prints the new receipt. This is the same shape as the queued writes: the node holds the node's copy.
 */
const LAYOUT_KEY = 'dizi.print.layouts';

export function loadNodeLayouts(): Record<string, PrintLayout> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PrintLayout>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A store this node cannot read is reported by the next publish rather than thrown at somebody printing a receipt.
    return {};
  }
}

export function saveNodeLayout(layout: PrintLayout): void {
  if (typeof window === 'undefined') return;
  try {
    const all = loadNodeLayouts();
    all[layout.id] = layout;
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch {
    /* Full or unavailable storage: the version is still queued, and the print route falls back to the code template. */
  }
}

/** The layout this node prints from, or nothing when the template has never been published here. */
export function nodeLayoutFor(templateId: string): PrintLayout | undefined {
  return loadNodeLayouts()[templateId];
}

/**
 * Which register template a printed document belongs to.
 *
 * The register's twelve are the documents the legacy product tracked; the platform prints six more (the registration
 * slip, the two labels, the purchase order, the ID card and the day list) which no designer owns yet, and they keep
 * printing from their code templates. A document with no entry here is one of those, not a mistake.
 */
export const TEMPLATE_OF_DOC: Record<string, string> = {
  receipt: 'receipt',
  invoice: 'invoice',
  'appointment-slip': 'opd-slip',
  prescription: 'prescription',
  'result-report': 'lab-report',
  'imaging-report': 'imaging-report',
  'discharge-summary': 'discharge',
  'birth-record': 'birth-certificate',
  'death-record': 'death-certificate',
  payslip: 'payslip',
  'attendance-sheet': 'attendance-sheet',
  'visitor-badge': 'visitor-badge',
};

/* ------------------------------------------------------------------ the rules the screen states */

export const LAYOUT_RULES: Array<{ title: string; because: string }> = [
  { title: 'A layout is millimetres on a sheet', because: 'The only question the person setting up a printer actually has is whether the block lands inside the tray, and that is a question about millimetres rather than about a hierarchy of boxes.' },
  { title: 'A data block names the field it reads', because: 'A block that prints a heading and a blank line is the failure mode of every designer that lets a table be dropped in without saying where its rows come from.' },
  { title: 'The header is authored once, in the settings', because: 'Twelve templates with twelve headers is how a branch ends up with two addresses and one of them wrong. The header block reads the setting; it does not hold a copy.' },
  { title: 'Publishing appends a version', because: 'A receipt from September has to be reproducible in November. Editing a published layout destroys the only evidence of what a family was handed.' },
  { title: 'A document that prints a figure prints where it came from', because: 'The payslip prints the rule behind each deduction and the laboratory report prints who verified it. A number with no source beside it is a number nobody can check.' },
];

export const DESIGNER_WAITING: string[] = [
  'A certified Code 128 encoder for the barcode block: the block prints a pattern drawn from the record’s own number until the laboratory module supplies one (P4).',
  'The layout store on the server. A published version is queued through the contract’s own operation today, and the edge node prints from its own copy of it — which is what lets a branch change its receipt with the uplink down.',
  'Printer profiles per counter: the same layout has to land inside the tray of a laser printer and a thermal roll, and only a real machine can settle that.',
  'Six documents the register does not track yet — the registration slip, the medicine and specimen labels, the purchase order, the patient ID card and the appointment day list. They print from their code templates, and moving them here is a matter of adding them to the print register.',
];
