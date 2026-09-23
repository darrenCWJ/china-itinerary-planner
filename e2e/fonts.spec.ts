import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

/**
 * The three font families, in a real browser.
 *
 * They are vendored under app/fonts/ now; fonts.css says why. The build proves
 * the files exist. Nothing else checks the two things the vendoring has to
 * keep true:
 *
 * - Every subset draws in its family's own font, through the family's CSS
 *   variable. Each next/font/local call in app/layout.tsx owns only its latin
 *   file, and it chains BY NAME to the faces fonts.css declares for the other
 *   subsets. Rename either side and every ł, ş and ạ in the city catalog
 *   quietly draws in Arial, with the build, tsc and the rest of the suite
 *   still green.
 * - Only the four latin files are preloaded, as `subsets: ["latin"]` did.
 *   The other fifteen are left to load on demand, and nothing here needs to
 *   pin that: each variable puts its latin family first, and that family
 *   covers ASCII, so a page without their glyphs never asks for them. (With
 *   every unicode-range stripped from fonts.css, /login still fetched just
 *   the four.)
 *
 * Signed out, on /login: the fonts belong to the root layout, and this is the
 * page the wall always serves.
 */

/** A few glyphs from each subset, all of which these fonts actually contain. */
const SAMPLES = {
  latin: "Aa",
  "latin-ext": "Łódź",
  vietnamese: "Hà Nội",
  cyrillic: "Москва",
  "cyrillic-ext": "Ә",
  greek: "Αθήνα",
} as const;

type Subset = keyof typeof SAMPLES;

/**
 * Each family's weights and the subsets Google publishes for it. One probe
 * per weight and subset is one probe per face: 37 in all, as in fonts.css
 * plus app/layout.tsx.
 */
const FAMILIES: { variable: string; font: string; weights: number[]; subsets: Subset[] }[] = [
  {
    variable: "--font-brico",
    font: "Bricolage Grotesque",
    weights: [600, 700, 800],
    subsets: ["latin", "latin-ext", "vietnamese"],
  },
  {
    variable: "--font-plex",
    font: "IBM Plex Sans",
    weights: [400, 500, 600],
    subsets: ["latin", "latin-ext", "vietnamese", "cyrillic", "cyrillic-ext", "greek"],
  },
  {
    variable: "--font-plexmono",
    font: "IBM Plex Mono",
    weights: [500, 600],
    subsets: ["latin", "latin-ext", "vietnamese", "cyrillic", "cyrillic-ext"],
  },
];

const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, "");

test("every subset of every family draws in its own font, through its CSS variable", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();

  // Each variable is the latin family next/font owns, then the family
  // fonts.css declares, then that family's metric-matched Arial.
  const values = await page.evaluate(
    (variables) => variables.map((v) => getComputedStyle(document.documentElement).getPropertyValue(v)),
    FAMILIES.map((f) => f.variable),
  );
  const chains = values.map((value) => value.split(",").map(unquote));
  for (const [i, chain] of chains.entries()) {
    expect(chain, FAMILIES[i].variable).toHaveLength(3);
    expect(chain[2], FAMILIES[i].variable).toBe(`${chain[1]} Fallback`);
  }

  const probes = FAMILIES.flatMap(({ variable, font, weights, subsets }) =>
    weights.flatMap((weight) =>
      subsets.map((subset) => ({ id: `font-probe-${variable.slice(2)}-${weight}-${subset}`, variable, font, weight, subset })),
    ),
  );
  await page.evaluate(
    ({ probes, samples }) => {
      for (const { id, variable, weight, subset } of probes) {
        const line = document.createElement("div");
        line.id = id;
        line.style.fontFamily = `var(${variable})`;
        line.style.fontWeight = String(weight);
        line.textContent = samples[subset as keyof typeof samples];
        document.body.appendChild(line);
      }
    },
    { probes, samples: SAMPLES },
  );

  // Which font drew the glyphs, asked of the browser itself. `familyName` is
  // the name inside the font file ("IBM Plex Mono Medium"), not the CSS
  // family, so a face reached under any name counts, and a glyph that fell
  // through to the Arial fallback does not. Every project here is Chromium.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const drawnBy = async (id: string) => {
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `#${id}` });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    return fonts.map((f) => (f.isCustomFont ? f.familyName : `${f.familyName} (system)`));
  };

  // Polled, because font-display: swap draws the fallback first and swaps
  // when each file arrives. On failure the received value is the list of
  // fonts that drew the probe; an empty list never passes.
  for (const { id, font, weight, subset } of probes) {
    await expect
      .poll(
        async () => {
          const names = await drawnBy(id);
          return names.length > 0 && names.every((name) => name.startsWith(font)) ? "ok" : names;
        },
        { message: `${font} ${weight}, ${subset}: drawn by` },
      )
      .toBe("ok");
  }

  // And by count. Lose one face and its glyphs fall to Arial, which the polls
  // above catch. Lose every face of one weight and the matcher takes the next
  // weight instead: the right font by name, a weight too bold, and only a
  // count notices. Every probe has drawn by now, so every face it reached has
  // loaded.
  const faces = await page.evaluate(() =>
    [...document.fonts].map((f) => ({ family: f.family, status: f.status })),
  );
  const loaded = (name: string) => faces.filter((f) => unquote(f.family) === name && f.status === "loaded").length;
  const declared = (name: string) => faces.filter((f) => unquote(f.family) === name).length;
  for (const [i, { variable, weights, subsets }] of FAMILIES.entries()) {
    const [latin, family, fallback] = chains[i];
    expect([declared(latin), loaded(latin)], `${variable}: latin faces`).toEqual([weights.length, weights.length]);
    const rest = weights.length * (subsets.length - 1);
    expect([declared(family), loaded(family)], `${variable}: ${family} faces`).toEqual([rest, rest]);
    expect(declared(fallback), `${variable}: ${fallback}`).toBe(1);
  }
});

test("only the four vendored latin files are preloaded", async ({ page }) => {
  await page.goto("/login");

  const hrefs = await page
    .locator('link[rel="preload"][as="font"]')
    .evaluateAll((links) =>
      links.map((l) => ({
        href: l.getAttribute("href"),
        type: l.getAttribute("type"),
        crossorigin: l.hasAttribute("crossorigin"),
      })),
    );
  expect(hrefs).toHaveLength(4);
  for (const { type, crossorigin } of hrefs) {
    expect(type).toBe("font/woff2");
    // Fonts are fetched in CORS mode, so a preload without it is a second,
    // wasted download rather than the one the @font-face rule uses.
    expect(crossorigin).toBe(true);
  }

  // By content, not by name: the emitted filenames are next/font's business.
  // Fetched signed out, so this also shows the wall lets them through.
  const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const preloaded = await Promise.all(
    hrefs.map(async ({ href }) => {
      const response = await page.request.get(href!);
      expect(response.status(), href!).toBe(200);
      return sha256(await response.body());
    }),
  );
  const fontsDir = join(__dirname, "..", "app", "fonts");
  const latinFiles = readdirSync(fontsDir, { recursive: true, encoding: "utf8" }).filter((f) =>
    f.endsWith("-latin.woff2"),
  );
  expect(latinFiles).toHaveLength(4);
  const vendored = latinFiles.map((f) => sha256(readFileSync(join(fontsDir, f))));
  expect(preloaded.sort()).toEqual(vendored.sort());
});
