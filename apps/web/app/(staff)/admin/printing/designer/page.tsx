'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, CheckboxField, Panel, SafetyBanner, Segmented, SelectField, TextField, Tooltip, cx, useToast } from '@dizi/ui';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BringToFront, Copy, Grid3x3, MousePointer2, Printer, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { PrintSheet } from '@/components/PrintCanvas';
import { useShell } from '@/lib/shell';
import {
  BLOCK_KINDS,
  DESIGNER_WAITING,
  FIELDS,
  GRID,
  LAYOUTS,
  LAYOUT_RULES,
  MAX_BLOCKS,
  PAPERS,
  blockAt,
  blockSpec,
  checkLayout,
  editBlock,
  fieldLabel,
  guidesFor,
  layoutFor,
  onGrid,
  addBlock as place,
  publish,
  roomFor,
  saveNodeLayout,
  removeBlock,
  updateBlock,
  versionsOf,
  type BlockKind,
  type TemplateVersion,
  type PaperId,
  type PrintBlock,
  type PrintLayout,
} from '@/lib/printing';

/* The print-template designer (P7's last item).
 *
 * The register has said `authoredIn: 'designer'` since the printing settings screen shipped, and the screen has been
 * previewing a specimen while the twelve layouts lived in JSX. This is the other side of that promise.
 *
 * The screen is built the way the person using it thinks, not the way the data is shaped:
 *
 *  1. **A sheet, at its real size.** The paper is drawn in millimetres and the blocks sit on it in millimetres, so
 *     “does the address fit inside the tray” is answered by looking rather than by printing and measuring.
 *  2. **Everything is dragged, and everything is also typed.** A block is moved with the pointer, moved with the
 *     arrow keys, and its millimetres can be typed into the properties panel — a designer that only has a mouse is a
 *     designer a branch administrator with a keyboard cannot use.
 *  3. **The rules run as you work.** `checkLayout` is called on every edit: refusals are shown while there is still
 *     time to fix them, and publishing is what refuses, not the printer after the paper is wasted.
 *  4. **Publishing appends a version.** The version number, who published it and the day are on the screen, and the
 *     write goes through the contract's own operation — queued, because a branch that cannot change its receipt with
 *     the uplink down will change it by ringing somebody.
 */

type Mode = 'move' | 'resize';

export default function PrintDesignerPage() {
  const { push } = useToast();
  const { queueWrite } = useShell();

  const [layouts, setLayouts] = useState<PrintLayout[]>(LAYOUTS);
  const [templateId, setTemplateId] = useState('receipt');
  const [selected, setSelected] = useState<string | null>(null);
  const [guidesOn, setGuidesOn] = useState(true);
  const [preview, setPreview] = useState<'specimen' | 'blank'>('specimen');
  const [dragging, setDragging] = useState<{ id: string; mode: Mode; startX: number; startY: number; origin: PrintBlock } | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [history, setHistory] = useState<PrintLayout[]>([]);
  /* The versions published in this sitting, per template. The register's own history starts empty — a node that has
   * published nothing has nothing to list — and this is what makes the rule visible as it happens. */
  const [publishedVersions, setPublishedVersions] = useState<Record<string, TemplateVersion[]>>({});
  const paperRef = useRef<HTMLDivElement | null>(null);

  const layout = layouts.find((l) => l.id === templateId) ?? layouts[0];
  const paper = PAPERS[layout.paper];
  const check = useMemo(() => checkLayout(layout), [layout]);
  const block = layout.blocks.find((b) => b.id === selected) ?? null;
  const versions = publishedVersions[layout.id] ?? versionsOf(layout.id);
  const dirty = layout.version === 0 || layout.updatedAt !== layout.publishedAt;

  const commit = (next: PrintLayout) => {
    setHistory((h) => [...h.slice(-19), layout]);
    setLayouts((list) => list.map((l) => (l.id === next.id ? { ...next, updatedAt: '2026-10-16', updatedBy: 'S. Nahar, system administrator' } : l)));
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setLayouts((list) => list.map((l) => (l.id === last.id ? last : l)));
    setHistory((h) => h.slice(0, -1));
  };

  /* ------------------------------------------------------------------ dragging
   *
   * Pointer events rather than mouse events, because the same screen is used on a tablet at the counter. The
   * pointer is captured so a fast drag across the sheet does not leave the block behind, and the position is
   * converted from pixels to millimetres through the rendered sheet's own width — which is why the sheet element is
   * measured rather than the scale being assumed.
   */
  const mmPerPx = () => {
    const width = paperRef.current?.getBoundingClientRect().width ?? 0;
    /* A sheet that has not been laid out reports zero width — a hidden panel, a first paint, a test without layout.
     * Dividing by it gives Infinity, which throws the block into the corner; one millimetre per pixel is the honest
     * fallback, and the next real drag corrects it. */
    return width > 0 ? paper.w / width : 1;
  };

  const onPointerDown = (e: React.PointerEvent, blockId: string, mode: Mode) => {
    e.stopPropagation();
    const target = layout.blocks.find((b) => b.id === blockId);
    if (!target) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSelected(blockId);
    setDragging({ id: blockId, mode, startX: e.clientX, startY: e.clientY, origin: target });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const scale = mmPerPx();
    const dx = (e.clientX - dragging.startX) * scale;
    const dy = (e.clientY - dragging.startY) * scale;
    const step = dragging.mode === 'move' ? { dx, dy } : { dw: dx, dh: dy };
    const next = editBlock(dragging.origin, step, layout.paper);
    setGuides(guidesFor(layout.blocks, next, layout.paper));
    setLayouts((list) => list.map((l) => (l.id === layout.id ? { ...l, blocks: l.blocks.map((b) => (b.id === next.id ? next : b)) } : l)));
  };

  const onPointerUp = () => {
    if (dragging) {
      const moved = layout.blocks.find((b) => b.id === dragging.id);
      if (moved && (moved.x !== dragging.origin.x || moved.y !== dragging.origin.y || moved.w !== dragging.origin.w || moved.h !== dragging.origin.h)) {
        setHistory((h) => [...h.slice(-19), { ...layout, blocks: layout.blocks.map((b) => (b.id === dragging.id ? dragging.origin : b)) }]);
      }
    }
    setDragging(null);
    setGuides({ x: [], y: [] });
  };

  const nudge = (dx: number, dy: number) => {
    if (!block) return;
    commit(updateBlock(layout, block.id, editBlock(block, { dx, dy }, layout.paper)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!block) return;
    const step = e.shiftKey ? GRID * 2 : GRID;
    if (e.key === 'ArrowLeft') nudge(-step, 0);
    else if (e.key === 'ArrowRight') nudge(step, 0);
    else if (e.key === 'ArrowUp') nudge(0, -step);
    else if (e.key === 'ArrowDown') nudge(0, step);
    else if (e.key === 'Delete' || e.key === 'Backspace') commit(removeBlock(layout, block.id));
    else if (e.key === 'Escape') setSelected(null);
    else return;
    e.preventDefault();
  };

  /* ------------------------------------------------------------------ publishing */

  const publishNow = () => {
    if (!check.ok) {
      push({
        title: 'This layout cannot be printed yet',
        description: check.reasons[0].message,
        tone: 'critical',
      });
      return;
    }
    const next = publish(layout, 'S. Nahar, system administrator', '2026-10-16 11:20');
    setHistory((h) => [...h.slice(-19), layout]);
    setLayouts((list) => list.map((l) => (l.id === next.id ? next : l)));
    saveNodeLayout(next);
    setPublishedVersions((v) => ({
      ...v,
      [layout.id]: [
        { templateId: layout.id, version: next.version, paper: next.paper, blocks: next.blocks, publishedAt: next.publishedAt ?? '2026-10-16', publishedBy: next.publishedBy ?? 'S. Nahar, system administrator' },
        ...(v[layout.id] ?? versionsOf(layout.id)),
      ],
    }));
    const wrote = queueWrite(`Publish ${layout.name} version ${next.version}`, {
      id: 'publishPrintTemplate',
      recordId: layout.id,
      fields: { template: layout.id, version: next.version, paper: layout.paper, blocks: layout.blocks.length, by: 'S. Nahar, system administrator' },
    });
    push({
      title: `Version ${next.version} is what this branch prints`,
      description: wrote.queued
        ? `The layout is on this node’s printer now and the version is queued for the cloud, where the other branches read it. Written as ${wrote.operation.op} against ${wrote.operation.entity}, sequenced ${wrote.operation.id}.`
        : `It could not be queued: ${wrote.because}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="print-header-footer"
        subtitle={`${layout.name} · ${paper.label} · ${layout.blocks.length} blocks · ${check.ok ? 'ready to print' : `${check.reasons.length} to fix`}${layout.version ? ` · version ${layout.version} published ${layout.publishedAt}` : ' · nothing published yet, so the code template still prints'}`}
        actions={
          <>
            <Link href="/admin/printing">
              <Button variant="ghost">Header and footer</Button>
            </Link>
            <Button variant="ghost" onClick={undo} disabled={history.length === 0}>
              <Undo2 className="size-4" aria-hidden /> Undo
            </Button>
            <Button variant="primary" onClick={publishNow}>
              <Printer className="size-4" aria-hidden /> Publish version {(layout.version ?? 0) + 1}
            </Button>
          </>
        }
        waiting={check.ok ? undefined : check.reasons[0].message}
      />

      <AdminSiblings screenId="print-header-footer" />

      {/* ---------------------------------------------------------------- the templates */}
      <Panel title="The twelve templates">
        <ul className="flex flex-wrap gap-1.5">
          {layouts.map((l) => {
            const bad = !checkLayout(l).ok;
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => {
                    setTemplateId(l.id);
                    setSelected(null);
                    setHistory([]);
                  }}
                  aria-pressed={l.id === layout.id}
                  className={cx(
                    'rounded-md border px-2.5 py-1.5 text-xs font-medium',
                    l.id === layout.id ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border-subtle text-text-secondary hover:bg-surface-sunken',
                  )}
                >
                  {l.name}
                  <span className="ml-1.5 font-normal text-text-tertiary">{PAPERS[l.paper].register}</span>
                  {l.version > 0 && <span className="ml-1.5 text-safety-success">v{l.version}</span>}
                  {bad && <span className="ml-1.5 text-safety-warning">·</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-text-secondary">
          A template with no published version prints from the code template, so nothing on this screen can take a
          document away from a counter that is already printing.
        </p>
      </Panel>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
        {/* ---------------------------------------------------------------- the block library */}
        <Panel title="Blocks">
          <ul className="space-y-1">
            {BLOCK_KINDS.map((spec) => (
              <li key={spec.kind}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  disabled={layout.blocks.length >= MAX_BLOCKS}
                  onClick={() => {
                    const room = roomFor(layout, spec.kind);
                    if (!room.ok) {
                      push({ title: 'No room on this sheet', description: room.because ?? '', tone: 'warning' });
                      return;
                    }
                    const next = place(layout, spec.kind, `${spec.kind}-${layout.blocks.length + 1}`);
                    commit(next);
                    setSelected(next.blocks[next.blocks.length - 1].id);
                  }}
                >
                  {spec.label}
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-secondary">
            A new block lands in the first gap tall enough for it rather than on top of what is already there — and a
            sheet with no gap left says so instead of dropping the block off the edge. The ceiling is {MAX_BLOCKS}{' '}
            blocks, because past that nobody reads the document.
          </p>
        </Panel>

        {/* ---------------------------------------------------------------- the sheet */}
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Show"
              name="designer-preview"
              value={preview}
              onChange={(v) => setPreview(v as 'specimen' | 'blank')}
              options={[
                { value: 'specimen', label: 'A real specimen' },
                { value: 'blank', label: 'Empty fields' },
              ]}
            />
            <Tooltip content="The printable area and the 10 mm grid. Printed pages never carry them.">
              <Button variant="ghost" size="sm" aria-pressed={guidesOn} onClick={() => setGuidesOn((g) => !g)}>
                <Grid3x3 className="size-4" aria-hidden /> Guides
              </Button>
            </Tooltip>
            <span className="text-xs text-text-secondary">
              {paper.w} × {paper.h} mm · everything lands on a {GRID} mm grid
            </span>
          </div>

          <div
            className="flex justify-center overflow-auto rounded-md bg-surface-sunken p-4"
            onKeyDown={onKeyDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            tabIndex={0}
            role="application"
            aria-label={`Layout of ${layout.name}. Arrow keys move the selected block; hold shift for four millimetres; delete removes it.`}
          >
            <div ref={paperRef} className="relative">
              <PrintSheet
                layout={layout}
                preview
                showGuides={guidesOn}
                activeId={selected ?? undefined}
                values={preview === 'blank' ? Object.fromEntries(FIELDS.map((f) => [f.key, ''])) : undefined}
              />
              {/* The drag surfaces sit over the drawn blocks: the renderer stays a renderer, and the handles are
                  the designer's own chrome. */}
              <div className="absolute inset-0">
                {layout.blocks.map((b) => (
                  <div
                    key={b.id}
                    role="button"
                    tabIndex={-1}
                    aria-label={`${blockSpec(b.kind).label} at ${b.x}, ${b.y} millimetres, ${b.w} by ${b.h}`}
                    className={cx(
                      'absolute cursor-move rounded-sm border border-dashed',
                      selected === b.id ? 'border-brand-700 bg-brand-600/5' : 'border-transparent hover:border-brand-300',
                    )}
                    style={{ left: `${b.x}mm`, top: `${b.y}mm`, width: `${b.w}mm`, height: `${b.h}mm` }}
                    onPointerDown={(e) => onPointerDown(e, b.id, 'move')}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  >
                    {selected === b.id && (
                      <span
                        aria-hidden
                        className="absolute -bottom-1.5 -right-1.5 size-3 cursor-se-resize rounded-sm border border-white bg-brand-700"
                        onPointerDown={(e) => onPointerDown(e, b.id, 'resize')}
                      />
                    )}
                  </div>
                ))}
              </div>
              {guides.x.map((x) => (
                <span key={`x${x}`} aria-hidden className="pointer-events-none absolute top-0 h-full w-px bg-brand-600" style={{ left: `${x}mm` }} />
              ))}
              {guides.y.map((y) => (
                <span key={`y${y}`} aria-hidden className="pointer-events-none absolute left-0 h-px w-full bg-brand-600" style={{ top: `${y}mm` }} />
              ))}
            </div>
          </div>

          <p className="text-xs text-text-secondary">
            Drag a block to move it, the corner to resize it, or use the arrow keys — one grid step each, four with
            shift. The blue lines are the edges this block now lines up with, which is how two blocks are made to agree
            without counting millimetres.
          </p>

          {check.warnings.length > 0 && (
            <SafetyBanner severity="warning" title={`${check.warnings.length} thing(s) to look at`}>
              <ul className="space-y-0.5">
                {check.warnings.slice(0, 4).map((w, i) => (
                  <li key={i}>
                    <span className="font-medium">{w.title}:</span> {w.message}
                  </li>
                ))}
              </ul>
            </SafetyBanner>
          )}
        </div>

        {/* ---------------------------------------------------------------- the properties */}
        <div className="min-w-0 space-y-3">
          <Panel
            title={block ? blockSpec(block.kind).label : 'No block selected'}
            actions={
              block && (
                <Button variant="ghost" size="sm" onClick={() => commit(removeBlock(layout, block.id))}>
                  <Trash2 className="size-4" aria-hidden /> Remove
                </Button>
              )
            }
          >
            {block ? (
              <>
                <p className="mb-2 text-xs text-text-secondary">{blockSpec(block.kind).because}</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['x', 'y', 'w', 'h'] as const).map((k) => (
                    <TextField
                      key={k}
                      label={k === 'x' ? 'From the left (mm)' : k === 'y' ? 'From the top (mm)' : k === 'w' ? 'Width (mm)' : 'Height (mm)'}
                      name={`blk-${k}`}
                      inputMode="numeric"
                      value={String(block[k])}
                      onChange={(e) => {
                        const v = Number(e.target.value.replace(/[^0-9.-]/g, ''));
                        if (Number.isNaN(v)) return;
                        commit(updateBlock(layout, block.id, editBlock(block, { [k === 'x' ? 'dx' : k === 'y' ? 'dy' : k === 'w' ? 'dw' : 'dh']: v - block[k] }, layout.paper)));
                      }}
                      hint={k === 'x' || k === 'y' ? `Printer margin is ${paper.margin} mm` : `Grid ${GRID} mm`}
                    />
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(['left', 'centre', 'right'] as const).map((a) => (
                    <Button key={a} variant="ghost" size="sm" aria-pressed={block.align === a} onClick={() => commit(updateBlock(layout, block.id, { align: a }))}>
                      {a === 'left' ? <AlignLeft className="size-4" aria-hidden /> : a === 'centre' ? <AlignCenter className="size-4" aria-hidden /> : <AlignRight className="size-4" aria-hidden />}
                      {a}
                    </Button>
                  ))}
                  <Button variant="ghost" size="sm" aria-pressed={block.size === 'sm'} onClick={() => commit(updateBlock(layout, block.id, { size: 'sm' }))}>
                    Small
                  </Button>
                  <Button variant="ghost" size="sm" aria-pressed={block.size === 'md' || !block.size} onClick={() => commit(updateBlock(layout, block.id, { size: 'md' }))}>
                    Normal
                  </Button>
                  <Button variant="ghost" size="sm" aria-pressed={block.size === 'lg'} onClick={() => commit(updateBlock(layout, block.id, { size: 'lg' }))}>
                    Large
                  </Button>
                </div>

                <div className="mt-2 space-y-2">
                  {blockSpec(block.kind).data ? (
                    <SelectField
                      label="Reads"
                      name="blk-field"
                      value={block.field ?? ''}
                      onChange={(e) => commit(updateBlock(layout, block.id, { field: e.target.value }))}
                      options={[{ value: '', label: '— nothing chosen —' }, ...FIELDS.map((f) => ({ value: f.key, label: f.label }))]}
                      hint="A block that reads a record names the field; without one it prints its heading and a blank line."
                    />
                  ) : (
                    <TextField
                      label="The words"
                      name="blk-text"
                      value={block.text ?? ''}
                      onChange={(e) => commit(updateBlock(layout, block.id, { text: e.target.value }))}
                      hint={block.kind === 'footer' || block.kind === 'hospital' ? 'A footer or header block reads the print settings; the text here is only a fallback.' : undefined}
                    />
                  )}
                  {block.kind === 'table' && (
                    <TextField
                      label="Rows"
                      name="blk-rows"
                      inputMode="numeric"
                      value={String(block.rows ?? 6)}
                      onChange={(e) => commit(updateBlock(layout, block.id, { rows: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) }))}
                      hint="A bill that runs longer continues on a second sheet rather than shrinking the type."
                    />
                  )}
                  <CheckboxField label="Bold" name="blk-bold" checked={Boolean(block.bold)} onChange={(e: React.ChangeEvent<HTMLInputElement>) => commit(updateBlock(layout, block.id, { bold: e.target.checked }))} />
                </div>

                <p className="mt-2 text-xs text-text-tertiary">
                  {onGrid(block.x) && onGrid(block.y) && onGrid(block.w) && onGrid(block.h)
                    ? 'On the grid.'
                    : `Off the grid — the next drag or arrow key puts it back on ${GRID} mm steps.`}
                </p>
              </>
            ) : (
              <p className="text-sm text-text-secondary">
                Pick a block on the sheet to change what it reads, how big it is and where it sits. Everything is in
                millimetres, measured from the top-left corner of the paper.
              </p>
            )}
          </Panel>

          <Panel title={check.ok ? 'Ready to publish' : `${check.reasons.length} refusal(s)`}>
            {check.ok ? (
              <ul className="space-y-1 text-sm text-text-secondary">
                <li>
                  {layout.version === 0
                    ? 'Nothing has been published for this template, so the code template still prints. Publishing puts this layout on this node’s printers and queues the version for the cloud.'
                    : `Version ${layout.version} was published by ${layout.publishedBy} on ${layout.publishedAt}. Publishing again appends version ${layout.version + 1} and leaves this one readable, which is what makes a receipt from an earlier month reproducible.`}
                </li>
                <li>{dirty ? 'There are unpublished changes on this sheet.' : 'The sheet matches the published version.'}</li>
              </ul>
            ) : (
              <ul className="space-y-1 text-sm text-text-secondary">
                {check.reasons.map((r, i) => (
                  <li key={i}>
                    <span className="font-medium text-safety-warning-text">{r.title}</span>
                    {r.block ? ` — ${r.block}` : ''}: {r.message}
                  </li>
                ))}
              </ul>
            )}
            {versions.length > 0 && (
              <div className="mt-3 border-t border-border-subtle pt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Earlier versions</p>
                <ul className="mt-1 space-y-0.5 text-xs text-text-secondary">
                  {versions.map((v) => (
                    <li key={v.version}>
                      v{v.version} · {PAPERS[v.paper].register} · {v.publishedAt} · {v.publishedBy}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <Panel title="What this screen still needs">
            <ul className="space-y-1 text-sm text-text-secondary">
              {DESIGNER_WAITING.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title="The rules this designer obeys">
        <ul className="space-y-1 text-sm text-text-secondary">
          {LAYOUT_RULES.map((r) => (
            <li key={r.title}>
              <span className="font-medium text-text-primary">{r.title}.</span> {r.because}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="How to work">
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>
            <MousePointer2 className="mr-1 inline size-3.5" aria-hidden />
            Drag a block to move it and its bottom-right corner to resize it. Arrow keys move one grid step, shift
            four; Delete takes the block off the sheet; Escape drops the selection.
          </li>
          <li>
            <Copy className="mr-1 inline size-3.5" aria-hidden />
            A block reads a field, so the same layout prints a different patient: the specimen on screen is the
            register’s own record, not a placeholder.
          </li>
          <li>
            <BringToFront className="mr-1 inline size-3.5" aria-hidden />
            A watermark prints behind everything. Nothing else is allowed to sit on top of words, and the designer warns
            when two blocks share the same millimetres.
          </li>
          <li>
            <ArrowLeft className="mr-1 inline size-3.5" aria-hidden />
            <ArrowRight className="mr-1 inline size-3.5" aria-hidden />
            <ArrowUp className="mr-1 inline size-3.5" aria-hidden />
            <ArrowDown className="mr-1 inline size-3.5" aria-hidden />
            <RotateCcw className="mr-1 inline size-3.5" aria-hidden />
            Undo steps back one edit, up to twenty. Nothing is written until a version is published.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
