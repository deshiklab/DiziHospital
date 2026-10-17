'use client';

import { cx } from '@dizi/ui';
import { HOSPITAL_HEADER, PAPERS, blockSpec, specimenFor, type Paper, type PaperId, type PrintBlock, type PrintLayout } from '@/lib/printing';

/* The one renderer for a print layout.
 *
 * It is shared on purpose: the designer draws a layout with it, and the print route draws the published layout with
 * it, so “what I saw” and “what came out of the printer” are the same code rather than two implementations that
 * agree today. Everything is positioned in millimetres — the sheet is a `mm`-sized box and the blocks are absolutely
 * placed inside it — so the component is also the truth about whether a block lands inside the tray.
 *
 * The blocks print from a specimen when `specimen` is on and from the record the caller passes when it is not, which
 * is what lets the designer show a real patient rather than a placeholder and still print the actual record.
 */

export interface PrintSheetProps {
  layout: PrintLayout;
  /** A record's own values, by field key. Unset means “show the specimen”, which is what the designer previews. */
  values?: Record<string, string>;
  /** Extra rows for a table, when the caller has the real ones. */
  rows?: Record<string, string[]>;
  /** Marks the sheet as a preview: the header says so and the paper is drawn with its edges. */
  preview?: boolean;
  /** Draws the printable area and the grid — the designer's own scaffolding, never printed. */
  showGuides?: boolean;
  /** The block being dragged, so the canvas can outline it. */
  activeId?: string;
  id?: string;
}

export const paperStyle = (paper: Paper) => ({ width: `${paper.w}mm`, height: `${paper.h}mm` });

const TYPE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'text-[9px] leading-[1.3]',
  md: 'text-[11px] leading-[1.35]',
  lg: 'text-[14px] leading-[1.3]',
};

const ALIGN: Record<'left' | 'centre' | 'right', string> = {
  left: 'text-left',
  centre: 'text-center',
  right: 'text-right',
};

/** One block, at its own millimetres. */
export function PrintBlockView({
  block,
  values,
  rows,
  active,
}: {
  block: PrintBlock;
  values?: Record<string, string>;
  rows?: Record<string, string[]>;
  active?: boolean;
}) {
  const spec = blockSpec(block.kind);
  const value = block.field ? values?.[block.field] ?? specimenFor(block.field) : undefined;
  const align = ALIGN[block.align ?? 'left'];
  const style = {
    left: `${block.x}mm`,
    top: `${block.y}mm`,
    width: `${block.w}mm`,
    height: `${block.h}mm`,
  } as const;

  if (block.kind === 'watermark') {
    return (
      <div data-block={block.id} style={style} className="pointer-events-none absolute flex items-center justify-center overflow-hidden">
        <span className="rotate-[-18deg] text-[28px] font-bold uppercase tracking-widest text-black/10">{block.text}</span>
      </div>
    );
  }

  return (
    <div
      data-block={block.id}
      style={style}
      className={cx('absolute overflow-hidden', align, TYPE[block.size ?? 'md'], block.bold && 'font-semibold', active && 'ring-1 ring-brand-700')}
    >
      {block.kind === 'hospital' && (
        <div className="border-b border-black pb-1">
          <p className="text-[13px] font-bold">{HOSPITAL_HEADER.name}</p>
          <p className="text-[9px]">{HOSPITAL_HEADER.branch}</p>
          {HOSPITAL_HEADER.note && <p className="text-[9px]">{HOSPITAL_HEADER.note}</p>}
        </div>
      )}

      {block.kind === 'title' && <p className="text-[13px] font-bold uppercase">{block.text}</p>}

      {block.kind === 'patient' && (
        <div>
          <p className="text-[9px] uppercase tracking-wide text-black/60">{spec.label}</p>
          <p className="font-semibold">{value}</p>
        </div>
      )}

      {block.kind === 'table' && (
        <div>
          <p className="border-b border-black text-[9px] uppercase tracking-wide text-black/60">{block.field ? `Reads: ${spec.label}` : spec.label}</p>
          <table className="w-full border-collapse">
            <tbody>
              {(rows?.[block.field ?? ''] ?? specimenRows(block)).slice(0, block.rows ?? 6).map((row, i) => (
                <tr key={i} className="border-b border-black/20">
                  <td className="py-[1px]">{row}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {block.kind === 'totals' && (
        <div className={cx('border-t border-black pt-1', align)}>
          <p className="text-[9px] uppercase tracking-wide text-black/60">{spec.label}</p>
          <p className="font-semibold">{value}</p>
        </div>
      )}

      {block.kind === 'signature' && (
        <div className="flex h-full flex-col justify-end">
          <div className="border-t border-black pt-[2px] text-[9px]">{block.text || 'Signature'} · {HOSPITAL_HEADER.name}</div>
        </div>
      )}

      {block.kind === 'barcode' && (
        <div>
          <div aria-hidden className="flex h-[26px] items-end gap-px">
            {Array.from(blockValue(block, values).slice(0, 26)).map((ch, i) => {
              const code = ch.charCodeAt(0);
              return <span key={i} className={code % 2 ? 'bg-black' : 'bg-transparent'} style={{ width: code % 3 === 0 ? 2 : 1, height: '100%' }} />;
            })}
          </div>
          <p className="text-center font-mono text-[8px] tracking-widest">{blockValue(block, values)}</p>
        </div>
      )}

      {block.kind === 'note' && <p className="whitespace-pre-wrap">{block.text}</p>}

      {block.kind === 'footer' && <p className="border-t border-black/40 pt-[2px] text-[8px] text-black/70">{HOSPITAL_HEADER.footer}</p>}
    </div>
  );
}

const blockValue = (block: PrintBlock, values?: Record<string, string>): string =>
  (block.field ? values?.[block.field] ?? specimenFor(block.field) : '') || 'DIZI-00000000';

/** The specimen rows a table shows when the caller has no real ones: the block's own field, expanded. */
function specimenRows(block: PrintBlock): string[] {
  const base = specimenFor(block.field ?? '');
  const extra: Record<string, string[]> = {
    'invoice.lines': ['Obstetric ultrasound · 1 × ৳ 1,500', 'Outdoor ticket — consultant · 1 × ৳ 800'],
    'prescription.medicines': ['Ferrous sulphate 200 mg · twice daily · 30 days', 'Calcium carbonate 500 mg · once daily · 30 days', 'Folic acid 5 mg · once daily · 30 days'],
    'lab.results': ['Haemoglobin 10.4 g/dL (11.0–14.0) · low', 'Platelets 2.1 lakh/µL (1.5–4.0)', 'White cells 8,400 /µL (4,000–11,000)'],
    'attendance.month': ['01–05 Oct · present · 08:02 in, 16:10 out', '06 Oct · late · 08:24 in, 16:05 out', '09–10 Oct · weekly off'],
  };
  return extra[block.field ?? ''] ?? [base];
}

/** The sheet: the paper, its blocks, and — in the designer — the printable area and the grid. */
export function PrintSheet({ layout, values, rows, preview, showGuides, activeId, id }: PrintSheetProps) {
  const paper = PAPERS[layout.paper as PaperId];
  const area = { x: paper.margin, y: paper.margin, w: paper.w - paper.margin * 2, h: paper.h - paper.margin * 2 };
  return (
    <div id={id} className="print-paper relative bg-white text-black shadow-lg" style={paperStyle(paper)}>
      {showGuides && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute border border-dashed border-brand-300"
            style={{ left: `${area.x}mm`, top: `${area.y}mm`, width: `${area.w}mm`, height: `${area.h}mm` }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{ backgroundImage: 'linear-gradient(to right, rgba(14,110,122,0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(14,110,122,0.25) 1px, transparent 1px)', backgroundSize: '10mm 10mm' }}
          />
        </>
      )}

      {[...layout.blocks]
        .sort((a, b) => Number(a.kind === 'watermark') - Number(b.kind === 'watermark'))
        .map((block) => (
          <PrintBlockView key={block.id} block={block} values={values} rows={rows} active={activeId === block.id} />
        ))}

      {preview && (
        <p className="absolute bottom-[1mm] right-[1mm] text-[6px] uppercase tracking-widest text-black/30">Preview — not for printing</p>
      )}
    </div>
  );
}
