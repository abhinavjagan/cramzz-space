import { describe, expect, it } from "vitest";
import analyticsContract from "../analytics-contract.json";
import analyticsContractSchema from "../public/schemas/analytics-contract.schema.json";
import {
  ANALYTICS_ID_STORAGE_KEY,
  ANALYTICS_ID_TTL_MS,
  buildAnalyticsPayload,
  classifyReferrer,
  getOrCreateAnonymousId,
  publicEvents,
  sanitizeProperties,
} from "../src/lib/analytics";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

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
});
