'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ------------------------------------------------------------------- the grid's query
 *
 * A grid on a screen is three things that used to be typed at every call site and drifted: the *query* (which window
 * of which ordered, filtered set), the *views* over it (the named queries a desk uses every morning), and the *source*
 * (where the rows come from — in production the API, in the preview a deterministic function, and the grid must not
 * care which).
 *
 * This file owns the first two and states the third as a type. The rules it keeps:
 *
 *  · **The window is the query, not a slice of an array.** `GridQuery` is exactly what a server needs to answer a
 *    page: an offset window, an order and the filters. Nothing here holds a result set, so a register of a hundred
 *    thousand rows costs the same as one of ten — the grid is handed a page and a total.
 *  · **The query is the address.** Page, size, sort, search and filters round-trip through the URL, so a clerk can
 *    send "the unpaid claims this week" to a colleague as a link, and the back button steps back through a morning's
 *    filters. Only the parts that differ from the screen's defaults are written, so a clean address stays clean.
 *  · **A view is a query with a name.** Not a label: `{ name: 'Unpaid this week', query: {...} }`. That is what makes
 *    a view survive a code change — it holds the filters it was saved with rather than a pointer to a `switch` — and
 *    it is why the active view is *derived* by comparing the query rather than stored: a stored name goes stale the
 *    moment somebody edits one filter after applying it.
 *  · **Filters the screen did not declare are ignored.** A URL is user input. `?f.payer=X` is only read if the screen
 *    listed `payer` in `filterKeys`, so an unknown parameter cannot reach a query.
 */

export interface GridSort {
  key: string;
  dir: 'asc' | 'desc';
}

export interface GridQuery {
  page: number;
  pageSize: number;
  sort?: GridSort;
  /** The quick search box: one string, interpreted by the source. */
  q?: string;
  /** The advanced filters, one flat string map so a query is serialisable without a schema. */
  filters?: Record<string, string>;
}

/** One window of a result set, plus how many rows the whole filtered set has. */
export interface GridPage<T> {
  rows: T[];
  total: number;
}

/**
 * Where the rows come from.
 *
 * It may answer synchronously (the preview screens hold their data) or with a promise (the API). It is given a query
 * and nothing else — no rows to filter, no array to sort — which is what makes "server-side" a structural property of
 * the grid rather than a promise in a comment.
 */
export type GridSource<T> = (query: GridQuery) => GridPage<T> | Promise<GridPage<T>>;

/** A named query. `builtin` views ship with the screen; the rest are the user's own. */
export interface GridView {
  id: string;
  name: string;
  query: GridQuery;
  builtin?: boolean;
  /** One line under the name in the views menu, for a built-in whose name is not self-explanatory. */
  hint?: string;
}

export const GRID_PAGE_SIZES = [10, 25, 50, 100] as const;

/** How many rows an "export everything" walk will fetch before it stops and says so. */
export const GRID_EXPORT_LIMIT = 50_000;
/** The window an export walk asks for at a time. A page size of its own, because an export is not a page. */
export const GRID_EXPORT_WINDOW = 1_000;

const PAGE_PARAM = 'page';
const SIZE_PARAM = 'size';
const SORT_PARAM = 'sort';
const SEARCH_PARAM = 'q';
const FILTER_PREFIX = 'f.';

/**
 * A query decoded from the URL, minus anything the screen did not open.
 *
 * Numbers are clamped rather than trusted (a page of `-4` or a size of `1000000` is a link somebody edited), the sort
 * key is checked against the columns the screen says it can order by, and unknown `f.` parameters are dropped. Every
 * ignored part falls back to the default, so a hand-edited URL degrades to a working screen instead of an error page.
 */
export function decodeGridQuery(search: string, defaults: GridQuery, allowed?: { filterKeys?: readonly string[]; sortKeys?: readonly string[] }): GridQuery {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  const page = Number(params.get(PAGE_PARAM));
  const size = Number(params.get(SIZE_PARAM));
  const sortRaw = params.get(SORT_PARAM);
  const q = params.get(SEARCH_PARAM);

  const filters: Record<string, string> = { ...(defaults.filters ?? {}) };
  for (const [key, value] of params) {
    if (!key.startsWith(FILTER_PREFIX)) continue;
    const name = key.slice(FILTER_PREFIX.length);
    if (allowed?.filterKeys && !allowed.filterKeys.includes(name)) continue;
    if (value === '') delete filters[name];
    else filters[name] = value;
  }

  let sort = defaults.sort;
  if (sortRaw) {
    const [key, dir] = sortRaw.split(':');
    if (key && (dir === 'asc' || dir === 'desc') && (!allowed?.sortKeys || allowed.sortKeys.includes(key))) {
      sort = { key, dir };
    }
  }

  return {
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : defaults.page,
    pageSize: (GRID_PAGE_SIZES as readonly number[]).includes(size) ? size : defaults.pageSize,
    ...(sort ? { sort } : {}),
    ...(q ? { q } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
  };
}

/**
 * The URL for a query — the interesting half only.
 *
 * Same values as the screen's defaults are left out, because an address that repeats the defaults is an address that
 * lies the moment a default changes: `?page=1&size=25` reads like a choice somebody made. Page 1 is dropped with them
 * for the same reason — it is where every query starts.
 */
export function encodeGridQuery(query: GridQuery, defaults: GridQuery): string {
  const params = new URLSearchParams();

  if (query.page !== 1 && query.page !== defaults.page) params.set(PAGE_PARAM, String(query.page));
  if (query.pageSize !== defaults.pageSize) params.set(SIZE_PARAM, String(query.pageSize));
  if (query.sort && (query.sort.key !== defaults.sort?.key || query.sort.dir !== defaults.sort?.dir)) {
    params.set(SORT_PARAM, `${query.sort.key}:${query.sort.dir}`);
  }
  if (query.q && query.q !== defaults.q) params.set(SEARCH_PARAM, query.q);

  for (const [key, value] of Object.entries(query.filters ?? {})) {
    if (value === '' || value === (defaults.filters?.[key] ?? '')) continue;
    params.set(`${FILTER_PREFIX}${key}`, value);
  }

  return params.toString();
}

/** Whether two queries are the same window — what makes the active view derivable rather than remembered. */
export function sameGridQuery(a: GridQuery, b: GridQuery): boolean {
  const filters = (query: GridQuery) =>
    Object.entries(query.filters ?? {})
      .filter(([, value]) => value !== '')
      .sort(([x], [y]) => x.localeCompare(y));

  return (
    a.page === b.page &&
    a.pageSize === b.pageSize &&
    (a.sort?.key ?? '') === (b.sort?.key ?? '') &&
    (a.sort?.dir ?? '') === (b.sort?.dir ?? '') &&
    (a.q ?? '') === (b.q ?? '') &&
    JSON.stringify(filters(a)) === JSON.stringify(filters(b))
  );
}

/**
 * A query in words — for a chip, a toast or a printed header.
 *
 * The grid shows this rather than trying to describe itself from its own state, because the person reading it needs to
 * know what they are looking at: "Main Campus · Admitted · page 2 of 40" is checkable against the screen, and "filters
 * applied" is not.
 */
export function describeGridQuery(
  query: GridQuery,
  labels: { sort?: string; filters?: Record<string, string> } = {},
): string {
  const parts: string[] = [];
  if (query.q) parts.push(`Search “${query.q}”`);
  for (const [key, value] of Object.entries(query.filters ?? {})) {
    if (!value) continue;
    parts.push(`${labels.filters?.[key] ?? key}: ${value}`);
  }
  if (query.sort) parts.push(`sorted by ${labels.sort ?? query.sort.key} ${query.sort.dir === 'asc' ? 'ascending' : 'descending'}`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------------- saved views */

const STORAGE_PREFIX = 'dizi.grid.';

/** The storage key for a grid's saved views. One grid, one list — the same grid on two screens is two grids. */
export const viewsStorageKey = (id: string): string => `${STORAGE_PREFIX}${id}.views`;

const readStoredViews = (id: string): GridView[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(viewsStorageKey(id));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    /* Stored views are user data and are read defensively: a shape this version does not understand is dropped rather
       than rendered, because a view is applied to a query and a malformed one would poison the screen. */
    return parsed
      .filter((v): v is GridView => Boolean(v) && typeof v === 'object' && typeof (v as GridView).name === 'string' && Boolean((v as GridView).query))
      .map((v) => ({
        id: String(v.id ?? v.name),
        name: v.name,
        query: {
          page: Number(v.query.page) >= 1 ? Number(v.query.page) : 1,
          pageSize: Number(v.query.pageSize) || GRID_PAGE_SIZES[1],
          ...(v.query.sort ? { sort: v.query.sort } : {}),
          ...(v.query.q ? { q: v.query.q } : {}),
          ...(v.query.filters ? { filters: v.query.filters } : {}),
        },
      }));
  } catch {
    return [];
  }
};

const writeStoredViews = (id: string, views: GridView[]): void => {
  try {
    window.localStorage.setItem(viewsStorageKey(id), JSON.stringify(views.map(({ id: viewId, name, query }) => ({ id: viewId, name, query }))));
  } catch {
    /* storage unavailable (private mode, or full) — the views still work for this session */
  }
};

/** A view's id from its name, so saving "Unpaid this week" twice replaces rather than duplicates. */
export const viewId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09FF]+/g, '-')
    .replace(/^-|-$/g, '') || 'view';

/* ------------------------------------------------------------------------------ the hook */

export interface UseGridOptions<T> {
  /** Stable per grid: the saved views and the column preferences are keyed by it. */
  id: string;
  defaults: GridQuery;
  source: GridSource<T>;
  /** The filter keys the URL and the saved views may carry. Anything else in a URL is ignored. */
  filterKeys?: readonly string[];
  /** The keys a sort may name. A URL asking for another one keeps the default order. */
  sortKeys?: readonly string[];
  /** The views the screen ships with. They cannot be renamed or deleted — they are the screen's, not the desk's. */
  builtinViews?: readonly GridView[];
  /**
   * Put the query in the URL. On by default; a grid inside a tab or a panel whose address is already doing work can
   * turn it off rather than fighting over the query string.
   */
  url?: boolean;
}

export interface GridController<T> {
  query: GridQuery;
  rows: T[];
  total: number;
  loading: boolean;
  /** A source that threw. The grid shows it and offers a retry rather than a table that looks empty. */
  error: string | null;
  setQuery: (next: Partial<GridQuery>, reason?: GridChange['reason']) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sort: GridSort) => void;
  setSearch: (q: string) => void;
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
  reload: () => void;
  views: GridView[];
  /** The view the current query *is*, if it is one of them. Derived, so editing a filter frees the chip. */
  activeViewId: string | undefined;
  applyView: (id: string) => void;
  saveView: (name: string) => void;
  renameView: (id: string, name: string) => void;
  deleteView: (id: string) => void;
  /** Every row the current filters match, for an export: the source walked in windows, not the page on screen. */
  exportAll: () => Promise<{ rows: T[]; total: number; complete: boolean }>;
  /** Spread onto `DataGrid`. The primitive stays usable on its own; this is the wiring for a server-paged screen. */
  gridProps: {
    rows: T[];
    total: number;
    page: number;
    pageSize: number;
    sort?: GridSort;
    loading: boolean;
    /** The source's refusal, so a screen that spreads these props cannot forget to show it. */
    error: string | null;
    onQuery: (next: { page: number; pageSize: number; sort?: GridSort }) => void;
    views: GridView[];
    activeViewId: string | undefined;
    onViewApply: (id: string) => void;
    onViewSave: (name: string) => void;
    onViewRename: (id: string, name: string) => void;
    onViewDelete: (id: string) => void;
    onExport: () => Promise<{ rows: T[]; total: number; complete: boolean }>;
    onExportLabel: string;
  };
}

export interface GridChange {
  reason: 'page' | 'size' | 'sort' | 'search' | 'filter' | 'view' | 'url' | 'reload';
}

/**
 * One server-paged grid: its query, its views and its rows.
 *
 * The order of the three effects is the whole design. The query starts at the screen's defaults and the first fetch
 * happens against those — never against the URL — so the server-rendered markup and the first client render agree
 * (reading `location` during render is the classic hydration mismatch). The URL is then applied in an effect, and
 * every later change writes the query back to the address. The fetch runs on the query, with an abort so a fast
 * typist's earlier pages do not land after their later ones.
 */
export function useGrid<T>(options: UseGridOptions<T>): GridController<T> {
  const { id, defaults, source, filterKeys, sortKeys, builtinViews = [], url = true } = options;

  const [query, setQueryState] = useState<GridQuery>(defaults);
  const [page, setPage] = useState<GridPage<T>>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [storedViews, setStoredViews] = useState<GridView[]>([]);

  /* The defaults are a literal at the call site, so they change identity every render; the ref keeps the effects
     stable while always reading the current values. */
  const ref = useRef({ defaults, source, filterKeys, sortKeys, url });
  ref.current = { defaults, source, filterKeys, sortKeys, url };

  /* The source may be synchronous (the preview screens) or a promise (the API). `Promise.resolve` around both keeps
     the loading state honest either way — without it a synchronous source renders a flash of "loading". */
  const run = useCallback(
    async (next: GridQuery, signal: { aborted: boolean }) => {
      setLoading(true);
      try {
        const result = await Promise.resolve(ref.current.source(next));
        if (signal.aborted) return;
        setPage(result);
        setError(null);
      } catch (cause) {
        if (signal.aborted) return;
        setPage({ rows: [], total: 0 });
        setError(cause instanceof Error ? cause.message : 'The list could not be loaded.');
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const signal = { aborted: false };
    void run(query, signal);
    return () => {
      signal.aborted = true;
    };
  }, [query, nonce, run]);

  /* The address, read after mount and written after every change. `replaceState` rather than `pushState`: a screen's
     filters are one place you are in, not thirty places to press Back through — and the back button then leaves the
     screen rather than untyping a search box letter by letter. */
  useEffect(() => {
    if (!url || typeof window === 'undefined') return;
    const applied = { ...ref.current.defaults, ...decodeGridQuery(window.location.search, ref.current.defaults, { filterKeys: ref.current.filterKeys, sortKeys: ref.current.sortKeys }) };
    setQueryState((current) => (sameGridQuery(current, applied) ? current : applied));
  }, [url]);

  const setQuery = useCallback(
    (next: Partial<GridQuery>, reason: GridChange['reason'] = 'filter') => {
      setQueryState((current) => {
        const merged: GridQuery = { ...current, ...next };
        /* Anything that narrows or reorders the set sends the reader back to its first page: keeping page 7 of a set
           that now has two pages is how a screen shows an empty table over a filter that matched forty rows. */
        if (reason === 'search' || reason === 'filter' || reason === 'view' || reason === 'sort' || reason === 'size') {
          if (next.page === undefined) merged.page = 1;
        }
        if (url && typeof window !== 'undefined') {
          const search = encodeGridQuery(merged, ref.current.defaults);
          window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
        }
        return merged;
      });
    },
    [url],
  );

  const views = useMemo(() => [...builtinViews, ...storedViews], [builtinViews, storedViews]);

  useEffect(() => {
    setStoredViews(readStoredViews(id));
  }, [id]);

  const activeViewId = useMemo(() => views.find((v) => sameGridQuery(v.query, query))?.id, [views, query]);

  const applyView = useCallback(
    (viewIdToApply: string) => {
      const view = views.find((v) => v.id === viewIdToApply);
      if (view) setQuery({ ...view.query }, 'view');
    },
    [views, setQuery],
  );

  const saveView = useCallback(
    (name: string) => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return;
      const next: GridView = { id: viewId(trimmed), name: trimmed, query: { ...query, page: 1 } };
      setStoredViews((current) => {
        const updated = [...current.filter((v) => v.id !== next.id), next];
        writeStoredViews(id, updated);
        return updated;
      });
    },
    [id, query],
  );

  const renameView = useCallback(
    (target: string, name: string) => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return;
      setStoredViews((current) => {
        const updated = current.map((v) => (v.id === target ? { ...v, id: viewId(trimmed), name: trimmed } : v));
        writeStoredViews(id, updated);
        return updated;
      });
    },
    [id],
  );

  const deleteView = useCallback(
    (target: string) => {
      setStoredViews((current) => {
        const updated = current.filter((v) => v.id !== target);
        writeStoredViews(id, updated);
        return updated;
      });
    },
    [id],
  );

  /**
   * Every matching row, for an export.
   *
   * It walks the source in windows of its own size rather than asking for one enormous page, because the source is an
   * API in production and a 100 000-row response is a request that times out and an export that silently half-writes.
   * The walk stops at `GRID_EXPORT_LIMIT` and reports that it stopped, which the screen says out loud — an export that
   * quietly leaves rows out is worse than one that refuses.
   */
  const exportAll = useCallback(async () => {
    const base: GridQuery = { ...query, page: 1, pageSize: GRID_EXPORT_WINDOW };
    const first = await Promise.resolve(ref.current.source(base));
    const total = first.total;
    const rows = [...first.rows];

    while (rows.length < Math.min(total, GRID_EXPORT_LIMIT) && first.rows.length > 0) {
      const next = await Promise.resolve(ref.current.source({ ...base, page: Math.floor(rows.length / GRID_EXPORT_WINDOW) + 1 }));
      if (next.rows.length === 0) break;
      rows.push(...next.rows);
    }

    const capped = rows.slice(0, GRID_EXPORT_LIMIT);

    return { rows: capped, total, complete: capped.length >= total };
  }, [query]);

  return {
    query,
    rows: page.rows,
    total: page.total,
    loading,
    error,
    setQuery,
    setPage: (next) => setQuery({ page: next }, 'page'),
    setPageSize: (size) => setQuery({ pageSize: size, page: 1 }, 'size'),
    setSort: (sort) => setQuery({ sort, page: 1 }, 'sort'),
    setSearch: (q) => setQuery({ q }, 'search'),
    setFilter: (key, value) => {
      const filters = { ...(query.filters ?? {}) };
      if (value === '') delete filters[key];
      else filters[key] = value;
      setQuery({ filters }, 'filter');
    },
    clearFilters: () => setQuery({ filters: {}, q: '' }, 'filter'),
    reload: () => setNonce((n) => n + 1),
    views,
    activeViewId,
    applyView,
    saveView,
    renameView,
    deleteView,
    exportAll,
    gridProps: {
      rows: page.rows,
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
      ...(query.sort ? { sort: query.sort } : {}),
      loading,
      /* The source's refusal travels with the wiring: a screen that spreads `gridProps` gets the error state, the
         retry and the export in one line and cannot forget one of them. */
      error,
      onQuery: (next) => setQuery({ page: next.page, pageSize: next.pageSize, ...(next.sort ? { sort: next.sort } : {}) }, 'page'),
      views,
      activeViewId,
      onViewApply: applyView,
      onViewSave: saveView,
      onViewRename: renameView,
      onViewDelete: deleteView,
      onExport: exportAll,
      onExportLabel: 'every row matching the filters',
    },
  };
}
