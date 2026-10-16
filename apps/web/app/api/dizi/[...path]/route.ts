import { NextRequest } from 'next/server';

/* The app's door to the hospital server, and the only place that knows where it is.
 *
 * The browser talks to this route and never to the API's host: `/api/dizi/appointments?day=…` here becomes
 * `GET {DIZI_API_URL}/appointments?day=…` there. Two reasons, and the second is the one that made it a requirement:
 *
 *   1. **The address of the service is a deployment fact.** `DIZI_API_URL` is read on the server, so the same build
 *      runs against a laptop, a branch node or the cloud without a variable the browser can see or a rebuild.
 *   2. **A browser in a preview cannot reach `127.0.0.1:8000`.** The app is served over a proxy that exposes one
 *      origin; a page calling the API's host directly is a page that works on one machine and breaks on every other —
 *      and, on a hospital LAN, a page that needs the API to be reachable *from the browser* rather than from the app
 *      it was served by.
 *
 * What crosses is the request, not the identity: the client's own `Authorization` and `Idempotency-Key` are passed
 * through unchanged, and the response's status, body and `X-Trace-Id` come back as they were. This route authenticates
 * nobody and hides nothing — the API is the thing that decides, and a proxy that quietly added a token would make the
 * audit ledger's actor a lie.
 *
 * When the service is not configured or not reachable, the answer is the contract's own problem shape, so the screens
 * have one kind of failure to render rather than two.
 */

export const runtime = 'nodejs';
/* Never cached: every one of these is either a read of a diary that moves all morning or a write. */
export const dynamic = 'force-dynamic';

const API_URL = (process.env.DIZI_API_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');

/** The headers that belong to the caller and the API between them, and nothing else. */
const FORWARDED = ['authorization', 'idempotency-key', 'x-trace-id', 'content-type', 'accept'];

function problem(status: number, code: string, title: string, detail: string, instance: string): Response {
  return new Response(
    JSON.stringify({
      type: `https://contract.dizihospital.example/problems/${code}`,
      title,
      status,
      detail,
      instance,
    }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

async function forward(request: NextRequest, params: Promise<{ path: string[] }>): Promise<Response> {
  const { path } = await params;
  const target = new URL(`${API_URL}/${(path ?? []).join('/')}`);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));

  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();

  let answer: Response;
  try {
    answer = await fetch(target, {
      method: request.method,
      headers,
      body,
      /* The request's own cancellation: a desk that navigates away should not leave the API working on a write it
         will throw away. */
      signal: request.signal,
      cache: 'no-store',
    });
  } catch (cause) {
    /* The service is configured and not answering. This is the sentence the desk reads, and it is deliberately not
       "something went wrong": a branch whose server is down needs to know that is what happened. */
    return problem(
      502,
      'dizi.unavailable',
      'The hospital server is not answering',
      `This app could not reach the API at ${API_URL}${target.pathname}. The screen is showing what it can do without it; nothing was written. (${cause instanceof Error ? cause.message : 'the request failed'})`,
      request.nextUrl.pathname,
    );
  }

  const passthrough = new Headers();
  for (const name of ['content-type', 'x-trace-id', 'x-dizi-replay']) {
    const value = answer.headers.get(name);
    if (value !== null) passthrough.set(name, value);
  }

  return new Response(await answer.arrayBuffer(), { status: answer.status, headers: passthrough });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, context.params);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, context.params);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, context.params);
}
