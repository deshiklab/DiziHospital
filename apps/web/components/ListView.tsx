'use client';

import { DataGrid, type Column, type RowAction } from '@dizi/ui';

/* ListView — the app's preset over the design system's DataGrid.
 *
 * `DataGrid` is a server-paged table: it takes an id, a caption, a page, a page size and a total, because in
 * production every list is queried rather than held. The preview screens hold whole lists in memory, and typing
 * the same six props at every call site is the kind of duplication that drifts — one screen forgets `caption` and
 * its table becomes unlabelled for a screen reader.
 *
 * So the preset is explicit: a caption is required, the whole list is one page, and sorting, column preferences,
 * keyboard navigation and the print view still come from the primitive. When a screen starts paging from the
 * server it should call `DataGrid` directly, which is why this file is deliberately small.
 */
export interface ListViewProps<T> {
  id: string;
  /** Announced to screen readers and printed above the table; always name the list. */
  caption: string;
  columns: Array<Column<T>>;
  rows: T[];
  rowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => RowAction<T>[];
  quickSearch?: { value: string; onChange: (v: string) => void; placeholder?: string };
  height?: string;
  sort?: { key: string; dir: 'asc' | 'desc' };
  emptyLabel?: string;
}

export function ListView<T>({ id, caption, columns, rows, rowId, onRowClick, rowActions, quickSearch, height = '26rem', sort, emptyLabel }: ListViewProps<T>) {
  return (
    <DataGrid<T>
      id={id}
      caption={caption}
      columns={columns}
      rows={rows}
      total={rows.length}
      page={1}
      pageSize={Math.max(rows.length, 1)}
      rowId={rowId}
      height={height}
      {...(sort ? { sort } : {})}
      {...(onRowClick ? { onRowClick } : {})}
      {...(rowActions ? { rowActions } : {})}
      {...(quickSearch ? { quickSearch } : {})}
      {...(emptyLabel ? { emptyLabel } : {})}
    />
  );
}
