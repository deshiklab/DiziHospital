/* --------------------------------------------------------------------------------- the wire, on its own
 *
 * Every screen in this app that reads or writes the hospital's records goes through `/api/dizi/...` — the app's own
 * proxy, the only thing that knows where the service is — and every one of them needs the same four things: a path
 * taken from the contract rather than typed, a refusal turned into a value rather than a status code, an idempotency
 * key minted once per attempt, and a way to ask whether the server is there at all.
 *
 * Those four lived inside `appointments-api.ts` while appointments were the only screens served by the API. The
 * messaging console is the second, so they live here instead: one transport, two vocabularies. The rules are the ones
 * the appointments slice learned the hard way and they are unchanged:
 *
 *   1. **The path comes from the contract.** `operations.<id>.path` is generated from `openapi.json`, so a screen
 *      cannot call an endpoint nobody documented, and moving a path in the contract moves the call.
 *   2. **A refusal is a value, not a status code.** A screen that branches on `response.status === 409` breaks the
 *      first time a code moves.
 *   3. **A write is replayed under the key the contract names.** The header is read from `x-dizi-idempotency`, and it
 *      goes only on the writes whose own metadata says `requiresIdempotencyKey` — so a new operation cannot be
 *      forgotten here, and one that does not need a key does not get one.
 */

import { operations, type OperationMeta } from '@dizi/contracts/client';
import capabilities from '@dizi/contracts/capabilities.json';

/** Where the API is: nowhere. The proxy in front of it is same-origin by design — a page that needs the API
    reachable *from the browser* is a page that works on one machine and breaks on every other. */
export const API_BASE = '/api/dizi';

/** The header a write is replayed under, read from the contract rather than typed here. The contract publishes it as
    an object (`{name, requiredOn}`), not a bare string — reading it as one put the object itself into the header name
    and every write failed before it left the browser. */
export const IDEMPOTENCY_HEADER = (capabilities.idempotencyHeader as unknown as { name: string }).name;

/**
 * A refusal, in the contract's own vocabulary.
 *
 * It carries the code, the status, the sentence a person reads and whatever the contract puts *beside* the code — a
 * taken slot's alternatives, the attempts a retry has left. The two accessors below are the extras whose shape is
 * published: a screen branches on `isSlotTaken` rather than on the string `'dizi.slot-taken'`, so a code that moves
 * moves in one place.
 */
export class ApiProblem extends Error {
  constructor(
    readonly code: string,
    readonly title: string,
    readonly status: number,
    readonly detail: string,
    readonly extras: Record<string, unknown> = {},
  ) {
    super(detail);
    this.name = 'ApiProblem';
  }

  /** The conflict the desk has to answer: somebody else took the slot a second ago. */
  get isSlotTaken(): boolean {
    return this.code === 'dizi.slot-taken';
  }

  /** The alternatives a taken slot offered, in the shape the screens render. */
  get alternatives(): Array<{ start: string; day: string; minutes: number }> {
    const offered = this.extras.alternatives;

    return Array.isArray(offered) ? (offered as Array<{ start: string; day: string; minutes: number }>) : [];
  }
}

/** The code at the tail of the problem's `type` URI: `…/problems/dizi.slot-taken` → `dizi.slot-taken`. */
export function codeOf(body: Record<string, unknown>, status: number): string {
  const type = typeof body.type === 'string' ? body.type : '';
  const tail = type.split('/').pop() ?? '';
  if (tail.startsWith('dizi.')) return tail;

  return status >= 500 ? 'dizi.unavailable' : 'about:blank';
}

/** A path with its placeholders filled from the contract's own template. */
export function fill(operation: OperationMeta, values: string[]): string {
  let path = operation.path;
  for (const value of values) path = path.replace(/\{[^}]+\}/, encodeURIComponent(value));

  return path;
}

export interface CallOptions {
  /** Values for the operation's `{placeholders}`, in the order they appear in the contract's path. */
  at?: string[];
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** The idempotency key, for the operations whose metadata requires one. */
  key?: string;
}

export async function call<T>(operation: OperationMeta, options: CallOptions = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') query.set(name, String(value));
  }

  const path = fill(operation, options.at ?? []);
  const url = `${API_BASE}${path}${query.size > 0 ? `?${query}` : ''}`;

  const headers = new Headers({ accept: 'application/json' });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  /* The key goes on the writes the contract says it goes on (`requiresIdempotencyKey`), not on everything
     write-shaped: it is the operation's own metadata that decides, so a new operation cannot be forgotten here. */
  if (operation.requiresIdempotencyKey && options.key !== undefined) headers.set(IDEMPOTENCY_HEADER, options.key);

  const answer = await fetch(url, {
    method: operation.method.toUpperCase(),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });

  const text = await answer.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    /* A proxy answered with HTML — a 502 page, a login wall. That is not a refusal in the contract's vocabulary, so
       it is reported as what it is rather than parsed into a problem it never was. */
    parsed = { title: 'The hospital server answered with something this app cannot read', detail: text.slice(0, 200) };
  }

  if (!answer.ok) {
    throw new ApiProblem(
      codeOf(parsed, answer.status),
      typeof parsed.title === 'string' ? parsed.title : 'The hospital server refused that',
      answer.status,
      typeof parsed.detail === 'string' ? parsed.detail : 'The server refused the request and did not say why.',
      parsed,
    );
  }

  return parsed as T;
}

/**
 * A key for one write, minted once and reused for that write's retries.
 *
 * The contract accepts `nodeId:seq` for a queued write and a UUID for one made online. What matters is not which of
 * the two: it is that a retry after a dropped connection carries the *same* key, so a booking retried once is one
 * booking. The caller mints one key per attempt and passes it back in on the retry.
 */
export function attemptKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Whether the app can reach the hospital server at all, and the sentence to show when it cannot. */
export async function probeApi(): Promise<{ reachable: boolean; because: string }> {
  try {
    await call<Record<string, unknown>>(operations.health);

    return { reachable: true, because: 'The hospital server answered.' };
  } catch (error) {
    const problem = error instanceof ApiProblem ? error : null;

    return {
      reachable: false,
      because:
        problem === null
          ? 'The hospital server could not be reached from this app.'
          : problem.status === 502 || problem.status === 503
            ? problem.detail
            : `${problem.title}. ${problem.detail}`,
    };
  }
}
