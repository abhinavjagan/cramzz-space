# Production and rollback runbook

## First release

1. Publish `cramzz-exp-packet-panic` and copy its full 40-character release commit into `src/data/experiments.json` as `pinnedCommit`.
2. Set the same SHA as the GitHub repository variable and Render environment value `PACKET_PANIC_REF`.
3. Create the Render Static Site from this repository using `render.yaml`. Leave `cramzz.space` on the existing service.
4. Verify the Render preview URL: all routes, CSP headers, mobile layouts, Packet Panic assets, share URLs, analytics allow-list, and sponsor links.
5. Record the previous Spotify service URL and deployment identifier. Remove its custom domains without deleting or suspending the service.
6. Add `cramzz.space` and `www.cramzz.space` to the verified new static site. Configure `www` to redirect to the apex in Render.
7. Verify HTTPS, canonical URLs, `/robots.txt`, `/sitemap.xml`, `/404.html`, and the absence of Spotify redirects.

Do not revoke Spotify credentials until the new site passes this production check. Once it does, revoke credentials and tokens, retain the old service at its Render URL for 14 days, and mark the old repository archived. Deleting its service or data requires separate explicit confirmation.

## Roll back within 14 days

1. Remove the custom domains from the new static site.
2. Reattach both domains to the recorded Spotify service and confirm its certificate becomes valid.
3. If Spotify credentials have already been revoked, restore only after reviewing the old service for public debug endpoints and stored refresh tokens.
4. Record the incident in the experiment ledger. Do not erase the failed Cramzz deployment.

## Roll back a hub or experiment release

1. In Render, select the last known-good atomic deploy and choose **Rollback**.
2. If only Packet Panic is faulty, update `PACKET_PANIC_REF` to its last known-good full SHA and redeploy the unchanged hub.
3. Verify `/e/packet-panic/`, its immutable assets, the homepage, and the ledger.
4. Revert the registry pin in Git so the checked-in lock agrees with production.

## Stop conditions

Stop rather than improvise if DNS ownership is unclear, the preview contains secrets, the artifact is not pinned, HTTPS is invalid, or Render indicates a paid upgrade.
