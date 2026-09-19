import experimentData from "../data/experiments.json";

export const experimentStatuses = ["backlog", "building", "testing", "scaled", "iterating", "retired"] as const;
export const experimentDecisions = ["pending", "scale", "iterate", "kill"] as const;
export const activeExperimentStatuses = ["building", "testing", "scaled", "iterating"] as const;

export type ExperimentStatus = (typeof experimentStatuses)[number];
export type ExperimentDecision = (typeof experimentDecisions)[number];

export interface SponsorPackage {
  id: string;
  name: string;
  priceInr: number;
  availability: string;
  state: "open" | "locked" | "closed";
}

export interface ExperimentArtifact {
  localDirectory: string;
  packageManager: "npm";
  pinEnvironment: string;
  installCommand: [string, ...string[]];
  verifyCommand: [string, ...string[]];
  buildCommand: [string, ...string[]];
  outputDirectory: string;
  basePath: string;
}

export interface Experiment {
  slug: string;
  title: string;
  eyebrow: string;
  summary: string;
  hypothesis: string;
  repository: string;
  pinnedCommit: string;
  status: ExperimentStatus;
  launchDate: string | null;
  evaluationEnds: string | null;
  path: string;
  analyticsId: string;
  artifact: ExperimentArtifact;
  sponsorInventory: SponsorPackage[];
  metrics: {
    visitorsBand: string;
    completedPlays: number;
    shareRate: number | null;
    returnRate: number | null;
    sponsorRevenueInr: number;
  };
  decision: ExperimentDecision;
  fundedNext: string;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const shaPattern = /^[a-f0-9]{40}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const sponsorUnlocks = new Map([
  ["daily-challenge", 250],
  ["season", 1_000],
]);

function parseUtcDate(value: string | null | undefined): Date | null {
  if (!value || !datePattern.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed;
}

export function validateExperiment(value: unknown): asserts value is Experiment {
  if (!value || typeof value !== "object") throw new Error("Experiment must be an object.");
  const candidate = value as Partial<Experiment>;
  if (!candidate.slug || !slugPattern.test(candidate.slug)) throw new Error("Experiment slug is invalid.");
  if (!candidate.title || !candidate.summary || !candidate.hypothesis) throw new Error(`Experiment ${candidate.slug} is missing public copy.`);
  if (!candidate.repository?.startsWith("https://github.com/abhinavjagan/")) throw new Error(`Experiment ${candidate.slug} must point to the personal GitHub account.`);
  if (!experimentStatuses.includes(candidate.status as ExperimentStatus)) throw new Error(`Experiment ${candidate.slug} has an invalid status.`);
  if (!experimentDecisions.includes(candidate.decision as ExperimentDecision)) throw new Error(`Experiment ${candidate.slug} has an invalid decision.`);
  if (candidate.path !== `/e/${candidate.slug}/`) throw new Error(`Experiment ${candidate.slug} path must match its slug.`);
  if (candidate.artifact?.basePath !== candidate.path) throw new Error(`Experiment ${candidate.slug} build base must match its public path.`);
  if (!/^[A-Z][A-Z0-9_]+$/.test(candidate.artifact?.pinEnvironment ?? "")) throw new Error(`Experiment ${candidate.slug} needs a valid pin environment name.`);
  if (!candidate.artifact?.verifyCommand?.length) throw new Error(`Experiment ${candidate.slug} needs a pinned-source verification command.`);
  if (!candidate.pinnedCommit) throw new Error(`Experiment ${candidate.slug} needs a pin.`);
  if (!Array.isArray(candidate.sponsorInventory)) throw new Error(`Experiment ${candidate.slug} needs sponsor inventory.`);
  const sponsorIds = candidate.sponsorInventory.map((item) => item.id);
  if (sponsorIds.some((id) => !slugPattern.test(id)) || new Set(sponsorIds).size !== sponsorIds.length) {
    throw new Error(`Experiment ${candidate.slug} sponsor package IDs must be unique slugs.`);
  }
  if (!Number.isInteger(candidate.metrics?.completedPlays) || (candidate.metrics?.completedPlays ?? -1) < 0) {
    throw new Error(`Experiment ${candidate.slug} completed plays must be a non-negative integer.`);
  }
  for (const item of candidate.sponsorInventory) {
    const threshold = sponsorUnlocks.get(item.id);
    if (item.state === "open" && threshold !== undefined && candidate.metrics!.completedPlays < threshold) {
      throw new Error(`${item.name} cannot open before ${threshold.toLocaleString("en-IN")} completed plays.`);
    }
  }

  const isPrelaunch = candidate.status === "backlog" || candidate.status === "building";
  if (isPrelaunch) {
    if (candidate.launchDate !== null || candidate.evaluationEnds !== null) {
      throw new Error(`Experiment ${candidate.slug} must keep launchDate and evaluationEnds null before testing.`);
    }
  } else {
    const launchDate = parseUtcDate(candidate.launchDate);
    const evaluationEnds = parseUtcDate(candidate.evaluationEnds);
    if (!launchDate || !evaluationEnds) {
      throw new Error(`Experiment ${candidate.slug} needs valid launchDate and evaluationEnds dates.`);
    }
    const fourteenDays = 14 * 24 * 60 * 60 * 1_000;
    if (evaluationEnds.valueOf() - launchDate.valueOf() !== fourteenDays) {
      throw new Error(`Experiment ${candidate.slug} evaluationEnds must be exactly 14 calendar days after launchDate.`);
    }
  }
}

export function hasReleasePin(experiment: Experiment): boolean {
  return shaPattern.test(experiment.pinnedCommit);
}

export function isActiveExperiment(experiment: Experiment): boolean {
  return activeExperimentStatuses.includes(experiment.status as (typeof activeExperimentStatuses)[number]);
}

export function validateExperimentPortfolio(values: readonly unknown[]): asserts values is Experiment[] {
  values.forEach(validateExperiment);
  const portfolio = values as Experiment[];
  if (new Set(portfolio.map((item) => item.slug)).size !== portfolio.length) {
    throw new Error("Experiment slugs must be unique.");
  }
  if (new Set(portfolio.map((item) => item.path)).size !== portfolio.length) {
    throw new Error("Experiment paths must be unique.");
  }
  if (portfolio.filter((item) => item.status === "building").length > 1) {
    throw new Error("Cramzz may have at most one experiment building at a time.");
  }
  if (portfolio.filter((item) => item.status === "testing").length > 2) {
    throw new Error("Cramzz may have at most two experiments testing at a time.");
  }
}

validateExperimentPortfolio(experimentData);

export const experiments = experimentData as Experiment[];
export const activeExperiments = experiments.filter(isActiveExperiment);
export const featuredExperiment = activeExperiments[0];
export const sponsorExperiment = activeExperiments.find((experiment) =>
  experiment.sponsorInventory.some((item) => item.state === "open"),
);

export function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
