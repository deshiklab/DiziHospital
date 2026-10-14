'use client';

import { useMemo, useState } from 'react';
import { cx } from './cx';
import { Button } from './Button';

/* ------------------------------------------------------------------ DataGrid
 * DataGrid v0 (plan 02 §5 #3) — replaces the 597 legacy grids.
 *
 * Deliberately server-shaped from the start: the component owns sorting, paging, selection and export,
 * but the row data always arrives through `onQuery`/`rows`, so swapping the local mock for the API in P0-301
 * is a data-source change, not a rewrite. Wide grids condense: columns can be marked `secondary` and are
 * hidden below the given breakpoint instead of producing a horizontal scrollbar on a 1280 px counter screen.
 */

export interface Column<T> {
  key: keyof T & string;
  header: string;
  width?: string;
  align?: 'left' | 'right';
  /** Rendered as tabular numerals — money, quantities, clinical values. */
  numeric?: boolean;
  hideBelow?: 'md' | 'lg' | 'xl';
  render?: (row: T) => React.ReactNode;
}

export interface DataGridProps<T> {
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
  onExport?: () => void;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  savedViews?: string[];
  emptyLabel?: string;
}

const hidden: Record<NonNullable<Column<unknown>['hideBelow']>, string> = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

export function DataGrid<T>({
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
  onExport,
  selected = [],
  onSelectedChange,
  savedViews = [],
  emptyLabel = 'Nothing to show',
}: DataGridProps<T>) {
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const visible = useMemo(() => columns.filter((c) => !hiddenCols.includes(c.key)), [columns, hiddenCols]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(rowId(r)));

  const setSort = (key: string) => {
    if (!onQuery) return;
    const dir: 'asc' | 'desc' = sort?.key === key && sort.dir === 'asc' ? 'desc' : 'asc';
    onQuery({ page: 1, pageSize, sort: { key, dir } });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {savedViews.length > 0 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Saved views">
            {savedViews.map((v) => (
              <button
                key={v}
                type="button"
                className="rounded-full border border-border-subtle bg-surface-raised px-3 py-1 text-xs text-text-secondary hover:border-brand-300 hover:text-brand-600"
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Button size="sm" onClick={() => setColumnsOpen((o) => !o)} aria-expanded={columnsOpen} aria-haspopup="true">
              Columns
            </Button>
            {columnsOpen && (
              <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border-subtle bg-surface-raised p-2 shadow-lg">
                {columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-surface-sunken">
                    <input
                      type="checkbox"
                      checked={!hiddenCols.includes(c.key)}
                      onChange={(e) =>
                        setHiddenCols((prev) => (e.target.checked ? prev.filter((k) => k !== c.key) : [...prev, c.key]))
                      }
                    />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
          {onExport && (
            <Button size="sm" onClick={onExport}>
              Export CSV
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-default">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            {total.toLocaleString()} records, page {page} of {pages}
          </caption>
          <thead>
            <tr className="bg-surface-sunken">
              {onSelectedChange && (
                <th scope="col" className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={allSelected}
                    onChange={(e) =>
                      onSelectedChange(e.target.checked ? Array.from(new Set([...selected, ...rows.map(rowId)])) : [])
                    }
                  />
                </th>
              )}
              {visible.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: c.width }}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={cx(
                    'border-b border-border-subtle px-3 py-2 text-sm font-semibold text-text-secondary',
                    c.align === 'right' && 'text-right',
                    c.hideBelow && hidden[c.hideBelow],
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSort(c.key)}
                    className={cx('inline-flex items-center gap-1 hover:text-text-primary', c.align === 'right' && 'flex-row-reverse')}
                  >
                    {c.header}
                    {sort?.key === c.key && <span aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-b border-border-subtle">
                  <td className="px-3 py-3" colSpan={visible.length + (onSelectedChange ? 1 : 0)}>
                    <div className="h-3 w-1/3 animate-pulse rounded-sm bg-surface-sunken" />
                  </td>
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-3 py-10 text-center text-sm text-text-tertiary" colSpan={visible.length + (onSelectedChange ? 1 : 0)}>
                  {emptyLabel}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => {
                const id = rowId(row);
                const isSelected = selected.includes(id);
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    className={cx(
                      'h-[var(--dizi-density-row-height)] border-b border-border-subtle last:border-0',
                      onRowClick && 'cursor-pointer',
                      isSelected ? 'bg-brand-50' : 'hover:bg-surface-sunken',
                    )}
                  >
                    {onSelectedChange && (
                      <td className="px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select row ${id}`}
                          checked={isSelected}
                          onChange={(e) =>
                            onSelectedChange(e.target.checked ? [...selected, id] : selected.filter((s) => s !== id))
                          }
                        />
                      </td>
                    )}
                    {visible.map((c) => (
                      <td
                        key={c.key}
                        className={cx(
                          'px-3 text-base text-text-primary',
                          c.align === 'right' && 'text-right',
                          (c.numeric || c.align === 'right') && 'font-numeric tabular-nums',
                          c.hideBelow && hidden[c.hideBelow],
                        )}
                      >
                        {c.render ? c.render(row) : String(row[c.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-text-secondary">
        <span>
          {total.toLocaleString()} records · page {page} of {pages}
        </span>
        <div className="flex gap-2">
          <Button size="sm" disabled={page <= 1} onClick={() => onQuery?.({ page: page - 1, pageSize, sort })}>
            Previous
          </Button>
          <Button size="sm" disabled={page >= pages} onClick={() => onQuery?.({ page: page + 1, pageSize, sort })}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
