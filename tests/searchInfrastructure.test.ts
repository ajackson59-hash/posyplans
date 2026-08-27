import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const robots = readFileSync(resolve(process.cwd(), "client/public/robots.txt"), "utf8");
const sitemap = readFileSync(resolve(process.cwd(), "client/public/sitemap.xml"), "utf8");

describe("search infrastructure", () => {
  it("keeps private event, host, recovery, checkout, and API paths out of crawlers", () => {
    for (const path of [
      "/api/",
      "/checkout/",
      "/dashboard/",
      "/draft-generating/",
      "/draft-overview/",
      "/intake",
      "/recover",
      "/rsvp/",
    ]) {
      expect(robots).toContain(`Disallow: ${path}`);
      expect(sitemap).not.toContain(`https://posyplans.com${path}`);
    }
  });

  it("points crawlers at the canonical sitemap and includes every public landing page", () => {
    expect(robots).toContain("Sitemap: https://posyplans.com/sitemap.xml");

    for (const path of [
      "/",
      "/pricing",
      "/baby-shower-planning",
      "/birthday-party-planning",
      "/graduation-party-planning",
      "/family-reunion-planning",
      "/holiday-party-planning",
      "/privacy",
      "/terms",
      "/refund-policy",
      "/sms-terms",
    ]) {
      expect(sitemap).toContain(`<loc>https://posyplans.com${path}</loc>`);
    }
  });
});
