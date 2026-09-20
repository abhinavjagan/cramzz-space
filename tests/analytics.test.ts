import { afterEach, describe, expect, it, vi } from "vitest";
import analyticsContract from "../analytics-contract.json";
import analyticsContractSchema from "../public/schemas/analytics-contract.schema.json";
import {
  ANALYTICS_ID_STORAGE_KEY,
  ANALYTICS_ID_TTL_MS,
  buildAnalyticsPayload,
  classifyReferrer,
  getOrCreateAnonymousId,
  installAnalytics,
  publicEvents,
  sanitizeProperties,
} from "../src/lib/analytics";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

interface BrowserHarnessOptions {
  search?: string;
  referrer?: string;
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  storage?: MemoryStorage;
}

interface BrowserWindowMock {
  location: { hostname: string; search: string };
  localStorage: MemoryStorage;
  sessionStorage: MemoryStorage;
  dispatchEvent: ReturnType<typeof vi.fn>;
  cramzzAnalytics?: Window["cramzzAnalytics"];
}

function installBrowserHarness({
  search = "",
  referrer = "",
  doNotTrack = null,
  globalPrivacyControl = false,
  storage = new MemoryStorage(),
}: BrowserHarnessOptions = {}) {
  const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
  const windowMock: BrowserWindowMock = {
    location: { hostname: "cramzz.space", search },
    localStorage: storage,
    sessionStorage: new MemoryStorage(),
    dispatchEvent: vi.fn(),
  };

  vi.stubGlobal("window", windowMock);
  vi.stubGlobal("document", {
    referrer,
    querySelectorAll: () => [],
  });
  vi.stubGlobal("navigator", { doNotTrack, globalPrivacyControl });
  vi.stubGlobal("fetch", fetchMock);

  return { fetchMock, storage, windowMock };
}

function capturedPayload(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const request = fetchMock.mock.calls[index];
  const options = request?.[1] as RequestInit | undefined;
  return JSON.parse(String(options?.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("privacy-preserving analytics", () => {
  it("sends only declared, constrained properties", () => {
    expect(sanitizeProperties({
      experiment_id: "packet-panic-v1",
      campaign: "launch_day-1",
      referrer_class: "social",
      returning_player: true,
      outcome: "delivered",
      grade: "A",
      hops: 4,
      latency_ms: 420,
      reliability_pct: 98.5,
      email: "visitor@example.com",
      current_url: "https://example.com/private",
      source: "contains spaces and personal text",
      puzzle_id: "x".repeat(65),
      score: 999,
      latency: 420,
      reliability: 98.5,
    })).toEqual({
      experiment_id: "packet-panic-v1",
      campaign: "launch_day-1",
      referrer_class: "social",
      returning_player: true,
      outcome: "delivered",
      grade: "A",
      hops: 4,
      latency_ms: 420,
      reliability_pct: 98.5,
    });
  });

  it("enforces exact gameplay enums and numeric bounds", () => {
    expect(sanitizeProperties({
      outcome: "won",
      grade: "S+",
      hops: 6.5,
      latency_ms: 10_001,
      reliability_pct: -0.1,
      referrer_class: "x",
    })).toEqual({});
    expect(sanitizeProperties({
      outcome: "dropped",
      grade: "S",
      hops: 6,
      latency_ms: 10_000,
      reliability_pct: 100,
    })).toEqual({
      outcome: "dropped",
      grade: "S",
      hops: 6,
      latency_ms: 10_000,
      reliability_pct: 100,
    });
  });

  it("classifies X as social and malformed referrers without an unknown bucket", () => {
    expect(classifyReferrer("", "cramzz.space")).toBe("direct");
    expect(classifyReferrer("https://cramzz.space/privacy/", "cramzz.space")).toBe("internal");
    expect(classifyReferrer("https://x.com/post/1", "cramzz.space")).toBe("social");
    expect(classifyReferrer("https://google.com/search?q=packet", "cramzz.space")).toBe("search");
    expect(classifyReferrer("not a url", "cramzz.space")).toBe("direct");
  });

  it("implements the checked-in public analytics contract", () => {
    expect([...publicEvents]).toEqual(analyticsContract.events);
    expect(analyticsContractSchema.properties.events.const).toEqual(analyticsContract.events);
    const fixture = {
      experiment_id: "packet-panic-v1",
      puzzle_id: "2026-09-20",
      source: "share",
      campaign: "launch-1",
      referrer_class: "social",
      returning_player: true,
      outcome: "delivered",
      latency_ms: 42,
      reliability_pct: 98.5,
      hops: 4,
      grade: "A",
    };
    expect(Object.keys(sanitizeProperties(fixture)).sort())
      .toEqual(Object.keys(analyticsContract.properties).sort());
  });

  it("puts the anonymous ID at the API top level and privacy flags in properties", () => {
    expect(buildAnalyticsPayload("project-key", "game_complete", "anon_1111111111111111", {
      experiment_id: "packet-panic-v1",
      hops: 4,
      email: "must-not-leave",
    })).toEqual({
      api_key: "project-key",
      event: "game_complete",
      distinct_id: "anon_1111111111111111",
      properties: {
        $process_person_profile: false,
        $geoip_disable: true,
        experiment_id: "packet-panic-v1",
        hops: 4,
      },
    });
  });

  it("reuses a random identifier inside the measurement window", () => {
    const storage = new MemoryStorage();
    const first = getOrCreateAnonymousId(storage, 1_000, () => "anon_1111111111111111");
    const again = getOrCreateAnonymousId(storage, 1_000 + ANALYTICS_ID_TTL_MS - 1, () => "anon_2222222222222222");
    expect(first).toBe("anon_1111111111111111");
    expect(again).toBe(first);
  });

  it("rotates the identifier after 30 days and replaces corrupt values", () => {
    const storage = new MemoryStorage();
    storage.setItem(ANALYTICS_ID_STORAGE_KEY, "not-json");
    expect(getOrCreateAnonymousId(storage, 1_000, () => "anon_1111111111111111")).toBe("anon_1111111111111111");
    expect(getOrCreateAnonymousId(storage, 1_000 + ANALYTICS_ID_TTL_MS, () => "anon_2222222222222222")).toBe("anon_2222222222222222");
  });

  it("transmits a payment return once with only sanitized attribution fields", () => {
    const { fetchMock, windowMock } = installBrowserHarness({
      search: "?utm_source=x-launch&utm_campaign=founding_nodes&utm_medium=email"
        + "&utm_term=person%40example.com&razorpay_payment_id=pay_private"
        + "&razorpay_payment_link_reference_id=customer-private&payment_id=payment-private"
        + "&email=person%40example.com&phone=9999999999",
    });

    installAnalytics("e2e-public-key", "https://us.i.posthog.com");
    windowMock.cramzzAnalytics?.track("payment_returned", {
      experiment_id: "packet-panic-v1",
      razorpay_payment_id: "pay_private",
      payment_reference: "customer-private",
      email: "person@example.com",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://us.i.posthog.com/i/v0/e/", expect.objectContaining({
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
    }));
    const payload = capturedPayload(fetchMock);
    expect(Object.keys(payload).sort()).toEqual(["api_key", "distinct_id", "event", "properties"]);
    expect(payload).toEqual({
      api_key: "e2e-public-key",
      event: "payment_returned",
      distinct_id: expect.stringMatching(/^anon_/),
      properties: {
        $process_person_profile: false,
        $geoip_disable: true,
        source: "x-launch",
        campaign: "founding_nodes",
        referrer_class: "direct",
        experiment_id: "packet-panic-v1",
      },
    });
    const serialized = JSON.stringify(payload);
    for (const sensitiveValue of [
      "person@example.com",
      "9999999999",
      "pay_private",
      "customer-private",
      "payment-private",
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
  });

  it.each([
    ["Do Not Track", { doNotTrack: "1" }],
    ["Global Privacy Control", { globalPrivacyControl: true }],
  ])("does not transmit when %s is enabled", (_label, privacy) => {
    const { fetchMock, windowMock } = installBrowserHarness(privacy);
    installAnalytics("e2e-public-key", "https://us.i.posthog.com");
    windowMock.cramzzAnalytics?.track("payment_returned", { experiment_id: "packet-panic-v1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts one direct payment return per load while reusing the anonymous browser ID", () => {
    const storage = new MemoryStorage();
    const { fetchMock, windowMock } = installBrowserHarness({ storage });

    installAnalytics("e2e-public-key", "https://us.i.posthog.com");
    windowMock.cramzzAnalytics?.track("payment_returned", { experiment_id: "packet-panic-v1" });
    installAnalytics("e2e-public-key", "https://us.i.posthog.com");
    windowMock.cramzzAnalytics?.track("payment_returned", { experiment_id: "packet-panic-v1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const initialLoad = capturedPayload(fetchMock, 0);
    const reload = capturedPayload(fetchMock, 1);
    expect(initialLoad.distinct_id).toBe(reload.distinct_id);
    expect(initialLoad.properties).toEqual({
      $process_person_profile: false,
      $geoip_disable: true,
      referrer_class: "direct",
      experiment_id: "packet-panic-v1",
    });
    expect(reload.properties).toEqual(initialLoad.properties);
  });
});
