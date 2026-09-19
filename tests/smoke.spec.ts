import { expect, test } from "@playwright/test";

test("home exposes the flagship and trust navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Small bets");
  const playLink = page.getByRole("link", { name: /Play today’s experiment/ });
  await expect(playLink).toHaveAttribute("href", "/e/packet-panic/");
  await expect(playLink).not.toHaveAttribute("data-analytics-event", "experiment_view");
  await expect(page.locator('script:not([src])')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
});

test("only an available sponsor form is tagged as opened", async ({ page }) => {
  await page.goto("/sponsors/");
  for (const link of await page.getByRole("link", { name: "See unlock rule" }).all()) {
    await expect(link).not.toHaveAttribute("data-analytics-event", "sponsor_form_opened");
  }
  // Local/PR builds intentionally have no sponsor form URL and must not count
  // the fallback X conversation as a form opening.
  await expect(page.getByRole("link", { name: "Request this placement" })).not.toHaveAttribute(
    "data-analytics-event",
    "sponsor_form_opened",
  );
});

test("ledger and policy pages render", async ({ page }) => {
  await page.goto("/experiments/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Experiments");
  await page.getByRole("link", { name: "Read the brief" }).click();
  await expect(page).toHaveURL(/\/experiments\/packet-panic\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Packet Panic");

  await page.goto("/ledger/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Receipts");
  await expect(page.getByRole("cell", { name: "Packet Panic" })).toBeVisible();
  await page.goto("/sponsor-policy/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Useful context");
});

test("mobile navigation and 404 are usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".mobile-menu summary").click();
  await expect(page.locator(".mobile-menu").getByRole("link", { name: "Sponsor" })).toBeVisible();
  await page.goto("/definitely-not-a-route");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("packet");
});

test("social cards use crawler-compatible absolute PNG URLs", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://cramzz.space/og-default.png");
  await expect(page.locator('meta[property="og:image:type"]')).toHaveAttribute("content", "image/png");

  await page.goto("/e/packet-panic/");
  const packetImage = (await page.title()).includes("booting")
    ? "https://cramzz.space/og-default.png"
    : "https://cramzz.space/e/packet-panic/packet-panic-card.png";
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", packetImage);
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", packetImage);
});

test("the assembled Packet Panic artifact completes, shares, copies, and plays offline", async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => Object.assign(window, { __sharedData: data }),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => Object.assign(window, { __copiedText: text }),
      },
    });
  });
  await page.goto("/e/packet-panic/?p=2026-09-20&source=hub-acceptance");
  await expect(page.getByRole("heading", { name: /Packet Panic/i })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("Offline · game still works", { exact: true })).toBeVisible();
  for (const nodeId of ["edge", "relay", "gateway", "dst"]) {
    await page.locator(`[data-node-id="${nodeId}"]`).click();
  }
  await expect(page.getByText("PACKET DELIVERED", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Share result/i }).click();
  const shareData = await page.evaluate(() =>
    (window as Window & { __sharedData?: ShareData }).__sharedData,
  );
  expect(shareData?.url).toContain("/e/packet-panic/?p=2026-09-20");
  expect(shareData?.url).toContain("source=share");

  await page.getByRole("button", { name: "Copy score" }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  expect(await page.evaluate(() =>
    (window as Window & { __copiedText?: string }).__copiedText,
  )).toContain("Packet Panic #");
  await context.setOffline(false);
});
