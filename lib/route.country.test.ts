import { describe, expect, test } from "vitest";
import type { Airport } from "./airports";
import { getCountryProfile } from "./countryProfile";
import { estimateLeg, suggestRoute, TRANSPORT, type RoutePlace } from "./route";

/**
 * Peru, because it is the country the estimator was lying about.
 *
 * `lib/route.test.ts` is untouched by this task and stays that way: it pins the
 * China path, and the point of the optional `transport` parameter is that the
 * China path did not move. Everything here is the other side of that parameter.
 *
 * Every fixture is real. City coordinates are the ones the app ships in
 * `public/cities/PE.json`; the airports are the exact rows from
 * `data/airports.json`. Nothing below is a constructed meridian, because the
 * claim being tested — "there is no train from Lima to Cusco" — is about a real
 * place and would be worth nothing measured against an invented one.
 */
const lima: RoutePlace = { id: "lima", name: "Lima", lat: -12.04318, lon: -77.02824 };
const cusco: RoutePlace = { id: "cusco", name: "Cusco", lat: -13.53188, lon: -71.96701 };
const arequipa: RoutePlace = { id: "arequipa", name: "Arequipa", lat: -16.39899, lon: -71.53747 };
const iquitos: RoutePlace = { id: "iquitos", name: "Iquitos", lat: -3.74814, lon: -73.2529 };

const LIM: Airport = { iata: "LIM", icao: "SPJC", name: "Jorge Chávez International Airport", municipality: "Lima", country: "PE", lat: -12.0219, lon: -77.114305, size: "large" };
const CUZ: Airport = { iata: "CUZ", icao: "SPZO", name: "Alejandro Velasco Astete International Airport", municipality: "Cusco", country: "PE", lat: -13.535699844400002, lon: -71.9387969971, size: "large" };
const AQP: Airport = { iata: "AQP", icao: "SPQU", name: "Rodríguez Ballón International Airport", municipality: "Arequipa", country: "PE", lat: -16.340786, lon: -71.569485, size: "large" };
const IQT: Airport = { iata: "IQT", icao: "SPQT", name: "Coronel FAP Francisco Secada Vignetta International Airport", municipality: "Iquitos", country: "PE", lat: -3.78474, lon: -73.3088, size: "large" };

const PE_AIRPORTS: Airport[] = [LIM, CUZ, AQP, IQT];

const PE = getCountryProfile("PE").transport;
const CN = getCountryProfile("CN").transport;

/** Whichever of mode or kind actually describes how this leg is travelled. */
function travelledAs(from: RoutePlace, to: RoutePlace, airports: Airport[], transport = TRANSPORT) {
  const leg = estimateLeg(from, to, airports, transport);
  return leg.kind === "estimated" ? leg.mode : leg.kind;
}

describe("railKmh: null is load-bearing", () => {
  test("the fixtures are armed: Peru withholds a rail speed, China does not", () => {
    // Without this every assertion below could be passing because Peru's
    // profile is China's, or because both are empty.
    expect(PE.railKmh).toBeNull();
    expect(CN.railKmh).toBe(230);
    expect(CN.bookingCopy.length).toBeGreaterThan(0);
    expect(CN.bookingCopy.join(" ")).toMatch(/12306/);
  });

  test("the estimator's default parameter is the default country's profile", () => {
    // This is the whole zero-edit proof in one assertion: every pre-existing
    // route test calls the three-argument form, and the three-argument form is
    // the four-argument form with China's profile.
    expect(TRANSPORT).toEqual(CN);
    expect(estimateLeg(lima, cusco, PE_AIRPORTS)).toEqual(estimateLeg(lima, cusco, PE_AIRPORTS, CN));
    expect(suggestRoute([lima, cusco], PE_AIRPORTS)).toEqual(
      suggestRoute([lima, cusco], PE_AIRPORTS, CN)
    );
  });

  test("Lima → Cusco: a 🚄 rail leg under China's profile, a flight under Peru's", () => {
    // The defect, pinned from both ends. There is no railway between Lima and
    // Cusco; the app scored the 573 km at China's 230 km/h and drew a train.
    const shipped = estimateLeg(lima, cusco, PE_AIRPORTS, CN);
    expect(shipped.kind).toBe("estimated");
    if (shipped.kind !== "estimated") return;
    expect(shipped.mode).toBe("rail");
    expect(shipped.hours).toBe(3);

    //   airportKm 586 (LIM → CUZ), transfers 10 km + 3 km
    //   hours = roundHalf(586/700 + 2.5 + 13/60)
    //         = roundHalf(0.8371 + 2.5 + 0.2167) = roundHalf(3.5538) = 3.5
    const now = estimateLeg(lima, cusco, PE_AIRPORTS, PE);
    expect(now.kind).toBe("estimated");
    if (now.kind !== "estimated") return;
    expect(now.mode).toBe("flight");
    expect(now.airports?.from.iata).toBe("LIM");
    expect(now.airports?.to.iata).toBe("CUZ");
    expect(now.hours).toBe(3.5);
    // The distance the traveller covers has not changed, only the mode.
    expect(now.km).toBe(shipped.km);
    expect(now.km).toBe(573);
  });

  test("with no airport data at all the leg is overland: real km, no hours", () => {
    const leg = estimateLeg(lima, cusco, [], PE);
    expect(leg.kind).toBe("overland");
    if (leg.kind !== "overland") return;
    expect(leg.km).toBe(573);
    // The teeth: the property is absent, not zero and not undefined. A leg
    // carrying `hours: 573/60 = 9.5` would render as a 9.5 h drive; Lima to
    // Cusco is roughly 20 h by coach.
    expect(Object.keys(leg).sort()).toEqual(["from", "kind", "km", "to"]);
    expect("hours" in leg).toBe(false);
  });

  test("an airport out of range is the same as no airport: overland", () => {
    // IQT is 1005 km from Lima and 1094 km from Cusco — far outside the 150 km
    // search radius, so neither end resolves a pair.
    const leg = estimateLeg(lima, cusco, [IQT], PE);
    expect(leg.kind).toBe("overland");
    if (leg.kind !== "overland") return;
    expect(leg.km).toBe(573);
    expect(Object.keys(leg).sort()).toEqual(["from", "kind", "km", "to"]);
  });

  test("no Peru fixture comes back rail — and the scan can see rail when it is there", () => {
    const fixtures: { label: string; from: RoutePlace; to: RoutePlace; airports: Airport[] }[] = [
      { label: "Lima → Cusco, airports known", from: lima, to: cusco, airports: PE_AIRPORTS },
      { label: "Lima → Cusco, no airport data", from: lima, to: cusco, airports: [] },
      { label: "Lima → Cusco, only a distant airport", from: lima, to: cusco, airports: [IQT] },
      { label: "Lima → Iquitos, airports known", from: lima, to: iquitos, airports: PE_AIRPORTS },
      { label: "Cusco → Arequipa, airports known", from: cusco, to: arequipa, airports: PE_AIRPORTS },
      { label: "Cusco → Arequipa, no airport data", from: cusco, to: arequipa, airports: [] },
      { label: "Arequipa → Iquitos, airports known", from: arequipa, to: iquitos, airports: PE_AIRPORTS },
    ];

    const peru = fixtures.map((f) => travelledAs(f.from, f.to, f.airports, PE));
    expect(peru).not.toContain("rail");

    // The scan ran over what it claims to have run over, and it saw both
    // outcomes a country with no rail can produce. A one-directional "never
    // rail" passes just as well against an estimator that returns nothing.
    expect(peru).toHaveLength(fixtures.length);
    expect(fixtures.length).toBeGreaterThanOrEqual(7);
    expect(peru).toContain("flight");
    expect(peru).toContain("overland");
    expect(peru).not.toContain("unknown");

    // And the arming that matters most: the identical scan under China's
    // profile is full of rail, so "not rail" above is a fact about the
    // profile and not about the geometry or about a broken scan.
    const china = fixtures.map((f) => travelledAs(f.from, f.to, f.airports, CN));
    expect(china.filter((m) => m === "rail").length).toBeGreaterThanOrEqual(5);
    expect(china).not.toContain("overland");
  });
});

describe("the rail booking copy follows the rail", () => {
  test("an all-overland Peru route earns no note; the same geometry in China earns the copy", () => {
    const peru = suggestRoute([lima, cusco], [IQT], PE);
    expect(peru.legs.map((l) => l.kind)).toEqual(["overland"]);
    expect(peru.notes).toEqual([]);

    // The arming, and the guard's only witness: this route reaches the
    // all-ground predicate — one ground leg, 573 km, well under the flight
    // threshold — and is turned away by `railKmh !== null` alone.
    const china = suggestRoute([lima, cusco], [IQT], CN);
    expect(china.legs.map((l) => l.kind)).toEqual(["estimated"]);
    expect(china.notes).toEqual(CN.bookingCopy);
    expect(china.notes.join(" ")).toMatch(/12306/);
  });

  test("a flown Peru route names the flight and never names rail", () => {
    const { notes } = suggestRoute([lima, cusco], PE_AIRPORTS, PE);
    // Positive half first, so "no rail copy" cannot pass on an empty notes list.
    expect(notes.join(" ")).toMatch(/worth flying/i);
    expect(notes.join(" ")).toMatch(/Cusco/);
    expect(notes.join(" ")).toMatch(/Lima/);
    expect(notes.join(" ")).not.toMatch(/rail|12306|Trip\.com|high-speed/i);
  });
});

describe("totalKm counts the overland legs", () => {
  test("an all-overland Peru route totals the same distance as the same route in China", () => {
    const places = [lima, cusco, arequipa];
    const peru = suggestRoute(places, [], PE);
    const china = suggestRoute(places, [], CN);

    expect(peru.legs.every((l) => l.kind === "overland")).toBe(true);
    expect(china.legs.every((l) => l.kind === "estimated")).toBe(true);
    // Order is geometry, not transport — so any difference in the total is a
    // difference in what was counted, which is the whole assertion.
    expect(peru.order.map((p) => p.id)).toEqual(china.order.map((p) => p.id));
    expect(peru.totalKm).toBe(china.totalKm);
    expect(peru.totalKm).toBe(895);
  });

  test("a mixed flight-and-overland route totals both kinds of leg", () => {
    // Only Lima and Cusco have an airport in this list, so the Iquitos leg is
    // overland and the Lima → Cusco leg is flown.
    const places = [lima, cusco, iquitos];
    const airports = [LIM, CUZ];
    const peru = suggestRoute(places, airports, PE);
    const china = suggestRoute(places, airports, CN);

    const kinds = peru.legs.map((l) => l.kind);
    expect(kinds).toContain("overland");
    expect(kinds).toContain("estimated");
    expect(peru.totalKm).toBe(china.totalKm);
    expect(peru.totalKm).toBe(1585);
  });
});

describe("the notes the old hardcoded string used to guard", () => {
  /**
   * `route.test.ts` asserts three times that the all-rail note is absent, by
   * matching /Every leg/i against the string this task replaced. Those three
   * assertions still pass, but they can no longer fail — the words are gone.
   * The same three cases are restated here against the copy that is actually
   * emitted now, so the coverage moved rather than evaporated.
   */
  const suzhou: RoutePlace = { id: "suzhou", name: "Suzhou", lat: 31.299, lon: 120.585 };
  const shanghai: RoutePlace = { id: "shanghai", name: "Shanghai", lat: 31.23, lon: 121.474 };
  const beijing: RoutePlace = { id: "beijing", name: "Beijing", lat: 39.904, lon: 116.407 };
  const village: RoutePlace = { id: "village", name: "Grandma’s village", lat: null, lon: null };
  const remote: RoutePlace = { id: "remote", name: "Remote valley", lat: 30.0, lon: 95.0 };
  const PEK: Airport = { iata: "PEK", icao: "ZBAA", name: "Beijing Capital International Airport", municipality: "Beijing", country: "CN", lat: 40.08, lon: 116.585, size: "large" };
  const SHA: Airport = { iata: "SHA", icao: "ZSSS", name: "Shanghai Hongqiao International Airport", municipality: "Shanghai", country: "CN", lat: 31.198, lon: 121.336, size: "large" };

  test("a short all-rail Chinese route still gets the booking copy", () => {
    // The positive control the three absence checks below are measured against.
    expect(suggestRoute([shanghai, suzhou]).notes).toEqual(CN.bookingCopy);
  });

  test("an unmeasurable leg withholds it", () => {
    expect(suggestRoute([shanghai, suzhou, village]).notes).not.toContain(CN.bookingCopy[0]);
  });

  test("a grounded leg withholds it", () => {
    const { notes } = suggestRoute([beijing, remote], [PEK, SHA]);
    expect(notes.join(" ")).toMatch(/no airport/i);
    expect(notes).not.toContain(CN.bookingCopy[0]);
  });
});
