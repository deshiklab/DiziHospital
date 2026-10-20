/* Copying to the clipboard, and telling the truth about whether it worked.
 *
 * `navigator.clipboard` is not something to rely on:
 *  - it only exists in a secure context (https, or localhost);
 *  - inside an embedded frame it needs permission from the host page, otherwise `writeText` rejects with
 *    NotAllowedError — and an unhandled rejection is what shows up as a crash in the browser overlay;
 *  - on hospital desks still on an old browser it is simply missing.
 *
 * So: try the modern API, fall back to the legacy selection trick, and return a boolean the caller can report
 * on. It never throws, because "the copy did not happen" is information, not an exception.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied, frame blocked the call, or no transient user activation left — try the fallback */
  }

  try {
    if (typeof document === 'undefined') return false;

    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // Off-screen rather than `display:none`: a hidden element cannot be selected.
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.left = '-1000px';
    area.style.opacity = '0';

    const selection = document.getSelection();
    const restore = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(area);

    if (restore && selection) {
      selection.removeAllRanges();
      selection.addRange(restore);
    }

    return ok;
  } catch {
    return false;
  }
}
