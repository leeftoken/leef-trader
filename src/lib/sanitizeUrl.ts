/**
 * Validate that a string is a well-formed HTTPS URL.
 *
 * Returns the normalised `href` when valid, or `undefined` otherwise.
 * Use this whenever a URL originates from untrusted Nostr event data
 * (tags, metadata fields, etc.) and will be placed into an `href`, `src`,
 * or CSS `url()`. Without this check a `javascript:` / `data:` URI could
 * run as a navigation or resource load.
 */
export function sanitizeUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:") return parsed.href;
  } catch {
    // not a valid URL
  }
  return undefined;
}
