const DEFAULT_REDIRECT = "/dashboard";

// Any fixed origin works — it's only used to tell relative paths from absolute URLs
const BASE = "http://internal.invalid";

/**
 * Returns `value` as a same-origin path (path + query + hash), or the fallback.
 *
 * `callbackUrl` comes from the query string, so without this check a link like
 * /login?callbackUrl=https://evil.example would bounce users off-site (an open
 * redirect). Parsing with URL also catches tricks like "//evil.example" and
 * "/\evil.example", which browsers treat as absolute URLs.
 */
export function getSafeRedirect(
  value: string | string[] | undefined,
  fallback: string = DEFAULT_REDIRECT,
): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return fallback;
  }
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
