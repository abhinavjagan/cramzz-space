export const publicEvents = [
  "experiment_view",
  "game_start",
  "game_complete",
  "share_opened",
  "share_completed",
  "challenge_visit",
  "sponsor_cta_clicked",
  "sponsor_form_opened",
  "payment_returned",
] as const;

export type PublicEvent = (typeof publicEvents)[number];

export const ANALYTICS_ID_STORAGE_KEY = "cramzz.analytics.anonymous-id.v1";
export const ANALYTICS_ID_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const publicEventSet = new Set<string>(publicEvents);
const permittedProperties = new Set<string>([
  "experiment_id",
  "puzzle_id",
  "source",
  "campaign",
  "referrer_class",
  "returning_player",
  "outcome",
  "latency_ms",
  "reliability_pct",
  "hops",
  "grade",
]);

type AnalyticsProperty = string | number | boolean;
type StorageLike = Pick<Storage, "getItem" | "setItem">;

function safeToken(value: unknown, maximumLength = 64): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0
    && normalized.length <= maximumLength
    && /^[a-zA-Z0-9._-]+$/.test(normalized)
    ? normalized
    : undefined;
}

export function sanitizeProperties(properties: Record<string, unknown>): Record<string, AnalyticsProperty> {
  const sanitized: Record<string, AnalyticsProperty> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (!permittedProperties.has(key)) continue;

    if (["experiment_id", "puzzle_id", "source", "campaign"].includes(key)) {
      const token = safeToken(value);
      if (token) sanitized[key] = token;
      continue;
    }

    if (key === "referrer_class") {
      if (["direct", "internal", "search", "social", "referral"].includes(String(value))) {
        sanitized[key] = String(value);
      }
      continue;
    }

    if (key === "returning_player") {
      if (typeof value === "boolean") sanitized[key] = value;
      continue;
    }

    if (key === "outcome") {
      if (["delivered", "dropped"].includes(String(value))) sanitized[key] = String(value);
      continue;
    }

    if (key === "grade") {
      if (["S", "A", "B", "C", "D"].includes(String(value))) sanitized[key] = String(value);
      continue;
    }

    if (key === "hops") {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) {
        sanitized[key] = value;
      }
      continue;
    }

    const maximum = key === "latency_ms" ? 10_000 : 100;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function buildAnalyticsPayload(
  key: string,
  event: PublicEvent,
  distinctId: string,
  properties: Record<string, unknown>,
) {
  return {
    api_key: key,
    event,
    distinct_id: distinctId,
    properties: {
      $process_person_profile: false,
      $geoip_disable: true,
      ...sanitizeProperties(properties),
    },
  };
}

function createAnonymousId(): string {
  if (typeof crypto.randomUUID === "function") return `anon_${crypto.randomUUID()}`;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `anon_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function getOrCreateAnonymousId(
  storage: StorageLike,
  now = Date.now(),
  generate: () => string = createAnonymousId,
): string {
  const stored = storage.getItem(ANALYTICS_ID_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { id?: unknown; createdAt?: unknown };
      const validId = typeof parsed.id === "string" && /^anon_[a-zA-Z0-9-]{16,64}$/.test(parsed.id);
      const validDate = typeof parsed.createdAt === "number" && parsed.createdAt <= now && now - parsed.createdAt < ANALYTICS_ID_TTL_MS;
      if (validId && validDate) return parsed.id as string;
    } catch {
      // Replace corrupt or legacy data with a fresh, short-lived identifier.
    }
  }

  const id = generate();
  storage.setItem(ANALYTICS_ID_STORAGE_KEY, JSON.stringify({ id, createdAt: now }));
  return id;
}

let volatileAnonymousId = "";
function anonymousId(): string {
  for (const storageName of ["localStorage", "sessionStorage"] as const) {
    try {
      return getOrCreateAnonymousId(window[storageName]);
    } catch {
      // Storage may be blocked by browser privacy settings; try a narrower scope.
    }
  }
  volatileAnonymousId ||= createAnonymousId();
  return volatileAnonymousId;
}

function analyticsOptedOut(): boolean {
  const privacyNavigator = navigator as Navigator & { globalPrivacyControl?: boolean };
  return privacyNavigator.globalPrivacyControl === true || ["1", "yes"].includes(navigator.doNotTrack ?? "");
}

function posthogHost(host: string): string | undefined {
  try {
    const url = new URL(host);
    if (url.protocol !== "https:" || !["us.i.posthog.com", "eu.i.posthog.com"].includes(url.hostname)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function classifyReferrer(referrerValue: string, currentHostname: string): string {
  if (!referrerValue) return "direct";
  try {
    const referrer = new URL(referrerValue);
    if (referrer.hostname === currentHostname) return "internal";
    if (/(^|\.)(twitter\.com|x\.com)$/i.test(referrer.hostname)) return "social";
    if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/i.test(referrer.hostname)) return "search";
    return "referral";
  } catch {
    return "direct";
  }
}

export function installAnalytics(key: string, host: string): void {
  const cleanedHost = posthogHost(host);
  const params = new URLSearchParams(window.location.search);

  window.cramzzAnalytics = {
    track(event, properties = {}) {
      if (!key || !cleanedHost || analyticsOptedOut() || !publicEventSet.has(event)) return;
      const payload = buildAnalyticsPayload(key, event, anonymousId(), {
        source: params.get("utm_source") ?? undefined,
        campaign: params.get("utm_campaign") ?? undefined,
        referrer_class: classifyReferrer(document.referrer, window.location.hostname),
        ...properties,
      });

      void fetch(`${cleanedHost}/i/v0/e/`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => undefined);
    },
  };

  window.dispatchEvent(new Event("cramzz:analytics-ready"));

  document.querySelectorAll<HTMLElement>("[data-analytics-event]").forEach((element) => {
    element.addEventListener("click", () => {
      const event = element.dataset.analyticsEvent as PublicEvent | undefined;
      if (event) window.cramzzAnalytics?.track(event, { experiment_id: element.dataset.experimentId ?? "cramzz-space" });
    });
  });
}

declare global {
  interface Window {
    cramzzAnalytics?: {
      track: (event: PublicEvent, properties?: Record<string, unknown>) => void;
    };
  }
}
