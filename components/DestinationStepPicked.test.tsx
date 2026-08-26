import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CatalogHit } from "@/lib/tripShared";
import { DestinationStep } from "./DestinationStep";

/**
 * The render end of Task 15's lazy enrichment.
 *
 * `app/plan/page.tsx` fetches a blurb for a city the build never pre-fetched
 * and writes it to `extras[qid].description`. Until this file existed nothing
 * asserted that the string ever reached a user: `extras` has exactly one
 * consumer, the `picked` memo below, and `PickedPlace` had no `description`
 * field — so the fetched value was stored and dropped one hop later, and the
 * whole feature was invisible. A test that only checks the state was written
 * would have passed throughout. This one reads the DOM.
 *
 * Deliberately NOT named `DestinationStep.test.tsx`: Task 19's brief creates a
 * file at that path with prescribed content and would overwrite this one.
 *
 * `MapExplorer` is stubbed out. It owns four fetches and a topology parse and
 * has its own suite; what is under test here is the chain
 * `extras` -> `picked` -> `PlaceSearch` chip -> DOM.
 */
vi.mock("@/components/map/MapExplorer", () => ({
  MapExplorer: () => null,
}));

/**
 * Miraflores, Lima region: row `G3934876` of `public/cities/PE.json`,
 * population 187,401, and absent from `public/cities/enrich/PE.json` — which
 * holds 30 of that shard's 750 rows. It is one of the 720 Peruvian cities
 * (96%) whose only possible blurb is the lazy fetch, which is why it is the
 * fixture. The description is the shape Wikidata's `schema:description`
 * returns: one short noun phrase.
 */
const MIRAFLORES: CatalogHit = {
  qid: "G3934876",
  name: "Miraflores",
  localName: null,
  province: "Lima region",
  description: "district of Lima, Peru",
  population: 187_401,
  attractionCount: 0,
};

const BLURB = "district of Lima, Peru";

function renderStep(extras: Record<string, CatalogHit>) {
  render(
    <DestinationStep
      selected={Object.keys(extras)}
      visited={[]}
      extras={extras}
      days={5}
      onToggleSelect={() => {}}
      onToggleVisited={() => {}}
      onAddCatalog={() => {}}
      onRemoveCatalog={() => {}}
      onReorder={() => {}}
      onMonthPicked={() => {}}
      country="PE"
      onCountryChange={() => {}}
      onAddOffMap={() => {}}
      offMap={[]}
    />
  );
}

beforeEach(() => {
  // PlaceSearch loads the open country's shard on mount. A country with no
  // shard is a normal case it already swallows, so this is the quiet answer.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DestinationStep renders what the enrichment fetch stored", () => {
  test("shows the description a catalog pick carries", () => {
    renderStep({ [MIRAFLORES.qid]: MIRAFLORES });

    // The assertion the Critical finding turns on: a non-null description in
    // `extras` is visible text, not just state. Fails if `PickedPlace` loses
    // the field, if the `picked` memo stops carrying `hit.description`, or if
    // the chip stops rendering it.
    expect(screen.getByText(BLURB)).toBeInTheDocument();
  });

  test("attaches it to the chip for that city and no other", () => {
    // Two picks, one enriched and one not: this is what separates "the blurb
    // is rendered against its own city" from "some blurb is on the page".
    const lima: CatalogHit = {
      qid: "G3936456",
      name: "Lima",
      localName: null,
      province: "Lima region",
      description: null,
      population: 7_737_002,
      attractionCount: 0,
    };
    renderStep({ [MIRAFLORES.qid]: MIRAFLORES, [lima.qid]: lima });

    const chips = screen.getAllByRole("listitem");
    const miraflores = chips.find((li) => li.textContent?.includes("Miraflores"));
    const limaChip = chips.find((li) => li.textContent?.startsWith("Lima"));

    expect(miraflores?.textContent).toContain(BLURB);
    // The unenriched city renders no blurb at all, rather than an empty node
    // or a placeholder — that is the accepted state for a city Wikidata has
    // nothing for, and it must stay distinguishable from an enriched one.
    expect(limaChip?.textContent).not.toContain(BLURB);
  });

  test("renders nothing where a null description would go", () => {
    // The control for the two above: if the chip rendered a blurb slot
    // unconditionally, the first test would pass against a component that had
    // never read `description` at all.
    renderStep({ [MIRAFLORES.qid]: { ...MIRAFLORES, description: null } });

    expect(screen.getByText("Miraflores")).toBeInTheDocument();
    expect(screen.queryByText(BLURB)).not.toBeInTheDocument();
  });

  test("carries the full blurb in the chip's title, whatever the truncation shows", () => {
    // The chip truncates to keep the pill one line tall. Truncation is CSS, so
    // the text node is whole either way — but the title is what a user gets on
    // hover, and it must be the untruncated string.
    renderStep({ [MIRAFLORES.qid]: MIRAFLORES });

    expect(screen.getByText(BLURB)).toHaveAttribute("title", BLURB);
  });
});
