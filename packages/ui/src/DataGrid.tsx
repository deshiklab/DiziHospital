'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, Download, Filter, Pencil, Printer, RotateCcw, Search, X } from 'lucide-react';
import { cx } from './cx';
import { Button } from './Button';
import { Menu, MenuTriggerIcon, type MenuItem } from './Menu';
import { Tooltip } from './Tooltip';
import { usePersistentState } from './hooks';

/* --------------------------------------------------------------------------- DataGrid
 * The workhorse that replaces the 597 legacy grids. What it adds over a plain table, and why:
 *
 *  - **fixed height with its own scroll + sticky header**: a ward screen stays still while the data moves, and
 *    the page bar is always reachable — the legacy grid grew the page instead.
 *  - **advanced search and filtering**: a quick search plus an expanding filter panel and removable chips,
 *    so a clerk can see *why* the list is short rather than guessing.
 *  - **pagination with page size and jump**: the counters deal in "page 3 of 12 at 50 rows", not infinite scroll.
 *  - **inline edit** for the two or three fields a clerk actually fixes (phone, status, note), without a modal.
 *  - **3-dot row menu** for the long tail of actions, so the row does not grow eight buttons.
 *  - **print / export / sort / column show-hide**, all persisted per table.
 *  - **tooltips only where a real pointer exists**, because on a phone they are worse than nothing.
 */

export interface Column<T> {
  key: (keyof T & string) | string;
  header: string;
  width?: string;
  align?: 'left' | 'right';
  numeric?: boolean;
  hideBelow?: 'md' | 'lg' | 'xl';
  sortable?: boolean;
  /** Inline-editable cells get a pencil affordance and enter edit mode on double-click. */
  editable?: boolean;
  editor?: 'text' | 'number' | 'select';
  options?: Array<{ value: string; label: string }>;
  /** Long-form explanation shown on hover on desktop only — never the only place information lives. */
  tooltip?: string;
  render?: (row: T) => React.ReactNode;
  /** Excluded from the print view (e.g. action columns). */
  printable?: boolean;
}

export interface RowAction<T> {
  label: string;
  onSelect: (row: T) => void;
  icon?: React.ReactNode;
  danger?: boolean;
  shortcut?: string;
  hint?: string;
  /** Draws a divider above this action — used to separate destructive items from everyday ones. */
  separated?: boolean;
}

export interface DataGridProps<T> {
  /** Stable id — column preferences are remembered per table. */
  id: string;
  caption: string;
  columns: Array<Column<T>>;
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  sort?: { key: string; dir: 'asc' | 'desc' };
  loading?: boolean;
  rowId: (row: T) => string;
  onQuery?: (q: { page: number; pageSize: number; sort?: { key: string; dir: 'asc' | 'desc' } }) => void;
  onRowClick?: (row: T) => void;
  /** Called when an inline edit is committed; return a promise to show the busy state on the cell. */
  onInlineEdit?: (rowId: string, key: string, value: string) => void | Promise<void>;
  rowActions?: (row: T) => RowAction<T>[];
  quickSearch?: { value: string; onChange: (v: string) => void; placeholder?: string };
  /** Advanced filter panel content (fields, selects, date ranges). */
  filters?: React.ReactNode;
  activeFilters?: Array<{ id: string; label: string; onRemove: () => void }>;
  onClearFilters?: () => void;
  savedViews?: string[];
  activeView?: string;
  onViewChange?: (view: string) => void;
  toolbar?: React.ReactNode;
  bulkActions?: Array<{ label: string; onSelect: (ids: string[]) => void }>;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  height?: string;
  stickyFirstColumn?: boolean;
  emptyLabel?: string;
  exportFileName?: string;
  /** Shown in the print header, e.g. "Branch: Main Campus · Status: Active". */
  printMeta?: string;
}

const hiddenClass = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const;

export function DataGrid<T>({
  id,
  caption,
  columns,
  rows,
  total,
  page,
  pageSize,
  sort,
  loading,
  rowId,
  onQuery,
  onRowClick,
  onInlineEdit,
  rowActions,
  quickSearch,
  filters,
  activeFilters = [],
  onClearFilters,
  savedViews = [],
  activeView,
  onViewChange,
  toolbar,
  bulkActions = [],
  selected = [],
  onSelectedChange,
  height = '58vh',
  stickyFirstColumn,
  emptyLabel = 'Nothing to show',
  exportFileName = 'export',
  printMeta,
}: DataGridProps<T>) {
  /* ----------------------------------------------------------- column preferences */
  const defaultOrder = useMemo(() => columns.map((c) => c.key), [columns]);
  const [prefs, setPrefs] = usePersistentState<string[]>(`dizi.grid.${id}.cols`, defaultOrder);
  const [colQuery, setColQuery] = useState('');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // A column added to the code must appear without the user having to reset their preferences.
  useEffect(() => {
    const known = new Set(prefs);
    const missing = defaultOrder.filter((k) => !known.has(k));
    if (missing.length) setPrefs([...prefs, ...missing]);
  }, [defaultOrder, prefs, setPrefs]);

  const ordered = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    return [...prefs.filter((k) => byKey.has(k)), ...columns.filter((c) => !prefs.includes(c.key)).map((c) => c.key)]
      .map((k) => byKey.get(k))
      .filter((c): c is Column<T> => Boolean(c));
  }, [columns, prefs]);

  const visible = ordered.filter((c) => prefs.includes(c.key));
  const printableCols = (visible.length ? visible : ordered).filter((c) => c.printable !== false);

  const toggleColumn = (key: string, on: boolean) =>
    setPrefs(on ? [...prefs, key] : prefs.filter((k) => k !== key));

  const move = (key: string, dir: -1 | 1) => {
    const index = prefs.indexOf(key);
    const next = [...prefs];
    const target = index + dir;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPrefs(next);
  };

  /* ------------------------------------------------------------------ inline editing */
  const [editing, setEditing] = useState<{ rowId: string; key: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const beginEdit = (row: T, key: string) => {
    if (!onInlineEdit) return;
    const value = (row as Record<string, unknown>)[key];
    setDraft(value == null ? '' : String(value));
    setEditing({ rowId: rowId(row), key });
  };

  const commit = async () => {
    if (!editing || !onInlineEdit) return;
    const cellKey = `${editing.rowId}:${editing.key}`;
    setSavingCell(cellKey);
    try {
      await onInlineEdit(editing.rowId, editing.key, draft);
    } finally {
      setSavingCell(null);
      setEditing(null);
    }
  };

  /* ------------------------------------------------------------------------- export */
  const exportCsv = () => {
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      printableCols.map((c) => escape(c.header)).join(','),
      ...rows.map((r) => printableCols.map((c) => escape(c.render ? '' : (r as Record<string, unknown>)[c.key])).join(',')),
    ].join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportFileName}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* -------------------------------------------------------------------------- print */
  const print = () => {
    const now = new Date().toLocaleString();
    const head = printableCols.map((c) => `<th>${c.header}</th>`).join('');
    const body = rows
      .map(
        (r) =>
          `<tr>${printableCols
            .map((c) => `<td class="${c.align === 'right' ? 'right' : ''}">${escapeHtml(cellText(c, r))}</td>`)
            .join('')}</tr>`,
      )
      .join('');
    const filterLine = [
      quickSearch?.value ? `Search: “${quickSearch.value}”` : '',
      ...activeFilters.map((f) => f.label),
      printMeta ?? '',
    ]
      .filter(Boolean)
      .join(' · ');

    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${caption}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        body { font: 12px/1.45 'Inter', system-ui, sans-serif; color: #101828; }
        h1 { font-size: 16px; margin: 0 0 2px; }
        .meta { color: #5A6B7B; font-size: 11px; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #D7DEE7; padding: 4px 6px; text-align: left; vertical-align: top; }
        th { background: #EEF2F6; }
        td.right { text-align: right; font-variant-numeric: tabular-nums; }
        footer { margin-top: 10px; color: #5A6B7B; font-size: 10px; }
      </style></head><body>
      <h1>${caption}</h1>
      <p class="meta">${filterLine}<br/>Printed ${now} · ${rows.length} of ${total} record(s) on this view</p>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <footer>DiziHospital Phase 0 shell · synthetic data · this document is generated from the current view including filters and visible columns</footer>
      </body></html>`;

    const win = window.open('', '_blank', 'width=1100,height=800');
    if (win) {
      win.document.write(doc);
      win.document.close();
      win.focus();
      win.print();
    } else {
      // Popup blocked: fall back to printing the page with print styles that hide the shell chrome.
      document.body.classList.add('printing-grid');
      window.print();
      document.body.classList.remove('printing-grid');
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.includes(rowId(r)));
  const columnCount = visible.length + (onSelectedChange ? 1 : 0) + (rowActions ? 1 : 0);

  return (
    <div className="flex flex-col gap-2">
      {/* ------------------------------------------------------------------ toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2">
        {quickSearch && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <input
              type="search"
              value={quickSearch.value}
              onChange={(e) => quickSearch.onChange(e.target.value)}
              placeholder={quickSearch.placeholder ?? 'Search…'}
              aria-label={`Search ${caption}`}
              className="h-9 w-64 rounded-md border border-border-default bg-surface-default pl-8 pr-2 text-base"
            />
          </div>
        )}

        {filters && (
          <Button size="sm" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} className="gap-1.5">
            <Filter className="size-3.5" aria-hidden />
            Filters
            {activeFilters.length > 0 && (
              <span className="rounded-full bg-brand-500 px-1.5 font-numeric text-xs text-text-inverse">{activeFilters.length}</span>
            )}
          </Button>
        )}

        {savedViews.length > 0 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Saved views">
            {savedViews.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onViewChange?.(v)}
                aria-pressed={activeView === v}
                className={cx(
                  'rounded-full border px-3 py-1 text-xs',
                  activeView === v
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-border-subtle bg-surface-raised text-text-secondary hover:border-brand-300 hover:text-brand-600',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {toolbar}
          <div className="relative">
            <Tooltip title="Columns" content="Choose which columns are shown, reorder them, or reset to the defaults. Saved for this table.">
              <button
                type="button"
                onClick={() => setColumnsOpen((o) => !o)}
                aria-expanded={columnsOpen}
                aria-haspopup="dialog"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-surface-raised px-3 text-sm hover:bg-surface-sunken"
              >
                <Columns3 className="size-3.5" aria-hidden />
                Columns
                <span className="font-numeric text-xs text-text-tertiary">{prefs.length}/{ordered.length}</span>
              </button>
            </Tooltip>

            {columnsOpen && (
              <div
                role="dialog"
                aria-label="Choose columns"
                className="absolute right-0 z-50 mt-1 w-80 rounded-md border border-border-subtle bg-surface-raised p-3 shadow-lg"
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-text-primary">Columns</p>
                  <button
                    type="button"
                    onClick={() => setPrefs(defaultOrder)}
                    className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
                  >
                    <RotateCcw className="size-3" aria-hidden />
                    Reset
                  </button>
                </div>

                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary" aria-hidden />
                  <input
                    value={colQuery}
                    onChange={(e) => setColQuery(e.target.value)}
                    placeholder="Find a column…"
                    aria-label="Find a column"
                    className="h-8 w-full rounded-sm border border-border-default bg-surface-default pl-7 pr-2 text-sm"
                  />
                </div>

                <ul className="max-h-64 overflow-y-auto">
                  {ordered
                    .filter((c) => c.header.toLowerCase().includes(colQuery.toLowerCase()))
                    .map((c) => {
                      const on = prefs.includes(c.key);
                      const index = prefs.indexOf(c.key);
                      return (
                        <li key={c.key} className="flex items-center gap-1.5 rounded-sm px-1 py-1 hover:bg-surface-sunken">
                          <input
                            type="checkbox"
                            id={`col-${id}-${c.key}`}
                            checked={on}
                            onChange={(e) => toggleColumn(c.key, e.target.checked)}
                          />
                          <label htmlFor={`col-${id}-${c.key}`} className="flex-1 truncate text-sm">
                            {c.header}
                          </label>
                          <button
                            type="button"
                            aria-label={`Move ${c.header} up`}
                            disabled={index <= 0}
                            onClick={() => move(c.key, -1)}
                            className="grid size-6 place-items-center rounded-sm text-text-tertiary hover:bg-surface-default disabled:opacity-30"
                          >
                            <ArrowUp className="size-3" aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${c.header} down`}
                            disabled={index < 0 || index >= prefs.length - 1}
                            onClick={() => move(c.key, 1)}
                            className="grid size-6 place-items-center rounded-sm text-text-tertiary hover:bg-surface-default disabled:opacity-30"
                          >
                            <ArrowDown className="size-3" aria-hidden />
                          </button>
                        </li>
                      );
                    })}
                </ul>

                <div className="mt-2 flex justify-between border-t border-border-subtle pt-2">
                  <button type="button" onClick={() => setPrefs(defaultOrder)} className="text-xs text-text-secondary hover:text-text-primary">
                    Show all
                  </button>
                  <button type="button" onClick={() => setColumnsOpen(false)} className="text-xs font-medium text-brand-600">
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
          <Button size="sm" onClick={exportCsv} className="gap-1.5">
            <Download className="size-3.5" aria-hidden />
            Export
          </Button>
          <Tooltip title="Print" content="Prints the current view: filters, visible columns and the row count.">
            <Button size="sm" onClick={print} className="gap-1.5">
              <Printer className="size-3.5" aria-hidden />
              Print
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* ------------------------------------------------------------ filter panel */}
      {filters && filtersOpen && (
        <div className="no-print rounded-lg border border-border-subtle bg-surface-default p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-text-primary">Advanced filters</p>
            <div className="flex gap-2">
              {onClearFilters && (
                <Button size="sm" variant="ghost" onClick={onClearFilters} className="gap-1.5">
                  <RotateCcw className="size-3.5" aria-hidden />
                  Clear all
                </Button>
              )}
              <Button size="sm" onClick={() => setFiltersOpen(false)}>
                Done
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{filters}</div>
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-tertiary">Filtered by:</span>
          {activeFilters.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-raised px-2 py-0.5 text-xs">
              {f.label}
              <button type="button" aria-label={`Remove filter ${f.label}`} onClick={f.onRemove} className="text-text-tertiary hover:text-text-primary">
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* --------------------------------------------------------- selection actions */}
      {selected.length > 0 && bulkActions.length > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-md border border-brand-300 bg-brand-50 px-3 py-2">
          <span className="text-sm text-brand-700">{selected.length} selected</span>
          {bulkActions.map((a) => (
            <Button key={a.label} size="sm" onClick={() => a.onSelect(selected)}>
              {a.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => onSelectedChange?.([])}>
            Clear
          </Button>
        </div>
      )}

      {/* ------------------------------------------------------------------- table */}
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-default">
        <div className="overflow-auto" style={{ maxHeight: height }}>
          <table className="w-full border-separate border-spacing-0 text-left">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 z-10">
              <tr>
                {onSelectedChange && (
                  <th scope="col" className="sticky left-0 z-20 w-10 border-b border-border-subtle bg-surface-sunken px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={allOnPageSelected}
                      onChange={(e) =>
                        onSelectedChange(e.target.checked ? Array.from(new Set([...selected, ...rows.map(rowId)])) : [])
                      }
                    />
                  </th>
                )}
                {visible.map((c, i) => {
                  const isSorted = sort?.key === c.key;
                  const canSort = (c.sortable ?? true) && Boolean(onQuery);
                  const headerButton = (
                    <button
                      type="button"
                      disabled={!canSort}
                      onClick={() =>
                        onQuery?.({
                          page: 1,
                          pageSize,
                          sort: { key: c.key, dir: isSorted && sort?.dir === 'asc' ? 'desc' : 'asc' },
                        })
                      }
                      className={cx('inline-flex items-center gap-1', canSort ? 'hover:text-text-primary' : 'cursor-default')}
                    >
                      {c.header}
                      {isSorted && (sort?.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                    </button>
                  );
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      style={{ width: c.width }}
                      aria-sort={isSorted ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={cx(
                        'border-b border-border-subtle bg-surface-sunken px-3 py-2 text-sm font-semibold text-text-secondary',
                        c.align === 'right' && 'text-right',
                        c.hideBelow && hiddenClass[c.hideBelow],
                        stickyFirstColumn && i === 0 && 'sticky left-0 z-20',
                      )}
                    >
                      {c.tooltip ? (
                        <Tooltip title={c.header} content={c.tooltip}>
                          <span className={cx('inline-flex', c.align === 'right' && 'justify-end')}>{headerButton}</span>
                        </Tooltip>
                      ) : (
                        headerButton
                      )}
                    </th>
                  );
                })}
                {rowActions && (
                  <th scope="col" className="w-12 border-b border-border-subtle bg-surface-sunken px-2 py-2">
                    <span className="sr-only">Row actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`}>
                    <td colSpan={columnCount} className="border-b border-border-subtle px-3 py-3">
                      <div className="h-3 w-1/3 animate-pulse rounded-sm bg-surface-sunken" />
                    </td>
                  </tr>
                ))}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="px-3 py-10 text-center text-sm text-text-tertiary">
                    {emptyLabel}
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map((row) => {
                  const rid = rowId(row);
                  const isSelected = selected.includes(rid);
                  const actions = rowActions?.(row) ?? [];
                  return (
                    <tr
                      key={rid}
                      onClick={() => onRowClick?.(row)}
                      className={cx(
                        'h-[var(--dizi-density-row-height)]',
                        onRowClick && 'cursor-pointer',
                        isSelected ? 'bg-brand-50' : 'hover:bg-surface-sunken',
                      )}
                    >
                      {onSelectedChange && (
                        <td
                          className={cx('border-b border-border-subtle px-3', stickyFirstColumn && 'sticky left-0 bg-surface-default')}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select record ${rid}`}
                            checked={isSelected}
                            onChange={(e) => onSelectedChange(e.target.checked ? [...selected, rid] : selected.filter((s) => s !== rid))}
                          />
                        </td>
                      )}
                      {visible.map((c, i) => {
                        const isEditing = editing?.rowId === rid && editing.key === c.key;
                        const isSaving = savingCell === `${rid}:${c.key}`;
                        const cellValue = (row as Record<string, unknown>)[c.key];
                        return (
                          <td
                            key={c.key}
                            onDoubleClick={() => c.editable && beginEdit(row, c.key)}
                            className={cx(
                              'group border-b border-border-subtle px-3 text-base text-text-primary',
                              c.align === 'right' && 'text-right',
                              (c.numeric || c.align === 'right') && 'font-numeric tabular-nums',
                              c.hideBelow && hiddenClass[c.hideBelow],
                              stickyFirstColumn && i === 0 && 'sticky left-0 z-10 bg-surface-default',
                            )}
                          >
                            {isEditing ? (
                              c.editor === 'select' ? (
                                <select
                                  ref={editRef as React.Ref<HTMLSelectElement>}
                                  value={draft}
                                  onChange={(e) => setDraft(e.target.value)}
                                  onBlur={commit}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commit();
                                    if (e.key === 'Escape') setEditing(null);
                                  }}
                                  className="h-7 w-full rounded-sm border border-brand-500 bg-surface-default px-1 text-base"
                                >
                                  {c.options?.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  ref={editRef as React.Ref<HTMLInputElement>}
                                  type={c.editor === 'number' ? 'number' : 'text'}
                                  value={draft}
                                  onChange={(e) => setDraft(e.target.value)}
                                  onBlur={commit}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commit();
                                    if (e.key === 'Escape') setEditing(null);
                                  }}
                                  className="h-7 w-full rounded-sm border border-brand-500 bg-surface-default px-1 text-base"
                                />
                              )
                            ) : (
                              <span className="inline-flex w-full items-center gap-1.5">
                                <span className="min-w-0 truncate">{c.render ? c.render(row) : String(cellValue ?? '')}</span>
                                {isSaving && <span className="text-xs text-text-tertiary">saving…</span>}
                                {c.editable && !isSaving && (
                                  <Tooltip title="Edit in place" content="Double-click the cell to change this value without opening a form.">
                                    <button
                                      type="button"
                                      aria-label={`Edit ${c.header}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        beginEdit(row, c.key);
                                      }}
                                      className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                    >
                                      <Pencil className="size-3 text-text-tertiary" aria-hidden />
                                    </button>
                                  </Tooltip>
                                )}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      {rowActions && (
                        <td className="border-b border-border-subtle px-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <Menu
                            label={`Actions for record ${rid}`}
                            align="right"
                            trigger={({ toggle, ref, open }) => (
                              <button
                                ref={ref}
                                type="button"
                                onClick={toggle}
                                aria-expanded={open}
                                aria-haspopup="menu"
                                aria-label={`Actions for record ${rid}`}
                                className="inline-flex"
                              >
                                <MenuTriggerIcon icon={<span aria-hidden className="text-lg leading-none">⋯</span>} />
                              </button>
                            )}
                            items={actions.map<MenuItem>((a) => ({
                              label: a.label,
                              icon: a.icon,
                              danger: a.danger,
                              separated: a.separated,
                              shortcut: a.shortcut,
                              hint: a.hint,
                              onSelect: () => a.onSelect(row),
                            }))}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* ---------------------------------------------------------------- pagination */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle bg-surface-raised px-3 py-2 text-sm text-text-secondary">
          <span className="font-numeric">
            {total.toLocaleString()} records
            {total > 0 && <> · showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</>}
          </span>

          <label className="ml-auto flex items-center gap-1.5">
            <span className="text-xs">Rows</span>
            <select
              value={pageSize}
              onChange={(e) => onQuery?.({ page: 1, pageSize: Number(e.target.value), sort })}
              aria-label="Rows per page"
              className="h-7 rounded-sm border border-border-default bg-surface-default px-1 text-sm"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="First page"
              disabled={page <= 1}
              onClick={() => onQuery?.({ page: 1, pageSize, sort })}
              className="grid size-7 place-items-center rounded-sm border border-border-default disabled:opacity-40"
            >
              <ChevronsLeft className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => onQuery?.({ page: page - 1, pageSize, sort })}
              className="grid size-7 place-items-center rounded-sm border border-border-default disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" aria-hidden />
            </button>
            <span className="font-numeric px-1">
              {page} / {pages}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => onQuery?.({ page: page + 1, pageSize, sort })}
              className="grid size-7 place-items-center rounded-sm border border-border-default disabled:opacity-40"
            >
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Last page"
              disabled={page >= pages}
              onClick={() => onQuery?.({ page: pages, pageSize, sort })}
              className="grid size-7 place-items-center rounded-sm border border-border-default disabled:opacity-40"
            >
              <ChevronsRight className="size-3.5" aria-hidden />
            </button>
          </div>

          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(new FormData(e.currentTarget).get('jump'));
              if (Number.isFinite(value)) onQuery?.({ page: Math.min(Math.max(1, value), pages), pageSize, sort });
            }}
          >
            <label htmlFor={`${id}-jump`} className="text-xs">
              Go to
            </label>
            <input
              id={`${id}-jump`}
              name="jump"
              type="number"
              min={1}
              max={pages}
              className="h-7 w-16 rounded-sm border border-border-default bg-surface-default px-1 text-sm"
            />
          </form>
        </div>
      </div>
    </div>
  );
}

function cellText<T>(c: Column<T>, row: T): string {
  if (c.render) {
    const value = (row as Record<string, unknown>)[c.key];
    return value == null ? '' : String(value);
  }
  const value = (row as Record<string, unknown>)[c.key];
  return value == null ? '' : String(value);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
