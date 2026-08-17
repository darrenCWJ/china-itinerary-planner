import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { CountryHero, httpUrl } from "./CountryHero";

/**
 * Whether the scrim produces *adequate* contrast over a given photograph is
 * visual-regression territory (spec §9) and is not asserted here. What is
 * asserted is the structural half of spec §4.4 rule 1, which is the half that
 * regresses silently: that the scrim renders at all when there is no image to
 * "need" one, and that it sits between the background and the content rather
 * than under both or over both.
 *
 * `CN` and `AL` are the two paths through `pickHero`: China has an ingested
 * Commons photograph in `data/country-images.json`, Albania has none. If that
 * file is ever regenerated without CN the image-path tests fail loudly, which
 * is the correct outcome — they are about the image path existing.
 */

const PHOTOGRAPHED = "CN";
const UNPHOTOGRAPHED = "AL";

afterEach(cleanup);

function renderHero(code: string) {
  const { container } = render(
    <CountryHero countryCode={code} className="p-6 text-white">
      <h1>Wander</h1>
    </CountryHero>
  );
  return {
    container,
    scrims: container.querySelectorAll("[data-scrim]"),
    background: container.querySelector("[data-hero-bg]"),
    photo: container.querySelector("img"),
  };
}

describe("CountryHero", () => {
  test("renders a photograph for a country that has one", () => {
    const { photo } = renderHero(PHOTOGRAPHED);

    expect(photo).toHaveAttribute("src", expect.stringContaining("commons.wikimedia.org"));
    // Decorative: the trip name and the country name sit above it.
    expect(photo).toHaveAttribute("alt", "");
  });

  test("falls back to the accent gradient, not a blank band", () => {
    const { photo, background } = renderHero(UNPHOTOGRAPHED);

    expect(photo).toBeNull();
    expect(background).not.toBeNull();
    expect(background?.getAttribute("style")).toMatch(/linear-gradient\(135deg, oklch\(/);
  });

  test("renders exactly one scrim over a photograph", () => {
    expect(renderHero(PHOTOGRAPHED).scrims).toHaveLength(1);
  });

  test("renders the scrim over the gradient too — it is not the image's scrim", () => {
    expect(renderHero(UNPHOTOGRAPHED).scrims).toHaveLength(1);
  });

  test("renders the scrim for an unknown country code, without throwing", () => {
    const { scrims, photo } = renderHero("ZZ");

    expect(scrims).toHaveLength(1);
    expect(photo).toBeNull();
  });

  test.each([
    ["a photograph", PHOTOGRAPHED],
    ["the gradient", UNPHOTOGRAPHED],
  ])("stacks the scrim between %s and the content", (_label, code) => {
    const { container, scrims, background } = renderHero(code);
    const scrim = scrims[0];
    const content = screen.getByRole("heading", { name: "Wander" });
    // A band with no background layer at all would make the ordering assertions
    // below vacuously true, so it fails here instead.
    if (!background) throw new Error(`${code} rendered no background layer`);

    // Both layers are behind the content (negative z-index), so their order in
    // the document is what puts the scrim on top of the background.
    expect(background.compareDocumentPosition(scrim) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(scrim.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    // And all three are inside the one band, not scattered up the tree.
    expect(container.firstElementChild?.contains(scrim)).toBe(true);
  });

  test("credits the photographer and links both the source and the licence", () => {
    renderHero(PHOTOGRAPHED);

    const artist = screen.getByRole("link", { name: /Aranas/ });
    expect(artist).toHaveAttribute(
      "href",
      expect.stringContaining("commons.wikimedia.org/wiki/File:")
    );
    expect(artist).toHaveAttribute("rel", "noopener noreferrer");

    const deed = screen.getByRole("link", { name: /^CC / });
    expect(deed).toHaveAttribute("href", expect.stringContaining("creativecommons.org"));
  });

  test("renders no credit line when there is no photograph to attribute", () => {
    renderHero(UNPHOTOGRAPHED);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText(/^Photo/)).toBeNull();
  });

  test("renders the caller's content", () => {
    renderHero(PHOTOGRAPHED);

    expect(screen.getByRole("heading", { name: "Wander" })).toBeInTheDocument();
  });
});

describe("httpUrl", () => {
  test("passes http and https through unchanged", () => {
    expect(httpUrl("https://commons.wikimedia.org/wiki/File:X.jpg")).toBe(
      "https://commons.wikimedia.org/wiki/File:X.jpg"
    );
    expect(httpUrl("http://example.org/a.jpg")).toBe("http://example.org/a.jpg");
  });

  test("rejects a script URL, which is the whole point of the check", () => {
    expect(httpUrl("javascript:alert(1)")).toBeUndefined();
    // eslint-disable-next-line no-script-url
    expect(httpUrl("JavaScript:alert(1)")).toBeUndefined();
    expect(httpUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  test("rejects a missing or unparseable URL", () => {
    expect(httpUrl(null)).toBeUndefined();
    expect(httpUrl("")).toBeUndefined();
    expect(httpUrl("/relative/path.jpg")).toBeUndefined();
  });
});
