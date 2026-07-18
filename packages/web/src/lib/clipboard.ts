// Copy text to the clipboard, returning whether it succeeded.
//
// The async Clipboard API is unavailable in non-secure contexts and is blocked
// outright by some privacy-hardened browsers (e.g. Brave), so we fall back to a
// hidden-textarea `execCommand('copy')` — the older synchronous path that still
// works there as long as we're inside a user gesture.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
