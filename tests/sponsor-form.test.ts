import { describe, expect, it } from "vitest";
import { approvedSponsorFormUrl } from "../src/lib/sponsorForm";

describe("sponsor form destination", () => {
  it("allows only credential-free HTTPS Tally URLs", () => {
    expect(approvedSponsorFormUrl("https://tally.so/r/demo?source=cramzz"))
      .toBe("https://tally.so/r/demo?source=cramzz");
    expect(approvedSponsorFormUrl("http://tally.so/r/demo")).toBeUndefined();
    expect(approvedSponsorFormUrl("https://user:pass@tally.so/r/demo")).toBeUndefined();
    expect(approvedSponsorFormUrl("https://tally.so:444/r/demo")).toBeUndefined();
    expect(approvedSponsorFormUrl("https://evil.example/r/demo")).toBeUndefined();
    expect(approvedSponsorFormUrl("not a URL")).toBeUndefined();
  });
});
