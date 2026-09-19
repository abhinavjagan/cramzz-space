import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(join(root, "src/data/experiments.json"), "utf8"));
const mode = process.env.VENDOR_MODE ?? "optional";
const commitPattern = /^[a-f0-9]{40}$/;
if (!["optional", "strict"].includes(mode)) {
  throw new Error("VENDOR_MODE must be either optional or strict.");
}

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}

for (const experiment of registry) {
  const artifact = experiment.artifact;
  if (!artifact) continue;

  const registryPin = experiment.pinnedCommit;
  const environmentPin = process.env[artifact.pinEnvironment];
  if (environmentPin && environmentPin !== registryPin) {
    throw new Error(
      `${experiment.slug} ${artifact.pinEnvironment} must exactly match the reviewed registry pinnedCommit.`,
    );
  }
  if (mode === "strict") {
    if (!commitPattern.test(registryPin)) {
      throw new Error(`${experiment.slug} registry pinnedCommit must be a full 40-character commit SHA.`);
    }
    if (!commitPattern.test(environmentPin ?? "")) {
      throw new Error(`${experiment.slug} ${artifact.pinEnvironment} must be a full 40-character commit SHA.`);
    }
  }
  const pin = registryPin;
  const localSource = resolve(root, artifact.localDirectory);
  const destination = join(root, "dist", "e", experiment.slug);
  let source = localSource;
  let temporarySource = false;

  if (commitPattern.test(pin)) {
    const vendorRoot = join(root, ".vendor", experiment.slug);
    rmSync(vendorRoot, { recursive: true, force: true });
    mkdirSync(vendorRoot, { recursive: true });
    run("git", ["init", "--quiet"], vendorRoot);
    run("git", ["remote", "add", "origin", `${experiment.repository}.git`], vendorRoot);
    run("git", ["fetch", "--no-tags", "origin", "refs/heads/main:refs/remotes/origin/main"], vendorRoot);
    const commitExists = spawnSync("git", ["cat-file", "-e", `${pin}^{commit}`], {
      cwd: vendorRoot,
      stdio: "inherit",
    });
    if (commitExists.status !== 0) {
      throw new Error(`${experiment.slug} pin does not name a commit in the fetched origin/main history.`);
    }
    const ancestry = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", pin, "refs/remotes/origin/main"],
      { cwd: vendorRoot, stdio: "inherit" },
    );
    if (ancestry.status !== 0) {
      throw new Error(`${experiment.slug} pin is not an ancestor of origin/main; production accepts tested main history only.`);
    }
    run("git", ["checkout", "--quiet", pin], vendorRoot);
    source = vendorRoot;
    temporarySource = true;
  } else if (!existsSync(localSource)) {
    const message = `${experiment.slug}: no pinned release and no local sibling; keeping the hub's launch-soon page.`;
    if (mode === "strict") throw new Error(message);
    console.warn(message);
    continue;
  }

  const buildEnvironment = {
    VITE_BASE_PATH: artifact.basePath,
    CRAMZZ_BASE_PATH: artifact.basePath,
    VITE_POSTHOG_KEY: process.env.VITE_POSTHOG_KEY ?? process.env.PUBLIC_POSTHOG_KEY ?? "",
    VITE_POSTHOG_HOST: process.env.VITE_POSTHOG_HOST ?? process.env.PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    VITE_SPONSOR_FORM_URL: process.env.VITE_SPONSOR_FORM_URL ?? process.env.PUBLIC_SPONSOR_FORM_URL ?? "",
  };
  // Packet Panic stamps this exact release source into dist/experiment.json.
  // Omit the variable entirely for local previews so the source's explicit
  // UNPINNED sentinel survives; only release artifacts receive a SHA.
  if (commitPattern.test(pin)) buildEnvironment.EXPERIMENT_SOURCE_COMMIT = pin;

  // A local sibling may be running its dev server while the hub is assembled.
  // Reuse its lockfile-installed dependencies instead of destructively replacing
  // node_modules with `npm ci`; pinned production checkouts are always clean.
  if (temporarySource || !existsSync(join(source, "node_modules"))) {
    run(artifact.installCommand[0], artifact.installCommand.slice(1), source);
  }
  if (temporarySource) {
    // This repository-specific command must run its tests and produce dist/.
    run(artifact.verifyCommand[0], artifact.verifyCommand.slice(1), source, buildEnvironment);
  } else {
    run(artifact.buildCommand[0], artifact.buildCommand.slice(1), source, buildEnvironment);
  }

  const builtArtifact = resolve(source, artifact.outputDirectory);
  if (!existsSync(join(builtArtifact, "index.html"))) {
    throw new Error(`${experiment.slug} did not produce ${artifact.outputDirectory}/index.html`);
  }
  const builtManifestPath = join(builtArtifact, "experiment.json");
  if (!existsSync(builtManifestPath)) {
    throw new Error(`${experiment.slug} did not produce ${artifact.outputDirectory}/experiment.json`);
  }
  const builtManifest = JSON.parse(readFileSync(builtManifestPath, "utf8"));
  const manifestExpectations = {
    slug: experiment.slug,
    repository: experiment.repository,
    analyticsIdentifier: experiment.analyticsId,
    status: experiment.status,
    launchDate: experiment.launchDate,
  };
  for (const [field, expected] of Object.entries(manifestExpectations)) {
    if (builtManifest[field] !== expected) {
      throw new Error(
        `${experiment.slug} artifact manifest ${field} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(builtManifest[field])}.`,
      );
    }
  }
  if (mode === "strict" && builtManifest.pinnedCommit !== pin) {
    throw new Error(
      `${experiment.slug} artifact pin mismatch: expected ${pin}, received ${builtManifest.pinnedCommit ?? "null"}.`,
    );
  }

  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(builtArtifact, destination, { recursive: true });
  console.log(`${experiment.slug}: vendored ${temporarySource ? pin : "local workspace"} -> ${destination}`);
}
