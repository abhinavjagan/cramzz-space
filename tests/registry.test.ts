import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  activeExperiments,
  experiments,
  featuredExperiment,
  hasReleasePin,
  isActiveExperiment,
  validateExperiment,
  validateExperimentPortfolio,
  type Experiment,
  type ExperimentStatus,
} from "../src/lib/registry";

function portfolioItem(index: number, status: ExperimentStatus): Experiment {
  const source = experiments[0]!;
  const slug = `portfolio-${index}`;
  const hasLaunched = !["backlog", "building"].includes(status);
  return {
    ...source,
    slug,
    title: `Portfolio ${index}`,
    status,
    launchDate: hasLaunched ? "2026-09-20" : null,
    evaluationEnds: hasLaunched ? "2026-10-04" : null,
    path: `/e/${slug}/`,
    artifact: { ...source.artifact, basePath: `/e/${slug}/` },
  };
}

describe("experiment registry", () => {
  it("contains unique slugs and paths", () => {
    expect(new Set(experiments.map((item) => item.slug)).size).toBe(experiments.length);
    expect(new Set(experiments.map((item) => item.path)).size).toBe(experiments.length);
  });

  it("validates every checked-in experiment", () => {
    expect(() => experiments.forEach(validateExperiment)).not.toThrow();
  });

  it("pins the checked-in artifact to a full commit SHA", () => {
    expect(hasReleasePin(experiments[0]!)).toBe(true);
    expect(hasReleasePin({ ...experiments[0]!, pinnedCommit: "local-workspace" })).toBe(false);
  });

  it("keeps retired experiments out of active navigation", () => {
    expect(activeExperiments.every(isActiveExperiment)).toBe(true);
    expect(featuredExperiment?.status).not.toBe("retired");
    expect(isActiveExperiment(portfolioItem(1, "retired"))).toBe(false);
  });

  it("enforces one build and two simultaneous tests", () => {
    expect(() => validateExperimentPortfolio([
      portfolioItem(1, "building"),
      portfolioItem(2, "building"),
    ])).toThrow(/at most one experiment building/i);
    expect(() => validateExperimentPortfolio([
      portfolioItem(1, "testing"),
      portfolioItem(2, "testing"),
      portfolioItem(3, "testing"),
    ])).toThrow(/at most two experiments testing/i);
    expect(() => validateExperimentPortfolio([
      portfolioItem(1, "building"),
      portfolioItem(2, "testing"),
      portfolioItem(3, "testing"),
    ])).not.toThrow();
  });

  it("binds launched statuses to an exact fourteen-day evaluation window", () => {
    expect(() => validateExperiment(portfolioItem(1, "testing"))).not.toThrow();
    expect(() => validateExperiment({
      ...portfolioItem(2, "testing"),
      evaluationEnds: "2026-10-05",
    })).toThrow(/exactly 14 calendar days/i);
    expect(() => validateExperiment({
      ...portfolioItem(3, "testing"),
      launchDate: "2026-02-30",
    })).toThrow(/valid launchDate/i);
    expect(() => validateExperiment({
      ...portfolioItem(4, "building"),
      launchDate: "2026-09-20",
    })).toThrow(/keep launchDate and evaluationEnds null/i);
  });

  it("keeps threshold sponsor packages locked until verified completions", () => {
    const source = portfolioItem(1, "building");
    const withPackage = (id: string, name: string, completedPlays: number) => ({
      ...source,
      metrics: { ...source.metrics, completedPlays },
      sponsorInventory: [{ id, name, priceInr: 1, availability: "Test", state: "open" as const }],
    });
    expect(() => validateExperiment(withPackage("founding-node", "Founding Node", 0))).not.toThrow();
    expect(() => validateExperiment(withPackage("daily-challenge", "Daily Challenge Sponsor", 249))).toThrow(/250 completed plays/i);
    expect(() => validateExperiment(withPackage("daily-challenge", "Daily Challenge Sponsor", 250))).not.toThrow();
    expect(() => validateExperiment(withPackage("season", "Season Sponsor", 999))).toThrow(/1,000 completed plays/i);
    expect(() => validateExperiment(withPackage("season", "Season Sponsor", 1_000))).not.toThrow();
  });

  it("requires stable unique sponsor package IDs", () => {
    const source = portfolioItem(1, "building");
    const repeated = { id: "founding-node", name: "Founding Node", priceInr: 499, availability: "Test", state: "open" as const };
    expect(() => validateExperiment({ ...source, sponsorInventory: [repeated, { ...repeated }] }))
      .toThrow(/package IDs must be unique slugs/i);
  });

  it("forwards both supported base-path variables to vendored builds", () => {
    const vendorScript = readFileSync(resolve("scripts/vendor-experiments.mjs"), "utf8");
    expect(vendorScript).toContain("VITE_BASE_PATH: artifact.basePath");
    expect(vendorScript).toContain("CRAMZZ_BASE_PATH: artifact.basePath");
  });

  it("keeps experiment and artifact base paths identical", () => {
    for (const experiment of experiments) {
      expect(experiment.artifact.basePath).toBe(experiment.path);
      expect(experiment.artifact.verifyCommand.length).toBeGreaterThan(0);
      expect(experiment.artifact.pinEnvironment).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });

  it("rejects an unsafe artifact pin environment name", () => {
    const experiment = experiments[0]!;
    expect(() => validateExperiment({
      ...experiment,
      artifact: { ...experiment.artifact, pinEnvironment: "PACKET-PANIC;echo" },
    })).toThrow(/pin environment/i);
  });

  it("publishes the canonical shared manifest schema", () => {
    const schema = JSON.parse(readFileSync(resolve("public/schemas/experiment.schema.json"), "utf8"));
    expect(schema.$id).toBe("https://cramzz.space/schemas/experiment.schema.json");
    expect(schema.required).toContain("pinnedCommit");
    expect(schema.properties.pinnedCommit.pattern).toContain("UNPINNED");
    expect(schema.properties.sponsorInventory.items.properties.label.minLength).toBe(1);
  });

  it("publishes the canonical scorecard schema including captured revenue", () => {
    const publicSchema = readFileSync(resolve("public/schemas/scorecard.schema.json"), "utf8");
    const canonicalPath = resolve("../cramzz-workflows/schemas/scorecard.schema.json");
    // The sibling exists in the local multi-repository workspace, but not when
    // this standalone repository runs on GitHub or Render.
    if (existsSync(canonicalPath)) expect(publicSchema).toBe(readFileSync(canonicalPath, "utf8"));
    const schema = JSON.parse(publicSchema);
    expect(schema.$id).toBe("https://cramzz.space/schemas/scorecard.schema.json");
    expect(schema.properties.metrics.required).toContain("capturedGrossInr");
    expect(schema.allOf).toHaveLength(4);
  });
});
