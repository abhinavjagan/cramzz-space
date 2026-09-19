const APPROVED_FORM_ORIGINS = new Set(["https://tally.so"]);

/** Return only a credential-free HTTPS form URL on an explicitly approved host. */
export function approvedSponsorFormUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    if (!APPROVED_FORM_ORIGINS.has(url.origin)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
