import { describe, expect, it } from "vitest";
import {
  computeSliceRegions,
  reconcileRowBounds,
  snapToGuide,
  parseLinkFromName,
  formatNameWithLink,
  sanitizeFileName,
  normalizeUrl,
  dedupeFileNames,
  generateEmailHTML,
  groupSlicesIntoRows,
  type HtmlSlice,
} from "../src/index";

describe("computeSliceRegions", () => {
  it("returns one full-height region when there are no guides", () => {
    expect(computeSliceRegions([], 900)).toEqual([
      { index: 0, y0: 0, y1: 900, name: "slice-001" },
    ]);
  });

  it("splits at guides, deduped and sorted", () => {
    const r = computeSliceRegions([300, 100, 100.4], 900);
    expect(r.map(s => [s.y0, s.y1])).toEqual([[0, 100], [100, 300], [300, 900]]);
    expect(r.map(s => s.name)).toEqual(["slice-001", "slice-002", "slice-003"]);
  });

  it("ignores guides on or outside the frame edges", () => {
    expect(computeSliceRegions([0, 900, -5, 1200], 900)).toHaveLength(1);
  });
});

describe("reconcileRowBounds", () => {
  const band = { found: true, top: 800, bottom: 834, padTop: 790, padBottom: 850, cells: [] };

  it("keeps the user's row when it brackets the band tightly", () => {
    expect(reconcileRowBounds([780, 860], 924, band)).toEqual({
      y0: 780, y1: 860, usedExistingGuides: true,
    });
  });

  it("falls back to the padded band when the user's row swallowed other content", () => {
    const out = reconcileRowBounds([200, 900], 924, band);
    expect(out.usedExistingGuides).toBe(false);
    expect([out.y0, out.y1]).toEqual([790, 850]);
  });

  it("snaps the padded bounds onto a nearby guide", () => {
    // 795 is within GUIDE_SNAP_PX of padTop 790.
    const out = reconcileRowBounds([300, 795], 924, band);
    expect(out.y0).toBe(795);
  });
});

describe("snapToGuide", () => {
  it("snaps within 10px and leaves anything further alone", () => {
    expect(snapToGuide(100, [108])).toBe(108);
    expect(snapToGuide(100, [111])).toBe(100);
  });
});

describe("name and link parsing", () => {
  it("reads a trailing http(s) url as the link", () => {
    expect(parseLinkFromName("Hero (https://example.com)")).toEqual({
      cleanName: "Hero", linkUrl: "https://example.com",
    });
  });

  it("leaves non-url parentheses as part of the name", () => {
    expect(parseLinkFromName("Hero (final)")).toEqual({
      cleanName: "Hero (final)", linkUrl: null,
    });
  });

  it("round-trips, so renaming twice does not stack links", () => {
    const once = formatNameWithLink("Hero", "https://a.com");
    expect(formatNameWithLink(once, "https://b.com")).toBe("Hero (https://b.com)");
  });

  it("sanitizes file names and never returns empty", () => {
    expect(sanitizeFileName("Slice 003 — LinkedIn!")).toBe("slice-003-linkedin");
    expect(sanitizeFileName("!!!")).toBe("slice");
  });

  it("adds https to a bare host", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeUrl("  ")).toBe("");
  });

  it("dedupes colliding file names", () => {
    expect(dedupeFileNames([{ fileName: "a.jpg" }, { fileName: "a.jpg" }, { fileName: "a.jpg" }]))
      .toEqual([{ fileName: "a.jpg" }, { fileName: "a-1.jpg" }, { fileName: "a-2.jpg" }]);
  });
});

const slice = (o: Partial<HtmlSlice>): HtmlSlice => ({
  fileName: "s.jpg", width: 600, height: 100, absX: 0, absY: 0,
  colors: { top: { r: 0, g: 0, b: 0 }, bottom: { r: 255, g: 255, b: 255 } },
  ...o,
});

describe("groupSlicesIntoRows", () => {
  it("groups by absY within 2px and orders each row by absX", () => {
    const rows = groupSlicesIntoRows([
      slice({ absY: 0, absX: 200 }), slice({ absY: 1, absX: 0 }), slice({ absY: 100, absX: 0 }),
    ]);
    expect(rows.map(r => r.map(s => s.absX))).toEqual([[0, 200], [0]]);
  });
});

describe("generateEmailHTML", () => {
  it("wraps a linked slice in an anchor and leaves an unlinked one bare", () => {
    const html = generateEmailHTML([slice({ linkUrl: "https://a.com?x=1&y=2" })], false);
    expect(html).toContain('<a href="https://a.com?x=1&amp;y=2" target="_blank"');
    expect(generateEmailHTML([slice({})], false)).not.toContain("<a href");
  });

  it("makes multi-column widths sum to exactly 600", () => {
    const html = generateEmailHTML(
      [200, 201, 199].map((w, i) => slice({ absY: 0, absX: i * 200, width: w, fileName: `c${i}.jpg` })),
      false
    );
    const widths = [...html.matchAll(/<td[^>]*width="(\d+)"/g)].map(m => Number(m[1]));
    expect(widths.reduce((a, b) => a + b, 0)).toBe(600);
  });

  it("emits the footer merge tag only when asked", () => {
    expect(generateEmailHTML([slice({})], true)).toContain("{{${email_footer}}}");
    expect(generateEmailHTML([slice({})], false)).not.toContain("email_footer");
  });

  it("escapes alt text", () => {
    expect(generateEmailHTML([slice({ alt: 'Say "hi" & <go>' })], false))
      .toContain('alt="Say &quot;hi&quot; &amp; &lt;go&gt;"');
  });

  it("survives a slice with no sampled edge colors", () => {
    expect(() => generateEmailHTML([slice({ colors: null })], false)).not.toThrow();
  });
});
