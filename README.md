# Cramzz Lab

The static home of `cramzz.space`: a public laboratory for small, shareable internet experiments. Astro generates the hub, and independently versioned experiment repositories are vendored into its final `dist/` tree at exact Git commits.

## Local development

Node 22.12 or newer is required; production uses Node 22.19.

```sh
npm ci
npm run dev
```

`npm run build` type-checks, tests, scans for common committed secrets, builds the hub, and then attempts to build `../cramzz-exp-packet-panic` into `dist/e/packet-panic/`. If the sibling is absent, a launch-soon route remains in non-strict local builds.

## Release contract

Every item in `src/data/experiments.json` owns a URL `/e/<slug>/` and declares:

- public metadata, hypothesis, status, dates, analytics ID, sponsor inventory, and evidence;
- an external repository and full 40-character `pinnedCommit` before release;
- install, pinned-source verification, and build commands; artifact directory; local sibling directory; pin-environment name; and matching base path. The repository-specific `verifyCommand` must run tests and leave a production artifact in `dist/` (`npm run check` for Packet Panic; template-derived experiments normally use `npm run verify`).

Packet Panic must build with `VITE_BASE_PATH=/e/packet-panic/` and emit both `dist/index.html` and `dist/experiment.json`. In strict mode the vendor script requires the registry pin and `PACKET_PANIC_REF` to be the same full SHA, verifies that commit is in `origin/main`, passes it as `EXPERIMENT_SOURCE_COMMIT`, runs `npm ci` plus the declared `verifyCommand`, and verifies the built manifest contains that same SHA before replacing the hub fallback. No floating or unreviewed ref is accepted. Repository branch protection is expected to require the Packet Panic CI check before `main` can advance.

Before the first production build, set the registry pin plus `PACKET_PANIC_REF` in GitHub repository variables and Render. Keep `VENDOR_MODE=strict` in production. At cutover, set `REQUIRE_LAUNCH_DATE=true` on the live Render service only after the registry and pinned experiment both record the real launch date; this makes a production rebuild fail closed if either artifact is still in preview mode.

## Configuration

Copy `.env.example` locally when needed. Public PostHog and Tally values are safe to expose by design; never add Razorpay secrets or sponsor records to this repository. Analytics is a no-op without a public key and uses a fixed event/property allow-list with no autocapture, session replay, geolocation, or person profiles. A random site-only visitor ID is stored for at most 30 days—enough to measure a 14-day experiment—then rotated; GPC and Do Not Track are respected. The vendor script maps the hub's `PUBLIC_POSTHOG_*` configuration to Packet Panic's build-time `VITE_POSTHOG_*` variables and forwards `PUBLIC_SPONSOR_FORM_URL` as `VITE_SPONSOR_FORM_URL`. The hub uses local system font stacks and makes no third-party font requests.

## Commands

- `npm run check` — Astro and TypeScript validation
- `npm test` — registry contract tests
- `npm run build:hub` — hub only, retaining the fallback route
- `npm run vendor:experiments` — build/copy pinned or local experiment artifacts
- `npm run build` — complete local verification and assembly
- `npm run test:e2e` — Playwright smoke suite across desktop and mobile engines
- `npm run scan:secrets` — deterministic repository secret-pattern check

Deployment and domain migration steps are in [`docs/ROLLBACK.md`](docs/ROLLBACK.md).
