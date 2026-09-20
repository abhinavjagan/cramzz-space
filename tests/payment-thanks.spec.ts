import { expect, test, type Page } from "@playwright/test";

interface RecordedAnalyticsCall {
  event: string;
  properties: Record<string, unknown>;
}

async function recordAnalyticsCalls(page: Page) {
  await page.addInitScript(() => {
    const state = window as Window & {
      __analyticsCalls?: RecordedAnalyticsCall[];
      cramzzAnalytics?: { track: (event: string, properties?: Record<string, unknown>) => void };
    };
    state.__analyticsCalls = [];
    let installedAnalytics: typeof state.cramzzAnalytics;

    Object.defineProperty(window, "cramzzAnalytics", {
      configurable: true,
      get: () => installedAnalytics,
      set: (next: typeof installedAnalytics) => {
        installedAnalytics = {
          track(event, properties = {}) {
            state.__analyticsCalls?.push({ event, properties });
            next?.track(event, properties);
          },
        };
      },
    });
  });
}

async function analyticsCalls(page: Page): Promise<RecordedAnalyticsCall[]> {
  return page.evaluate(() => (
    (window as Window & { __analyticsCalls?: RecordedAnalyticsCall[] }).__analyticsCalls ?? []
  ));
}

test("payment return renders with a 200, noindex, and captured-payment warning", async ({ page }) => {
  const response = await page.goto("/payment-thanks/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Payment return received — Cramzz Lab");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thanks. We’ll verify it from here.");
  await expect(page.getByText(/Returning to this page does not confirm payment/)).toBeVisible();
  await expect(page.getByText(/Razorpay shows the payment as captured/)).toBeVisible();
});

test("initial route load emits exactly one payment return without rendering sensitive query data", async ({ page }) => {
  await recordAnalyticsCalls(page);
  const secrets = [
    "pay_private_123",
    "plink_private_456",
    "reference_private_789",
    "signature_private_abc",
    "person@example.com",
    "9999999999",
  ];
  const query = new URLSearchParams({
    utm_source: "x-launch",
    utm_campaign: "founding_nodes",
    utm_medium: "email",
    razorpay_payment_id: secrets[0]!,
    razorpay_payment_link_id: secrets[1]!,
    razorpay_payment_link_reference_id: secrets[2]!,
    razorpay_signature: secrets[3]!,
    email: secrets[4]!,
    phone: secrets[5]!,
  });

  await page.goto(`/payment-thanks/?${query.toString()}`);
  await expect.poll(() => analyticsCalls(page)).toHaveLength(1);

  expect(await analyticsCalls(page)).toEqual([{
    event: "payment_returned",
    properties: { experiment_id: "packet-panic-v1" },
  }]);
  const renderedText = await page.locator("body").innerText();
  for (const secret of secrets) expect(renderedText).not.toContain(secret);
});

test("a direct visit and reload each emit one route event", async ({ page }) => {
  await recordAnalyticsCalls(page);

  await page.goto("/payment-thanks/");
  await expect.poll(() => analyticsCalls(page)).toHaveLength(1);
  expect(await analyticsCalls(page)).toEqual([{
    event: "payment_returned",
    properties: { experiment_id: "packet-panic-v1" },
  }]);

  await page.reload();
  await expect.poll(() => analyticsCalls(page)).toHaveLength(1);
  expect(await analyticsCalls(page)).toEqual([{
    event: "payment_returned",
    properties: { experiment_id: "packet-panic-v1" },
  }]);
});

test("a build with no open sponsor still renders safely and emits no payment event", async ({ page }) => {
  await page.route("**/payment-thanks/", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/\sdata-payment-experiment-id="[^"]*"/, "");
    await route.fulfill({ response, body });
  });
  await recordAnalyticsCalls(page);

  const response = await page.goto("/payment-thanks/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("[data-payment-experiment-id]")).toHaveCount(0);
  await expect(page.getByText(/Returning to this page does not confirm payment/)).toBeVisible();
  expect(await analyticsCalls(page)).toEqual([]);
});
