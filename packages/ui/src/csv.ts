/* ------------------------------------------------------------------------------ CSV
 *
 * The export a desk actually needs: the spreadsheet, not a screenshot of it.
 *
 * Three decisions are in this file rather than in the grid, because they are the three ways an export goes wrong and
 * each one is a line of code somebody can point at:
 *
 *  1. **The header is the column's name, not its key.** A file whose first row says `dob` is a file somebody has to
 *     rename before showing it to a manager.
 *  2. **A cell that a person sees is the cell that is exported.** `render` columns draw chips and links, so the raw
 *     field is often missing or ugly — the column says how to read itself with `value`, and this file uses it. Without
 *     that, every status column in the legacy exports was blank, which is the complaint that starts a spreadsheet of
 *     hand-typed rows.
 *  3. **The quoting is RFC 4180 and the encoding is UTF-8 with a BOM.** Bangla names are not optional in a Dhaka
 *     hospital, and Excel — still the thing on the office machine — reads a BOM-less UTF-8 file as mojibake. The
 *     legacy product had that bug in its own exports; it is not being reproduced.
 *
 * Rows are joined with CRLF and the file ends with one, which is what every spreadsheet expects.
 */

/** A column as the writer needs it: a heading and a way to read a cell. */
export interface CsvColumn<T> {
  header: string;
  key: string;
  /** What a person sees in this column, when that is not the raw field. */
  value?: ((row: T) => unknown) | undefined;
}

/** One cell, quoted only when it has to be. */
function cell(raw: unknown): string {
  const text =
    raw === null || raw === undefined
      ? ''
      : typeof raw === 'number' || typeof raw === 'boolean'
        ? String(raw)
        : String(raw).replace(/\r\n|\r|\n/g, ' ');

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole sheet as text. Pure, so the escaping is testable without a browser. */
export function toCsv<T>(columns: ReadonlyArray<CsvColumn<T>>, rows: ReadonlyArray<T>): string {
  const head = columns.map((c) => cell(c.header)).join(',');
  const body = rows.map((row) =>
    columns
      .map((c) => cell(c.value ? c.value(row) : (row as Record<string, unknown>)[c.key]))
      .join(','),
  );

  return [head, ...body].join('\r\n') + '\r\n';
}

/** The file's name: the screen's own name for it, then the day it was written. */
export function csvFileName(base: string, day: string): string {
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'export';
  return `${safe}-${day}.csv`;
}

/** A date as the file name uses it: `2026-10-16`, in local time rather than UTC. */
export function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Hand the text to the browser as a download.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari cancels a download whose URL is revoked
 * in the same task as the click, and the file then simply never appears.
 */
export function downloadCsv(text: string, fileName: string): void {
  const blob = new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
