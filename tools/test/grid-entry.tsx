/* Bundle entry for `npm run test:grid` and `npm run perf:grid`.
 *
 * It mounts the *real* DataGrid wired the way a screen wires it — through `useGrid`, with a source, built-in views and
 * the app's own primitives — so both harnesses exercise the shipping component rather than a re-creation of it in a
 * test file. Four scenarios, because the claims differ:
 *
 *   basic   — a queried register with views, a search and an export. The correctness harness drives this one.
 *   huge    — a hundred thousand rows behind a source that builds a page instead of holding one. The perf harness
 *             times this one, and the number it reports is the P0-204 acceptance.
 *   failing — a source that throws, which must read as an error rather than as an empty register.
 *   local   — a grid with no `onExport`: rows held on the screen, and the export says so.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { Button, DataGrid, useGrid, useToast, ToastProvider, type Column, type GridQuery, type GridView } from '@dizi/ui';

interface Row {
  id: string;
  name: string;
  status: string;
  phone: string;
  amount: number;
  note: string;
}

const STATUSES = ['Active', 'Follow-up', 'Admitted', 'Discharged'];

/** Deterministic rows: the same fixture every run, because a flaky perf number is worse than none. */
function makeRows(count: number, seed = 7): Row[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  return Array.from({ length: count }, (_, i) => ({
    id: `MRN-${String(i + 1).padStart(6, '0')}`,
    name: `Patient ${i + 1}`,
    status: STATUSES[Math.floor(next() * STATUSES.length)],
    phone: `017${String(Math.floor(next() * 100_000_000)).padStart(8, '0')}`,
    amount: Math.floor(next() * 20_000),
    note: i % 3 === 0 ? 'Note, with a comma' : '',
  }));
}

/** A hundred thousand records, generated once and never copied: the source slices it, the grid never sees it all. */
const HUGE: Row[] = makeRows(100_000);

const BASIC = makeRows(240);

const COLUMNS: Array<Column<Row>> = [
  { key: 'id', header: 'MRN', width: '9rem' },
  { key: 'name', header: 'Patient' },
  { key: 'status', header: 'Status', render: (r) => <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{r.status}</span>, exportValue: (r) => r.status },
  { key: 'phone', header: 'Mobile', numeric: true, align: 'right' },
  { key: 'amount', header: 'Balance', numeric: true, align: 'right' },
  { key: 'note', header: 'Note', hideBelow: 'lg' },
];

const DEFAULT_QUERY: GridQuery = { page: 1, pageSize: 25, sort: { key: 'id', dir: 'asc' } };

const VIEWS: GridView[] = [
  { id: 'all', name: 'Every patient', query: { ...DEFAULT_QUERY } },
  { id: 'admitted', name: 'Admitted', query: { ...DEFAULT_QUERY, filters: { status: 'Admitted' } } },
  { id: 'follow-up', name: 'Follow-up', query: { ...DEFAULT_QUERY, filters: { status: 'Follow-up' } } },
];

/** Filter → sort → window, the shape a server has: what the grid is handed, and everything it is allowed to know. */
function slice(rows: Row[], query: GridQuery): { rows: Row[]; total: number } {
  const status = query.filters?.status ?? '';
  const needle = (query.q ?? '').trim().toLowerCase();

  let kept = rows;
  if (status) kept = kept.filter((r) => r.status === status);
  if (needle) kept = kept.filter((r) => r.name.toLowerCase().includes(needle) || r.id.toLowerCase().includes(needle));

  if (query.sort) {
    const { key, dir } = query.sort;
    const sign = dir === 'asc' ? 1 : -1;
    kept = [...kept].sort((a, b) => {
      const av = a[key as keyof Row];
      const bv = b[key as keyof Row];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
      return String(av).localeCompare(String(bv)) * sign;
    });
  }

  const start = (query.page - 1) * query.pageSize;
  return { rows: kept.slice(start, start + query.pageSize), total: kept.length };
}

/** How many rows the source has been asked for, and how large the largest single request was. */
export const asked = { calls: 0, rows: 0, largest: 0 };

function Register({ rows, exportable }: { rows: Row[]; exportable: boolean }) {
  const grid = useGrid<Row>({
    id: exportable ? 'harness-basic' : 'harness-local',
    defaults: DEFAULT_QUERY,
    filterKeys: ['status'],
    sortKeys: ['id', 'name', 'status', 'phone', 'amount'],
    builtinViews: exportable ? VIEWS : [],
    url: false,
    source: (query) => {
      const page = slice(rows, query);
      asked.calls += 1;
      asked.rows += page.rows.length;
      asked.largest = Math.max(asked.largest, page.rows.length);
      return page;
    },
  });

  return (
    <div id="grid-host">
      <DataGrid<Row>
        {...grid.gridProps}
        id={exportable ? 'harness-basic' : 'harness-local'}
        caption="Synthetic register"
        columns={COLUMNS}
        rowId={(r) => r.id}
        quickSearch={{ value: grid.query.q ?? '', onChange: grid.setSearch, placeholder: 'Name or MRN…' }}
        toolbar={<Button size="sm">Toolbar slot</Button>}
        {...(exportable ? {} : {})}
        exportFileName="harness"
        onRetry={grid.reload}
        rowActions={(r) => [{ label: `Open ${r.id}`, onSelect: () => undefined }]}
      />
      <p data-testid="total">{grid.total}</p>
      <button type="button" data-testid="apply-admitted" onClick={() => grid.setFilter('status', 'Admitted')}>
        Admitted
      </button>
      <button type="button" data-testid="clear" onClick={grid.clearFilters}>
        Clear
      </button>
      <button type="button" data-testid="page-2" onClick={() => grid.setPage(2)}>
        Page 2
      </button>
    </div>
  );
}

/** The hundred-thousand-row case: the source builds one page of a generator and never materialises the set. */
function Huge() {
  const grid = useGrid<Row>({
    id: 'harness-huge',
    defaults: DEFAULT_QUERY,
    sortKeys: ['id', 'name', 'status', 'amount'],
    url: false,
    source: (query) => {
      const page = slice(HUGE, query);
      asked.calls += 1;
      asked.rows += page.rows.length;
      asked.largest = Math.max(asked.largest, page.rows.length);
      return page;
    },
  });

  return (
    <DataGrid<Row>
      {...grid.gridProps}
      id="harness-huge"
      caption="A hundred thousand records"
      columns={COLUMNS}
      rowId={(r) => r.id}
      onExport={grid.exportAll}
      exportFileName="huge"
      height="40rem"
    />
  );
}

/**
 * A grid over a list the screen already holds — no `useGrid`, no source, no `onExport`.
 *
 * This is the `ListView` shape (a settings table, a receipt's lines): the primitive has to keep working without the
 * query layer, and its export has to say that what it wrote is what was on the screen.
 */
function Local() {
  const rows = BASIC.slice(0, 25);
  return (
    <DataGrid<Row>
      id="harness-local"
      caption="A list the screen holds"
      columns={COLUMNS}
      rows={rows}
      total={rows.length}
      page={1}
      pageSize={rows.length}
      rowId={(r) => r.id}
      exportFileName="harness-local"
    />
  );
}

/** A source that refuses. The grid must say so instead of showing an empty register. */
function Failing() {
  const grid = useGrid<Row>({
    id: 'harness-failing',
    defaults: DEFAULT_QUERY,
    url: false,
    source: () => {
      throw new Error('the register is unreachable');
    },
  });

  return (
    <DataGrid<Row>
      {...grid.gridProps}
      id="harness-failing"
      caption="Unreachable register"
      columns={COLUMNS}
      rowId={(r) => r.id}
      onRetry={grid.reload}
    />
  );
}

export interface MountOptions {
  scenario: 'basic' | 'huge' | 'failing' | 'local';
}

export function mount(container: HTMLElement, options: MountOptions): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <ToastProvider>
        {options.scenario === 'huge' ? (
          <Huge />
        ) : options.scenario === 'failing' ? (
          <Failing />
        ) : options.scenario === 'local' ? (
          <Local />
        ) : (
          <Register rows={BASIC} exportable />
        )}
      </ToastProvider>,
    );
  });
  return root;
}

export { act };
