import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixtures";
import { detectSectionOffsets, detectSocialBand } from "../src/index";

// These are the numbers the Figma plugin produces today, captured off the same
// two renders the original Node harness was tuned against. They are not
// "correct" in any absolute sense — they are the baseline. If a change here
// moves them, that is the change asking to be justified.

describe("hbomax-moments (600x924)", () => {
  const img = loadFixture("hbomax-moments-emkt.jpg");

  it("cuts the seven gaps between cards", () => {
    expect(detectSectionOffsets(img, 1, img.height, 12, 60)).toEqual([
      135, 287, 381, 471, 568, 644, 789,
    ]);
  });

  it("finds the social row and names all three icons", () => {
    const band = detectSocialBand(img, 1, img.width, img.height)!;
    expect(band.found).toBe(true);
    expect([band.top, band.bottom]).toEqual([800, 834]);
    // padTop was 798 until padding learnt to look past speckle bands the
    // way isolation already did; the 8px above are decorative glow.
    expect([band.padTop, band.padBottom]).toEqual([790, 868]);
    expect(band.cells.map(c => (c.isIcon ? c.platform : "gap"))).toEqual([
      "gap", "facebook", "linkedin", "instagram", "gap",
    ]);
  });

  it("produces cells that tile the full row width", () => {
    const band = detectSocialBand(img, 1, img.width, img.height)!;
    expect(band.cells[0].x0).toBe(0);
    expect(band.cells[band.cells.length - 1].x1).toBe(img.width);
    for (let i = 1; i < band.cells.length; i++) {
      expect(band.cells[i].x0).toBe(band.cells[i - 1].x1);
    }
  });
});

describe("wbd-fandoms (1080x2857)", () => {
  const img = loadFixture("wbd-email-fandoms.jpg");

  it("cuts the background gaps between sections", () => {
    expect(detectSectionOffsets(img, 1, img.height, 12, 60)).toEqual([
      85, 217, 284, 807, 903, 982, 1071, 1540, 1674, 1778, 1851,
      2148, 2230, 2292, 2438, 2501, 2572, 2651,
    ]);
  });

  it("finds a four-icon social row in the footer", () => {
    const band = detectSocialBand(img, 1, img.width, img.height)!;
    expect(band.found).toBe(true);
    expect([band.top, band.bottom]).toEqual([2727, 2771]);
    // The fourth icon has no template (only linkedin/facebook/instagram exist),
    // so it mis-matches linkedin. Locked in deliberately: the web app lets you
    // retype a cell's platform, and this is the case that needs it.
    expect(band.cells.map(c => (c.isIcon ? c.platform : "gap"))).toEqual([
      "gap", "linkedin", "facebook", "instagram", "linkedin", "gap",
    ]);
  });
});

describe("wbd-emmy26 (600x1908)", () => {
  const img = loadFixture("wbd-email-emmy26.png");

  // A diagonal light streak hugs the left edge and touches the icon row, so
  // on the loose mask the row and the streak form one 72px band that sits
  // too close to the CTA button above to count as isolated. The strict-mask
  // re-split has to kick in for non-isolated bands, not only oversized ones.
  it("finds the four-icon social row under the CTA despite the light streak", () => {
    const band = detectSocialBand(img, 1, img.width, img.height)!;
    expect(band.found).toBe(true);
    expect([band.top, band.bottom]).toEqual([1690, 1728]);
    expect([band.padTop, band.padBottom]).toEqual([1664, 1763]);
    // First icon is a globe, which has no template yet, so it mis-matches.
    expect(band.cells.map(c => (c.isIcon ? c.platform : "gap"))).toEqual([
      "gap", "linkedin", "facebook", "linkedin", "instagram", "gap",
    ]);
  });
});

describe("work-area bounds", () => {
  const img = loadFixture("hbomax-moments-emkt.jpg");

  it("only proposes cuts inside the given range", () => {
    const cuts = detectSectionOffsets(img, 1, img.height, 12, 60, { y0: 300, y1: 700 });
    expect(cuts.every(c => c > 300 && c < 700)).toBe(true);
    expect(cuts).toContain(471);
  });

  it("ignores a social row outside the range", () => {
    // The icon band lives at y 800-834.
    expect(detectSocialBand(img, 1, img.width, img.height, { y0: 0, y1: 700 })).toBeNull();
  });

  it("still finds the social row when the range contains it", () => {
    const band = detectSocialBand(img, 1, img.width, img.height, { y0: 700, y1: 924 })!;
    expect(band.found).toBe(true);
    expect([band.top, band.bottom]).toEqual([800, 834]);
  });
});
