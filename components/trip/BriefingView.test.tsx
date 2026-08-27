import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { buildBriefing } from "@/lib/briefing";
import type { TripPayload } from "@/lib/tripShared";
import { BriefingView } from "./BriefingView";

/**
 * T28, surface 3 of 3 — and the one that matters most.
 *
 * `app/b/[code]/page.tsx` renders this for anyone holding the bearer link: no
 * account, no membership, no way to ask where the advice came from. They see
 * `plan.tips`, so they see the disclaimer about them too.
 *
 * The briefing is built through the real `buildBriefing` rather than from a
 * hand-written `Briefing` literal. That is deliberate: a literal would let this
 * file assert that BriefingView renders whatever it is handed while the
 * production path silently handed it `[]`, which is precisely the shape of
 * hollow test this repo keeps finding. Building it for real means the country
 * resolution — `tripCountry(payload.data)` → `getCountryProfile` → `gapNote` —
 * is under test here too.
 */

function payload(country: string | undefined, tips: string[]): TripPayload {
  return {
    id: "abc123",
    version: 3,
    updatedAt: 1_700_000_000_000,
    data: {
      tripName: "A trip",
      startDate: "2026-12-24",
      input: {
        destinationIds: ["c1"],
        days: 1,
        season: "winter",
        adults: 2,
        kids: 0,
        interests: ["food"],
        ...(country === undefined ? {} : { country }),
      },
      plan: {
        days: [
          {
            day: 1,
            destinationId: "c1",
            destinationName: "Lima",
            items: [{ id: "i1", slot: "morning", kind: "arrival", title: "Land" }],
          },
        ],
        tips,
      },
      packing: [],
      foods: [],
      destinationNames: ["Lima"],
    },
    members: [],
    checks: [],
    tickets: [],
    expenses: [],
    journal: [],
  } as unknown as TripPayload;
}

/** The public link's options — redacted, no booking secrets. */
const PUBLIC = { redacted: true, includeBookings: false } as const;

const TIP = "Carry your passport everywhere.";

function renderBriefing(country: string | undefined, tips: string[] = [TIP]) {
  return render(<BriefingView briefing={buildBriefing(payload(country, tips), PUBLIC)} />);
}

/** The Logistics section, found by its heading rather than by a class. */
function logistics(): HTMLElement {
  const section = screen.getByRole("heading", { name: "Logistics" }).parentElement;
  expect(section).not.toBeNull();
  return section as HTMLElement;
}

const PERU_LINE_ONE =
  "These notes come from open reference data. We don't have Peru-specific guidance on payments, " +
  "connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.";

afterEach(cleanup);

describe("BriefingView — the gap note on the unauthenticated briefing", () => {
  test("a bearer-link holder on a Peru trip is told where the notes came from", () => {
    renderBriefing("PE");
    expect(screen.getByRole("note")).toHaveTextContent(PERU_LINE_ONE);
    expect(screen.getByRole("note").querySelectorAll("p")).toHaveLength(1);
  });

  test("the note is beside the tips list, not one of the tips", () => {
    renderBriefing("PE");

    const section = logistics();
    const list = within(section).getByRole("list");
    const note = screen.getByRole("note");

    // Armed: the list exists and holds the tip the note disclaims.
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText(TIP)).toBeInTheDocument();

    expect(list).not.toContainElement(note);
    expect(note.closest("ul")).toBeNull();
    expect(note.closest("li")).toBeNull();
    expect(within(list).queryByText(/open reference data/)).toBeNull();
    expect(section).toContainElement(note);
  });

  test("a China trip renders none of it", () => {
    renderBriefing("CN");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/open reference data/)).toBeNull();
    // Armed: the section it would have appeared in is on screen, with a tip.
    expect(within(logistics()).getAllByRole("listitem")).toHaveLength(1);
  });

  test("a legacy trip with no country stored is a China trip, and gets none either", () => {
    // `tripCountry`'s `?? "CN"` backfill. A briefing that started disclaiming
    // "we have no guidance on…" for every trip saved before the country field
    // existed would be a regression dressed as honesty.
    renderBriefing(undefined);
    expect(screen.queryByRole("note")).toBeNull();
  });

  test("a sparse country names exactly the fields we lack", () => {
    renderBriefing("SH");
    const paragraphs = [...screen.getByRole("note").querySelectorAll("p")].map((p) => p.textContent);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]).toBe(
      "Our data also has no currency, plug types, mains voltage or dialling code for " +
        "this country."
    );
  });

  test("a briefing with no tips at all still explains itself", () => {
    renderBriefing("PE", []);
    expect(within(logistics()).queryByRole("list")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(PERU_LINE_ONE);
  });
});
